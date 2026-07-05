---
name: test-addition-or-update-with-edit-log
description: Workflow command scaffold for test-addition-or-update-with-edit-log in XQAP-XRay-Quality-Assurance-Platform.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /test-addition-or-update-with-edit-log

Use this workflow when working on **test-addition-or-update-with-edit-log** in `XQAP-XRay-Quality-Assurance-Platform`.

## Goal

Adds or updates a test file and records the change in the EDIT_LOG.

## Common Files

- `docs/EDIT_LOG.md`
- `src/**/*.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Add or update a test file (e.g., *.test.ts).
- Add an entry to docs/EDIT_LOG.md describing the test addition or change.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.