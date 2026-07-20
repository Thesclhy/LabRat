# Session Transcripts

This directory connects AI-assisted repository changes to the conversations and decisions that produced them.

Use chronologically sortable filenames such as:

```text
YYYY-MM-DD-topic-short-id.md
```

Commits that result from an archived session should include a matching provenance line:

```text
source: session <short-id> @ <ISO-8601 timestamp>
```

Before committing a transcript, remove secrets, credentials, personal information, and unrelated private context. When a raw transcript cannot be shared safely, archive only a concise redacted session record and preserve the essential reasoning in the code commit body.
