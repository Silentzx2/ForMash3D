"""Regression tests for lossless master.log stream framing."""

import json

from api.routers.system import _complete_utf8_prefix, _format_log_chunk


def test_stream_preserves_control_characters_blank_lines_and_unicode():
    text = "sampling 1%\rsampling 10%\r\n\nModel loaded: café\n"
    raw = text.encode("utf-8")
    identity = "1:2"

    event, next_offset = _format_log_chunk(raw, 19, identity)

    assert event.startswith(f"id: {identity}:{19 + len(raw)}\ndata: ")
    assert event.endswith("\n\n")
    data_line = next(line for line in event.splitlines() if line.startswith("data: "))
    payload = json.loads(data_line[len("data: "):])
    assert payload == {"offset": 19 + len(raw), "identity": identity, "chunk": text}
    assert next_offset == 19 + len(raw)


def test_stream_holds_only_incomplete_utf8_suffix_and_reassembles_it():
    first, pending = _complete_utf8_prefix(b"prefix caf\xc3")
    assert first == b"prefix caf"
    assert pending == b"\xc3"

    second, pending = _complete_utf8_prefix(pending + b"\xa9\r\n\n")
    assert second == "é\r\n\n".encode("utf-8")
    assert pending == b""


def test_stream_does_not_wait_for_line_delimiters():
    raw = b"partial progress output without a newline"
    complete, pending = _complete_utf8_prefix(raw)
    assert complete == raw
    assert pending == b""
