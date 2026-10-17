"""Regression tests for realtime master.log stream framing."""
from api.routers.system import _pop_complete_log_lines


def test_log_stream_emits_carriage_return_progress_and_crlf_lines():
    pending = bytearray(
        b"sampling 1%\rsampling 10%\r\n"
        b"2026-10-17 12:00:00,000 - scheduler - INFO - Model loaded"
    )

    assert _pop_complete_log_lines(pending) == ["sampling 1%", "sampling 10%"]
    assert pending == bytearray(
        b"2026-10-17 12:00:00,000 - scheduler - INFO - Model loaded"
    )

    pending.extend(b" successfully\n")
    assert _pop_complete_log_lines(pending) == [
        "2026-10-17 12:00:00,000 - scheduler - INFO - Model loaded successfully"
    ]
    assert pending == bytearray()


def test_log_stream_retains_partial_multibyte_lines_until_delimiter():
    pending = bytearray(b"Loading model: caf\xc3")
    assert _pop_complete_log_lines(pending) == []

    pending.extend(b"\xa9\n")
    assert _pop_complete_log_lines(pending) == ["Loading model: café"]
    assert pending == bytearray()
