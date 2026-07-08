```markdown
# XQAP-XRay-Quality-Assurance-Platform Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill teaches you the core development conventions and workflows for contributing to the **XQAP-XRay-Quality-Assurance-Platform**, a TypeScript project using the Vite framework. You'll learn how to structure code, write tests, document changes, and follow established workflows for feature development, UI component modularization, documentation, linting, and merging. This guide ensures consistency, maintainability, and smooth collaboration within the codebase.

## Coding Conventions

### File Naming

- **Use camelCase** for file names.
  - Example: `requestCard.tsx`, `referralApprovalList.ts`
- Test files follow the pattern: `*.test.ts` or `*.test.tsx`

### Imports

- **Use relative imports** for internal modules.
  ```typescript
  import { fetchReferrals } from './referralApi';
  import ReviewModal from '../ReviewModal';
  ```

### Exports

- **Mixed export styles** are used:
  - Named exports:
    ```typescript
    export function calculateScore(data: XRayData): number { ... }
    ```
  - Default exports:
    ```typescript
    export default ReferralApprovalList;
    ```

### Commit Messages

- **Conventional commit style** with prefixes:
  - `feat`: New feature
  - `fix`: Bug fix
  - `docs`: Documentation
  - `refactor`: Code refactor
  - `merge`: Merging branches
- Example:  
  ```
  feat: add ReviewModal component for referral approval workflow
  ```

## Workflows

### Feature Development with Edit Log and Tests
**Trigger:** When adding a new feature, major component, or significant logic change  
**Command:** `/feature`

1. Implement or refactor logic in source files (commonly under `src/data/` or `src/components/`).
2. Add or update corresponding test files (`.test.ts` or `.test.tsx` in the same directory).
3. Update `docs/EDIT_LOG.md` to log the change.

**Example:**
```typescript
// src/data/referral/referralUtils.ts
export function isReferralValid(referral: Referral): boolean {
  // logic here
}
```
```typescript
// src/data/referral/referralUtils.test.ts
import { isReferralValid } from './referralUtils';
test('valid referral', () => {
  expect(isReferralValid({ ... })).toBe(true);
});
```
```markdown
// docs/EDIT_LOG.md
- feat: add isReferralValid utility and tests
```

---

### Component Development in Sidebar EmployeeWorkspace ReferralApproval
**Trigger:** When adding or modularizing UI for referral approval  
**Command:** `/new-referralapproval-component`

1. Create a new component file under `src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/` (e.g., `RequestCard.tsx`).
2. Update `docs/EDIT_LOG.md` to log the addition.
3. Optionally, add or update test files for the new component.

**Example:**
```tsx
// src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestCard.tsx
export default function RequestCard({ request }) {
  return <div>{request.name}</div>;
}
```
```markdown
// docs/EDIT_LOG.md
- feat: add RequestCard component for ReferralApproval
```

---

### Documentation Spec and Plan Drafting
**Trigger:** When documenting a new feature or major rework before implementation  
**Command:** `/new-spec`

1. Create a new markdown file under `docs/superpowers/specs/` or `docs/superpowers/plans/`.
2. Optionally, update or create related files (e.g., `EDIT_LOG`, other docs).

**Example:**
```markdown
// docs/superpowers/specs/referral-approval-v2.md
# Referral Approval V2 Spec
...
```

---

### Lint Suppression or Lint Fix
**Trigger:** When addressing known-safe lint rule violations  
**Command:** `/lint-fix`

1. Add `eslint-disable-next-line` comments to affected files.
2. Update `docs/EDIT_LOG.md` to log the lint suppression or fix.

**Example:**
```tsx
// src/components/Sidebar/Tabs/EmployeeWorkspace/views/ReferralApproval/RequestList.tsx
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(() => { ... }, []);
```
```markdown
// docs/EDIT_LOG.md
- fix: suppress exhaustive-deps lint in RequestList
```

---

### Merge Feature Branch with Edit Log Reconciliation
**Trigger:** When merging a long-lived feature branch into main  
**Command:** `/merge-feature`

1. Merge the feature branch.
2. Resolve conflicts, especially in `docs/EDIT_LOG.md` and large component files.
3. Remove or consolidate superseded files.
4. Ensure all related files from both branches are present and reconciled.

**Example:**
```bash
git checkout main
git merge feature/referral-approval-v2
# Resolve conflicts in docs/EDIT_LOG.md and components
```

---

## Testing Patterns

- **Framework:** [vitest](https://vitest.dev/)
- **Test file pattern:** `*.test.ts` or `*.test.tsx` in the same directory as the code.
- **Typical test structure:**
  ```typescript
  import { someFunction } from './someFile';

  test('should return true for valid input', () => {
    expect(someFunction(validInput)).toBe(true);
  });
  ```
- **Run tests:**
  ```bash
  npm run test
  ```

## Commands

| Command                           | Purpose                                                        |
|------------------------------------|----------------------------------------------------------------|
| /feature                          | Start a new feature or major refactor with tests and edit log  |
| /new-referralapproval-component    | Add or modularize a ReferralApproval UI component              |
| /new-spec                         | Draft or update a feature spec or implementation plan          |
| /lint-fix                         | Suppress or fix lint rule violations and log the change        |
| /merge-feature                    | Merge a feature branch and reconcile edit log and components   |
```
