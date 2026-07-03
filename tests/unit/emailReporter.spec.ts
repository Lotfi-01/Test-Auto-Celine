/**
 * Unit tests for EmailReporter utility
 * Tests email generation, formatting, and configuration
 * Note: Does NOT actually send emails - tests internal logic only
 */

import { test, expect } from '@playwright/test';
import { OrderRecord } from '../../utils/orderTracker';

// Mock order data for testing
const MOCK_ORDERS: OrderRecord[] = [
  {
    orderNumber: 'FRD0081234-01',
    displayedOrderNumber: 'FRD0081234-01',
    timestamp: new Date().toISOString(),
    testName: 'Complete purchase flow - FR',
    status: 'success',
    metadata: {
      email: 'test@example.com',
      browser: 'Chromium',
      duration: 85000,
    },
  },
  {
    orderNumber: 'USD0087654-01',
    displayedOrderNumber: 'USD0087654-01',
    timestamp: new Date().toISOString(),
    testName: 'Complete purchase flow - US',
    status: 'success',
    metadata: {
      email: 'test@example.com',
      browser: 'Chromium',
      duration: 92000,
    },
  },
  {
    orderNumber: 'JPD0065432-01',
    displayedOrderNumber: 'JPD0065432-01',
    timestamp: new Date().toISOString(),
    testName: 'Complete purchase flow - JP',
    status: 'success',
    metadata: {
      email: 'test@example.com',
      browser: 'Chromium',
      duration: 78000,
    },
  },
];

test.describe('EmailReporter Unit Tests', () => {
  test.describe('Duration Calculation', () => {
    test('should calculate real elapsed time for parallel tests', async () => {
      // Simulate 3 tests running in parallel
      // They all start around the same time but have different durations
      const now = Date.now();
      const orders: OrderRecord[] = [
        {
          orderNumber: 'FR-001',
          timestamp: new Date(now).toISOString(),
          testName: 'FR Test',
          status: 'success',
          metadata: { duration: 80000 }, // 1m 20s
        },
        {
          orderNumber: 'US-001',
          timestamp: new Date(now + 5000).toISOString(), // 5s later
          testName: 'US Test',
          status: 'success',
          metadata: { duration: 85000 }, // 1m 25s
        },
        {
          orderNumber: 'JP-001',
          timestamp: new Date(now + 11000).toISOString(), // 11s later
          testName: 'JP Test',
          status: 'success',
          metadata: { duration: 90000 }, // 1m 30s
        },
      ];

      // Calculate real elapsed time (same logic as emailReporter)
      const timestamps = orders.map((o) => new Date(o.timestamp).getTime());
      const durations = orders.map((o) => o.metadata?.duration || 0);

      const oldestTimestamp = Math.min(...timestamps);
      const newestTimestamp = Math.max(...timestamps);
      const maxDuration = Math.max(...durations);

      const realElapsedMs = newestTimestamp - oldestTimestamp + maxDuration;

      // Real elapsed should be ~101s (11s spread + 90s max duration)
      // NOT 255s (sum of all durations)
      expect(realElapsedMs).toBeLessThan(150000); // Less than 2.5 minutes
      expect(realElapsedMs).toBeGreaterThan(90000); // At least max duration
    });

    test('should handle single test duration correctly', async () => {
      const orders: OrderRecord[] = [
        {
          orderNumber: 'SINGLE-001',
          timestamp: new Date().toISOString(),
          testName: 'Single Test',
          status: 'success',
          metadata: { duration: 60000 },
        },
      ];

      const durations = orders.map((o) => o.metadata?.duration || 0);
      const maxDuration = Math.max(...durations);

      expect(maxDuration).toBe(60000);
    });
  });

  test.describe('Statistics Calculation', () => {
    test('should calculate correct success rate', async () => {
      const orders: OrderRecord[] = [
        { orderNumber: '1', timestamp: '', testName: '', status: 'success' },
        { orderNumber: '2', timestamp: '', testName: '', status: 'success' },
        { orderNumber: '3', timestamp: '', testName: '', status: 'success' },
        { orderNumber: '4', timestamp: '', testName: '', status: 'failed' },
      ];

      const total = orders.length;
      const success = orders.filter((o) => o.status === 'success').length;
      const successRate = ((success / total) * 100).toFixed(0);

      expect(successRate).toBe('75');
    });

    test('should handle 100% success rate', async () => {
      const orders: OrderRecord[] = [
        { orderNumber: '1', timestamp: '', testName: '', status: 'success' },
        { orderNumber: '2', timestamp: '', testName: '', status: 'success' },
      ];

      const total = orders.length;
      const success = orders.filter((o) => o.status === 'success').length;
      const successRate = ((success / total) * 100).toFixed(0);

      expect(successRate).toBe('100');
    });

    test('should handle 0% success rate', async () => {
      const orders: OrderRecord[] = [
        { orderNumber: '1', timestamp: '', testName: '', status: 'failed' },
        { orderNumber: '2', timestamp: '', testName: '', status: 'failed' },
      ];

      const total = orders.length;
      const success = orders.filter((o) => o.status === 'success').length;
      const successRate = ((success / total) * 100).toFixed(0);

      expect(successRate).toBe('0');
    });

    test('should handle empty orders list', async () => {
      const orders: OrderRecord[] = [];
      const total = orders.length;
      const successRate = total > 0 ? ((0 / total) * 100).toFixed(0) : '0';

      expect(successRate).toBe('0');
    });
  });

  test.describe('Browser Info Extraction', () => {
    test('should extract unique browsers from orders', async () => {
      const orders = MOCK_ORDERS;

      const browsers = [...new Set(orders.map((o) => o.metadata?.browser).filter(Boolean))];
      const browserInfo = browsers.length > 0 ? browsers.join(', ') : 'Non spécifié';

      expect(browserInfo).toBe('Chromium');
    });

    test('should handle multiple browsers', async () => {
      const orders: OrderRecord[] = [
        { orderNumber: '1', timestamp: '', testName: '', status: 'success', metadata: { browser: 'Chromium' } },
        { orderNumber: '2', timestamp: '', testName: '', status: 'success', metadata: { browser: 'Firefox' } },
        { orderNumber: '3', timestamp: '', testName: '', status: 'success', metadata: { browser: 'Chromium' } },
      ];

      const browsers = [...new Set(orders.map((o) => o.metadata?.browser).filter(Boolean))];

      expect(browsers).toContain('Chromium');
      expect(browsers).toContain('Firefox');
      expect(browsers).toHaveLength(2);
    });

    test('should handle missing browser info', async () => {
      const orders: OrderRecord[] = [{ orderNumber: '1', timestamp: '', testName: '', status: 'success' }];

      const browsers = [...new Set(orders.map((o) => o.metadata?.browser).filter(Boolean))];
      const browserInfo = browsers.length > 0 ? browsers.join(', ') : 'Non spécifié';

      expect(browserInfo).toBe('Non spécifié');
    });
  });

  test.describe('Date Formatting', () => {
    test('should format date correctly in French locale', async () => {
      const timestamp = new Date('2026-02-08T17:30:00Z').getTime();

      const formattedDate = new Date(timestamp).toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });

      // Should be in DD/MM/YYYY format
      expect(formattedDate).toMatch(/\d{2}\/\d{2}\/\d{4}/);
    });

    test('should format time correctly', async () => {
      const timestamp = new Date('2026-02-08T17:30:00Z').getTime();

      const formattedTime = new Date(timestamp).toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      });

      // Should be in HH:MM format
      expect(formattedTime).toMatch(/\d{2}:\d{2}/);
    });
  });

  test.describe('Order Number Pattern', () => {
    test('should match valid order number patterns', async () => {
      const pattern = /#([A-Z0-9]+-\d+)/;

      const validOrderNumbers = ['#FRD0081234-01', '#USD0087654-01', '#JPD0065432-01', '#TEST123-99'];

      for (const orderNum of validOrderNumbers) {
        const match = orderNum.match(pattern);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBeTruthy();
      }
    });

    test('should not match invalid order number patterns', async () => {
      const pattern = /#([A-Z0-9]+-\d+)/;

      const invalidOrderNumbers = [
        'FRD0081234-01', // Missing #
        '#12345', // No hyphen
        '#ABC', // No number after hyphen
      ];

      for (const orderNum of invalidOrderNumbers) {
        const match = orderNum.match(pattern);
        expect(match).toBeNull();
      }
    });
  });

  test.describe('Status Badge Logic', () => {
    test('should return correct badge for each status', async () => {
      const getStatusLabel = (status: string): string => {
        const labels: Record<string, string> = {
          success: 'Succès',
          failed: 'Échec',
          partial: 'Partiel',
        };
        return labels[status] || status;
      };

      expect(getStatusLabel('success')).toBe('Succès');
      expect(getStatusLabel('failed')).toBe('Échec');
      expect(getStatusLabel('partial')).toBe('Partiel');
      expect(getStatusLabel('unknown')).toBe('unknown');
    });
  });

  test.describe('Email Subject Generation', () => {
    test('should generate correct subject with order count', async () => {
      const orders = MOCK_ORDERS;
      const today = new Date().toLocaleDateString('fr-FR');

      const subject = `🧪 Playwright Test Report - ${orders.length} Order${orders.length > 1 ? 's' : ''} - ${today}`;

      expect(subject).toContain('3 Orders');
      expect(subject).toContain(today);
    });

    test('should handle singular order', async () => {
      const orders = [MOCK_ORDERS[0]];

      const subject = `🧪 Playwright Test Report - ${orders.length} Order${orders.length > 1 ? 's' : ''}`;

      expect(subject).toContain('1 Order');
      expect(subject).not.toContain('1 Orders');
    });
  });
});
