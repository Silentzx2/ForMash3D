"""
Thumbnail generation utilities for 3D meshes.

This module provides functionality to generate preview thumbnails of 3D meshes
using Trimesh and pyrender for off-screen rendering.
"""

import logging
import os
import threading
from pathlib import Path
from typing import Optional, Tuple

import numpy as np
import trimesh
from PIL import Image

logger = logging.getLogger(__name__)

# Protect headless EGL context creation/deletion across concurrent worker threads
_RENDER_LOCK = threading.Lock()

# Try to import pyrender, fall back to basic rendering if not available
try:
    import pyrender

    PYRENDER_AVAILABLE = True
except ImportError:
    logger.warning("pyrender not available. Thumbnail generation will be limited.")
    PYRENDER_AVAILABLE = False


class MeshThumbnailGenerator:
    """
    Utility class for generating thumbnails of 3D meshes.

    Uses Trimesh for mesh processing and pyrender for off-screen rendering
    to create high-quality preview images.
    """

    def __init__(
        self,
        thumbnail_size: Tuple[int, int] = (512, 512),
        background_color: Tuple[float, float, float, float] = (1.0, 1.0, 1.0, 0.0),
        use_antialiasing: bool = True,
    ):
        """
        Initialize the thumbnail generator.

        Args:
            thumbnail_size: Output image size (width, height)
            background_color: Background color as RGBA tuple (0-1 range)
            use_antialiasing: Whether to use antialiasing for smoother rendering
        """
        self.thumbnail_size = thumbnail_size
        self.background_color = background_color
        self.use_antialiasing = use_antialiasing

        if not PYRENDER_AVAILABLE:
            logger.warning(
                "pyrender not available. Falling back to basic thumbnail generation."
            )

    def generate_thumbnail(
        self,
        mesh_path: str,
        output_path: str,
        camera_distance: Optional[float] = None,
        elevation_angle: float = 30.0,
        azimuth_angle: float = 45.0,
    ) -> bool:
        """
        Generate a thumbnail image for a 3D mesh.

        Args:
            mesh_path: Path to the input mesh file
            output_path: Path where thumbnail image will be saved
            camera_distance: Distance of camera from mesh center (auto-calculated if None)
            elevation_angle: Camera elevation angle in degrees
            azimuth_angle: Camera azimuth angle in degrees

        Returns:
            True if thumbnail was generated successfully, False otherwise
        """
        try:
            # Check if thumbnail already exists and is non-empty
            target = Path(output_path)
            if target.exists() and target.stat().st_size > 0:
                return True

            # Load the mesh
            mesh = self._load_mesh(mesh_path)
            if mesh is None:
                return False

            # Try pyrender rendering under thread lock to avoid headless EGL display conflicts
            success = False
            if PYRENDER_AVAILABLE:
                try:
                    with _RENDER_LOCK:
                        success = self._generate_with_pyrender(
                            mesh, output_path, camera_distance, elevation_angle, azimuth_angle
                        )
                except Exception as pyrender_err:
                    logger.warning(f"Pyrender execution failed for {mesh_path}: {pyrender_err}")
                    success = False

            # If pyrender failed or produced missing/empty file, always run fallback
            if not success or not target.exists() or target.stat().st_size == 0:
                logger.info(f"Using reliable fallback thumbnail generation for {mesh_path}")
                success = self._generate_fallback(mesh, output_path)

            return success

        except Exception as e:
            logger.error(f"Failed to generate thumbnail for {mesh_path}: {str(e)}")
            return False

    def _load_mesh(self, mesh_path: str) -> Optional[trimesh.Trimesh]:
        """Load mesh from file path."""
        try:
            mesh_path = Path(mesh_path)
            if not mesh_path.exists():
                logger.error(f"Mesh file not found: {mesh_path}")
                return None

            # Load mesh using trimesh
            mesh = trimesh.load(mesh_path)

            # Handle scene objects
            if isinstance(mesh, trimesh.Scene):
                # Get the combined mesh from scene
                mesh = mesh.dump(concatenate=True)

            if not isinstance(mesh, trimesh.Trimesh):
                logger.error(f"Loaded object is not a valid mesh: {type(mesh)}")
                return None

            # Validate mesh
            if len(mesh.vertices) == 0:
                logger.error("Mesh has no vertices")
                return None

            logger.info(
                f"Loaded mesh: {len(mesh.vertices)} vertices, {len(mesh.faces)} faces"
            )
            return mesh

        except Exception as e:
            logger.error(f"Failed to load mesh from {mesh_path}: {str(e)}")
            return None

    def _generate_with_pyrender(
        self,
        mesh: trimesh.Trimesh,
        output_path: str,
        camera_distance: Optional[float],
        elevation_angle: float,
        azimuth_angle: float,
    ) -> bool:
        """Generate thumbnail using pyrender for high-quality rendering."""
        renderer = None
        try:
            # Create pyrender scene
            scene = pyrender.Scene(
                bg_color=self.background_color, ambient_light=[0.3, 0.3, 0.3]
            )

            # Add mesh to scene
            pyrender_mesh = pyrender.Mesh.from_trimesh(mesh, smooth=True)
            scene.add(pyrender_mesh)

            # Setup lighting
            light = pyrender.DirectionalLight(color=[1.0, 1.0, 1.0], intensity=2.0)
            scene.add(light, pose=self._get_light_pose())

            # Add fill light
            fill_light = pyrender.PointLight(color=[1.0, 1.0, 1.0], intensity=1.0)
            fill_pose = np.array(
                [[1, 0, 0, -2], [0, 1, 0, 2], [0, 0, 1, 2], [0, 0, 0, 1]]
            )
            scene.add(fill_light, pose=fill_pose)

            # Setup camera
            camera_pose = self._calculate_camera_pose(
                mesh, camera_distance, elevation_angle, azimuth_angle
            )

            camera = pyrender.PerspectiveCamera(yfov=np.pi / 4.0)
            scene.add(camera, pose=camera_pose)

            # Render. Prefer EGL for headless Linux/Colab runtimes.
            if not os.environ.get("PYOPENGL_PLATFORM"):
                os.environ["PYOPENGL_PLATFORM"] = "egl"
            renderer = pyrender.OffscreenRenderer(*self.thumbnail_size)

            flags = pyrender.RenderFlags.RGBA
            if self.use_antialiasing:
                flags |= pyrender.RenderFlags.VERTEX_NORMALS

            color, _ = renderer.render(scene, flags=flags)

            # Save image first before cleanup
            image = Image.fromarray(color)
            out_target = Path(output_path)
            out_target.parent.mkdir(parents=True, exist_ok=True)
            image.save(output_path, "PNG")

            logger.info(f"Generated thumbnail: {output_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to generate thumbnail with pyrender: {str(e)}")
            # If the image was saved successfully before any error (e.g. cleanup), treat as success
            out_target = Path(output_path)
            if out_target.exists() and out_target.stat().st_size > 0:
                return True
            return False
        finally:
            # Safe EGL context cleanup that never propagates GLError or crashes the worker
            if renderer is not None:
                try:
                    renderer.delete()
                except Exception as cleanup_err:
                    logger.debug(f"Non-fatal EGL context cleanup notice: {cleanup_err}")

    def _generate_fallback(self, mesh: trimesh.Trimesh, output_path: str) -> bool:
        """Generate reliable studio thumbnail without pyrender (fallback method)."""
        try:
            from PIL import Image, ImageDraw, ImageFont

            width, height = self.thumbnail_size
            # Create sleek dark studio background image
            image = Image.new("RGBA", (width, height), (20, 22, 28, 255))
            draw = ImageDraw.Draw(image)

            # Project vertices to 2.5D isometric view to render mesh silhouette/points
            try:
                verts = np.asarray(mesh.vertices)
                if len(verts) > 0:
                    min_b = verts.min(axis=0)
                    max_b = verts.max(axis=0)
                    extent = np.maximum(max_b - min_b, 1e-6)
                    max_span = np.max(extent)
                    norm_verts = (verts - (min_b + max_b) * 0.5) / max_span

                    # Isometric projection angles
                    angle_y = np.radians(45.0)
                    angle_x = np.radians(28.0)
                    cos_y, sin_y = np.cos(angle_y), np.sin(angle_y)
                    cos_x, sin_x = np.cos(angle_x), np.sin(angle_x)

                    x1 = norm_verts[:, 0] * cos_y + norm_verts[:, 2] * sin_y
                    z1 = -norm_verts[:, 0] * sin_y + norm_verts[:, 2] * cos_y
                    y1 = norm_verts[:, 1] * cos_x - z1 * sin_x

                    scale = min(width, height) * 0.70
                    px = (width * 0.5 + x1 * scale).astype(int)
                    py = (height * 0.5 - y1 * scale).astype(int)

                    step = max(1, len(px) // 4000)
                    for i in range(0, len(px), step):
                        draw.point((int(px[i]), int(py[i])), fill=(0, 245, 212, 160))
            except Exception as proj_err:
                logger.debug(f"Silhouette projection skipped: {proj_err}")

            # Draw basic mesh info badge at bottom
            try:
                font = ImageFont.load_default()
            except Exception:
                font = None

            v_count = f"{len(mesh.vertices):,}"
            f_count = f"{len(mesh.faces):,}"
            draw.text((24, height - 48), "3D MESH PREVIEW", fill=(0, 245, 212, 255), font=font)
            draw.text((24, height - 30), f"Vertices: {v_count} | Faces: {f_count}", fill=(200, 205, 215, 220), font=font)

            # Save image
            out_target = Path(output_path)
            out_target.parent.mkdir(parents=True, exist_ok=True)
            image.save(output_path, "PNG")

            logger.info(f"Generated fallback thumbnail: {output_path}")
            return True

        except Exception as e:
            logger.error(f"Failed to generate fallback thumbnail: {str(e)}")
            return False

    def _calculate_camera_pose(
        self,
        mesh: trimesh.Trimesh,
        camera_distance: Optional[float],
        elevation_angle: float,
        azimuth_angle: float,
    ) -> np.ndarray:
        """Calculate camera pose matrix."""
        # Get mesh center and bounds
        center = mesh.centroid
        bounds = mesh.bounds
        size = np.linalg.norm(bounds[1] - bounds[0])

        # Auto-calculate camera distance if not provided
        if camera_distance is None:
            camera_distance = size * 2.5

        # Convert angles to radians
        elevation_rad = np.radians(elevation_angle)
        azimuth_rad = np.radians(azimuth_angle)

        # Calculate camera position
        x = camera_distance * np.cos(elevation_rad) * np.sin(azimuth_rad)
        y = camera_distance * np.sin(elevation_rad)
        z = camera_distance * np.cos(elevation_rad) * np.cos(azimuth_rad)

        camera_pos = center + np.array([x, y, z])

        # Create look-at matrix
        forward = center - camera_pos
        forward = forward / np.linalg.norm(forward)

        right = np.cross(forward, [0, 0, 1])
        if np.linalg.norm(right) < 1e-6:
            right = np.cross(forward, [0, 1, 0])
        right = right / np.linalg.norm(right)
        up = np.cross(right, forward)
        up = up / np.linalg.norm(up)

        # Create pose matrix
        pose = np.eye(4)
        pose[:3, 0] = right
        pose[:3, 1] = up
        pose[:3, 2] = -forward
        pose[:3, 3] = camera_pos

        return pose

    def _get_light_pose(self) -> np.ndarray:
        """Get lighting pose matrix."""
        # Light from above and to the right
        pose = np.array(
            [
                [0.7071, -0.5000, 0.5000, 2],
                [0.7071, 0.5000, -0.5000, 2],
                [0.0000, 0.7071, 0.7071, 4],
                [0.0000, 0.0000, 0.0000, 1],
            ]
        )
        return pose


def generate_mesh_thumbnail(
    mesh_path: str,
    output_path: str,
    thumbnail_size: Tuple[int, int] = (512, 512),
    camera_distance: Optional[float] = None,
    elevation_angle: float = 0.0,
    azimuth_angle: float = 0.0,
) -> bool:
    """
    Convenience function to generate a mesh thumbnail.

    Args:
        mesh_path: Path to the input mesh file
        output_path: Path where thumbnail image will be saved
        thumbnail_size: Output image size (width, height)
        camera_distance: Distance of camera from mesh center (auto-calculated if None)
        elevation_angle: Camera elevation angle in degrees
        azimuth_angle: Camera azimuth angle in degrees

    Returns:
        True if thumbnail was generated successfully, False otherwise
    """
    generator = MeshThumbnailGenerator(thumbnail_size=thumbnail_size)
    return generator.generate_thumbnail(
        mesh_path, output_path, camera_distance, elevation_angle, azimuth_angle
    )
