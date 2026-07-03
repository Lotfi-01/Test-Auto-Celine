/**
 * Unit tests for utils/testResultTracker.ts
 *
 * Coverage:
 *   - record() persists a result and getAll() returns it
 *   - record() appends across multiple calls (sync API)
 *   - clear() empties the file
 *   - getStats() reflects today's records
 *   - cross-process: 3 child Node processes calling record() concurrently
 *     preserve all entries, with no .lock or .tmp.* leftovers
 *
 * Each test gets its own JSON file via testInfo.outputPath() so the real
 * `test-data/test-results.json` is never touched.
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { TestResultTracker } from '../../utils/testResultTracker';

test.describe('TestResultTracker Unit Tests', () => {
  let tracker: TestResultTracker;

  test.beforeEach(({}, testInfo) => {
    tracker = new TestResultTracker(testInfo.outputPath('test-results.json'));
    tracker.clear();
  });

  test('record() persists a single result', () => {
    tracker.record({ region: 'fr', testName: 'A', status: 'success', timestamp: Date.now() });
    const all = tracker.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].region).toBe('fr');
    expect(all[0].status).toBe('success');
  });

  test('record() appends across multiple calls', () => {
    tracker.record({ region: 'fr', testName: 'A', status: 'success', timestamp: Date.now() });
    tracker.record({ region: 'us', testName: 'B', status: 'failed', timestamp: Date.now() });
    tracker.record({ region: 'jp', testName: 'C', status: 'success', timestamp: Date.now() });
    const all = tracker.getAll();
    expect(all).toHaveLength(3);
    expect(all.map((r) => r.region)).toEqual(['fr', 'us', 'jp']);
  });

  test('clear() empties the file', () => {
    tracker.record({ region: 'fr', testName: 'A', status: 'success', timestamp: Date.now() });
    tracker.record({ region: 'us', testName: 'B', status: 'failed', timestamp: Date.now() });
    tracker.clear();
    expect(tracker.getAll()).toEqual([]);
  });

  test('getStats() returns today counters', () => {
    const now = Date.now();
    tracker.record({ region: 'fr', testName: 'A', status: 'success', timestamp: now });
    tracker.record({ region: 'us', testName: 'B', status: 'success', timestamp: now });
    tracker.record({ region: 'jp', testName: 'C', status: 'failed', timestamp: now });
    const stats = tracker.getStats();
    expect(stats.total).toBe(3);
    expect(stats.success).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.successRate).toBe('67');
  });

  test('cross-process concurrent record() preserves all entries', ({}, testInfo) => {
    const dataPath = testInfo.outputPath('cross-proc-results.json');
    const lockPath = `${dataPath}.lock`;
    fs.writeFileSync(dataPath, '[]', 'utf-8');

    const CHILDREN = 3;
    const PER_CHILD = 5;

    // Inline sync-lock + record-equivalent. Semantically equivalent to
    // utils/testResultTracker.ts.record() under withFileLockSync.
    const childScript = `
      const fs = require('fs');
      const dataPath = process.argv[1];
      const lockPath = dataPath + '.lock';
      const childId = process.argv[2];
      const count = parseInt(process.argv[3], 10);
      const sleepBuf = new Int32Array(new SharedArrayBuffer(4));
      function sleepMs(ms) { Atomics.wait(sleepBuf, 0, 0, ms); }
      function tryRemoveStale(p, age) {
        try {
          const st = fs.statSync(p);
          if (Date.now() - st.mtimeMs > age) { try { fs.unlinkSync(p); } catch (e) {} }
        } catch (e) {}
      }
      function withLock(fn) {
        const start = Date.now();
        let fd;
        for (;;) {
          try { fd = fs.openSync(lockPath, 'wx'); break; }
          catch (e) {
            if (e.code !== 'EEXIST') throw e;
            tryRemoveStale(lockPath, 30000);
            if (Date.now() - start >= 5000) throw new Error('lock timeout');
            sleepMs(20);
          }
        }
        try { return fn(); }
        finally {
          try { fs.closeSync(fd); } catch (e) {}
          try { fs.unlinkSync(lockPath); } catch (e) {}
        }
      }
      for (let i = 0; i < count; i++) {
        withLock(() => {
          let arr = [];
          try { arr = JSON.parse(fs.readFileSync(dataPath, 'utf-8')); } catch (e) {}
          arr.push({ region: 'child-' + childId, testName: 'T' + i, status: 'success', timestamp: Date.now() });
          const tmp = dataPath + '.tmp.' + process.pid + '.' + i;
          fs.writeFileSync(tmp, JSON.stringify(arr));
          fs.renameSync(tmp, dataPath);
        });
      }
    `;

    const childPromises: Promise<number>[] = [];
    for (let c = 0; c < CHILDREN; c++) {
      childPromises.push(
        new Promise<number>((resolve, reject) => {
          const child = spawn(process.execPath, ['-e', childScript, dataPath, String(c), String(PER_CHILD)], {
            stdio: 'pipe',
          });
          child.on('exit', (code) => {
            if (code === 0) resolve(code);
            else reject(new Error(`child ${c} exited with code ${code}`));
          });
        })
      );
    }

    return Promise.all(childPromises).then(() => {
      const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
      expect(data.length).toBe(CHILDREN * PER_CHILD);

      // Each (child, testName) tuple appears exactly once.
      const seen = new Set<string>();
      for (const entry of data) {
        const key = `${entry.region}:${entry.testName}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }

      // No leftover .lock or .tmp.* in the test output dir.
      expect(fs.existsSync(lockPath)).toBe(false);
      const dir = path.dirname(dataPath);
      const leftovers = fs.readdirSync(dir).filter((f) => /\.tmp\./.test(f) || f.endsWith('.lock'));
      expect(leftovers).toEqual([]);
    });
  });
});
