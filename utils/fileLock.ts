/**
 * Cross-process advisory file lock (no external dependency).
 *
 * Acquires an exclusive lock by creating an empty lock file via
 * `fs.openSync(lockPath, 'wx')`. The 'wx' flag fails atomically if the file
 * already exists, which is the OS-level primitive for cross-process mutual
 * exclusion on Windows, macOS, and Linux.
 *
 * Stale locks (older than `staleAfterMs`) are removed before retrying so a
 * crashed worker does not block subsequent acquirers indefinitely.
 *
 * Provided in two variants because the existing trackers have different APIs:
 *   - withFileLock(...)     async — used by OrderTracker (Promise-based API).
 *   - withFileLockSync(...) sync  — used by TestResultTracker (sync API,
 *                                   preserved for callers in
 *                                   global-teardown.ts, emailReporter.ts and
 *                                   tests/celine-purchase.spec.ts).
 *
 * The sync variant blocks the event loop while waiting via Atomics.wait, which
 * is acceptable here because lock contention windows are short (~ a few ms per
 * JSON read-modify-write).
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FileLockOptions {
  /** Total time to wait for lock acquisition before throwing. Default: 5000 ms. */
  timeoutMs?: number;
  /** Sleep between acquisition retries. Default: 50 ms. */
  retryDelayMs?: number;
  /** A lock file older than this (mtime) is considered stale and removed. Default: 30000 ms. */
  staleAfterMs?: number;
}

const DEFAULTS: Required<FileLockOptions> = {
  timeoutMs: 5_000,
  retryDelayMs: 50,
  staleAfterMs: 30_000,
};

function ensureParentDir(lockPath: string): void {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
}

function tryRemoveStaleLock(lockPath: string, staleAfterMs: number): void {
  try {
    const st = fs.statSync(lockPath);
    if (Date.now() - st.mtimeMs > staleAfterMs) {
      try {
        fs.unlinkSync(lockPath);
      } catch {
        // Lost the cleanup race with another acquirer — fine.
      }
    }
  } catch {
    // Lock file vanished between contention and stat — fine.
  }
}

function tryAcquire(lockPath: string): number | undefined {
  try {
    return fs.openSync(lockPath, 'wx');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'EEXIST') return undefined;
    throw err;
  }
}

function release(lockPath: string, fd: number | undefined): void {
  if (fd !== undefined) {
    try {
      fs.closeSync(fd);
    } catch {
      /* ignore */
    }
  }
  try {
    fs.unlinkSync(lockPath);
  } catch {
    /* ignore (already removed by stale cleanup or another release) */
  }
}

// Reused for every sleepSync call to avoid allocating a SharedArrayBuffer per wait.
const sharedSleepBuffer = new Int32Array(new SharedArrayBuffer(4));

function sleepSync(ms: number): void {
  Atomics.wait(sharedSleepBuffer, 0, 0, ms);
}

function sleepAsync(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T> | T,
  options: FileLockOptions = {}
): Promise<T> {
  const opts = { ...DEFAULTS, ...options };
  ensureParentDir(lockPath);

  const start = Date.now();
  let fd: number | undefined;

  for (;;) {
    fd = tryAcquire(lockPath);
    if (fd !== undefined) break;

    tryRemoveStaleLock(lockPath, opts.staleAfterMs);

    if (Date.now() - start >= opts.timeoutMs) {
      throw new Error(`Failed to acquire file lock within ${opts.timeoutMs}ms: ${lockPath}`);
    }
    await sleepAsync(opts.retryDelayMs);
  }

  try {
    return await fn();
  } finally {
    release(lockPath, fd);
  }
}

export function withFileLockSync<T>(lockPath: string, fn: () => T, options: FileLockOptions = {}): T {
  const opts = { ...DEFAULTS, ...options };
  ensureParentDir(lockPath);

  const start = Date.now();
  let fd: number | undefined;

  for (;;) {
    fd = tryAcquire(lockPath);
    if (fd !== undefined) break;

    tryRemoveStaleLock(lockPath, opts.staleAfterMs);

    if (Date.now() - start >= opts.timeoutMs) {
      throw new Error(`Failed to acquire file lock within ${opts.timeoutMs}ms: ${lockPath}`);
    }
    sleepSync(opts.retryDelayMs);
  }

  try {
    return fn();
  } finally {
    release(lockPath, fd);
  }
}
