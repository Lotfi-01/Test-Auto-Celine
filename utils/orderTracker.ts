import fs from 'fs';
import path from 'path';
import { withFileLock } from './fileLock';

/**
 * Order tracking utility
 * Persists order numbers to JSON file for analysis and debugging
 *
 * Concurrency: every read-modify-write (save / clear / cleanupOld) runs under
 * a cross-process advisory file lock at `${ordersFile}.lock` so concurrent
 * Playwright workers cannot lose entries through interleaved reads. See
 * utils/fileLock.ts for the lock primitive.
 */

export interface OrderRecord {
  orderNumber: string;
  displayedOrderNumber?: string;
  timestamp: string;
  testName: string;
  status: 'success' | 'failed' | 'partial';
  metadata?: {
    email?: string;
    total?: string;
    items?: number;
    [key: string]: any;
  };
}

export class OrderTracker {
  private ordersFile: string;
  private lockFile: string;

  constructor(filePath?: string) {
    this.ordersFile = filePath || path.join(process.cwd(), 'test-data', 'orders.json');
    this.lockFile = `${this.ordersFile}.lock`;
    this.ensureDirectoryExists();
  }

  /**
   * Ensure the test-data directory exists
   */
  private ensureDirectoryExists(): void {
    const dir = path.dirname(this.ordersFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  /**
   * Sleep helper using async timeout
   * Compatible with all environments (no SharedArrayBuffer required)
   */
  private async sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Read all existing orders from file
   * @returns Array of order records
   */
  private async readOrders(): Promise<OrderRecord[]> {
    const maxRetries = 5;
    const retryDelay = 100; // ms

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        if (fs.existsSync(this.ordersFile)) {
          const content = fs.readFileSync(this.ordersFile, 'utf-8');
          return JSON.parse(content);
        }
        return [];
      } catch (error) {
        if (attempt === maxRetries - 1) {
          console.warn('⚠️  Failed to read orders file after retries:', (error as Error).message);
          return [];
        }
        // Wait before retry with exponential backoff
        const waitTime = retryDelay * Math.pow(2, attempt);
        await this.sleep(waitTime);
      }
    }
    return [];
  }

  /**
   * Write orders to file with retry mechanism for concurrent writes
   * @param orders - Array of order records to save
   *
   * Atomic write via temp file + rename. The temp file is unlinked on failure
   * so a partial write does not leave .tmp.* leftovers. Outer cross-process
   * serialization is the caller's responsibility (see callsites under withFileLock).
   */
  private async writeOrders(orders: OrderRecord[]): Promise<void> {
    const maxRetries = 5;
    const retryDelay = 100; // ms

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const tempFile = `${this.ordersFile}.tmp.${process.pid}.${Date.now()}.${Math.random()}`;
      try {
        fs.writeFileSync(tempFile, JSON.stringify(orders, null, 2), 'utf-8');
        fs.renameSync(tempFile, this.ordersFile);
        return; // Success
      } catch (error) {
        try {
          if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
        } catch {
          /* best-effort cleanup */
        }
        if (attempt === maxRetries - 1) {
          console.error('❌ Failed to write orders file after retries:', (error as Error).message);
          return;
        }
        const waitTime = retryDelay * Math.pow(2, attempt);
        await this.sleep(waitTime);
      }
    }
  }

  /**
   * Save a new order record
   * @param orderNumber - Order number from API
   * @param options - Additional order information
   */
  async save(
    orderNumber: string,
    options: {
      displayedOrderNumber?: string;
      testName: string;
      status?: 'success' | 'failed' | 'partial';
      metadata?: OrderRecord['metadata'];
    }
  ): Promise<void> {
    return withFileLock(this.lockFile, async () => {
      const orders = await this.readOrders();

      const newOrder: OrderRecord = {
        orderNumber,
        displayedOrderNumber: options.displayedOrderNumber,
        timestamp: new Date().toISOString(),
        testName: options.testName,
        status: options.status || 'success',
        metadata: options.metadata,
      };

      orders.push(newOrder);
      await this.writeOrders(orders);

      console.log(`💾 Order saved: ${orderNumber} (${this.ordersFile})`);
    });
  }

  /**
   * Get all saved orders
   * @returns Array of all order records
   */
  async getAll(): Promise<OrderRecord[]> {
    return await this.readOrders();
  }

  /**
   * Get orders by test name
   * @param testName - Name of the test to filter by
   * @returns Array of matching order records
   */
  async getByTestName(testName: string): Promise<OrderRecord[]> {
    const orders = await this.readOrders();
    return orders.filter((order) => order.testName === testName);
  }

  /**
   * Get orders by date range
   * @param startDate - Start date (inclusive)
   * @param endDate - End date (inclusive)
   * @returns Array of matching order records
   */
  async getByDateRange(startDate: Date, endDate: Date): Promise<OrderRecord[]> {
    const orders = await this.readOrders();
    return orders.filter((order) => {
      const orderDate = new Date(order.timestamp);
      return orderDate >= startDate && orderDate <= endDate;
    });
  }

  /**
   * Get the most recent order
   * @returns Most recent order record or undefined
   */
  async getLatest(): Promise<OrderRecord | undefined> {
    const orders = await this.readOrders();
    if (orders.length === 0) return undefined;

    return orders.reduce((latest, current) => {
      return new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest;
    });
  }

  /**
   * Get orders with specific status
   * @param status - Status to filter by
   * @returns Array of matching order records
   */
  async getByStatus(status: 'success' | 'failed' | 'partial'): Promise<OrderRecord[]> {
    const orders = await this.readOrders();
    return orders.filter((order) => order.status === status);
  }

  /**
   * Search for a specific order number
   * @param orderNumber - Order number to search for (partial match)
   * @returns Matching order record or undefined
   */
  async findByOrderNumber(orderNumber: string): Promise<OrderRecord | undefined> {
    const orders = await this.readOrders();
    return orders.find(
      (order) => order.orderNumber.includes(orderNumber) || order.displayedOrderNumber?.includes(orderNumber)
    );
  }

  /**
   * Delete all orders
   * Use with caution - this permanently removes all records
   */
  async clear(): Promise<void> {
    await withFileLock(this.lockFile, async () => {
      await this.writeOrders([]);
      console.log('🗑️  All orders cleared');
    });
  }

  /**
   * Delete orders older than specified days
   * @param days - Number of days to keep
   * @returns Number of deleted orders
   */
  async cleanupOld(days: number): Promise<number> {
    return withFileLock(this.lockFile, async () => {
      const orders = await this.readOrders();
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);

      const filteredOrders = orders.filter((order) => {
        return new Date(order.timestamp) >= cutoffDate;
      });

      const deletedCount = orders.length - filteredOrders.length;

      if (deletedCount > 0) {
        await this.writeOrders(filteredOrders);
        console.log(`🗑️  Deleted ${deletedCount} old orders (older than ${days} days)`);
      }

      return deletedCount;
    });
  }

  /**
   * Export orders to CSV format
   * @param outputPath - Path for CSV file
   */
  async exportToCSV(outputPath: string): Promise<void> {
    const orders = await this.readOrders();

    if (orders.length === 0) {
      console.warn('⚠️  No orders to export');
      return;
    }

    // CSV header
    const headers = [
      'Order Number',
      'Displayed Order Number',
      'Timestamp',
      'Test Name',
      'Status',
      'Email',
      'Total',
      'Items',
    ];

    // CSV rows
    const rows = orders.map((order) => [
      order.orderNumber,
      order.displayedOrderNumber || '',
      order.timestamp,
      order.testName,
      order.status,
      order.metadata?.email || '',
      order.metadata?.total || '',
      order.metadata?.items?.toString() || '',
    ]);

    // Combine
    const csv = [headers.join(','), ...rows.map((row) => row.map((cell) => `"${cell}"`).join(','))].join('\n');

    fs.writeFileSync(outputPath, csv, 'utf-8');
    console.log(`📊 Orders exported to: ${outputPath}`);
  }

  /**
   * Get statistics about stored orders
   * @returns Statistics object
   */
  async getStats(): Promise<{
    total: number;
    success: number;
    failed: number;
    partial: number;
    oldestDate: string | null;
    newestDate: string | null;
  }> {
    const orders = await this.readOrders();

    return {
      total: orders.length,
      success: orders.filter((o) => o.status === 'success').length,
      failed: orders.filter((o) => o.status === 'failed').length,
      partial: orders.filter((o) => o.status === 'partial').length,
      oldestDate:
        orders.length > 0
          ? orders.reduce((oldest, curr) => (new Date(curr.timestamp) < new Date(oldest.timestamp) ? curr : oldest))
              .timestamp
          : null,
      newestDate:
        orders.length > 0
          ? orders.reduce((newest, curr) => (new Date(curr.timestamp) > new Date(newest.timestamp) ? curr : newest))
              .timestamp
          : null,
    };
  }

  /**
   * Print statistics to console
   */
  async printStats(): Promise<void> {
    const stats = await this.getStats();

    console.log('\n📊 Order Statistics:');
    console.log(`   Total orders: ${stats.total}`);
    console.log(`   ✅ Success: ${stats.success}`);
    console.log(`   ❌ Failed: ${stats.failed}`);
    console.log(`   ⚠️  Partial: ${stats.partial}`);

    if (stats.oldestDate) {
      console.log(`   📅 Oldest: ${new Date(stats.oldestDate).toLocaleString()}`);
      console.log(`   📅 Newest: ${new Date(stats.newestDate!).toLocaleString()}`);
    }
    console.log('');
  }
}

/**
 * Singleton instance for easy access
 * Usage: import { orderTracker } from '../utils/orderTracker';
 */
export const orderTracker = new OrderTracker();
