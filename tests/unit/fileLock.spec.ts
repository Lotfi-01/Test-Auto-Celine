/**
 * Unit tests for utils/fileLock.ts
 *
 * Coverage:
 *   - withFileLock acquires + releases (no leftover .lock)
 *   - In-process Promise.all serializes critical sections
 *   - Stale lock is removed and acquisition proceeds
 *   - Timeout throws a clear error
 *   - withFileLockSync semantics
 *   - Cross-process: child Node processes contend on the same lock without losing entries
 */

import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { withFileLock, withFileLockSync } from '../../utils/fileLock';

test.describe('fileLock primitive', () => {
  test('withFileLock releases the lock file after success', async ({}, testInfo) => {
    const lockPath = testInfo.outputPath('plain.lock');
    const result = await withFileLock(lockPath, async () => 42);
    expect(result).toBe(42);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('withFileLock releases the lock file after the callback throws', async ({}, testInfo) => {
    const lockPath = testInfo.outputPath('throws.lock');
    await expect(
      withFileLock(lockPath, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('withFileLock serializes overlapping in-process critical sections', async ({}, testInfo) => {
    const lockPath = testInfo.outputPath('overlap.lock');
    const events: string[] = [];

    async function critical(label: string, holdMs: number) {
      await withFileLock(lockPath, async () => {
        events.push(`${label}:enter`);
        await new Promise((r) => setTimeout(r, holdMs));
        events.push(`${label}:exit`);
      });
    }

    await Promise.all([critical('A', 30), critical('B', 5), critical('C', 5)]);

    // Each enter must be immediately followed by its matching exit (no interleaving).
    for (let i = 0; i < events.length; i += 2) {
      const enter = events[i];
      const exit = events[i + 1];
      expect(enter.endsWith(':enter')).toBe(true);
      expect(exit.endsWith(':exit')).toBe(true);
      expect(enter.split(':')[0]).toBe(exit.split(':')[0]);
    }
    expect(events.length).toBe(6);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('withFileLock removes a stale lock and proceeds', async ({}, testInfo) => {
    const lockPath = testInfo.outputPath('stale.lock');
    // Pre-create a stale lock with old mtime.
    fs.writeFileSync(lockPath, '');
    const oldTime = new Date(Date.now() - 60_000); // 60s in the past
    fs.utimesSync(lockPath, oldTime, oldTime);
    expect(fs.existsSync(lockPath)).toBe(true);

    const result = await withFileLock(lockPath, async () => 'ok', {
      staleAfterMs: 1_000,
      timeoutMs: 2_000,
    });
    expect(result).toBe('ok');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('withFileLock throws a clear error when timeout is exhausted', async ({}, testInfo) => {
    const lockPath = testInfo.outputPath('timeout.lock');
    // Hold a fresh non-stale lock manually.
    const fd = fs.openSync(lockPath, 'wx');
    try {
      await expect(
        withFileLock(lockPath, async () => 'never', {
          timeoutMs: 200,
          retryDelayMs: 20,
          staleAfterMs: 60_000, // ensure not considered stale
        })
      ).rejects.toThrow(/Failed to acquire file lock within 200ms/);
    } finally {
      fs.closeSync(fd);
      fs.unlinkSync(lockPath);
    }
  });

  test('withFileLockSync releases the lock file after success', ({}, testInfo) => {
    const lockPath = testInfo.outputPath('sync-ok.lock');
    const result = withFileLockSync(lockPath, () => 'sync-result');
    expect(result).toBe('sync-result');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('withFileLockSync releases the lock file after the callback throws', ({}, testInfo) => {
    const lockPath = testInfo.outputPath('sync-throws.lock');
    expect(() =>
      withFileLockSync(lockPath, () => {
        throw new Error('sync-boom');
      })
    ).toThrow('sync-boom');
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  test('cross-process contention preserves all writes', ({}, testInfo) => {
    const dataPath = testInfo.outputPath('child-write.json');
    const lockPath = `${dataPath}.lock`;
    fs.writeFileSync(dataPath, '[]', 'utf-8');

    const CHILDREN = 3;
    const PER_CHILD = 5;

    // Child script: minimal sync lock + read-modify-write equivalent to
    // utils/fileLock.ts + utils/testResultTracker.ts. Inlined as a string so
    // child Node processes do not need the TS toolchain.
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
          const arr = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
          arr.push({ child: childId, index: i });
          const tmp = dataPath + '.tmp.' + process.pid + '.' + i;
          fs.writeFileSync(tmp, JSON.stringify(arr));
          fs.renameSync(tmp, dataPath);
        });
      }
    `;

    // Spawn children in parallel. Each runs the inlined sync-lock JS above.
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

      // Every (child, index) pair must appear exactly once.
      const seen = new Set<string>();
      for (const entry of data) {
        const key = `${entry.child}:${entry.index}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }

      // No leftover .lock or .tmp.* files in the test output dir.
      expect(fs.existsSync(lockPath)).toBe(false);
      const dir = path.dirname(dataPath);
      const leftovers = fs.readdirSync(dir).filter((f) => /\.tmp\./.test(f) || f.endsWith('.lock'));
      expect(leftovers).toEqual([]);
    });
  });
});
