# Docling runtime notices

This directory contains LabRat configuration and adapters, not modified upstream
Docling source or model binaries. Versions are fixed by `requirements.txt`, the
tested Windows lockfile and `model-manifest.json`. Retain the following notices
when preparing or redistributing a runtime, together with the notices already
installed by its dependencies. Code and model licenses are separate.

| Component | Tested version / revision | Declared license and retained evidence |
| --- | --- | --- |
| Docling / docling-slim | 2.96.1 | MIT; `licenses/docling-slim-LICENSE.txt` |
| docling-core | 2.78.0 | MIT; corresponding LICENSE file |
| docling-ibm-models | 3.13.2 | MIT inference code; corresponding LICENSE file |
| docling-parse | 6.2.0 | MIT; corresponding LICENSE file; preserve its bundled CMap notices |
| docling-serve | 1.21.0 | MIT; corresponding LICENSE file |
| docling-jobkit | 1.20.1 | MIT; corresponding LICENSE file |
| Heron layout weights | 8f39ad3c0b4c58e9c2d2c84a38465abf757272d8 | Apache-2.0; `Heron-MODEL-CARD.md` and `Apache-2.0.txt` |
| TableFormer weights | fc0f2d45e2218ea24bce5045f58a389aed16dc23 | CDLA-Permissive-2.0; `TableFormer-MODEL-CARD.md` and `CDLA-Permissive-2.0.txt` |
| RapidOCR | 3.8.1 | Apache-2.0; `RapidOCR-LICENSE.txt` |
| PP-OCRv4 detector/recognizer, v2 classifier and dictionaries | RapidAI asset release v3.8.0; individual checksums in manifest | PaddleOCR Apache-2.0; `PaddleOCR-LICENSE.txt`; retain RapidOCR provenance too |
| pypdfium2 / PDFium | 5.13.0 wheel | BSD-3-Clause / Apache-2.0 bindings and bundled dependency licenses; retain the complete wheel `licenses/` directory |
| ONNX Runtime | 1.26.0 | MIT; retain package `LICENSE` and `ThirdPartyNotices.txt` |
| PyTorch | 2.12.0 | BSD-3-Clause and bundled dependency notices; retain distribution `LICENSE` and `NOTICE` |
| Transformers | 5.9.0 | Apache-2.0; retain distribution license directory |

`licenses/sources.json` records origins and SHA-256 values for the unmodified
copies. The six MIT files retain their original copyright notices. Model cards
retain upstream attribution and references. Their declared licenses apply to the
identified artifacts; no blanket claim is made about all Docling ecosystem assets.

The preparer's optional `FZYTK.TTF` visualization font is excluded from the final
26-file manifest and runtime directory. LabRat disables all Docling debug
visualizations. Recognition and table extraction do not use that font; real scan
conversion with the font absent is part of acceptance. Do not copy an old entire
model cache into a distribution. Prepare the manifest into a fresh directory.

Export the installed runtime's notices with that runtime's Python:

```text
python services/docling/collect-notices.py /absolute/path/to/runtime-notices
```

This copies license/notice files unchanged, including PDFium's nested dependency
notices, and records installed package versions and file hashes in `inventory.json`.
Keep the resulting notices directory alongside a packaged runtime. It supplements,
and does not replace, the original wheel metadata/notices or an upstream NOTICE.
The local acceptance export is in ignored artifacts; it is not model source code.

Authoritative references: [Docling license](https://github.com/docling-project/docling/blob/v2.96.1/LICENSE),
[RapidOCR license](https://github.com/RapidAI/RapidOCR/blob/v3.8.1/LICENSE),
[PaddleOCR license](https://github.com/PaddlePaddle/PaddleOCR/blob/v2.7.0/LICENSE),
[Heron pinned card](https://huggingface.co/docling-project/docling-layout-heron/blob/8f39ad3c0b4c58e9c2d2c84a38465abf757272d8/README.md),
[TableFormer pinned card](https://huggingface.co/docling-project/docling-models/blob/fc0f2d45e2218ea24bce5045f58a389aed16dc23/README.md),
[CDLA text](https://cdla.dev/permissive-2-0/).
