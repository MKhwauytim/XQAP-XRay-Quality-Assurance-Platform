import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
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
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
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
