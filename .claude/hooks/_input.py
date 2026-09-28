"""Read a Claude Code hook's JSON from stdin and print one field.

    python3 _input.py file_path     -> tool_input.file_path
    python3 _input.py command       -> tool_input.command

Prints nothing when the field is absent, so a hook can treat "" as "not mine".
"""
import json
import sys

try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
field = sys.argv[1] if len(sys.argv) > 1 else ""
value = (data.get("tool_input") or {}).get(field) or data.get(field) or ""
print(value)
