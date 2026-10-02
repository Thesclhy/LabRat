"""Start the pinned, offline, local CPU Docling service; does not download models."""
import argparse
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import sys

def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models", type=Path, required=True)
    parser.add_argument("--scratch", type=Path, required=True)
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--port", type=int, default=5059)
    parser.add_argument("--compose", action="store_true", help="Bind inside the private Compose network")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        raise SystemExit("Use a nonprivileged service port.")
    for distribution, expected in {"docling-serve": "1.21.0", "docling": "2.96.1", "docling-core": "2.78.0",
                                   "docling-jobkit": "1.20.1", "docling-ibm-models": "3.13.2", "docling-parse": "6.2.0",
                                   "rapidocr": "3.8.1", "transformers": "5.9.0"}.items():
        if importlib.metadata.version(distribution) != expected:
            raise SystemExit(f"Unexpected {distribution} version; install the pinned runtime.")
    model_root = args.models.resolve(strict=True)
    manifest = json.loads((Path(__file__).parent / "model-manifest.json").read_text("utf-8"))
    for item in manifest:
        target = (model_root / item["path"]).resolve(strict=True)
        if not target.is_relative_to(model_root):
            raise SystemExit("Model manifest escapes its root.")
        digest = hashlib.sha256()
        with target.open("rb") as stream:
            for chunk in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(chunk)
        if target.stat().st_size != item["bytes"] or digest.hexdigest() != item["sha256"]:
            raise SystemExit(f"Model integrity failed: {item['path']}")
    key = args.key_file.read_text("utf-8").strip()
    if len(key) < 24:
        raise SystemExit("Use an API key with at least 24 characters.")
    # docling-serve owns this scratch directory and removes it at graceful shutdown.
    scratch = args.scratch.resolve()
    if (scratch == model_root or scratch in model_root.parents or scratch == Path(scratch.anchor)
            or args.key_file.resolve().is_relative_to(scratch) or scratch.name != "docling-scratch"):
        raise SystemExit("Scratch must be a dedicated directory outside the models/root.")
    marker = scratch / ".labrat-docling-scratch"
    if scratch.exists() and any(scratch.iterdir()) and not marker.is_file():
        raise SystemExit("Refusing an existing nonempty scratch directory not owned by LabRat Docling.")
    scratch.mkdir(parents=True, exist_ok=True)
    marker.touch()
    os.environ.update({
        "PYTHONIOENCODING": "utf-8", "DOCLING_SERVE_ARTIFACTS_PATH": str(model_root),
        "DOCLING_SERVE_SCRATCH_PATH": str(scratch), "DOCLING_SERVE_API_KEY": key,
        "DOCLING_SERVE_ENG_LOC_NUM_WORKERS": "1", "DOCLING_SERVE_ENG_LOC_SHARE_MODELS": "true",
        "DOCLING_SERVE_LOAD_MODELS_AT_BOOT": "false", "DOCLING_SERVE_SINGLE_USE_RESULTS": "true",
        "DOCLING_SERVE_RESULT_REMOVAL_DELAY": "3600", "DOCLING_SERVE_SHOW_VERSION_INFO": "true",
        "DOCLING_SERVE_MAX_DOCUMENT_TIMEOUT": "300", "DOCLING_SERVE_MAX_NUM_PAGES": "200",
        "DOCLING_SERVE_MAX_FILE_SIZE": str(25 * 1024 * 1024), "DOCLING_SERVE_ENABLE_REMOTE_SERVICES": "false",
        "DOCLING_SERVE_ALLOW_EXTERNAL_PLUGINS": "false", "DOCLING_SERVE_ALLOW_CUSTOM_VLM_CONFIG": "false",
        "DOCLING_SERVE_ALLOW_CUSTOM_PICTURE_DESCRIPTION_CONFIG": "false", "DOCLING_SERVE_ALLOW_CUSTOM_CODE_FORMULA_CONFIG": "false",
        "DOCLING_DEVICE": "cpu", "DOCLING_NUM_THREADS": "4", "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1",
        "DOCLING_DEBUG": json.dumps({"visualize_cells": False, "visualize_ocr": False,
                                    "visualize_layout": False, "visualize_raw_layout": False, "visualize_tables": False}),
    })
    sys.argv = ["docling-serve", "run", "--host", "0.0.0.0" if args.compose else "127.0.0.1", "--port", str(args.port)]
    from docling_serve.__main__ import main
    main()


if __name__ == "__main__":
    run()
