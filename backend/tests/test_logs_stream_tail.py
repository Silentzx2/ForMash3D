from pathlib import Path
import re

import pytest
import yaml
from fastapi import HTTPException

from api.routers.system import _resolve_log_path, _tail_start_offset
from core.config import _validate_log_stream_config


@pytest.mark.parametrize(
    ("content", "line_count", "expected"),
    [
        ("", 4, ""),
        ("one\n", 1, "one\n"),
        ("one\ntwo\n", 1, "two\n"),
        ("one\ntwo\n", 2, "one\ntwo\n"),
        ("one\ntwo", 1, "two"),
        ("one\ntwo\nthree", 2, "two\nthree"),
        ("first\r\nsecond\r\nthird\r\n", 2, "second\r\nthird\r\n"),
        ("first\nsecond\nthird", 3, "first\nsecond\nthird"),
    ],
)
def test_tail_start_offset_cases(tmp_path, content, line_count, expected):
    log_path = tmp_path / "tail.log"
    log_path.write_bytes(content.encode("utf-8"))
    with log_path.open("rb", buffering=0) as handle:
        offset = _tail_start_offset(handle, line_count, 1024 * 1024)
        handle.seek(offset)
        assert handle.read().decode("utf-8") == expected


def test_tail_start_offset_zero_starts_at_eof(tmp_path):
    log_path = tmp_path / "tail.log"
    log_path.write_text("old\nrecent\n", encoding="utf-8")
    with log_path.open("rb", buffering=0) as handle:
        assert _tail_start_offset(handle, 0, 1024) == log_path.stat().st_size


def test_tail_start_offset_keeps_utf8_and_line_boundary_across_block(tmp_path):
    content = ("x" * 65534) + "🌍\nsecond\nthird"
    log_path = tmp_path / "tail.log"
    log_path.write_bytes(content.encode("utf-8"))
    with log_path.open("rb", buffering=0) as handle:
        offset = _tail_start_offset(handle, 2, 1024 * 1024)
        handle.seek(offset)
        assert handle.read().decode("utf-8") == "second\nthird"


def test_tail_start_offset_very_long_single_line_never_splits_it(tmp_path):
    content = ("x" * (128 * 1024)) + "end"
    log_path = tmp_path / "tail.log"
    log_path.write_text(content, encoding="utf-8")
    with log_path.open("rb", buffering=0) as handle:
        offset = _tail_start_offset(handle, 1, 4096)
        handle.seek(offset)
        assert handle.read().decode("utf-8") == content


def test_log_filename_allowlist_and_missing_file(tmp_path):
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    (logs_dir / "master.log").write_text("ok\n", encoding="utf-8")
    assert _resolve_log_path(logs_dir, "master.log").read_text(encoding="utf-8") == "ok\n"
    for filename in ("../x", "a/b.log", "/tmp/escape.log", "master.txt"):
        with pytest.raises(HTTPException) as error:
            _resolve_log_path(logs_dir, filename)
        assert error.value.status_code == 404
    with pytest.raises(HTTPException) as error:
        _resolve_log_path(logs_dir, "missing.log")
    assert error.value.status_code == 404


def test_log_filename_symlink_cannot_escape_logs_dir(tmp_path):
    logs_dir = tmp_path / "logs"
    logs_dir.mkdir()
    outside = tmp_path / "outside.log"
    outside.write_text("secret\n", encoding="utf-8")
    (logs_dir / "escape.log").symlink_to(outside)
    with pytest.raises(HTTPException) as error:
        _resolve_log_path(logs_dir, "escape.log")
    assert error.value.status_code == 404


def test_log_stream_config_is_required_and_ui_values_match():
    root = Path(__file__).resolve().parents[2]
    system_config = yaml.safe_load((root / "backend/config/system.yaml").read_text(encoding="utf-8"))
    stream_config = system_config["logging"]["stream"]
    _validate_log_stream_config(stream_config)
    constants = (root / "constants/logs.ts").read_text(encoding="utf-8")
    initial_tail = int(re.search(r"LOG_VIEW_INITIAL_TAIL\s*=\s*(\d+)", constants).group(1))
    max_lines = int(re.search(r"LOG_VIEW_MAX_LINES\s*=\s*(\d+)", constants).group(1))
    assert initial_tail == stream_config["default_tail_lines"]
    assert max_lines == stream_config["max_tail_lines"]
    with pytest.raises(ValueError, match="Missing logging.stream keys"):
        _validate_log_stream_config({key: value for key, value in stream_config.items() if key != "heartbeat_seconds"})
