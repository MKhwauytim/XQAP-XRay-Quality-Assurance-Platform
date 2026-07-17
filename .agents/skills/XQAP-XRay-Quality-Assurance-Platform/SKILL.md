```markdown
# XQAP-XRay-Quality-Assurance-Platform Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill provides a comprehensive guide to the development patterns, coding conventions, and workflows used in the **XQAP-XRay-Quality-Assurance-Platform** repository. The codebase is written in TypeScript and focuses on modular, test-driven development for quality assurance tooling, with a strong emphasis on maintaining robust test coverage and clear documentation of changes.

## Coding Conventions

- **File Naming:**  
  Use camelCase for file names.  
  _Example:_  
  ```
  reportDesignStorage.ts
  populationLoadRace.test.tsx
  ```

- **Import Style:**  
  Use relative imports for modules within the project.  
  _Example:_  
  ```typescript
  import { getReportDesign } from './reportDesignStorage';
  ```

- **Export Style:**  
  Use named exports rather than default exports.  
  _Example:_  
  ```typescript
  // Good
  export function getReportDesign() { ... }

  // Avoid
  export default function getReportDesign() { ... }
  ```

- **Commit Messages:**  
  Follow [Conventional Commits](https://www.conventionalcommits.org/).  
  Prefixes include: `fix`, `docs`, `test`.  
  _Example:_  
  ```
  fix: correct race condition in population loader
  ```

## Workflows

### Bugfix with Test and Edit Log
**Trigger:** When you need to fix a bug and ensure it's tested and documented in the edit log.  
**Command:** `/bugfix-with-test`

1. Edit the source file to fix the bug.
2. Update or add a test file for the affected module/component.
3. Update `docs/EDIT_LOG.md` to record the change.

_Example:_
```typescript
// src/components/Sidebar/Tabs/Population/index.tsx
export function loadPopulationRace() {
  // ...bugfix applied here
}
```
```typescript
// src/components/Sidebar/Tabs/Population/populationLoadRace.test.tsx
import { loadPopulationRace } from './index';
test('loads population race correctly', () => {
  // ...test logic
});
```
```markdown
# docs/EDIT_LOG.md
- fix: corrected population race loading logic (2024-06-01)
```

### Add or Improve Test with Edit Log
**Trigger:** When you want to add or improve test coverage and document it.  
**Command:** `/add-test`

1. Add or update test file(s) for the relevant module.
2. Update `docs/EDIT_LOG.md` to record the addition or improvement.

_Example:_
```typescript
// src/data/reporting/reportBuilders.xss.test.ts
import { buildReport } from './reportBuilders.xss';
test('builds report with XSS protection', () => {
  // ...test logic
});
```
```markdown
# docs/EDIT_LOG.md
- test: added XSS protection tests for reportBuilders (2024-06-02)
```

### Feature or Bugfix in Report Designer with Edit Log and Tests
**Trigger:** When you want to improve or fix report designer storage and ensure it's tested and documented.  
**Command:** `/edit-report-designer-storage`

1. Edit `src/data/reportDesigner/storage/reportDesignStorage.ts` to implement the feature or fix.
2. Update or add `src/data/reportDesigner/storage/reportDesignStorage.test.ts`.
3. Update `docs/EDIT_LOG.md`.

_Example:_
```typescript
// src/data/reportDesigner/storage/reportDesignStorage.ts
export function saveDesign(design) {
  // ...feature or bugfix here
}
```
```typescript
// src/data/reportDesigner/storage/reportDesignStorage.test.ts
import { saveDesign } from './reportDesignStorage';
test('saves design correctly', () => {
  // ...test logic
});
```
```markdown
# docs/EDIT_LOG.md
- feat: added autosave to reportDesignStorage (2024-06-03)
```

## Testing Patterns

- **Framework:** [Vitest](https://vitest.dev/)
- **Test File Naming:**  
  Test files use the `.test.ts` or `.test.tsx` suffix and are placed alongside the modules they test.
  _Example:_  
  ```
  src/data/templates/templateSelectionStorage.test.ts
  ```

- **Test Example:**
  ```typescript
  // src/data/answers/employeeXlsx.test.ts
  import { generateEmployeeXlsx } from './employeeXlsx';
  test('generates XLSX with correct headers', () => {
    // ...assertions
  });
  ```

## Commands

| Command                      | Purpose                                                         |
|------------------------------|-----------------------------------------------------------------|
| /bugfix-with-test            | Fix a bug, update/add tests, and log the edit                   |
| /add-test                    | Add or improve test coverage and log the change                 |
| /edit-report-designer-storage| Feature or bugfix in report designer storage with tests and log |
```
