"""Verify the local parser with a synthetic PDF; never prints the private key."""
import argparse
import json
from pathlib import Path
import time

import httpx


def sample_pdf():
    text = b"BT /F1 16 Tf 40 740 Td (LabRat Docling deployment smoke) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(text)).encode() + b" >>\nstream\n" + text + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    content = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for number, obj in enumerate(objects, 1):
        offsets.append(len(content))
        content.extend(f"{number} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(content)
    content.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        content.extend(f"{offset:010d} 00000 n \n".encode())
    content.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(content)


def run():
    parser = argparse.ArgumentParser()
    parser.add_argument("--key-file", type=Path, required=True)
    args = parser.parse_args()
    key = args.key_file.read_text("utf-8").strip()
    if len(key) < 24:
        raise SystemExit("The local parser key is invalid.")
    expected = {"docling-serve": "1.21.0", "docling": "2.96.1", "docling-core": "2.78.0",
                "docling-jobkit": "1.20.1", "docling-ibm-models": "3.13.2", "docling-parse": "6.2.0"}
    options = {"to_formats": "json", "pipeline": "standard", "ocr_preset": "rapidocr",
               "do_ocr": "true", "force_ocr": "false", "do_table_structure": "true",
               "image_export_mode": "placeholder", "include_images": "false",
               "document_timeout": "300", "abort_on_error": "false", "pdf_backend": "pypdfium2"}
    started = time.monotonic()
    with httpx.Client(base_url="http://127.0.0.1:5059", headers={"X-Api-Key": key},
                      timeout=30, follow_redirects=False, trust_env=False) as client:
        version = client.get("/version")
        version.raise_for_status()
        if any(version.json().get(name) != value for name, value in expected.items()):
            raise SystemExit("The parser versions differ from the application processing version.")
        response = client.post("/v1/convert/file/async", data=options,
                               files={"files": ("deployment-smoke.pdf", sample_pdf(), "application/pdf")})
        response.raise_for_status()
        task_id = response.json()["task_id"]
        if not isinstance(task_id, str) or not all(c.isalnum() or c in "_-" for c in task_id):
            raise SystemExit("The parser task identifier is invalid.")
        while time.monotonic() - started < 360:
            response = client.get(f"/v1/status/poll/{task_id}", params={"wait": 2})
            response.raise_for_status()
            status = response.json().get("task_status")
            if status == "success":
                break
            if status not in {"pending", "started"}:
                raise SystemExit("The synthetic PDF conversion failed.")
            time.sleep(1)
        else:
            raise SystemExit("The synthetic PDF conversion exceeded its deadline.")
        response = client.get(f"/v1/result/{task_id}")
        response.raise_for_status()
        if len(response.content) > 24 * 1024 * 1024:
            raise SystemExit("The synthetic result exceeds its size limit.")
        result = response.json()
        document = result.get("document", {}).get("json_content", {})
        if isinstance(document, str):
            document = json.loads(document)
        texts = " ".join(item.get("orig") or item.get("text", "") for item in document.get("texts", []))
        if result.get("status") != "success" or set(document.get("pages", {})) != {"1"} \
                or "LabRat Docling deployment smoke" not in texts:
            raise SystemExit("The parser did not retain the synthetic page and text.")
    print(json.dumps({"ok": True, "pages": 1, "seconds": round(time.monotonic() - started, 2),
                      "versions": expected}))


if __name__ == "__main__":
    run()
