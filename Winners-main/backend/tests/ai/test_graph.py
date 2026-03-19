import pytest

from src.ai.utils import parse_json_response


def test_parse_json_strips_fences() -> None:
    raw = '```json\n{"schemas": []}\n```'
    result = parse_json_response(raw)
    assert result == {"schemas": []}


def test_parse_json_plain() -> None:
    raw = '{"schemas": [{"id": "1"}]}'
    result = parse_json_response(raw)
    assert result["schemas"][0]["id"] == "1"  # type: ignore[index]


def test_parse_json_invalid_raises() -> None:
    with pytest.raises(Exception):
        parse_json_response("not json")
