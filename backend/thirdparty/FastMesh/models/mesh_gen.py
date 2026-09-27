import torch
import torch.nn as nn
import copy
import numpy as np
import time
from scipy.spatial import KDTree
from .models import register, MODELS
from huggingface_hub import PyTorchModelHubMixin

def copy_state_dict(cur_state_dict, pre_state_dict, prefix = '', drop_prefix='', fix_loaded=False):
    success_layers, failed_layers = [], []
    def _get_params(key):
        key = key.replace(drop_prefix,'')
        key = prefix + key
        if key in pre_state_dict:
            return pre_state_dict[key]
        return None

    for k in cur_state_dict.keys():
        v = _get_params(k)
        try:
            if v is None:
                failed_layers.append(k)
                continue
            cur_state_dict[k].copy_(v)
            if prefix in k and prefix!='':
                k=k.split(prefix)[1]
            success_layers.append(k)
        except:
            print('copy param {} failed, mismatched'.format(k)) # logging.info
            continue
    print('missing parameters of layers:{}'.format(failed_layers))

    if fix_loaded and len(failed_layers)>0:
        print('fixing the layers that were loaded successfully, while train the layers that failed,')
        for k in cur_state_dict.keys():
            try:
                if k in success_layers:
                    cur_state_dict[k].requires_grad=False
            except:
                print('fixing the layer {} failed'.format(k))

    return success_layers

def load_model(pretrained_model, model, prefix = '', drop_prefix='',optimizer=None, **kwargs):

    # pretrained_model = torch.load(path)
    current_model = model.state_dict()
    if isinstance(pretrained_model, dict):
        if 'model_state_dict' in pretrained_model:
            pretrained_model = pretrained_model['model_state_dict']
    copy_state_dict(current_model, pretrained_model, prefix = prefix, drop_prefix=drop_prefix, **kwargs)

    return model

def compute_vertex_normals(point_cloud, vertices, k=10):
    vertices = (vertices-vertices.min())/(vertices.max()-vertices.min())*2 - 1

    # Separate coordinates and normals from the point cloud
    coords = point_cloud[:, :3]
    normals = point_cloud[:, 3:]
    
    # Build KDTree for nearest neighbor search
    tree = KDTree(coords)
    vertex_normals = np.zeros((vertices.shape[0], 3))
    
    for i, v in enumerate(vertices):
        # Query the k nearest neighbors of vertex v
        _, indices = tree.query(v, k=k)
        
        # Average the normals of the neighbors
        neighbor_normals = normals[indices]
        avg_normal = np.mean(neighbor_normals, axis=0)
        
        # Normalize the resulting normal vector
        norm = np.linalg.norm(avg_normal) + 1e-8  # Avoid division by zero
        vertex_normals[i] = avg_normal / norm
    
    return vertex_normals

@register("MeshGen")
class MeshGen(nn.Module, PyTorchModelHubMixin):
    def __init__(self, **kwargs):
        super().__init__()

        self.vert_args = kwargs.copy()
        self.vert_args['n_discrete_size'] = 128
        self.vert_gen = MODELS[self.vert_args['vert_model']](self.vert_args)

        self.face_args = kwargs.copy()
        self.face_args['n_discrete_size'] = 512
        self.face_gen = MODELS[self.face_args['face_model']](self.face_args)


        if self.vert_args['vertgen_ckpt'] is not None:
            load_model(torch.load(self.vert_args['vertgen_ckpt'], map_location=torch.device("cpu"), weights_only=False)["model"], self.vert_gen)
        if self.face_args['vertgen_ckpt'] is not None:
            load_model(torch.load(self.face_args['facegen_ckpt'], map_location=torch.device("cpu"), weights_only=False)["model"], self.face_gen)

    def forward(self, data_dict: dict, is_eval: bool=True) -> dict:
        vertices, _  = self.vert_gen(data_dict, is_eval=is_eval)
        sequence = vertices.clone().long()
        sequence[sequence!=-1] = ((vertices[vertices!=-1]+0.5)*self.face_args['n_discrete_size']).long()

        data_dict['vertices'] = vertices
        data_dict['sequence'] = sequence
        gen_mesh = self.face_gen(data_dict, is_eval=is_eval)
        
        return gen_mesh    