```markdown
# XQAP-XRay-Quality-Assurance-Platform Development Patterns

> Auto-generated skill from repository analysis

## Overview

This skill provides guidance for contributing to the **XQAP-XRay-Quality-Assurance-Platform**, a TypeScript codebase built with Vite. It covers coding conventions, commit patterns, and key workflows for implementing features, updating tests, and maintaining documentation consistency through the `EDIT_LOG.md`. The goal is to ensure high-quality, traceable development with clear documentation and robust testing.

## Coding Conventions

- **File Naming:** Use `camelCase` for file names.
  - Example: `imageProcessor.ts`, `qualityAssessor.test.ts`
- **Import Style:** Use relative imports.
  - Example:
    ```typescript
    import { analyzeImage } from './imageAnalyzer';
    ```
- **Export Style:** Prefer named exports.
  - Example:
    ```typescript
    // imageAnalyzer.ts
    export function analyzeImage(img: ImageData): AnalysisResult { ... }
    ```
    ```typescript
    import { analyzeImage } from './imageAnalyzer';
    ```
- **Commit Messages:** Follow [Conventional Commits](https://www.conventionalcommits.org/) with prefixes:
  - `feat`: New features
  - `fix`: Bug fixes
  - `chore`: Maintenance
  - `docs`: Documentation
  - `style`: Formatting
  - `test`: Tests
  - Example:  
    ```
    feat: add batch processing for DICOM images
    fix: correct thresholding in quality metrics
    ```

## Workflows

### Feature Implementation with Edit Log
**Trigger:** When adding a new feature or significant capability  
**Command:** `/new-feature`

1. Implement the new feature in one or more `src/**/*.ts` files.
2. Update or create corresponding test files as needed (`src/**/*.test.ts`).
3. Add an entry describing the change to `docs/EDIT_LOG.md`.

**Example:**
```typescript
// src/imageEnhancer.ts
export function enhanceImage(img: ImageData): ImageData { ... }
```
```typescript
// src/imageEnhancer.test.ts
import { enhanceImage } from './imageEnhancer';
test('enhanceImage improves clarity', () => { ... });
```
```markdown
# docs/EDIT_LOG.md
- feat: add image enhancement module (imageEnhancer.ts)
```

---

### Test Addition or Update with Edit Log
**Trigger:** When adding or updating a test for new or changed functionality  
**Command:** `/add-test`

1. Add or update a test file (e.g., `src/qualityAssessor.test.ts`).
2. Add an entry to `docs/EDIT_LOG.md` describing the test addition or change.

**Example:**
```typescript
// src/qualityAssessor.test.ts
import { assessQuality } from './qualityAssessor';
test('assessQuality detects low-contrast images', () => { ... });
```
```markdown
# docs/EDIT_LOG.md
- test: add test for low-contrast detection (qualityAssessor.test.ts)
```

---

### Retrospective Edit Log Update
**Trigger:** When a previous commit modified code or tests but forgot to update the EDIT_LOG  
**Command:** `/edit-log-retro`

1. Identify a missing `EDIT_LOG.md` entry for a past commit.
2. Add a retroactive entry to `docs/EDIT_LOG.md` describing the earlier change.

**Example:**
```markdown
# docs/EDIT_LOG.md
- fix: correct typo in imageAnalyzer.ts (added retroactively)
```

## Testing Patterns

- **Test Files:** Use the pattern `*.test.ts` and place alongside or near the source files.
- **Framework:** (Unknown; check project for specifics, but use standard TypeScript test syntax)
- **Example Test:**
    ```typescript
    // src/imageProcessor.test.ts
    import { processImage } from './imageProcessor';

    test('processImage returns expected output', () => {
      const input = ...;
      const result = processImage(input);
      expect(result).toEqual(...);
    });
    ```

## Commands

| Command         | Purpose                                                      |
|-----------------|-------------------------------------------------------------|
| /new-feature    | Start a new feature and update the EDIT_LOG                 |
| /add-test       | Add or update a test and record it in the EDIT_LOG          |
| /edit-log-retro | Add a missing entry to the EDIT_LOG for a previous change   |
```
