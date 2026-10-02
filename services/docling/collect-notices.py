"""Export the installed runtime's license files unchanged alongside its inventory."""
import argparse
import hashlib
import importlib.metadata
import json
from pathlib import Path
import shutil

parser = argparse.ArgumentParser()
parser.add_argument("destination", type=Path)
args = parser.parse_args()
root = args.destination.resolve()
root.mkdir(parents=True, exist_ok=True)
inventory = []
for distribution in sorted(importlib.metadata.distributions(), key=lambda item: item.metadata["Name"].lower()):
    name, version = distribution.metadata["Name"], distribution.version
    files = set()
    for relative in distribution.files or []:
        if any(any(word in part.lower() for word in ("license", "notice", "copying")) for part in relative.parts):
            source = Path(distribution.locate_file(relative))
            if source.is_file():
                files.add(source.resolve())
    # Some wheels install license directories without listing their children in RECORD.
    metadata_root = Path(distribution._path)
    if metadata_root.is_dir():
        for folder in metadata_root.iterdir():
            if folder.is_dir() and "license" in folder.name.lower():
                files.update(file.resolve() for file in folder.rglob("*") if file.is_file())
    copied = []
    site_root = Path(distribution.locate_file("")).resolve()
    for source in sorted(files):
        if not source.is_relative_to(site_root):
            continue
        relative = Path(name) / source.relative_to(site_root)
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
        copied.append({"path": relative.as_posix(), "sha256": hashlib.sha256(source.read_bytes()).hexdigest()})
    inventory.append({"distribution": name, "version": version,
                      "declaredLicense": distribution.metadata.get("License-Expression") or distribution.metadata.get("License"),
                      "files": copied})
for source in (Path(__file__).parent / "licenses").rglob("*"):
    if source.is_file():
        destination = root / "additional" / source.relative_to(Path(__file__).parent / "licenses")
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
(root / "inventory.json").write_text(json.dumps(inventory, ensure_ascii=False, indent=2), encoding="utf-8")
print(f"Exported notices for {len(inventory)} installed distributions; preserve the runtime's original notices too.")
