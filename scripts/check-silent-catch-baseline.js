#!/usr/bin/env node
/* eslint-disable no-console */

/**
 * Sprint 1 guard-rail — freeze the count of silent `.catch(() => {})`
 * occurrences and fail CI when the count grows.
 *
 * Why:
 *  - ESLint runs `no-restricted-syntax` on the silent-catch selector, but the
 *    historical debt (see `eslint.config.js:HISTORICAL_SILENT_CATCH_FILES`) is
 *    downgraded from `error` to `warn` to keep CI green.
 *  - Warnings do not fail the build. Without an extra check, a PR could ADD a
 *    silent catch to a historical file and pass.
 *  - This script counts occurrences per file and compares against a frozen
 *    baseline. Any file over its baseline fails CI. Any file NOT in the
 *    baseline that has NEW occurrences also fails. Files below their baseline
 *    are welcome — they surface the debt paydown.
 *
 * Usage:
 *    node scripts/check-silent-catch-baseline.js           # check mode (CI)
 *    node scripts/check-silent-catch-baseline.js --update  # refresh baseline
 *
 * Baseline location: `scripts/silent-catch.baseline.json`.
 * Regenerate ONLY when intentionally reducing the debt.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const BASELINE_PATH = path.join(__dirname, 'silent-catch.baseline.json');

// Match `.catch(() => {})` or `.catch(async () => {})` with an empty body.
// Deliberately narrow: only catches on a promise chain, not full try/catch blocks.
const SILENT_CATCH_RX = /\.catch\(\s*(?:async\s*)?\(\s*\)\s*=>\s*\{\s*\}\s*\)/g;

const SCAN_ROOTS = ['pages', 'utils', 'tests', 'config', 'fixtures', 'scripts'];
const IGNORE_DIRS = new Set(['node_modules', 'test-results', 'playwright-report', 'blob-report', 'dist', 'build']);

function relPosix(p) {
  return path.relative(REPO_ROOT, p).split(path.sep).join('/');
}

// This script embeds the pattern literally in its comments/regex — exclude it
// to avoid self-matching (would produce spurious hits every run).
const IGNORE_FILES = new Set([relPosix(__filename)]);

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile() && /\.(ts|js|mjs|cjs)$/.test(entry.name)) {
      out.push(full);
    }
  }
}

function collectFiles() {
  const out = [];
  for (const rootName of SCAN_ROOTS) {
    const root = path.join(REPO_ROOT, rootName);
    if (fs.existsSync(root)) walk(root, out);
  }
  return out.filter((f) => !IGNORE_FILES.has(relPosix(f)));
}

function countInFile(filePath) {
  const src = fs.readFileSync(filePath, 'utf8');
  const matches = src.match(SILENT_CATCH_RX);
  return matches ? matches.length : 0;
}

function buildCurrent() {
  const current = {};
  for (const file of collectFiles()) {
    const count = countInFile(file);
    if (count > 0) current[relPosix(file)] = count;
  }
  return current;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_PATH)) return { counts: {}, total: 0 };
  return JSON.parse(fs.readFileSync(BASELINE_PATH, 'utf8'));
}

function writeBaseline(counts) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const doc = {
    _description:
      'Frozen count of silent `.catch(() => {})` occurrences. See scripts/check-silent-catch-baseline.js. ' +
      'Only regenerate when intentionally reducing the debt.',
    generatedAt: new Date().toISOString(),
    total,
    counts,
  };
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  return total;
}

function main() {
  const update = process.argv.includes('--update');
  const current = buildCurrent();

  if (update) {
    const total = writeBaseline(current);
    console.log(`Baseline updated: ${total} silent catches across ${Object.keys(current).length} files.`);
    return 0;
  }

  const baseline = loadBaseline();
  const baselineCounts = baseline.counts || {};
  const errors = [];

  for (const [file, count] of Object.entries(current)) {
    const allowed = baselineCounts[file] ?? 0;
    if (count > allowed) {
      errors.push(
        `${file}: ${count} silent catches (baseline allows ${allowed}). ` +
          'Fix the new occurrence or refactor to log the error explicitly.'
      );
    }
  }

  const currentTotal = Object.values(current).reduce((a, b) => a + b, 0);
  const baselineTotal = baseline.total ?? 0;

  console.log(`silent-catch baseline check: current=${currentTotal}, baseline=${baselineTotal}`);
  if (errors.length > 0) {
    console.error('\nSilent-catch baseline VIOLATION:');
    for (const err of errors) console.error('  - ' + err);
    console.error(
      '\nIf the increase is truly justified, regenerate the baseline via:\n' +
        '  node scripts/check-silent-catch-baseline.js --update\n' +
        'and describe the reason in the accompanying PR.'
    );
    return 1;
  }

  console.log('OK — no new silent catches introduced.');
  return 0;
}

process.exit(main());
