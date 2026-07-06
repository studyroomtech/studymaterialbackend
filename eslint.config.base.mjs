// Shared ESLint convention rules for the Study Materials Platform backend.
//
// This flat-config array is consumed by the backend `eslint.config.mjs` and
// enforces the same code-organization conventions used across the project.
// The backend authors no React/TSX, so the inline-style (`style` prop) rules
// from the frontend config are intentionally omitted here.
//
// Enforced conventions (Requirements 1.14–1.20):
//   - Req 1.14: TypeScript only; source files use the `.ts` extension.
//   - Req 1.15/1.17: `interface` and `type` declarations live only in `*.types.ts`.
//   - Req 1.16/1.17: constant-literal exports live only in `*.constant.ts`.
//   - Req 1.18/1.20: no non-SCSS stylesheet imports.

import tseslint from 'typescript-eslint';

// Selectors that flag `interface` / `type` alias declarations (Req 1.15, 1.17).
const typeDeclarationSelectors = [
  {
    selector: 'TSInterfaceDeclaration',
    message:
      'Declare interfaces only in a *.types.ts file (Requirements 1.15, 1.17).',
  },
  {
    selector: 'TSTypeAliasDeclaration',
    message:
      'Declare type aliases only in a *.types.ts file (Requirements 1.15, 1.17).',
  },
];

// Selectors that flag exported constant *literal* values (Req 1.16, 1.17).
// Only literal-like initializers are flagged so that exported functions are
// not incorrectly reported.
const constantExportInitTypes = [
  'Literal',
  'TemplateLiteral',
  'ObjectExpression',
  'ArrayExpression',
  'TSAsExpression',
];

const constantExportSelectors = constantExportInitTypes.map((initType) => ({
  selector: `ExportNamedDeclaration > VariableDeclaration[kind="const"] > VariableDeclarator[init.type="${initType}"]`,
  message:
    'Define constant values only in a *.constant.ts file (Requirements 1.16, 1.17).',
}));

// Forbid importing non-SCSS stylesheets (Req 1.18, 1.20).
const forbiddenStyleImportPatterns = [
  {
    group: ['**/*.css', '*.css'],
    message: 'Author styling in *.scss files only (Requirements 1.18, 1.20).',
  },
  {
    group: ['**/*.less', '*.less'],
    message: 'Author styling in *.scss files only (Requirements 1.18, 1.20).',
  },
  {
    group: ['**/*.sass', '*.sass'],
    message: 'Author styling in *.scss files only (Requirements 1.18, 1.20).',
  },
  {
    group: ['**/*.styl', '*.styl'],
    message: 'Author styling in *.scss files only (Requirements 1.18, 1.20).',
  },
];

/**
 * Shared convention config as a flat-config array.
 * @type {import('eslint').Linter.Config[]}
 */
export const conventionConfig = [
  // Parser + plugin registration for all TypeScript source files (Req 1.14).
  {
    files: ['**/*.ts'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      'no-restricted-imports': ['error', { patterns: forbiddenStyleImportPatterns }],
    },
  },

  // Group A — ordinary source files (neither *.types.ts nor *.constant.ts):
  // forbid both type declarations and constant-literal exports.
  {
    files: ['**/*.ts'],
    ignores: ['**/*.types.ts', '**/*.constant.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...typeDeclarationSelectors,
        ...constantExportSelectors,
      ],
    },
  },

  // Group B — *.types.ts files: type declarations are allowed here, but
  // constant-literal exports still belong in *.constant.ts.
  {
    files: ['**/*.types.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...constantExportSelectors],
    },
  },

  // Group C — *.constant.ts files: constant-literal exports are allowed here,
  // but type/interface declarations still belong in *.types.ts.
  {
    files: ['**/*.constant.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...typeDeclarationSelectors],
    },
  },
];

export default conventionConfig;
