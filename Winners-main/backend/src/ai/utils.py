import json
import re


def parse_json_response(raw: str) -> dict[str, object]:
    cleaned = raw.strip()
    # Strip markdown code fences if LLM ignores the instruction
    cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned)
    cleaned = re.sub(r"\s*```$", "", cleaned)
    return json.loads(cleaned)  # type: ignore[no-any-return]
