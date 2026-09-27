# MIT License

# Copyright (c) 2025 VAST-AI-Research and contributors.

# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:

# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.

# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE

from safetensors.torch import load_file
import torch
from dataclasses import dataclass, field
import numpy as np
import open3d as o3d
import trimesh
import os
import time
import argparse
from omegaconf import OmegaConf
from typing import *

from triposf.modules import sparse as sp
from misc import get_device, find

def normalize_mesh(mesh_path):
    scene = trimesh.load(mesh_path, process=False, force='scene')
    meshes = []
    for node_name in scene.graph.nodes_geometry:
        geom_name = scene.graph[node_name][1]
        geometry = scene.geometry[geom_name]
        transform = scene.graph[node_name][0]
        if isinstance(geometry, trimesh.Trimesh):
            geometry.apply_transform(transform)
            meshes.append(geometry)

    mesh = trimesh.util.concatenate(meshes)

    center = mesh.bounding_box.centroid
    mesh.apply_translation(-center)
    scale = max(mesh.bounding_box.extents)
    mesh.apply_scale(2.0 / scale * 0.5)

    return mesh

def load_quantized_mesh_original(
    mesh_path, 
    volume_resolution=256,
    use_normals=True,
    pc_sample_number=4096000,
):
    cube_dilate = np.array(
            [
                [0, 0, 0],
                [0, 0, 1],
                [0, 1, 0],
                [0, 0, -1],
                [0, -1, 0],
                [0, 1, 1],
                [0, -1, 1],
                [0, 1, -1],
                [0, -1, -1],

                [1, 0, 0],
                [1, 0, 1],
                [1, 1, 0],
                [1, 0, -1],
                [1, -1, 0],
                [1, 1, 1],
                [1, -1, 1],
                [1, 1, -1],
                [1, -1, -1],

                [-1, 0, 0],
                [-1, 0, 1],
                [-1, 1, 0],
                [-1, 0, -1],
                [-1, -1, 0],
                [-1, 1, 1],
                [-1, -1, 1],
                [-1, 1, -1],
                [-1, -1, -1],
            ]
        ) / (volume_resolution * 4 - 1)
        
    
    mesh = o3d.io.read_triangle_mesh(str(mesh_path))
    vertices = np.clip(np.asarray(mesh.vertices), -0.5 + 1e-6, 0.5 - 1e-6)
    faces = np.asarray(mesh.triangles)
    mesh.vertices = o3d.utility.Vector3dVector(vertices)

    voxelization_mesh = o3d.geometry.VoxelGrid.create_from_triangle_mesh_within_bounds(
            mesh,
            voxel_size=1. / volume_resolution,
            min_bound=[-0.5, -0.5, -0.5],
            max_bound=[0.5, 0.5, 0.5]
        )
    voxel_mesh = np.asarray([voxel.grid_index for voxel in voxelization_mesh.get_voxels()])

    points_normals_sample = trimesh.Trimesh(vertices=vertices, faces=faces).sample(count=pc_sample_number, return_index=True)
    points_sample = points_normals_sample[0].astype(np.float32)
    voxelization_points = o3d.geometry.VoxelGrid.create_from_point_cloud_within_bounds(
            o3d.geometry.PointCloud(
                o3d.utility.Vector3dVector(
                    np.clip(
                        (points_sample[np.newaxis] + cube_dilate[..., np.newaxis, :]).reshape(-1, 3),
                        -0.5 + 1e-6, 0.5 - 1e-6)
                    )
                ),
            voxel_size=1. / volume_resolution,
            min_bound=[-0.5, -0.5, -0.5],
            max_bound=[0.5, 0.5, 0.5]
        )
    voxel_points = np.asarray([voxel.grid_index for voxel in voxelization_points.get_voxels()])
    voxels = torch.Tensor(np.unique(np.concatenate([voxel_mesh, voxel_points]), axis=0))

    if use_normals:
        mesh.compute_triangle_normals()
        normals_sample = np.asarray(
                            mesh.triangle_normals
                        )[points_normals_sample[1]].astype(np.float32)
        points_sample = torch.cat((torch.Tensor(points_sample), torch.Tensor(normals_sample)), axis=-1)
    
    return voxels, points_sample

class TripoSFVAEInference(torch.nn.Module):
    @dataclass
    class Config:
        local_pc_encoder_cls: str = ""
        local_pc_encoder: dict = field(default_factory=dict)

        encoder_cls: str = ""
        encoder: dict = field(default_factory=dict)

        decoder_cls: str = ""   
        decoder: dict = field(default_factory=dict)

        resolution: int = 256
        sample_points_num: int = 819_200
        use_normals: bool = True
        pruning: bool = False

        weight: Optional[str] = None

    cfg: Config

    def __init__(self, cfg):
        super().__init__()
        self.cfg = cfg
        self.configure()

    def load_weights(self):
        if self.cfg.weight is not None:
            print("Pretrained VAE Loading...")
            state_dict = load_file(self.cfg.weight)
            self.load_state_dict(state_dict)

    def configure(self) -> None:
        self.local_pc_encoder = find(self.cfg.local_pc_encoder_cls)(**self.cfg.local_pc_encoder).eval()
        for p in self.local_pc_encoder.parameters():
            p.requires_grad = False

        self.encoder = find(self.cfg.encoder_cls)(**self.cfg.encoder).eval()
        for p in self.encoder.parameters():
            p.requires_grad = False

        self.decoder = find(self.cfg.decoder_cls)(**self.cfg.decoder).eval()
        for p in self.decoder.parameters():
            p.requires_grad = False

        self.load_weights()

    @torch.no_grad()
    def forward(self, points_sample, sparse_voxel_coords):
        with torch.autocast("cuda", dtype=torch.float32):
            sparse_pc_features = self.local_pc_encoder(points_sample, sparse_voxel_coords, res=self.cfg.resolution, bbox_size=(-0.5, 0.5))
        sparse_tensor = sp.SparseTensor(sparse_pc_features, sparse_voxel_coords)
        latent, posterior = self.encoder(sparse_tensor)
        mesh = self.decoder(latent, pruning=self.cfg.pruning)
        return mesh
    
    @classmethod
    def from_config(cls, config_path):
        config = OmegaConf.load(config_path)
        cfg = OmegaConf.merge(OmegaConf.structured(TripoSFVAEInference.Config), config)
        return cls(cfg)
    
if __name__ == "__main__":
    # Usage: `python inference.py --mesh-path "assets/examples/loong.obj" --output-dir "outputs/" --config "configs/triposfVAE_1024.yaml"`
    parser = argparse.ArgumentParser("TripoSF Reconstruction")
    parser.add_argument("--config", required=True, help="path to config file")
    parser.add_argument("--output-dir", default="outputs/", help="path to output folder")
    parser.add_argument("--mesh-path", type=str, help="the input mesh to be reconstructed")

    args, extras = parser.parse_known_args()
    device = get_device()
    save_name = os.path.split(args.mesh_path)[-1].split(".")[0]

    model = TripoSFVAEInference.from_config(args.config).to(device)

    os.makedirs(args.output_dir, exist_ok=True)

    print(f"Mesh Normalizing...")
    preprocess_start = time.time()
    mesh_gt = normalize_mesh(args.mesh_path)
    save_path_gt = f"{args.output_dir}/{save_name}_gt.obj"
    trimesh.Trimesh(vertices=mesh_gt.vertices.tolist(), faces=mesh_gt.faces.tolist()).export(save_path_gt)
    preprocess_end = time.time()
    print(f"Mesh Normalizing Time: {(preprocess_end - preprocess_start):.2f}")
    
    print(f"Mesh Loading...")
    input_loading_start = time.time()
    sparse_voxels, points_sample = load_quantized_mesh_original(
                                                            save_path_gt, 
                                                            volume_resolution=model.cfg.resolution, 
                                                            use_normals=model.cfg.use_normals, 
                                                            pc_sample_number=model.cfg.sample_points_num,
                                                        )
    input_loading_end = time.time()
    print(f"Mesh Loading Time: {(input_loading_end - input_loading_start):.2f}")
    
    print(f"Mesh Reconstructing...")
    sparse_voxels, points_sample = sparse_voxels.to(device), points_sample.to(device)
    sparse_voxels_sp = torch.cat([torch.zeros_like(sparse_voxels[..., :1]), sparse_voxels], dim=-1).int()

    inference_start = time.time()
    with torch.cuda.amp.autocast(dtype=torch.float16):
        mesh_recon = model(points_sample[None], sparse_voxels_sp)[0]
    inference_end = time.time()
    print(f"Mesh Reconstructing Time: {(inference_end - inference_start):.2f}")

    save_path_recon = f"{args.output_dir}/{save_name}_reconstruction.obj"
    trimesh.Trimesh(vertices=mesh_recon.vertices.tolist(), faces=mesh_recon.faces.tolist()).export(save_path_recon)