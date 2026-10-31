"""
ARDY Motion Converter

Converts ARDY autoregressive motion generation outputs (.npz or dict)
into browser-playable motion.json format consumed by MeshViewer.tsx
and the ForMesh 3D animation studio.
"""

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import numpy as np
import torch

logger = logging.getLogger(__name__)

# Standard bone names for CoreSkeleton27 (matching ardy.skeleton.definitions.CoreSkeleton27)
CORE_SKELETON_27_BONES = [
    "Hips",
    "Spine",
    "Spine1",
    "Spine2",
    "Spine3",
    "Neck",
    "Head",
    "RightShoulder",
    "RightArm",
    "RightForeArm",
    "RightHand",
    "RightHandEnd",
    "RightHandThumb1",
    "LeftShoulder",
    "LeftArm",
    "LeftForeArm",
    "LeftHand",
    "LeftHandEnd",
    "LeftHandThumb1",
    "RightUpLeg",
    "RightLeg",
    "RightFoot",
    "RightToeBase",
    "LeftUpLeg",
    "LeftLeg",
    "LeftFoot",
    "LeftToeBase",
]

# Standard bone names for Unitree G1 (matching ardy.skeleton.definitions.G1Skeleton34)
G1_SKELETON_34_BONES = [
    "pelvis_skel",
    "left_hip_pitch_skel",
    "left_hip_roll_skel",
    "left_hip_yaw_skel",
    "left_knee_skel",
    "left_ankle_pitch_skel",
    "left_ankle_roll_skel",
    "left_toe_base",
    "right_hip_pitch_skel",
    "right_hip_roll_skel",
    "right_hip_yaw_skel",
    "right_knee_skel",
    "right_ankle_pitch_skel",
    "right_ankle_roll_skel",
    "right_toe_base",
    "waist_yaw_skel",
    "waist_roll_skel",
    "waist_pitch_skel",
    "left_shoulder_pitch_skel",
    "left_shoulder_roll_skel",
    "left_shoulder_yaw_skel",
    "left_elbow_skel",
    "left_wrist_roll_skel",
    "left_wrist_pitch_skel",
    "left_wrist_yaw_skel",
    "left_hand_roll_skel",
    "right_shoulder_pitch_skel",
    "right_shoulder_roll_skel",
    "right_shoulder_yaw_skel",
    "right_elbow_skel",
    "right_wrist_roll_skel",
    "right_wrist_pitch_skel",
    "right_wrist_yaw_skel",
    "right_hand_roll_skel",
]

# Aliases for mapping UniRig / Mixamo / standard rigs to CoreSkeleton27
BIPED_NAME_MAPPING = {
    "pelvis": "Hips",
    "hip": "Hips",
    "hips": "Hips",
    "spine": "Spine",
    "spine01": "Spine1",
    "spine1": "Spine1",
    "spine02": "Spine2",
    "spine2": "Spine2",
    "spine03": "Spine3",
    "spine3": "Spine3",
    "chest": "Spine2",
    "upperchest": "Spine3",
    "neck": "Neck",
    "neck01": "Neck",
    "head": "Head",
    "leftshoulder": "LeftShoulder",
    "leftarm": "LeftArm",
    "leftforearm": "LeftForeArm",
    "lefthand": "LeftHand",
    "rightshoulder": "RightShoulder",
    "rightarm": "RightArm",
    "rightforearm": "RightForeArm",
    "righthand": "RightHand",
    "leftupleg": "LeftUpLeg",
    "leftleg": "LeftLeg",
    "leftfoot": "LeftFoot",
    "lefttoebase": "LeftToeBase",
    "lefttoe": "LeftToeBase",
    "rightupleg": "RightUpLeg",
    "rightleg": "RightLeg",
    "rightfoot": "RightFoot",
    "righttoebase": "RightToeBase",
    "righttoe": "RightToeBase",
}


def normalize_bone_name(name: str) -> str:
    """Normalize a bone name by lowering and removing non-alphanumeric characters."""
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _sqrt_positive_part(x: torch.Tensor) -> torch.Tensor:
    """Returns torch.sqrt(torch.max(0, x))."""
    return torch.sqrt(x * (x > 0).to(x.dtype))


def rot_mat_to_quaternion_threejs(matrix: torch.Tensor) -> torch.Tensor:
    """
    Convert rotation matrices (..., 3, 3) to Three.js quaternions (..., 4) with [x, y, z, w].
    ARDY geometry emits [w, x, y, z]; Three.js expects [x, y, z, w].
    """
    if matrix.size(-1) != 3 or matrix.size(-2) != 3:
        raise ValueError(f"Invalid rotation matrix shape: {matrix.shape}")

    batch_dim = matrix.shape[:-2]
    flat = matrix.reshape(batch_dim + (9,))
    m00, m01, m02, m10, m11, m12, m20, m21, m22 = torch.unbind(flat, dim=-1)

    q_abs = _sqrt_positive_part(
        torch.stack(
            [
                1.0 + m00 + m11 + m22,
                1.0 + m00 - m11 - m22,
                1.0 - m00 + m11 - m22,
                1.0 - m00 - m11 + m22,
            ],
            dim=-1,
        )
    )

    quat_by_rijk = torch.stack(
        [
            torch.stack([q_abs[..., 0] ** 2, m21 - m12, m02 - m20, m10 - m01], dim=-1),
            torch.stack([m21 - m12, q_abs[..., 1] ** 2, m10 + m01, m02 + m20], dim=-1),
            torch.stack([m02 - m20, m10 + m01, q_abs[..., 2] ** 2, m12 + m21], dim=-1),
            torch.stack([m10 - m01, m02 + m20, m12 + m21, q_abs[..., 3] ** 2], dim=-1),
        ],
        dim=-2,
    )

    flr = torch.tensor(0.1, dtype=matrix.dtype, device=matrix.device)
    quat_candidates = quat_by_rijk / (2.0 * q_abs[..., None].max(flr))

    idx = q_abs.argmax(dim=-1, keepdim=True)[..., None].expand(batch_dim + (1, 4))
    # quat_wxyz has [w, x, y, z]
    quat_wxyz = torch.gather(quat_candidates, -2, idx).squeeze(-2)

    # Convert [w, x, y, z] to Three.js [x, y, z, w]
    quat_xyzw = torch.stack(
        [quat_wxyz[..., 1], quat_wxyz[..., 2], quat_wxyz[..., 3], quat_wxyz[..., 0]],
        dim=-1,
    )
    # Normalize
    norm = torch.norm(quat_xyzw, dim=-1, keepdim=True).clamp_min(1e-8)
    return quat_xyzw / norm


def validate_skeleton_compatibility(
    source_joints: List[str],
    target_joints: Optional[List[str]],
    min_coverage: float = 0.5,
) -> Tuple[bool, float, Dict[str, str]]:
    """
    Validate that target joints provide sufficient coverage for source motion joints.
    Returns (is_compatible, coverage_ratio, mapping).
    """
    if not target_joints:
        # Default identity mapping if no target rig provided
        return True, 1.0, {j: j for j in source_joints}

    target_map = {normalize_bone_name(b): b for b in target_joints}
    # Also index aliases
    for alias_key, canon_name in BIPED_NAME_MAPPING.items():
        if alias_key in target_map and canon_name not in target_map:
            target_map[normalize_bone_name(canon_name)] = target_map[alias_key]

    mapping: Dict[str, str] = {}
    for src in source_joints:
        norm_src = normalize_bone_name(src)
        if norm_src in target_map:
            mapping[src] = target_map[norm_src]
        elif norm_src in BIPED_NAME_MAPPING:
            target_alias = normalize_bone_name(BIPED_NAME_MAPPING[norm_src])
            if target_alias in target_map:
                mapping[src] = target_map[target_alias]

    coverage = len(mapping) / max(1, len(source_joints))
    is_compatible = coverage >= min_coverage
    return is_compatible, coverage, mapping


def convert_ardy_output_to_motion_json(
    output_data: Union[Dict[str, Any], str, Path],
    skeleton_id: str = "core",
    fps: float = 20.0,
    prompt: str = "",
    target_bones: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Convert ARDY motion output (from dictionary or .npz file) to the
    project motion.json format consumed by MeshViewer.tsx.

    Args:
        output_data: Either a dictionary containing ARDY outputs or path to an .npz file.
        skeleton_id: Skeleton model ID ('core', 'cskel27', 'g1', 'g1skel34').
        fps: Playback frames per second.
        prompt: Generation prompt text.
        target_bones: Optional list of target armature bone names for validation.

    Returns:
        Dictionary formatted according to motion.json contract.
    """
    if isinstance(output_data, (str, Path)):
        npz_path = Path(output_data)
        if not npz_path.exists():
            raise FileNotFoundError(f"Motion NPZ file not found: {npz_path}")
        loaded = np.load(str(npz_path), allow_pickle=True)
        data = {k: loaded[k] for k in loaded.files}
        if "fps" in data:
            fps = float(data["fps"])
        if "text" in data:
            prompt = str(data["text"])
    else:
        data = output_data

    # Resolve joint names for skeleton
    skeleton_clean = skeleton_id.lower()
    if "g1" in skeleton_clean:
        joint_names = list(G1_SKELETON_34_BONES)
        resolved_skel_id = "g1skel34"
    else:
        joint_names = list(CORE_SKELETON_27_BONES)
        resolved_skel_id = "core"

    # Validate compatibility if target bones provided
    if target_bones:
        is_compat, coverage, _ = validate_skeleton_compatibility(
            joint_names, target_bones, min_coverage=0.5
        )
        if not is_compat:
            raise ValueError(
                f"Target rig is incompatible with skeleton '{resolved_skel_id}': "
                f"only {coverage*100:.1f}% bone coverage (minimum 50% required)."
            )

    # Extract local rotation matrices
    if "local_rot_mats" not in data:
        raise KeyError("ARDY output missing required key 'local_rot_mats'")

    local_rot_mats = data["local_rot_mats"]
    if isinstance(local_rot_mats, np.ndarray):
        rot_tensor = torch.from_numpy(local_rot_mats).float()
    elif isinstance(local_rot_mats, torch.Tensor):
        rot_tensor = local_rot_mats.float()
    else:
        raise TypeError(f"Unsupported local_rot_mats type: {type(local_rot_mats)}")

    # Ensure shape is (num_frames, num_joints, 3, 3)
    if rot_tensor.ndim == 5:
        # e.g. (1, num_samples, T, J, 3, 3) or (num_samples, T, J, 3, 3)
        rot_tensor = rot_tensor[0]
    if rot_tensor.ndim == 4 and rot_tensor.shape[0] == 1:
        # (1, T, J, 3, 3) -> squeeze batch if present
        pass

    num_frames = rot_tensor.shape[0]
    num_joints = rot_tensor.shape[1]

    if num_joints != len(joint_names):
        logger.warning(
            f"Rotations joint count ({num_joints}) differs from skeleton joint count ({len(joint_names)}). "
            f"Truncating/padding joint_names."
        )
        if num_joints < len(joint_names):
            joint_names = joint_names[:num_joints]
        else:
            joint_names = joint_names + [f"Joint_{i}" for i in range(len(joint_names), num_joints)]

    # Convert 3x3 rotation matrices to Three.js quaternions [x, y, z, w]
    quaternions_tensor = rot_mat_to_quaternion_threejs(rot_tensor)
    quaternions_list = quaternions_tensor.cpu().numpy().round(6).tolist()

    # Extract root positions if available
    root_positions_list: List[List[float]] = []
    if "root_positions" in data:
        root_positions = data["root_positions"]
        if isinstance(root_positions, np.ndarray):
            r_tensor = torch.from_numpy(root_positions).float()
        elif isinstance(root_positions, torch.Tensor):
            r_tensor = root_positions.float()
        else:
            r_tensor = None

        if r_tensor is not None:
            if r_tensor.ndim == 3 and r_tensor.shape[0] == 1:
                r_tensor = r_tensor[0]
            root_positions_list = r_tensor.cpu().numpy().round(6).tolist()

    # Fallback root positions if missing
    if not root_positions_list:
        root_positions_list = [[0.0, 0.0, 0.0] for _ in range(num_frames)]

    duration = round(num_frames / max(1.0, fps), 3)

    motion_doc = {
        "joint_names": joint_names,
        "fps": float(fps),
        "num_frames": int(num_frames),
        "duration": duration,
        "skeleton_id": resolved_skel_id,
        "quaternions": quaternions_list,
        "root_positions": root_positions_list,
        "prompt": prompt,
        "model_id": "ardy_motion_generation",
    }

    return motion_doc


def save_motion_json(motion_data: Dict[str, Any], output_path: Union[str, Path]) -> Path:
    """Save motion data dictionary to a JSON file."""
    path = Path(output_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(motion_data, f, indent=2)
    logger.info(f"Saved motion.json to {path}")
    return path
