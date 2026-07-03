/**
 * Unit tests for `assertE2EEnv()` — the runtime guard that keeps unit tests
 * env-free while making E2E fail loud when a required var is missing.
 *
 * These tests intentionally mutate `process.env` and reset the internal
 * memoization flag via the exported test-only helper.
 */

import { test, expect } from '@playwright/test';
import { assertE2EEnv, __resetE2EEnvAssertionForTests } from '../../config/testConfig';

const REQUIRED = ['HTTP_AUTH_USER', 'HTTP_AUTH_PASSWORD', 'BASE_URL'] as const;

function snapshotAndClearEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of REQUIRED) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>): void {
  for (const key of REQUIRED) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
}

test.describe('assertE2EEnv', () => {
  test.beforeEach(() => {
    __resetE2EEnvAssertionForTests();
  });

  test('throws when HTTP_AUTH_USER / HTTP_AUTH_PASSWORD / BASE_URL are missing', () => {
    const saved = snapshotAndClearEnv();
    try {
      expect(() => assertE2EEnv()).toThrow(/HTTP_AUTH_USER/);
    } finally {
      restoreEnv(saved);
      __resetE2EEnvAssertionForTests();
    }
  });

  test('throws with all missing variables named in the error message', () => {
    const saved = snapshotAndClearEnv();
    try {
      let err: Error | undefined;
      try {
        assertE2EEnv();
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeDefined();
      expect(err!.message).toContain('HTTP_AUTH_USER');
      expect(err!.message).toContain('HTTP_AUTH_PASSWORD');
      expect(err!.message).toContain('BASE_URL');
      // The message must tell the operator how to fix it.
      expect(err!.message).toMatch(/\.env\.example|CI|secret store/i);
    } finally {
      restoreEnv(saved);
      __resetE2EEnvAssertionForTests();
    }
  });

  test('treats empty / whitespace-only values as missing', () => {
    const saved = snapshotAndClearEnv();
    try {
      process.env.HTTP_AUTH_USER = '';
      process.env.HTTP_AUTH_PASSWORD = '   ';
      process.env.BASE_URL = 'https://sandbox.example';
      expect(() => assertE2EEnv()).toThrow(/HTTP_AUTH_USER|HTTP_AUTH_PASSWORD/);
    } finally {
      restoreEnv(saved);
      __resetE2EEnvAssertionForTests();
    }
  });

  test('is a no-op when every required var is populated', () => {
    const saved = snapshotAndClearEnv();
    try {
      process.env.HTTP_AUTH_USER = 'operator';
      process.env.HTTP_AUTH_PASSWORD = 's3cret';
      process.env.BASE_URL = 'https://sandbox.example';
      expect(() => assertE2EEnv()).not.toThrow();
    } finally {
      restoreEnv(saved);
      __resetE2EEnvAssertionForTests();
    }
  });

  test('memoizes so repeated calls do not re-scan the env', () => {
    const saved = snapshotAndClearEnv();
    try {
      process.env.HTTP_AUTH_USER = 'operator';
      process.env.HTTP_AUTH_PASSWORD = 's3cret';
      process.env.BASE_URL = 'https://sandbox.example';

      assertE2EEnv(); // first call succeeds and memoizes

      // Wipe the env; without memoization, this would now throw.
      delete process.env.HTTP_AUTH_USER;
      expect(() => assertE2EEnv()).not.toThrow();
    } finally {
      restoreEnv(saved);
      __resetE2EEnvAssertionForTests();
    }
  });
});
