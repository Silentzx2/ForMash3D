import numpy as np
import trimesh
from PIL import Image

from backend.core.config import get_quality_config
from backend.postprocess.schemas import RepairOptions
from backend.postprocess.services.gate import evaluate_topology_gate
from backend.postprocess.services.hole_repair import (
    repair_holes_targeted,
    triangulate_boundary_loop,
)
from backend.postprocess.services.repair import run_repair, topology_counts
import backend.postprocess.services.repair as repair_service


def _open_prism(polygon, height=0.1):
    points = np.asarray(polygon, dtype=float)
    count = len(points)
    vertices = np.vstack(
        (
            np.column_stack((points, np.zeros(count))),
            np.column_stack((points, np.full(count, height))),
        )
    )
    faces = []
    for index in range(count):
        following = (index + 1) % count
        faces.extend(
            (
                [index, following, count + following],
                [index, count + following, count + index],
            )
        )
    return trimesh.Trimesh(vertices=vertices, faces=faces, process=False)


def test_targeted_repair_fills_small_planar_loops_with_canonical_limits():
    mesh = _open_prism(((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)))

    repaired, stats = repair_holes_targeted(mesh)

    assert stats["holes_filled"] == 2
    assert stats["holes_remaining"] == 0
    assert stats["boundary_edges_after"] == 0
    assert topology_counts(repaired.vertices, repaired.faces)["watertight"]
    assert repaired.is_winding_consistent
    assert topology_counts(mesh.vertices, mesh.faces)["boundary_edges"] == 8


def test_targeted_repair_rejects_loop_over_canonical_perimeter():
    mesh = _open_prism(((0, 0), (0.2, 0), (0.2, 0.2), (0, 0.2)))
    perimeter_limit = get_quality_config()["holes"]["max_hole_perimeter"]
    assert 0.2 * 4 > perimeter_limit

    repaired, stats = repair_holes_targeted(
        mesh,
        max_hole_vertices=get_quality_config()["holes"]["max_hole_vertices"],
    )

    assert stats["holes_filled"] == 0
    assert stats["holes_remaining"] == 2
    assert stats["boundary_edges_after"] == stats["boundary_edges_before"]
    assert len(repaired.faces) == len(mesh.faces)


def test_concave_loop_uses_valid_ear_triangulation():
    polygon = ((0, 0, 0), (2, 0, 0), (2, 2, 0), (1, 1, 0), (0, 2, 0))

    triangles = triangulate_boundary_loop(list(range(len(polygon))), np.asarray(polygon))

    assert triangles is not None
    assert len(triangles) == len(polygon) - 2


def test_ambiguous_and_degenerate_loops_are_rejected():
    bow_tie = np.asarray(((0, 0, 0), (1, 1, 0), (0, 1, 0), (1, 0, 0)))
    non_planar = np.asarray(((0, 0, 0), (1, 0, 0), (1, 1, 0.1), (0, 1, 0)))
    skinny = np.asarray(((0, 0, 0), (1, 0, 0), (1, 1e-18, 0), (0, 1e-18, 0)))

    assert triangulate_boundary_loop([0, 1, 2, 3], bow_tie) is None
    assert triangulate_boundary_loop([0, 1, 2, 3], non_planar) is None
    assert triangulate_boundary_loop([0, 1, 2, 3], skinny) is None


def test_gate_only_selects_minimal_repair_for_safely_fillable_holes():
    small = _open_prism(((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)))
    large = _open_prism(((0, 0), (0.2, 0), (0.2, 0.2), (0, 0.2)))

    small_result = evaluate_topology_gate(small)
    large_result = evaluate_topology_gate(large)

    assert small_result["repair_decision"] == "minimal_repair"
    assert large_result["repair_decision"] == "full_repair"


def test_gate_rejects_non_manifold_edges():
    mesh = trimesh.Trimesh(
        vertices=((0, 0, 0), (1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1)),
        faces=((0, 1, 2), (1, 0, 3), (0, 1, 4)),
        process=False,
    )

    result = evaluate_topology_gate(mesh)

    assert result["metrics"]["non_manifold_edges"] >= 1
    assert result["repair_decision"] == "full_repair"


def test_gate_rejects_disconnected_floater_components():
    main_component = trimesh.creation.icosphere(subdivisions=4)
    floaters = []
    for index in range(5):
        floater = trimesh.Trimesh(
            vertices=((0, 0, 0), (0.01, 0, 0), (0, 0.01, 0)),
            faces=((0, 1, 2),),
            process=False,
        )
        floater.apply_translation((3 + index, 0, 0))
        floaters.append(floater)
    mesh = trimesh.util.concatenate((main_component, *floaters))

    result = evaluate_topology_gate(mesh)

    assert result["metrics"]["connected_components"] == 6
    assert result["metrics"]["floater_ratio"] > get_quality_config()["gate"]["max_floater_ratio"]
    assert result["repair_decision"] == "full_repair"


def test_targeted_hole_repair_preserves_uvs_and_native_material():
    mesh = _open_prism(((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)))
    uv = np.arange(len(mesh.vertices) * 2, dtype=float).reshape(-1, 2) / 10
    image = Image.new("RGB", (2, 2), color=(20, 40, 60))
    material = trimesh.visual.material.SimpleMaterial(image=image)
    mesh.visual = trimesh.visual.TextureVisuals(uv=uv, material=material)

    repaired, stats = repair_holes_targeted(mesh)

    assert stats["holes_filled"] == 2
    assert np.array_equal(mesh.visual.uv, uv)
    assert np.array_equal(repaired.visual.uv, uv)
    assert repaired.visual.material is not None
    assert np.array_equal(np.asarray(repaired.visual.material.image), np.asarray(image))


def test_run_repair_preserves_input_and_reports_residual_unsafe_holes():
    mesh = _open_prism(((0, 0), (0.2, 0), (0.2, 0.2), (0, 0.2)))
    original_faces = mesh.faces.copy()

    repaired, stats, _ = run_repair(mesh, RepairOptions(max_hole_size=50))

    assert np.array_equal(mesh.faces, original_faces)
    assert stats["after"]["boundary_edges"] == stats["before"]["boundary_edges"]
    assert stats["filled_faces"] == 0


def test_run_repair_resolves_default_vertex_limit_from_canonical_config(monkeypatch):
    monkeypatch.setattr(
        repair_service,
        "get_quality_config",
        lambda: {"holes": {"max_hole_vertices": 3, "max_hole_perimeter": 0.5}},
    )
    mesh = _open_prism(((0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)))

    default_result, default_stats, _ = run_repair(mesh, RepairOptions())
    override_result, override_stats, _ = run_repair(
        mesh, RepairOptions(max_hole_size=50)
    )

    assert default_stats["filled_faces"] == 0
    assert topology_counts(default_result.vertices, default_result.faces)["boundary_edges"] == 8
    assert override_stats["filled_faces"] == 4
    assert topology_counts(override_result.vertices, override_result.faces)["boundary_edges"] == 0


def test_to_quad_dominant_converts_triangles_to_quad_dominant_polygons():
    from backend.postprocess.services.autoretopo.remesh import to_quad_dominant

    sphere = trimesh.creation.icosphere(subdivisions=2)
    Vq, polys = to_quad_dominant(sphere.vertices, sphere.faces)

    quads = [p for p in polys if len(p) == 4]
    tris = [p for p in polys if len(p) == 3]

    assert len(quads) > 0
    assert len(quads) + len(tris) == len(polys)


def test_export_glb_untextured_mesh_preserves_diffuse_pbr_factors():
    import struct, json
    from backend.postprocess.pipeline import _export_glb

    mesh = trimesh.creation.icosphere(subdivisions=2)
    norm_img = Image.new("RGB", (32, 32), (128, 128, 255))
    pbr_mat = trimesh.visual.material.PBRMaterial(name="GameReady_PBR", normalTexture=norm_img)
    mesh.visual = trimesh.visual.TextureVisuals(uv=mesh.vertices[:, :2], material=pbr_mat)

    glb = _export_glb(mesh)
    magic, version, length = struct.unpack_from("<4sII", glb, 0)
    chunk_len, chunk_type = struct.unpack_from("<I4s", glb, 12)
    json_data = json.loads(glb[20 : 20 + chunk_len].decode("utf-8"))

    mat = json_data["materials"][0]
    assert "pbrMetallicRoughness" in mat
    pbr = mat["pbrMetallicRoughness"]
    assert pbr["metallicFactor"] == 0.0
    assert pbr["roughnessFactor"] == 0.7
