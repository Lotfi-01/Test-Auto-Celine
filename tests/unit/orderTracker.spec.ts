/**
 * Unit tests for OrderTracker utility
 * Tests order persistence, retrieval, and statistics
 */

import { test, expect } from '@playwright/test';
import { OrderTracker } from '../../utils/orderTracker';

// Tests run in parallel: each test gets its own output dir via testInfo.outputPath().
// This isolates the underlying JSON file per test, preventing cross-test interference
// on a shared file (root cause of intermittent failures observed previously).

test.describe('OrderTracker Unit Tests', () => {
  let tracker: OrderTracker;

  test.beforeEach(async ({}, testInfo) => {
    // Per-test file path — isolated by Playwright's outputPath mechanism.
    tracker = new OrderTracker(testInfo.outputPath('orders-test.json'));
    await tracker.clear();
  });

  test('save() should persist order to file', async () => {
    await tracker.save('TEST-001', {
      testName: 'Unit Test',
      status: 'success',
      metadata: { email: 'test@example.com' },
    });

    const orders = await tracker.getAll();
    expect(orders).toHaveLength(1);
    expect(orders[0].orderNumber).toBe('TEST-001');
    expect(orders[0].testName).toBe('Unit Test');
    expect(orders[0].status).toBe('success');
  });

  test('save() should append to existing orders', async () => {
    await tracker.save('TEST-001', { testName: 'Test 1' });
    await tracker.save('TEST-002', { testName: 'Test 2' });
    await tracker.save('TEST-003', { testName: 'Test 3' });

    const orders = await tracker.getAll();
    expect(orders).toHaveLength(3);
  });

  test('getByTestName() should filter by test name', async () => {
    await tracker.save('FR-001', { testName: 'France Test' });
    await tracker.save('US-001', { testName: 'USA Test' });
    await tracker.save('FR-002', { testName: 'France Test' });

    const franceOrders = await tracker.getByTestName('France Test');
    expect(franceOrders).toHaveLength(2);
    expect(franceOrders.every((o) => o.testName === 'France Test')).toBe(true);
  });

  test('getByStatus() should filter by status', async () => {
    await tracker.save('SUCCESS-1', { testName: 'Test', status: 'success' });
    await tracker.save('SUCCESS-2', { testName: 'Test', status: 'success' });
    await tracker.save('FAILED-1', { testName: 'Test', status: 'failed' });

    const successOrders = await tracker.getByStatus('success');
    const failedOrders = await tracker.getByStatus('failed');

    expect(successOrders).toHaveLength(2);
    expect(failedOrders).toHaveLength(1);
  });

  test('getLatest() should return most recent order', async () => {
    await tracker.save('OLD-001', { testName: 'Old Test' });
    // Small delay to ensure different timestamps
    await new Promise((r) => setTimeout(r, 10));
    await tracker.save('NEW-001', { testName: 'New Test' });

    const latest = await tracker.getLatest();
    expect(latest?.orderNumber).toBe('NEW-001');
  });

  test('findByOrderNumber() should find order by partial match', async () => {
    await tracker.save('FRD0081234-01', { testName: 'France Order' });
    await tracker.save('USD0087654-01', { testName: 'USA Order' });

    const found = await tracker.findByOrderNumber('FRD008');
    expect(found?.orderNumber).toBe('FRD0081234-01');
  });

  test('clear() should remove all orders', async () => {
    await tracker.save('TEST-001', { testName: 'Test 1' });
    await tracker.save('TEST-002', { testName: 'Test 2' });

    await tracker.clear();

    const orders = await tracker.getAll();
    expect(orders).toHaveLength(0);
  });

  test('getStats() should return correct statistics', async () => {
    await tracker.save('SUCCESS-1', { testName: 'Test', status: 'success' });
    await tracker.save('SUCCESS-2', { testName: 'Test', status: 'success' });
    await tracker.save('FAILED-1', { testName: 'Test', status: 'failed' });
    await tracker.save('PARTIAL-1', { testName: 'Test', status: 'partial' });

    const stats = await tracker.getStats();

    expect(stats.total).toBe(4);
    expect(stats.success).toBe(2);
    expect(stats.failed).toBe(1);
    expect(stats.partial).toBe(1);
    expect(stats.oldestDate).not.toBeNull();
    expect(stats.newestDate).not.toBeNull();
  });

  test('getByDateRange() should filter by date', async () => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    await tracker.save('TODAY-001', { testName: 'Today Test' });

    const todayOrders = await tracker.getByDateRange(yesterday, tomorrow);
    expect(todayOrders).toHaveLength(1);

    // Test with past date range (should be empty)
    const pastStart = new Date('2020-01-01');
    const pastEnd = new Date('2020-01-02');
    const pastOrders = await tracker.getByDateRange(pastStart, pastEnd);
    expect(pastOrders).toHaveLength(0);
  });

  test('save() should handle metadata correctly', async () => {
    await tracker.save('META-001', {
      testName: 'Metadata Test',
      displayedOrderNumber: 'DISPLAY-001',
      metadata: {
        email: 'user@test.com',
        total: '1299.00',
        items: 3,
        browser: 'Chromium',
        duration: 85000,
      },
    });

    const orders = await tracker.getAll();
    expect(orders[0].metadata?.email).toBe('user@test.com');
    expect(orders[0].metadata?.duration).toBe(85000);
    expect(orders[0].displayedOrderNumber).toBe('DISPLAY-001');
  });

  test('should handle sequential saves correctly', async () => {
    // Sequential saves should always work
    for (let i = 0; i < 5; i++) {
      await tracker.save(`SEQUENTIAL-${i}`, { testName: `Sequential Test ${i}` });
    }

    const orders = await tracker.getAll();
    expect(orders.length).toBe(5);
  });

  test('concurrent saves preserve all entries under file lock', async () => {
    // Re-enabled after TRACKER-CONCURRENCY-HARDENING: every save() now runs
    // under a cross-process file lock (utils/fileLock.ts), so in-process
    // Promise.all races no longer interleave the read-modify-write cycles.
    const savePromises = [];
    for (let i = 0; i < 5; i++) {
      savePromises.push(tracker.save(`CONCURRENT-${i}`, { testName: `Concurrent Test ${i}` }));
    }

    await Promise.all(savePromises);

    const orders = await tracker.getAll();
    expect(orders.length).toBe(5);

    const numbers = orders.map((o) => o.orderNumber).sort();
    expect(numbers).toEqual(['CONCURRENT-0', 'CONCURRENT-1', 'CONCURRENT-2', 'CONCURRENT-3', 'CONCURRENT-4']);
  });

  test('getAll() should return empty array for new tracker', async ({}, testInfo) => {
    const freshTracker = new OrderTracker(testInfo.outputPath('orders-empty-test.json'));

    const orders = await freshTracker.getAll();
    expect(orders).toEqual([]);
  });
});
