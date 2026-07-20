# Session Transcripts

This directory connects AI-assisted repository changes to the conversations and decisions that produced them.

The default policy is one concise, reviewed, redacted session record for every AI-assisted session that produces one or more commits. Use one record per logical session and update it when the session produces additional commits. Full raw chat exports are optional, not the default.

Routine questions, status checks, and conversations that produce neither a commit nor a durable repository decision are not archived. This policy does not make committing automatic; it applies when work is otherwise being committed.

Use chronologically sortable filenames such as:

```text
YYYY-MM-DD-topic-short-id.md
```

Commits that result from an archived session should include a matching provenance line:

```text
source: session <short-id> @ <ISO-8601 timestamp>
```

Before committing a session record, remove secrets, credentials, personal information, and unrelated private context. When even a redacted record cannot be shared safely, keep it outside this repository and preserve the essential safe reasoning in the code commit body.
