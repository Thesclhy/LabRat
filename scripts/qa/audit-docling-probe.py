"""Compare a real conversion to frozen paper anchors; no answer generation."""
import argparse
import json
import re
from pathlib import Path


def comparison_text(text):
    text = text.replace("ﬁ", "fi").replace("ﬂ", "fl")
    text = re.sub(r"-\s*\n\s*", "", text)
    return re.sub(r"\s+", " ", text).strip()


def audit(result_path, golden_path):
    result = json.loads(result_path.read_text(encoding="utf-8"))
    doc = result["document"]["json_content"]
    pages = {int(n): [] for n in doc.get("pages", {})}
    for item in doc.get("texts", []):
        text = item.get("text", "")
        for prov in item.get("prov", []):
            start, end = prov.get("charspan", [0, len(text)])
            pages.setdefault(prov["page_no"], []).append(text[start:end])
    goldens = json.loads(golden_path.read_text(encoding="utf-8"))
    results = []
    for anchor in goldens["anchors"]:
        actual = comparison_text("\n".join(pages.get(anchor["page"], [])))
        results.append({**anchor, "found": comparison_text(anchor["text"]) in actual})
    report = {
        "conversionStatus": result.get("status"), "errors": result.get("errors"),
        "pages": [{"page": n, "items": len(items), "characters": len("\n".join(items))} for n, items in sorted(pages.items())],
        "anchorsFound": sum(x["found"] for x in results), "anchorsTotal": len(results), "anchors": results,
    }
    (result_path.parent / "anchor-audit.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps({**report, "anchors": [x for x in results if not x["found"]]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("result", type=Path)
    parser.add_argument("--goldens", type=Path, default=Path("doc/qa/docling-pdf-pages-goldens.json"))
    args = parser.parse_args()
    audit(args.result, args.goldens)
