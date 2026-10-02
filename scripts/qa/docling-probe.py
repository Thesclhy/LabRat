"""Bounded real docling-serve probe. Outputs are private artifacts, not fixtures."""
import argparse
import hashlib
import json
import time
from pathlib import Path

import httpx
import psutil


def resident_bytes(pid):
    try:
        root = psutil.Process(pid)
        return sum(p.memory_info().rss for p in [root, *root.children(recursive=True)] if p.is_running())
    except psutil.Error:
        return 0


def probe(args):
    args.output.mkdir(parents=True, exist_ok=True)
    key = args.key_file.read_text().strip()
    options = {
        "to_formats": "json", "pipeline": "standard", "ocr_preset": "rapidocr",
        "do_ocr": "true", "force_ocr": "false", "do_table_structure": "true",
        "image_export_mode": "placeholder", "include_images": "false",
        "document_timeout": "300", "abort_on_error": "false",
        "pdf_backend": args.pdf_backend,
    }
    started = time.monotonic()
    metrics = {"file": args.pdf.name, "sha256": hashlib.sha256(args.pdf.read_bytes()).hexdigest(),
               "options": options, "peakRssBytes": 0, "observedStates": []}
    try:
        with httpx.Client(base_url=args.url, headers={"X-Api-Key": key}, timeout=30) as client:
            if args.resume:
                task_id = args.resume
            else:
                with args.pdf.open("rb") as source:
                    response = client.post("/v1/convert/file/async", data=options,
                                           files={"files": (args.pdf.name, source, "application/pdf")})
                response.raise_for_status()
                submission = response.json()
                (args.output / "submission.json").write_text(json.dumps(submission, indent=2), encoding="utf-8")
                task_id = submission["task_id"]
            metrics["taskId"] = task_id
            print(json.dumps({"taskId": task_id, "file": args.pdf.name}), flush=True)
            while time.monotonic() - started < 360:
                metrics["peakRssBytes"] = max(metrics["peakRssBytes"], resident_bytes(args.pid))
                poll = client.get(f"/v1/status/poll/{task_id}", params={"wait": 2})
                poll.raise_for_status()
                state = poll.json()
                status = state.get("task_status")
                if not metrics["observedStates"] or metrics["observedStates"][-1] != status:
                    metrics["observedStates"].append(status)
                    print(json.dumps({"status": status}), flush=True)
                (args.output / "last-status.json").write_text(json.dumps(state, indent=2), encoding="utf-8")
                if status in {"success", "failure", "cancelled"}:
                    metrics["terminalStatus"] = status
                    break
                time.sleep(1)
            else:
                raise TimeoutError("Probe observation deadline; resume this task ID rather than resubmit.")
            with client.stream("GET", f"/v1/result/{task_id}") as response:
                response.raise_for_status()
                raw = bytearray()
                for chunk in response.iter_bytes():
                    raw.extend(chunk)
                    if len(raw) > 24 * 1024 * 1024:
                        raise ValueError("Result exceeds 24 MiB probe cap")
            result = json.loads(raw)
            (args.output / "result.json").write_bytes(raw)
            metrics["resultBytes"] = len(raw)
            metrics["conversionStatus"] = result.get("status")
            document = result.get("document") or {}
            parsed = document.get("json_content") or {}
            if isinstance(parsed, str):
                parsed = json.loads(parsed)
            metrics["pageKeys"] = list((parsed.get("pages") or {}).keys())
            metrics["textItems"] = len(parsed.get("texts", []))
            metrics["tables"] = len(parsed.get("tables", []))
            metrics["resultFields"] = list(result)
            metrics["documentFields"] = list(document)
            metrics["errors"] = result.get("errors")
    except Exception as error:
        metrics["probeError"] = f"{type(error).__name__}: {error}"
        raise
    finally:
        metrics["elapsedSeconds"] = round(time.monotonic() - started, 3)
        (args.output / "metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")
        print(json.dumps(metrics, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--url", default="http://127.0.0.1:5059")
    parser.add_argument("--key-file", type=Path, required=True)
    parser.add_argument("--pid", type=int, required=True)
    parser.add_argument("--resume")
    parser.add_argument("--pdf-backend", choices=["docling_parse", "pypdfium2"], default="pypdfium2")
    probe(parser.parse_args())
