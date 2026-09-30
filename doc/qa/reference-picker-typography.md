# Reference picker typography

Date: 2026-09-28. Status: deployed and verified; user retest pending.

The user found @ reference filenames too large. Candidate buttons inherited
the generic composer button's 18px type and fixed 44px height. Metadata spilled
outside the selected row, and a wrapped filename overlapped the next candidate.

Scope the picker button rule above that generic style: 13px filenames, 11px
metadata, a 2px line gap, modest padding and automatic row height. Keep filenames
wrappable and retain the full-row selected background. No JSX/behavior/API change.

Verification: production build and diff check passed. Actual Chromium with the
production frontend, real HTTP/PostgreSQL and synthetic references verified 13px/
11px computed sizes, no text overflow/overlap, desktop and 390px layout, a long
mixed Chinese/English filename, keyboard selection and pointer selection. Final
screenshots inspected. Test-owned services/database were stopped after confirming
no other database clients. No provider calls or production research writes.

The first temporary browser harness needed a CommonJS import correction, then
stopped after its desktop baseline because filling the same @ value after Escape
does not fire a change. Clearing/retyping fixed the harness; final checks passed.
The baseline screenshot confirms the overlapping rows. No application behavior
was changed to accommodate the harness.

Evidence: `.tmp/mention-typography-build.log`, `.tmp/mention-typography-after.log`,
`.tmp/mention-typography-browser/after.json`, and before/after desktop/mobile PNGs
in that directory. This isolated CSS change adds no unit tests.

User retest: refresh Ask, type @, inspect filename/metadata sizing and select a
reference. Manual acceptance remains pending.

Release: application `84e4443fa687880626454ef2739e1315fdcbdd56` is live at
`/opt/labrat/releases/20260928202623-84e4443fa687`.
[Workflow 36478638372](https://github.com/Thesclhy/LabRat/actions/runs/36478638372)
passed full regression, builds and deployment. Backup
`/var/backups/labrat/reference-picker-typography-20260928`, set `20260928202119`,
passed integrity checks. Exact public assets, health and existing schema/auth
checks passed; no migration or provider change. Safe receipt:
[reference-picker-typography-live.json](reference-picker-typography-live.json).
