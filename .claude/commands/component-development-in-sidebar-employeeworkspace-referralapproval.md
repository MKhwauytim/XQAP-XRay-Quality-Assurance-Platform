---
name: component-development-in-sidebar-employeeworkspace-referralapproval
description: Workflow command scaffold for component-development-in-sidebar-employeeworkspace-referralapproval in XQAP-XRay-Quality-Assurance-Platform.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /component-development-in-sidebar-employeeworkspace-referralapproval

Use this workflow when working on **component-development-in-sidebar-employeeworkspace-referralapproval** in `XQAP-XRay-Quality-Assurance-Platform`.

## Goal

Adds or splits out new UI components for the ReferralApproval workflow in EmployeeWorkspace, each as a new file.

## Common Files

- `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/*.tsx`
- `docs/EDIT_LOG.md`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Create a new component file under src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/ (e.g., RequestCard.tsx, RequestList.tsx, ReviewModal.tsx).
- Update docs/EDIT_LOG.md to log the addition.
- Optionally, add or update test files for the new component.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.