"""Atomically set the two parser settings without printing environment values."""
import argparse
import os
from pathlib import Path
import re
import stat
import tempfile


def apply(env_path, key_path):
    if env_path.is_symlink() or key_path.is_symlink():
        raise ValueError("Environment and key must be regular files.")
    metadata = env_path.stat()
    if not stat.S_ISREG(metadata.st_mode) or not stat.S_ISREG(key_path.stat().st_mode):
        raise ValueError("Environment and key must be regular files.")
    key = key_path.read_text("utf-8").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{24,160}", key):
        raise ValueError("The parser key must be a bounded URL-safe secret.")
    settings = {"LABRAT_DOCLING_ENDPOINT": "http://127.0.0.1:5059", "LABRAT_DOCLING_API_KEY": key}
    lines = env_path.read_text("utf-8").splitlines()
    counts = {name: 0 for name in settings}
    result = []
    for line in lines:
        match = re.match(r"^(?:export\s+)?(LABRAT_DOCLING_ENDPOINT|LABRAT_DOCLING_API_KEY)=", line)
        if match:
            name = match.group(1)
            counts[name] += 1
            if counts[name] > 1:
                raise ValueError("Duplicate parser settings in the backend environment.")
            result.append(f"{name}={settings[name]}")
        else:
            result.append(line)
    for name, value in settings.items():
        if not counts[name]:
            result.append(f"{name}={value}")
    descriptor, temporary = tempfile.mkstemp(prefix=".docling-env-", dir=env_path.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8", newline="\n") as stream:
            os.fchmod(stream.fileno(), stat.S_IMODE(metadata.st_mode))
            os.fchown(stream.fileno(), metadata.st_uid, metadata.st_gid)
            stream.write("\n".join(result) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, env_path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--env-file", type=Path, required=True)
    parser.add_argument("--key-file", type=Path, required=True)
    arguments = parser.parse_args()
    try:
        apply(arguments.env_file, arguments.key_file)
    except (OSError, ValueError):
        raise SystemExit("Could not safely update the parser environment; values were not logged.")
