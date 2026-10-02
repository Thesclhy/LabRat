# Docling service

This is a dedicated LabRat parsing service, reachable only by the backend. The
validated environments are Python 3.12.14 on Windows and Python 3.12.3 on
Ubuntu 24.04 x86_64, with CPU inference, one worker and four inference threads.
Original-paper conversion used approximately 2.37 GiB peak process-tree RSS on
Windows and 1.90 GiB on Linux (63 seconds on the approved 2-vCPU instance).
Reserve at least 4 GiB for the service, separate
from PostgreSQL and the application, and measure again before increasing load.

`requirements-windows.lock` and `requirements-linux.lock` record their complete
tested resolutions. A plain
`pip install docling-serve==1.21.0` is insufficient: the then-latest Docling and
jobkit combination failed during startup. `requirements.txt` records mandatory
direct pins. Linux installation starts with CPU Torch wheels from the official
CPU index and then installs the Linux lockfile. The dedicated Linux systemd
service passed the original 11-page paper / 29 anchors, native/table/rotation,
scan, mixed, blank and low-quality checks; encrypted/corrupt preflight also
passed. A Linux container image has not been validated.

## Preparation

Create a Python 3.12 virtual environment outside the source files. Install the
Windows lockfile there, then run `python -m pip check`. Never put the environment
or downloaded model weights in Git. Prepare the frozen public assets with:

```text
python services/docling/prepare-models.py /absolute/path/to/models
```

The downloader pins Hugging Face revisions and RapidOCR v3.8.0 asset paths and
checks every SHA-256 in `model-manifest.json`. A changed download fails; do not
refresh the manifest just to accept it. A parser/model/configuration change must
also change `PDF_PROCESSING_VERSION` and create new document versions.

Create a random API key of at least 24 characters in a restricted file outside
the scratch directory. Use a separate, dedicated directory named
`docling-scratch`; Docling owns its contents and removes it on graceful shutdown.
The wrapper rejects unrelated nonempty directories and model/key ancestors.

## Running

With the pinned virtual environment's Python:

```text
python services/docling/run.py --models /absolute/path/to/models --scratch /absolute/path/to/docling-scratch --key-file /absolute/path/to/private-key.txt --port 5059
```

On Windows, a background process must use a hidden window and redirected logs.
Record its PID; stop only that verified service process tree. On Linux, use a
dedicated unprivileged systemd service with `MemoryMax=4G`, `CPUQuota=150%`
on the approved 2-vCPU production instance,
`NoNewPrivileges=yes` and a writable dedicated scratch path. Give the service
read-only model/key access. Stop it before removing scratch data; resolve and
check that exact dedicated directory first. Do not delete application uploads.

Set these on the Nest backend only:

```text
LABRAT_DOCLING_ENDPOINT=http://127.0.0.1:5059
LABRAT_DOCLING_API_KEY=<same private key>
```

The adapter rejects non-loopback hostnames except the fixed private `docling`
service name, rejects embedded credentials and redirects, and checks `/version`
before submitting files. `--compose` binds inside a private container network;
only use it with an internal network, no public port and the backend as its sole
client. The current goal has not validated a Linux container image.

The wrapper verifies model checksums before starting. Inference is offline;
remote services, external plugins and custom remote model options are disabled.
The backend submits file bytes, never a source URL. File/page/character/output
caps are 25 MiB / 200 / 2,000,000 / 24 MiB. The upstream conversion deadline is
300 seconds, with a 360-second local attempt deadline. PostgreSQL fences one
active CPU job and persists the task ID; memory maps are not durable state.

`/health` confirms process availability; `/ready` does not prove models have
loaded when lazy loading is enabled. Verify a real conversion after installation.
Never log API keys, multipart request bodies, full private text or original PDFs.

## Recovery and retention

For Lightsail installation and upgrade, use the deployment workflow and
`deploy/lightsail/docling-deploy.sh`. It rejects the old 2GB host before
installation or migration, prepares an immutable runtime and checksum-verified
models, and requires an actual offline conversion before switching the backend.
Runtime/model files are read-only to `labrat-docling`; only its dedicated
scratch/cache paths are writable. The service binds to localhost and its
systemd network policy permits localhost only. Deployment keeps a database/files
checkpoint and rolls back parser, backend environment and application release
if activation fails. See [deployment evidence](../../doc/qa/docling-lightsail-deployment.md).

Backend restart resumes a known task. A service restart loses the upstream
in-memory task: its actual 404 response triggers a bounded new submission. There
are at most three total submissions per document processing version. A lost
submission response waits for its deadline rather than immediately duplicating
work. Encrypted, corrupt and oversized files fail without automatic retry.
Session/access loss interrupts the job; a currently authorized user may retry.
Cancellation fences local writes; the upstream job may finish and be discarded.

Fetched results expire after one hour. While running, the backend asks the
dedicated service every ten minutes to remove completed results older than one
hour, including unfetched orphan results. If the backend is deliberately stopped
for a long period, stop this dedicated parser as well: it has no independent
periodic sweeper for unfetched results. A graceful service stop cleans its
scratch; after a forced stop, check the recorded process is gone before clearing
only its marked scratch directory. Start with the same pinned models and key.

## Local verification and rollback

Use the original paper and generated fixtures, never unrelated project data.
`scripts/qa/verify-docling-pages.mjs` validates actual saved Docling results with
independent PDF preflight, frozen anchors, table cells and exact window joins.
The opt-in `docling-pages.postgres.test.ts` exercises real upload/DB/restart
behavior with `LABRAT_DOCLING_QA=1`; see the goal's verification report for inputs
and observed results. It is separate from default tests and must not be replaced
by mocks for acceptance. The service-restart case additionally needs the recorded
external restart harness and `LABRAT_DOCLING_RESTART_QA=1`.

To disable new parsing, remove the backend's Docling configuration and restart
the backend. New PDF registration then reports unavailable; saved pages,
historical passages and original-page rendering remain readable. Do not reverse
migration 038 or delete pages to roll back. Reprocess an original FileObject only
through an explicit authorized registration for the intended document/version;
normal reads never reparse old sources.

## Third-party assets

Docling/serve/core/jobkit code is MIT; Heron weights are Apache-2.0;
TableFormer weights use CDLA-Permissive-2.0; RapidOCR code and PaddleOCR model
sources use Apache-2.0. Their licenses are distinct. Keep installed distribution
license files, upstream model cards, notices and attributions when packaging.
No third-party code or model binaries are vendored by this directory.

The final manifest contains 26 files / 624,608,340 bytes, with SHA-256
`e4282b963037b90ae73392d6d79a26398b9ebcf5ffe8a708ac7ddbdaaa4e2af5`.
It excludes the unused visualization font; debug visualization is disabled and
real OCR is verified with that font absent. Prepare a fresh model directory,
rather than copying the old preparer's cache. Alternate model weights still in
the manifest are covered by the same documented model sources.

[Third-party notices](THIRD_PARTY_NOTICES.md) lists code/model licenses and the
retained original texts. Run `collect-notices.py` with the installed runtime to
export its complete available wheel notices, including PDFium's dependencies,
alongside any distribution. Keep the original wheel notices as well.
