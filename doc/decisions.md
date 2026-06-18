# Decisions

Durable decisions for LabRat architecture, product workflow, and Codex execution belong here. Keep entries newest first. Each entry should explain the decision, the context, the consequences, and any follow-up.

## 2026-06-18 - `doc/plan.md` Is The Active Agent-First Execution Source

Status: Accepted

Decision:
`doc/plan.md` is the source of truth for the current Agent-first evidence workflow implementation. `doc/source-understanding-long-term-plan.md` remains a reference architecture for Source Workspace details, not a competing milestone plan.

Context:
The Source Workspace plan explains why workbook/range evidence is needed, while the current product direction also includes ObservationSeries compare, Analysis Views, controlled AgentRuns, proposal review, and manuscript output. Keeping both documents is useful, but only one should drive sequencing.

Consequences:

- New implementation milestones should follow `doc/plan.md`.
- If a detailed source-workspace idea from `doc/source-understanding-long-term-plan.md` becomes active, first incorporate it into `doc/plan.md`.
- Roadmap, API, schema, data dictionary, and AI boundary docs should use `doc/plan.md` terminology for current work.

## 2026-06-18 - Codex Long-Task Loop Is Mandatory

Status: Accepted

Decision:
Codex work in this repository must follow a repeated execution loop:

```text
read docs -> create checklist -> implement one milestone -> run tests -> update progress -> re-read docs -> continue
```

Context:
The active roadmap is too large for a single pass. `doc/plan.md` is the current execution source of truth, while API contracts, data dictionary, architecture, and AI-boundary docs define the safety rails for backend, frontend, data, and AI changes.

Consequences:

- Non-trivial implementation starts by reading `doc/plan.md`.
- Routes, schemas, persistence, migrations, and frontend API usage require reading API/data-model docs first.
- Long tasks need an explicit checklist in `doc/task-checklist.md`.
- Every completed milestone updates `doc/PROGRESS.md`.
- Agents must stop and report code/doc conflicts instead of guessing.

## 2026-06-18 - `doc/PROGRESS.md` Remains The Canonical Progress Log

Status: Accepted

Decision:
Use the existing uppercase `doc/PROGRESS.md` as the canonical progress file. Do not create a parallel lowercase `doc/progress.md`.

Context:
The repository already uses `doc/PROGRESS.md`, and this workspace runs on Windows where case-only duplicate paths are unreliable.

Consequences:

- Scripts and AGENTS instructions refer to `doc/PROGRESS.md`.
- User requests that mention `doc/progress.md` should be interpreted as the existing progress log unless the repository moves to a case-sensitive filesystem and explicitly renames the file.
