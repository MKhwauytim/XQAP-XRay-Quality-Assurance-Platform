---
name: feature-implementation-with-edit-log
description: Workflow command scaffold for feature-implementation-with-edit-log in XQAP-XRay-Quality-Assurance-Platform.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-implementation-with-edit-log

Use this workflow when working on **feature-implementation-with-edit-log** in `XQAP-XRay-Quality-Assurance-Platform`.

## Goal

Implements a new feature or capability, updating both code and the EDIT_LOG documentation.

## Common Files

- `docs/EDIT_LOG.md`
- `src/**/*.ts`
- `src/**/*.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Implement the new feature in one or more source files.
- Update or create corresponding test files if needed.
- Add an entry describing the change to docs/EDIT_LOG.md.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.