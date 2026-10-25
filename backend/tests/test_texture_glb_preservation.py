import json
import struct
from pathlib import Path

from postprocess.pipeline import _normalize_textured_glb_pbr_defaults


def _write_test_glb(path: Path) -> bytes:
    document = {
        "asset": {"version": "2.0", "generator": "ForMesh3D test"},
        "materials": [
            {
                "name": "albedo-only",
                "pbrMetallicRoughness": {"baseColorTexture": {"index": 0}},
            },
            {
                "name": "explicit-material",
                "pbrMetallicRoughness": {
                    "baseColorTexture": {"index": 0},
                    "metallicFactor": 0.8,
                    "roughnessFactor": 0.2,
                },
            },
        ],
        "textures": [{"source": 0}],
        "images": [{"bufferView": 0, "mimeType": "image/png"}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": 4}],
        "buffers": [{"byteLength": 4}],
    }
    json_chunk = json.dumps(document, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * ((-len(json_chunk)) % 4)
    binary_chunk = b"\x10\x20\x30\x40"
    total_length = 12 + 8 + len(json_chunk) + 8 + len(binary_chunk)
    payload = (
        struct.pack("<4sII", b"glTF", 2, total_length)
        + struct.pack("<I4s", len(json_chunk), b"JSON")
        + json_chunk
        + struct.pack("<I4s", len(binary_chunk), b"BIN\x00")
        + binary_chunk
    )
    path.write_bytes(payload)
    return binary_chunk


def _read_glb(path: Path) -> tuple[dict, bytes]:
    payload = path.read_bytes()
    magic, version, total_length = struct.unpack_from("<4sII", payload, 0)
    assert magic == b"glTF"
    assert version == 2
    assert total_length == len(payload)
    offset = 12
    document = None
    binary_chunk = b""
    while offset < len(payload):
        chunk_length, chunk_type = struct.unpack_from("<I4s", payload, offset)
        offset += 8
        chunk_payload = payload[offset:offset + chunk_length]
        offset += chunk_length
        if chunk_type == b"JSON":
            document = json.loads(chunk_payload.decode("utf-8").rstrip(" \t\r\n\x00"))
        elif chunk_type == b"BIN\x00":
            binary_chunk = chunk_payload
    assert document is not None
    return document, binary_chunk


def test_albedo_only_glb_gets_safe_pbr_defaults_without_rewriting_binary_chunks(tmp_path: Path):
    glb_path = tmp_path / "textured.glb"
    expected_binary = _write_test_glb(glb_path)

    changed_materials = _normalize_textured_glb_pbr_defaults(glb_path)

    document, actual_binary = _read_glb(glb_path)
    assert changed_materials == 1
    assert document["materials"][0]["pbrMetallicRoughness"]["metallicFactor"] == 0.0
    assert document["materials"][0]["pbrMetallicRoughness"]["roughnessFactor"] == 0.7
    assert document["materials"][1]["pbrMetallicRoughness"]["metallicFactor"] == 0.8
    assert document["materials"][1]["pbrMetallicRoughness"]["roughnessFactor"] == 0.2
    assert actual_binary == expected_binary


def test_glb_normalization_is_noop_when_material_factors_are_explicit(tmp_path: Path):
    glb_path = tmp_path / "textured.glb"
    _write_test_glb(glb_path)
    document_before, binary_before = _read_glb(glb_path)
    document_before["materials"][0]["pbrMetallicRoughness"]["metallicFactor"] = 0.15
    document_before["materials"][0]["pbrMetallicRoughness"]["roughnessFactor"] = 0.5

    json_chunk = json.dumps(document_before, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * ((-len(json_chunk)) % 4)
    total_length = 12 + 8 + len(json_chunk) + 8 + len(binary_before)
    glb_path.write_bytes(
        struct.pack("<4sII", b"glTF", 2, total_length)
        + struct.pack("<I4s", len(json_chunk), b"JSON")
        + json_chunk
        + struct.pack("<I4s", len(binary_before), b"BIN\x00")
        + binary_before
    )

    payload_before = glb_path.read_bytes()
    assert _normalize_textured_glb_pbr_defaults(glb_path) == 0
    assert glb_path.read_bytes() == payload_before
