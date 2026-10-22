import hashlib
from pathlib import Path

from core.quality import sha256_file as public_sha256_file
from core.quality.metrics import audit_master_immutability
from core.quality.metrics import sha256_file as metrics_sha256_file
from core.utils.artifact_utils import sha256_file as canonical_sha256_file


def test_quality_hash_exports_use_canonical_streaming_helper(tmp_path: Path):
    source = tmp_path / "source.glb"
    payload = b"mesh artifact" * 100_000
    source.write_bytes(payload)

    expected = hashlib.sha256(payload).hexdigest()
    assert metrics_sha256_file is canonical_sha256_file
    assert public_sha256_file is canonical_sha256_file
    assert metrics_sha256_file(source) == expected


def test_master_immutability_audit_uses_compatible_hash_contract(tmp_path: Path):
    master = tmp_path / "master.glb"
    working_copy = tmp_path / "working.glb"
    master.write_bytes(b"immutable master")
    working_copy.write_bytes(master.read_bytes())

    assert audit_master_immutability(master, working_copy)

    working_copy.write_bytes(b"changed working copy")
    assert not audit_master_immutability(master, working_copy)
