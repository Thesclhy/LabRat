"""Download the frozen public model assets during deployment preparation only."""
import argparse
import hashlib
import json
from pathlib import Path
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument("destination", type=Path)
args = parser.parse_args()
root = args.destination.resolve()
root.mkdir(parents=True, exist_ok=True)
sources = {
    "docling-project--docling-layout-heron/": "https://huggingface.co/docling-project/docling-layout-heron/resolve/8f39ad3c0b4c58e9c2d2c84a38465abf757272d8/",
    "docling-project--docling-models/": "https://huggingface.co/docling-project/docling-models/resolve/fc0f2d45e2218ea24bce5045f58a389aed16dc23/",
    "RapidOcr/": "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.8.0/",
}
manifest = json.loads((Path(__file__).parent / "model-manifest.json").read_text("utf-8"))
for item in manifest:
    target = (root / item["path"]).resolve()
    if not target.is_relative_to(root):
        raise SystemExit("Invalid asset path.")
    if target.is_file() and target.stat().st_size == item["bytes"] and hashlib.file_digest(target.open("rb"), "sha256").hexdigest() == item["sha256"]:
        continue
    if target.exists():
        raise SystemExit(f"Existing asset differs: {item['path']}. Use a separate model directory.")
    prefix = next((prefix for prefix in sources if item["path"].startswith(prefix)), None)
    if prefix is None:
        raise SystemExit("Unknown model source.")
    target.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_suffix(target.suffix + ".download")
    digest = hashlib.sha256()
    length = 0
    with urllib.request.urlopen(sources[prefix] + item["path"][len(prefix):], timeout=60) as response, partial.open("wb") as stream:
        while chunk := response.read(1024 * 1024):
            length += len(chunk)
            if length > item["bytes"]:
                raise SystemExit(f"Unexpected asset size: {item['path']}")
            digest.update(chunk)
            stream.write(chunk)
    if length != item["bytes"] or digest.hexdigest() != item["sha256"]:
        raise SystemExit(f"Asset checksum failed: {item['path']}")
    partial.replace(target)
    print(f"Verified {item['path']}", flush=True)
print("All frozen assets are present. No model download is needed at runtime.")
