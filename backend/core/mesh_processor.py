"""High-performance multi-threaded mesh processor for ForMash3D.

Utilizes all available CPU cores (os.cpu_count()) for postprocessing,
decimation, smoothing, marching cubes, and LOD generation operations.
"""
from __future__ import annotations

import copy
import json
import logging
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple, Union

import numpy as np
import trimesh
import trimesh.smoothing

from core.scheduler.resource_planner import configure_cpu_runtime, cpu_count

logger = logging.getLogger(__name__)


def get_optimal_thread_count(requested: Optional[int] = None) -> int:
    """Resolve the optimal number of CPU worker threads for mesh operations."""
    if requested is not None and requested > 0:
        return max(1, requested)
    return max(1, os.cpu_count() or 8)


def marching_cubes(
    volume: np.ndarray,
    level: float = 0.0,
    spacing: Optional[Tuple[float, float, float]] = None,
    num_threads: Optional[int] = None,
) -> Tuple[np.ndarray, np.ndarray]:
    """Multi-threaded marching cubes isosurface extraction.

    Configures CPU runtime to utilize all CPU cores and extracts vertices and faces.
    """
    threads = get_optimal_thread_count(num_threads)
    configure_cpu_runtime(threads)

    # 1. Try PyMCubes (C++ multi-threaded marching cubes)
    try:
        import mcubes
        volume_c = np.ascontiguousarray(volume, dtype=np.float32)
        verts, faces = mcubes.marching_cubes(volume_c, float(level))
        if spacing is not None and len(verts) > 0:
            scale = np.asarray(spacing, dtype=np.float32)
            verts = verts * scale
        return verts, faces
    except Exception as mc_err:
        logger.debug("mcubes extraction fallback: %s", mc_err)

    # 2. Try skimage.measure.marching_cubes
    try:
        import skimage.measure
        sp = spacing if spacing is not None else (1.0, 1.0, 1.0)
        verts, faces, _, _ = skimage.measure.marching_cubes(
            volume, level=float(level), spacing=sp
        )
        return np.asarray(verts, dtype=np.float32), np.asarray(faces, dtype=np.int64)
    except Exception as ski_err:
        logger.warning("skimage marching cubes failed: %s", ski_err)
        raise RuntimeError(f"Marching cubes extraction failed: {ski_err}") from ski_err


def smooth_mesh(
    mesh: Union[trimesh.Trimesh, trimesh.Scene],
    iterations: int = 5,
    method: str = "taubin",
    num_threads: Optional[int] = None,
    **kwargs: Any,
) -> Union[trimesh.Trimesh, trimesh.Scene]:
    """Apply multi-threaded surface smoothing to a mesh or scene."""
    threads = get_optimal_thread_count(num_threads)
    configure_cpu_runtime(threads)

    if isinstance(mesh, trimesh.Scene):
        # Parallelize smoothing across scene parts using ThreadPoolExecutor
        if not mesh.geometry:
            return mesh
        results: Dict[str, trimesh.Trimesh] = {}
        with ThreadPoolExecutor(max_workers=min(len(mesh.geometry), threads)) as executor:
            future_to_name = {
                executor.submit(
                    smooth_mesh, geom, iterations, method, threads, **kwargs
                ): name
                for name, geom in mesh.geometry.items()
                if isinstance(geom, trimesh.Trimesh)
            }
            for fut in as_completed(future_to_name):
                name = future_to_name[fut]
                results[name] = fut.result()
        for name, geom in results.items():
            mesh.geometry[name] = geom
        return mesh

    if not isinstance(mesh, trimesh.Trimesh) or len(mesh.faces) == 0:
        return mesh

    method_lower = str(method).lower().strip()
    try:
        if method_lower == "taubin":
            lamb = float(kwargs.get("lamb", 0.5))
            nu = float(kwargs.get("nu", -0.53))
            smoothed = trimesh.smoothing.filter_taubin(
                mesh, lamb=lamb, nu=nu, iterations=iterations
            )
            return smoothed
        elif method_lower == "laplacian":
            lamb = float(kwargs.get("lamb", 0.5))
            smoothed = trimesh.smoothing.filter_laplacian(
                mesh, lamb=lamb, iterations=iterations
            )
            return smoothed
        elif method_lower == "humphrey":
            smoothed = trimesh.smoothing.filter_humphrey(
                mesh, iterations=iterations
            )
            return smoothed
        else:
            smoothed = trimesh.smoothing.filter_taubin(
                mesh, iterations=iterations
            )
            return smoothed
    except Exception as exc:
        logger.warning("Smoothing fallback due to error: %s", exc)
        return mesh


def decimate_mesh(
    mesh: Union[trimesh.Trimesh, trimesh.Scene],
    target_faces: int,
    num_threads: Optional[int] = None,
) -> Union[trimesh.Trimesh, trimesh.Scene]:
    """Decimate mesh to target face count using multi-threaded quadric edge collapse."""
    return MeshProcessor.simplify_mesh(mesh, target_faces=target_faces, num_threads=num_threads)


class MeshProcessor:
    """Multi-threaded mesh processing utility with multi-core CPU utilization."""

    @staticmethod
    def load_mesh(mesh_path: Union[str, Path]) -> trimesh.Trimesh:
        """Load a mesh from file."""
        mesh_path = Path(mesh_path)
        if not mesh_path.exists():
            raise FileNotFoundError(f"Mesh file not found: {mesh_path}")

        try:
            mesh = trimesh.load(mesh_path)
            if isinstance(mesh, trimesh.Scene):
                mesh = mesh.to_geometry()

            logger.info(
                f"Loaded mesh: {len(mesh.vertices)} vertices, {len(mesh.faces)} faces"
            )
            return mesh
        except Exception as e:
            logger.error(f"Failed to load mesh from {mesh_path}: {str(e)}")
            raise

    @staticmethod
    def normalise_mesh(
        mesh: Union[trimesh.Trimesh, trimesh.Scene],
    ) -> Union[trimesh.Trimesh, trimesh.Scene]:
        """Normalise a mesh to fit within a unit sphere."""
        try:
            mesh.apply_scale(1.0 / mesh.bounding_box.extents.max())
            return mesh
        except Exception as e:
            logger.error(f"Failed to normalise mesh: {str(e)}")
            return mesh

    @staticmethod
    def normalize_mesh(mesh: trimesh.Trimesh, scale: float = 1.0) -> trimesh.Trimesh:
        """Normalize mesh to fit within a unit sphere."""
        try:
            mesh.apply_translation(-mesh.centroid)
            max_extent = mesh.bounding_box.extents.max()
            if max_extent > 0:
                mesh.apply_scale(scale / max_extent)
            return mesh
        except Exception as e:
            logger.error(f"Failed to normalize mesh: {str(e)}")
            return mesh

    @staticmethod
    def save_mesh(
        mesh: trimesh.Trimesh,
        output_path: Union[str, Path],
        format: str = "glb",
        do_normalise: bool = True,
    ) -> Path:
        """Save a mesh to file."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            if do_normalise:
                mesh = MeshProcessor.normalise_mesh(mesh)
            mesh.export(output_path)
            logger.info(f"Saved mesh to {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Failed to save mesh to {output_path}: {str(e)}")
            raise

    @staticmethod
    def save_scene(
        scene: trimesh.Scene,
        output_path: Union[str, Path],
        format: str = "glb",
        do_normalise: bool = True,
    ) -> Path:
        """Save a scene to file."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        try:
            if do_normalise:
                scene = MeshProcessor.normalise_mesh(scene)
            scene.export(output_path)
            logger.info(
                f"Saved scene with {len(scene.geometry)} parts to {output_path}"
            )
            return output_path
        except Exception as e:
            logger.error(f"Failed to save scene to {output_path}: {str(e)}")
            raise

    @staticmethod
    def validate_mesh(mesh: trimesh.Trimesh) -> bool:
        """Validate mesh quality and topology."""
        try:
            if len(mesh.vertices) == 0 or len(mesh.faces) == 0:
                logger.warning("Mesh is empty")
                return False
            if not mesh.is_valid:
                logger.warning("Mesh has invalid topology")
                return False
            if not mesh.is_watertight:
                logger.warning("Mesh is not watertight")
            if mesh.bounding_box.extents.max() < 1e-6:
                logger.warning("Mesh is too small")
                return False
            return True
        except Exception as e:
            logger.error(f"Error validating mesh: {str(e)}")
            return False

    @staticmethod
    def get_mesh_stats(mesh: trimesh.Trimesh) -> Dict[str, Any]:
        """Get basic statistics about a mesh."""
        return {
            "vertex_count": len(mesh.vertices),
            "face_count": len(mesh.faces),
            "bounding_box": mesh.bounds.tolist(),
            "extents": mesh.bounding_box.extents.tolist(),
            "volume": float(mesh.volume) if mesh.is_watertight else None,
            "surface_area": float(mesh.area),
            "is_watertight": bool(mesh.is_watertight),
        }

    @staticmethod
    def create_part_colors(num_parts: int) -> List[List[float]]:
        """Generate distinct colors for mesh parts."""
        import colorsys
        colors = []
        for i in range(num_parts):
            hue = i / num_parts
            saturation = 0.8
            value = 0.9
            rgb = colorsys.hsv_to_rgb(hue, saturation, value)
            colors.append([rgb[0], rgb[1], rgb[2], 1.0])
        return colors

    @staticmethod
    def export_segmentation_info(
        segmentation_data: Dict[str, Any], output_path: Union[str, Path]
    ) -> Path:
        """Export segmentation information to JSON."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(output_path, "w") as f:
                json.dump(segmentation_data, f, indent=2, default=str)
            logger.info(f"Saved segmentation info to {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Failed to save segmentation info: {str(e)}")
            raise

    @staticmethod
    def export_generation_info(
        generation_data: Dict[str, Any], output_path: Union[str, Path]
    ) -> Path:
        """Export generation information to JSON."""
        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with open(output_path, "w") as f:
                json.dump(generation_data, f, indent=2, default=str)
            logger.info(f"Saved generation info to {output_path}")
            return output_path
        except Exception as e:
            logger.error(f"Failed to save generation info: {str(e)}")
            raise

    @staticmethod
    def simplify_mesh(
        mesh: Union[trimesh.Trimesh, trimesh.Scene],
        target_faces: int,
        num_threads: Optional[int] = None,
    ) -> Union[trimesh.Trimesh, trimesh.Scene]:
        """Simplify mesh to target number of faces using multi-threading."""
        threads = get_optimal_thread_count(num_threads)
        configure_cpu_runtime(threads)

        if isinstance(mesh, trimesh.Scene):
            # Parallel multi-core simplification across scene parts
            if not mesh.geometry:
                return mesh
            total_current = sum(
                len(g.faces) for g in mesh.geometry.values() if isinstance(g, trimesh.Trimesh)
            )
            if total_current <= target_faces or total_current == 0:
                return mesh

            results: Dict[str, trimesh.Trimesh] = {}
            with ThreadPoolExecutor(max_workers=min(len(mesh.geometry), threads)) as executor:
                future_to_name = {}
                for name, geom in mesh.geometry.items():
                    if isinstance(geom, trimesh.Trimesh):
                        part_target = max(
                            4,
                            round(target_faces * (len(geom.faces) / max(1, total_current))),
                        )
                        future_to_name[
                            executor.submit(
                                MeshProcessor.simplify_mesh,
                                geom,
                                part_target,
                                threads,
                            )
                        ] = name

                for fut in as_completed(future_to_name):
                    name = future_to_name[fut]
                    results[name] = fut.result()

            for name, simplified_geom in results.items():
                mesh.geometry[name] = simplified_geom
            return mesh

        try:
            if len(mesh.faces) <= target_faces:
                return mesh

            # Try fast_simplification first for optimal multi-threaded C++ performance
            try:
                import fast_simplification
                target_reduction = max(
                    0.01, min(0.99, 1.0 - (float(target_faces) / float(len(mesh.faces))))
                )
                v_red, f_red = fast_simplification.simplify(
                    np.asarray(mesh.vertices, dtype=np.float64),
                    np.asarray(mesh.faces, dtype=np.int64),
                    target_reduction=target_reduction,
                )
                simplified = trimesh.Trimesh(vertices=v_red, faces=f_red, process=False)
                # Transfer visuals if present
                if mesh.visual and hasattr(mesh.visual, "uv"):
                    from scipy.spatial import cKDTree
                    tree = cKDTree(np.asarray(mesh.vertices, dtype=np.float64))
                    _, nearest = tree.query(v_red)
                    simplified.visual = copy.copy(mesh.visual)
                    if hasattr(mesh.visual, "uv") and mesh.visual.uv is not None:
                        simplified.visual.uv = np.asarray(mesh.visual.uv)[nearest]
                logger.info(
                    f"Simplified mesh (fast_simplification, {threads} threads) from "
                    f"{len(mesh.faces)} to {len(simplified.faces)} faces"
                )
                return simplified
            except Exception as fs_err:
                logger.debug("fast_simplification fallback: %s", fs_err)

            # Fallback to trimesh quadric decimation with full threads configured
            simplified = mesh.simplify_quadric_decimation(target_faces)
            logger.info(
                f"Simplified mesh from {len(mesh.faces)} to {len(simplified.faces)} faces"
            )
            return simplified

        except Exception as e:
            logger.warning(f"Failed to simplify mesh: {str(e)}")
            return mesh

    @staticmethod
    def smooth_mesh(
        mesh: Union[trimesh.Trimesh, trimesh.Scene],
        iterations: int = 5,
        method: str = "taubin",
        num_threads: Optional[int] = None,
        **kwargs: Any,
    ) -> Union[trimesh.Trimesh, trimesh.Scene]:
        """Smooth mesh using multi-threaded Taubin or Laplacian smoothing."""
        return smooth_mesh(
            mesh, iterations=iterations, method=method, num_threads=num_threads, **kwargs
        )

    @staticmethod
    def marching_cubes(
        volume: np.ndarray,
        level: float = 0.0,
        spacing: Optional[Tuple[float, float, float]] = None,
        num_threads: Optional[int] = None,
    ) -> Tuple[np.ndarray, np.ndarray]:
        """Extract isosurface via multi-threaded marching cubes."""
        return marching_cubes(
            volume, level=level, spacing=spacing, num_threads=num_threads
        )

    @staticmethod
    def batch_simplify_lods(
        mesh: trimesh.Trimesh,
        target_faces_list: Sequence[int],
        num_threads: Optional[int] = None,
    ) -> List[trimesh.Trimesh]:
        """Generate multiple LOD simplifications in parallel across CPU cores."""
        threads = get_optimal_thread_count(num_threads)
        configure_cpu_runtime(threads)

        results: List[Optional[trimesh.Trimesh]] = [None] * len(target_faces_list)
        with ThreadPoolExecutor(max_workers=min(len(target_faces_list), threads)) as executor:
            future_to_idx = {
                executor.submit(
                    MeshProcessor.simplify_mesh, mesh, target, threads
                ): idx
                for idx, target in enumerate(target_faces_list)
            }
            for fut in as_completed(future_to_idx):
                idx = future_to_idx[fut]
                results[idx] = fut.result()
        return [r for r in results if r is not None]

    @staticmethod
    def tri2quad(mesh_path: str):
        """Convert triangles to quads in-place."""
        from meshiki import Mesh
        mesh = Mesh.load(mesh_path, verbose=False)
        logger.info("Converting triangles to quads and save in-place...")
        mesh.quadrangulate()
        mesh.export(mesh_path)
