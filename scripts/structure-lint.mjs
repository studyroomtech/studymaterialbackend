#!/usr/bin/env node
// @ts-check
/**
 * structure-lint.mjs
 *
 * Structural conformance check for the Study Materials Platform.
 *
 * This is a standalone Node script (no dependencies) that can be run directly
 * with `node backend/scripts/structure-lint.mjs` or via `npm run structure-lint`
 * from the `backend` project. It does NOT rely on a root package.json or npm
 * workspaces — `frontend` and `backend` are treated as two independent projects
 * that happen to live under a common repository root.
 *
 * It enforces the following required-structure rules:
 *
 *   1. (Req 1.8) The repository root contains no top-level SOURCE folder other
 *      than `frontend` and `backend`. Dot-folders (.kiro, .vscode, .git, ...)
 *      and any root-level files (config, dotfiles) are ignored.
 *
 *   2. (Req 1.9) Reusable UI components, reusable hooks, and shared utilities
 *      live only in their designated dedicated folders:
 *        - frontend/src/components  (Common Components Folder)
 *        - frontend/src/hooks       (Hooks Folder)
 *        - frontend/src/utils       (Common Utils Folder)
 *        - backend/src/utils        (backend common utilities)
 *
 *   3. (Req 10.1) The Roles referenced in source are exactly `role_common` and
 *      `role_admin` — no other `role_*` identifier may appear in source code.
 *
 * Exit code 0 = conformant, 1 = non-conformant (violations printed), 2 = script error.
 */

import { readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname, relative, basename, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
// scripts/ -> backend/ -> repository root
const REPO_ROOT = join(SCRIPT_DIR, '..', '..');

const FRONTEND = join(REPO_ROOT, 'frontend');
const BACKEND = join(REPO_ROOT, 'backend');

/** Top-level source folders that are permitted at the repository root. */
const ALLOWED_TOP_LEVEL_FOLDERS = new Set(['frontend', 'backend']);

/** The only Role identifiers permitted anywhere in source. */
const ALLOWED_ROLES = new Set(['role_common', 'role_admin']);

/** Directory names never traversed / never treated as source. */
const IGNORED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  '.next',
  '.git',
  '.kiro',
  '.vscode',
  'coverage',
  'build',
]);

/** Alternative "reusable code" folder names that must NOT exist under src/. */
const DISALLOWED_ALT_FOLDERS = new Set(['lib', 'helpers', 'common', 'shared']);

/** Source file extensions that are scanned for role identifiers. */
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mjs', '.cjs', '.js', '.jsx']);

/** Next.js App Router special files that may legitimately live under src/app. */
const NEXT_APP_SPECIAL_FILES = new Set([
  'layout.tsx',
  'page.tsx',
  'loading.tsx',
  'error.tsx',
  'not-found.tsx',
  'template.tsx',
  'default.tsx',
  'global-error.tsx',
  'route.ts',
  'route.tsx',
]);

/** @type {string[]} */
const violations = [];

function addViolation(rule, message) {
  violations.push(`[${rule}] ${message}`);
}

function isIgnoredDir(name) {
  return name.startsWith('.') || IGNORED_DIR_NAMES.has(name);
}

/**
 * Recursively collect files under a directory, skipping ignored directories.
 * @param {string} dir
 * @returns {string[]} absolute file paths
 */
function collectFiles(dir) {
  /** @type {string[]} */
  const out = [];
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (isIgnoredDir(entry)) continue;
      out.push(...collectFiles(full));
    } else if (s.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function pathIsInside(child, parent) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}

// ---------------------------------------------------------------------------
// Check 1 — Top-level source folders (Req 1.8)
// ---------------------------------------------------------------------------
function checkTopLevelFolders() {
  let entries;
  try {
    entries = readdirSync(REPO_ROOT);
  } catch (err) {
    addViolation('1.8', `Unable to read repository root: ${String(err)}`);
    return;
  }
  for (const entry of entries) {
    if (entry.startsWith('.')) continue; // dotfiles / dot-folders ignored
    const full = join(REPO_ROOT, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue; // root-level files (configs) are ignored
    if (IGNORED_DIR_NAMES.has(entry)) continue;
    if (!ALLOWED_TOP_LEVEL_FOLDERS.has(entry)) {
      addViolation(
        '1.8',
        `Unexpected top-level source folder "${entry}" at repository root. ` +
          `Only "frontend" and "backend" are permitted.`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Check 2 — Reusable code lives only in designated folders (Req 1.9)
// ---------------------------------------------------------------------------
function checkReusableCodePlacement() {
  const feSrc = join(FRONTEND, 'src');
  const feComponents = join(feSrc, 'components');
  const feHooks = join(feSrc, 'hooks');
  const feApp = join(feSrc, 'app');

  // 2a. Disallow alternative reusable-code folders under frontend/src and backend/src.
  for (const [label, srcDir] of [
    ['frontend', feSrc],
    ['backend', join(BACKEND, 'src')],
  ]) {
    let entries;
    try {
      entries = readdirSync(srcDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(srcDir, entry);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory() && DISALLOWED_ALT_FOLDERS.has(entry)) {
        addViolation(
          '1.9',
          `Disallowed reusable-code folder "${label}/src/${entry}". ` +
            `Reusable components/hooks/utilities must live in their designated folders ` +
            `(components/, hooks/, utils/).`
        );
      }
    }
  }

  // 2b. Reusable hooks (use*.ts/tsx) must live only under frontend/src/hooks.
  // 2c. Reusable UI components (*.tsx) must live only under frontend/src/components
  //     or frontend/src/app (route/page components).
  for (const file of collectFiles(feSrc)) {
    const name = basename(file);
    const ext = extname(file);
    const nameNoExt = name.slice(0, name.length - ext.length);

    const isHookFile =
      (ext === '.ts' || ext === '.tsx') &&
      /^use[A-Z0-9]/.test(nameNoExt) &&
      !nameNoExt.endsWith('.types') &&
      !nameNoExt.endsWith('.constant');

    if (isHookFile && !pathIsInside(file, feHooks)) {
      addViolation(
        '1.9',
        `Reusable hook "${relative(REPO_ROOT, file)}" is outside the designated ` +
          `Hooks Folder (frontend/src/hooks).`
      );
      continue;
    }

    if (ext === '.tsx' && !isHookFile) {
      const inComponents = pathIsInside(file, feComponents);
      const inApp = pathIsInside(file, feApp);
      const isNextSpecial = inApp && NEXT_APP_SPECIAL_FILES.has(name);
      if (!inComponents && !(inApp && isNextSpecial)) {
        addViolation(
          '1.9',
          `Reusable UI component "${relative(REPO_ROOT, file)}" is outside the designated ` +
            `Common Components Folder (frontend/src/components). ` +
            `Only Next.js route files are allowed under frontend/src/app.`
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Check 3 — Roles are exactly role_common / role_admin (Req 10.1)
// ---------------------------------------------------------------------------
function checkRoleIdentifiers() {
  const roleRegex = /\brole_[a-z0-9_]+\b/g;
  const scanRoots = [join(FRONTEND, 'src'), join(BACKEND, 'src')];
  /** @type {Map<string, Set<string>>} */
  const offending = new Map();

  for (const root of scanRoots) {
    for (const file of collectFiles(root)) {
      if (!SOURCE_EXTENSIONS.has(extname(file))) continue;
      let content;
      try {
        content = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      const matches = content.match(roleRegex);
      if (!matches) continue;
      for (const m of matches) {
        if (!ALLOWED_ROLES.has(m)) {
          const rel = relative(REPO_ROOT, file);
          if (!offending.has(m)) offending.set(m, new Set());
          offending.get(m).add(rel);
        }
      }
    }
  }

  for (const [role, files] of offending) {
    addViolation(
      '10.1',
      `Unexpected Role identifier "${role}" found in: ${[...files].join(', ')}. ` +
        `The Platform supports exactly two Roles: role_common and role_admin.`
    );
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
function main() {
  console.log('Running structure-lint (repository root: %s)', REPO_ROOT);
  checkTopLevelFolders();
  checkReusableCodePlacement();
  checkRoleIdentifiers();

  if (violations.length > 0) {
    console.error('\n✖ Structure lint FAILED — %d violation(s):\n', violations.length);
    for (const v of violations) console.error('  - ' + v);
    console.error('');
    process.exit(1);
  }

  console.log('✓ Structure lint passed — repository structure is conformant.');
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error('structure-lint encountered an unexpected error:', err);
  process.exit(2);
}
