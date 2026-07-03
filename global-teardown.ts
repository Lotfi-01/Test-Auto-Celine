/**
 * Global Teardown
 * Runs after all tests have completed
 * Sends email report with order summary if enabled
 */

import { FullConfig } from '@playwright/test';
import { createEmailReporter } from './utils/emailReporter';
import { orderTracker } from './utils/orderTracker';
import { testResultTracker } from './utils/testResultTracker';
import { maskEmailForLog } from './utils/logger';
import * as dotenv from 'dotenv';

dotenv.config();

async function globalTeardown(_config: FullConfig) {
  // Hard-skip for unit runs and when reporting disabled (much lighter)
  const argv = process.argv.join(' ');
  const isUnitOnlyRun = /--project[= ]+unit\b/.test(argv);
  const sendEmailReport = process.env.SEND_EMAIL_REPORT === 'true';

  if (isUnitOnlyRun || !sendEmailReport) {
    if (isUnitOnlyRun) console.log('📧 Email reporting skipped (unit test run)');
    else console.log('📧 Email reporting disabled (SEND_EMAIL_REPORT=false)');
    return;
  }

  console.log('\n🏁 Global Teardown - Running cleanup tasks...\n');

  // Get all orders from today
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const todayOrders = await orderTracker.getByDateRange(today, tomorrow);

  if (todayOrders.length === 0) {
    console.log('📧 No orders to report for today. Skipping email.\n');
    return;
  }

  console.log(`📊 Found ${todayOrders.length} order(s) from today's tests`);
  await orderTracker.printStats();

  // Create email reporter
  const emailReporter = createEmailReporter();

  if (!emailReporter) {
    console.log('⚠️  Email reporter not configured. Check SMTP settings in .env\n');
    return;
  }

  // Verify email configuration
  const isValid = await emailReporter.verify();

  if (!isValid) {
    console.log('❌ Email configuration is invalid. Please check your SMTP settings.\n');
    return;
  }

  // Get recipients from environment
  const recipients = process.env.REPORT_EMAIL_TO?.split(',').map((e) => e.trim()) || [];
  const cc =
    process.env.REPORT_EMAIL_CC?.split(',')
      .map((e) => e.trim())
      .filter(Boolean) || [];

  if (recipients.length === 0) {
    console.log('⚠️  No email recipients configured (REPORT_EMAIL_TO). Skipping email.\n');
    return;
  }

  console.log(`📧 Sending email report to: ${recipients.map(maskEmailForLog).join(', ')}`);
  if (cc && cc.length > 0) {
    console.log(`   CC: ${cc.map(maskEmailForLog).join(', ')}`);
  }

  // Send the report
  const success = await emailReporter.sendOrderReport({
    to: recipients,
    cc: cc.length > 0 ? cc : undefined,
    includeCSV: false,
    onlyToday: true,
  });

  if (success) {
    console.log('✅ Email report sent successfully!\n');

    // Clean up orders and test results after successful email send
    console.log('🧹 Cleaning up orders after email report...');

    // Option 1: Clear all orders (fresh start)
    if (process.env.CLEAR_ORDERS_AFTER_EMAIL === 'all') {
      await orderTracker.clear();
      testResultTracker.clear();
      console.log('✅ All orders cleared from database\n');
    }
    // Option 2: Keep last N days of orders
    else if (process.env.CLEAR_ORDERS_AFTER_EMAIL === 'old') {
      const daysToKeep = parseInt(process.env.KEEP_ORDERS_DAYS || '7', 10);
      const deletedCount = await orderTracker.cleanupOld(daysToKeep);
      testResultTracker.clear(); // Clear test results anyway
      console.log(`✅ Cleaned up ${deletedCount} old order(s) (keeping last ${daysToKeep} days)\n`);
    }
    // Option 3: Keep all orders (default - for audit trail)
    else {
      testResultTracker.clear(); // Clear test results anyway
      console.log('ℹ️  Orders kept for audit trail (set CLEAR_ORDERS_AFTER_EMAIL=all or old to enable cleanup)\n');
    }
  } else {
    console.log('❌ Failed to send email report. Check logs above for details.\n');
    console.log('⚠️  Orders NOT cleared due to email failure (data preserved)\n');
  }
}

export default globalTeardown;
