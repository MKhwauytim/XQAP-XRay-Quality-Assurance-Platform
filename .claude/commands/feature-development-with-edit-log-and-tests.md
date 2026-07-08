---
name: feature-development-with-edit-log-and-tests
description: Workflow command scaffold for feature-development-with-edit-log-and-tests in XQAP-XRay-Quality-Assurance-Platform.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-development-with-edit-log-and-tests

Use this workflow when working on **feature-development-with-edit-log-and-tests** in `XQAP-XRay-Quality-Assurance-Platform`.

## Goal

Implements a new feature or major refactor, with corresponding tests and an entry in the EDIT_LOG.

## Common Files

- `src/data/*/*.ts`
- `src/data/*/*.test.ts`
- `src/components/**/*.{ts,tsx}`
- `docs/EDIT_LOG.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Implement or refactor logic in one or more source files (often under src/data/ or src/components/).
- Add or update corresponding test files (usually .test.ts or .test.tsx in the same directory).
- Update docs/EDIT_LOG.md to log the change.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.