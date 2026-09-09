import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import reactCompiler from 'eslint-plugin-react-compiler'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    plugins: {
      'react-compiler': reactCompiler,
    },
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      // Informational, not a correctness rule: it reports components the React
      // Compiler declined to optimize because a `react-hooks/*` rule was
      // disabled somewhere inside them. This codebase has ~9 such components
      // with deliberate, individually-justified disables (latest-value refs
      // that are reassigned every render, and synchronous state resets in
      // effects). Those components are correct and still work — they simply
      // don't get auto-memoized, which is the pre-compiler status quo.
      //
      // Left as 'error' it fails `lint:ci` (`--max-warnings 0`) over a
      // trade-off that was made knowingly, so it is off. Re-enable it if the
      // disables are ever removed; it is genuinely useful for finding
      // components that are accidentally opting out of optimization.
      'react-compiler/react-compiler': 'off',
    },
  },
  {
    // ── Raw `removeEntry` is banned outside a short allowlist ───────────────
    //
    // `safeWriteJson` maintains THREE names for one logical file (the live
    // name, `{file}.bak`, `{file}.tmp`) and `safeReadJson` reads them as one:
    // on a miss of the live name it falls through to the siblings. So removing
    // only the live name does not delete the record — it leaves an orphan that
    // answers every subsequent read, forever, while `storage:bak-recovery`
    // reports the file as "damaged".
    //
    // That is not hypothetical. It ran in production for over eighteen hours
    // across every user (`tmpl-1787457917309-ngm1iq.json`, 2026-09-08/09), and
    // it had been written by hand at six different call sites — one of which
    // (`deleteDesign`) even carried a comment explaining the hazard, which is
    // exactly how a convention that lives only in comments fails.
    //
    // `safeRemoveJson` is now the one way to delete a managed name. `lint:ci`
    // runs with `--max-warnings 0`, so a new raw call fails the PR rather than
    // shipping a seventh orphan.
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      // The primitive itself, and the in-memory directory it is tested against.
      'src/data/storage/safeWrite.ts',
      'src/data/storage/memoryDirectory.ts',
      // Probe cleanup: these write and remove their own scratch files, which
      // are not safeWriteJson-managed and have no siblings.
      'src/data/storage/transientFileErrors.ts',
      // Whole FOLDERS and a restore marker, not managed JSON names.
      'src/data/backup/backupStorage.ts',
      // Archivers whose whole purpose is to keep the sibling as the recovery
      // source after moving the live file aside.
      'src/data/approvals/decisionFileRecovery.ts',
      'src/data/templates/templateFileRecovery.ts',
      // Removes exactly ONE orphaned sibling, after copying its bytes to an
      // archive name. Using safeRemoveJson here would take the live file and
      // the OTHER sibling with it, which is the opposite of the intent.
      'src/data/storage/orphanSiblings.ts',
      // Legacy `messages.json` archive-out (feedback migration).
      'src/data/feedback/feedbackStorage.ts',
      '**/*.test.ts',
      '**/*.test.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name="removeEntry"]',
          message:
            'Use safeRemoveJson(dir, fileName) from src/data/storage/safeWrite.ts. ' +
            'A raw removeEntry deletes only the live file and leaves {file}.bak / ' +
            '{file}.tmp behind, which safeReadJson then serves forever as a ' +
            '"recovered" copy of a record the user deleted.',
        },
      ],
    },
  },
  {
    // Playwright specs: Node-side test code, not app code. The React-specific
    // rule sets above are inapplicable here (there are no components and no
    // Fast Refresh boundary), and the suite runs under Node, so it needs Node
    // globals rather than only the browser ones. Everything else — the
    // TypeScript rules, unused-vars, prefer-const — still applies.
    files: ['e2e/**/*.ts', 'playwright.config.ts'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'react-refresh/only-export-components': 'off',
      'react-hooks/rules-of-hooks': 'off',
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    ignores: [
      'src/components/Sidebar/Tabs/ReportDesigner/**',
      'src/components/Sidebar/Tabs/Reports/**',
      'src/components/Sidebar/Tabs/UserManagement/**',
      'src/components/Sidebar/Tabs/TemplateBuilder/**',
      'src/components/Sidebar/Tabs/EmployeeWorkspace/**',
      'src/components/Sidebar/Tabs/tabRegistry.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        patterns: [
          { group: ['**/ReportDesigner', '**/ReportDesigner/*'], caseSensitive: true, message: 'ReportDesigner is a lazy boundary (§N) — import its default export (already lazy) from "../ReportDesigner" only, never a specific internal file, and never from outside Reports/.' },
          { group: ['**/Reports', '**/Reports/*'], caseSensitive: true, message: 'Reports is a lazy tab boundary (§N) — static imports from outside tabRegistry.ts silently defeat the split.' },
          { group: ['**/UserManagement', '**/UserManagement/*'], caseSensitive: true, message: 'UserManagement is a lazy tab boundary (§N) — static imports from outside tabRegistry.ts silently defeat the split.' },
          { group: ['**/TemplateBuilder', '**/TemplateBuilder/*'], caseSensitive: true, message: 'TemplateBuilder is a lazy boundary (§N) — import its default export (already lazy) from "../TemplateBuilder" only, never a specific internal file, and never from outside EmployeeWorkspace/.' },
        ],
      }],
    },
  },
])
