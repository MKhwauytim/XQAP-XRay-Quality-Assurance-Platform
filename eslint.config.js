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
    files: ['**/*.{ts,tsx}'],
    ignores: [
      'src/components/Sidebar/Tabs/ReportDesigner/**',
      'src/components/Sidebar/Tabs/Reports/**',
      'src/components/Sidebar/Tabs/ChangeLog/**',
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
          { group: ['**/ChangeLog', '**/ChangeLog/*'], caseSensitive: true, message: 'ChangeLog is a lazy tab boundary (§N) — static imports from outside tabRegistry.ts silently defeat the split.' },
          { group: ['**/UserManagement', '**/UserManagement/*'], caseSensitive: true, message: 'UserManagement is a lazy tab boundary (§N) — static imports from outside tabRegistry.ts silently defeat the split.' },
          { group: ['**/TemplateBuilder', '**/TemplateBuilder/*'], caseSensitive: true, message: 'TemplateBuilder is a lazy boundary (§N) — import its default export (already lazy) from "../TemplateBuilder" only, never a specific internal file, and never from outside EmployeeWorkspace/.' },
        ],
      }],
    },
  },
])
