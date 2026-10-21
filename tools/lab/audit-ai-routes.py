"""Compare AI endpoints used by the lab chat with backend lab routes."""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
chat = (ROOT / "apps/web/core/components/lab/agent-chat.tsx").read_text()
urls = (ROOT / "apps/api/plane/lab/urls.py").read_text()

used = set()
for match in re.finditer(r"agent/[a-z-]+/(?:\$\{[^}]+\}/approve/)?", chat):
    value = match.group(0)
    value = re.sub(r"\$\{[^}]+\}", "<id>", value)
    used.add(value)

patterns = set()
for match in re.finditer(r'path\("(agent/[^"]+)"', urls):
    patterns.add(re.sub(r"<[^>]+>", "<id>", match.group(1)))

missing = sorted(used - patterns)
print("used:", len(used), "routes:", len(patterns))
for item in sorted(used):
    print(("OK   " if item in patterns else "MISS ") + item)
if missing:
    raise SystemExit("missing routes: " + ", ".join(missing))
print("AI route audit passed")
