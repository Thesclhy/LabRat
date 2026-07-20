# Legible commits setup

- Session: `1f9f937e`
- Date: 2026-07-20
- Participants: repository owner and Codex

## Request

The repository owner supplied the “Legible Commits” guidance and asked Codex to read and act on the attached content. The guidance called for decision-focused commit messages, transcript provenance, reading history before edits, and explicit-path staging.

## Decision

Adopt the convention through repository-local agent instructions and a transcript archive. Keep the policy concise enough to remain usable, preserve the privacy caveat, and avoid inventing collaborator handles or agent model identities when they are unavailable.

After clarifying the intended default, the repository owner chose one concise, reviewed, redacted record for every AI-assisted session that produces commits. Raw chats are optional; routine no-change conversations are excluded; and the convention does not itself authorize automatic commits.

## Changes made

- Added the commit and transcript rules to `AGENTS.md` so future Codex collaborators load them automatically.
- Added `transcripts/README.md` with naming, provenance, and redaction rules.
- Recorded this setup session as the first redacted session record.
- Made concise session records mandatory by default for commit-producing AI sessions and explicitly excluded routine no-change chats.
- Logged the repository-context change in `doc/PROGRESS.md`.

## Verification

Documentation was inspected for internal consistency, and the resulting diff was reviewed. No runtime behavior changed, so application tests and builds were not required.
