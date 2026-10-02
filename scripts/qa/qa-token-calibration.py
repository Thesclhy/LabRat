"""Offline comparison with the official tokenizer; no remote code or network."""
import hashlib
import json
import pathlib
import sys
from tokenizers import Tokenizer

tokenizer_path = pathlib.Path(sys.argv[1])
samples_path = pathlib.Path(sys.argv[2])
tokenizer = Tokenizer.from_file(str(tokenizer_path))
rows = []
for sample in json.loads(samples_path.read_text(encoding="utf-8")):
    # Count the complete JSON, including tools and framing; this is an offline
    # tokenizer baseline, not an assertion about server-side chat templates.
    body = json.dumps(sample["body"], ensure_ascii=False, separators=(",", ":"))
    actual = len(tokenizer.encode(body).ids)
    rows.append({"case": sample["id"], "jsonBytes": len(body.encode("utf-8")),
                 "tokenizerTokens": actual, "reservedInput": sample["estimate"],
                 "ratio": round(sample["estimate"] / actual, 3)})
result = {"source": "https://cdn.deepseek.com/api-docs/deepseek_v4_tokenizer.zip",
          "tokenizerSha256": hashlib.sha256(tokenizer_path.read_bytes()).hexdigest(),
          "cases": rows, "allCovered": all(row["reservedInput"] >= row["tokenizerTokens"] for row in rows)}
samples_path.with_name("calibration-result.json").write_text(json.dumps(result, indent=2), encoding="utf-8")
print(json.dumps(result))
assert result["allCovered"], "An input exceeds its reservation; adjust and retain this failure before shipping."
