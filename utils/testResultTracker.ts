/**
 * Test Result Tracker
 * Tracks test results by region for email reporting
 *
 * Concurrency: every read-modify-write (record / clear) runs under a
 * cross-process advisory file lock at `${filePath}.lock` so concurrent
 * Playwright workers cannot lose entries through interleaved reads. The lock
 * is acquired synchronously to preserve the existing sync API surface (sync
 * callers in global-teardown.ts, utils/emailReporter.ts and
 * tests/celine-purchase.spec.ts). See utils/fileLock.ts.
 */

import * as fs from 'fs';
import * as path from 'path';
import { withFileLockSync } from './fileLock';

export interface TestResult {
  region: string;
  testName: string;
  status: 'success' | 'failed';
  timestamp: number;
  error?: string;
}

export class TestResultTracker {
  private filePath: string;
  private lockFile: string;

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), 'test-data', 'test-results.json');
    this.lockFile = `${this.filePath}.lock`;
    this.ensureDataDir();
  }

  private ensureDataDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  private readResults(): TestResult[] {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(data);
      }
    } catch (error) {
      console.warn('⚠️  Failed to read test results:', (error as Error).message);
    }
    return [];
  }

  private writeResults(results: TestResult[]): void {
    // Atomic write: write to a unique temp file then rename. Prevents partial-write corruption
    // if the process is killed mid-write (which would leave a malformed JSON unparseable on next read).
    const tempFile = `${this.filePath}.tmp.${process.pid}.${Date.now()}`;
    try {
      fs.writeFileSync(tempFile, JSON.stringify(results, null, 2), 'utf-8');
      fs.renameSync(tempFile, this.filePath);
    } catch (error) {
      // Best-effort cleanup of temp file on failure
      try {
        if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
      } catch {
        /* ignore */
      }
      console.error('❌ Failed to write test results:', (error as Error).message);
    }
  }

  /**
   * Record a test result
   *
   * Read-modify-write is wrapped in a cross-process file lock so concurrent
   * Playwright workers cannot interleave and last-writer-wins on
   * `test-data/test-results.json`. See utils/fileLock.ts.
   */
  record(result: TestResult): void {
    withFileLockSync(this.lockFile, () => {
      const results = this.readResults();
      results.push(result);
      this.writeResults(results);
    });
  }

  /**
   * Get all results
   */
  getAll(): TestResult[] {
    return this.readResults();
  }

  /**
   * Get results from today
   */
  getToday(): TestResult[] {
    const results = this.readResults();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTimestamp = today.getTime();

    return results.filter((r) => r.timestamp >= todayTimestamp);
  }

  /**
   * Get failed test results
   */
  getFailed(): TestResult[] {
    return this.readResults().filter((r) => r.status === 'failed');
  }

  /**
   * Get failed test results from today
   */
  getFailedToday(): TestResult[] {
    return this.getToday().filter((r) => r.status === 'failed');
  }

  /**
   * Clear all results
   */
  clear(): void {
    withFileLockSync(this.lockFile, () => {
      this.writeResults([]);
    });
    console.log('🗑️  Test results cleared');
  }

  /**
   * Get summary statistics
   */
  getStats() {
    const results = this.getToday();
    const total = results.length;
    const success = results.filter((r) => r.status === 'success').length;
    const failed = results.filter((r) => r.status === 'failed').length;

    return {
      total,
      success,
      failed,
      successRate: total > 0 ? ((success / total) * 100).toFixed(0) : '0',
    };
  }
}

export const testResultTracker = new TestResultTracker();
