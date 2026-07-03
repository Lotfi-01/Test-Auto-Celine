import nodemailer from 'nodemailer';
import { orderTracker, OrderRecord } from './orderTracker';
import { testResultTracker } from './testResultTracker';
import { maskEmailForLog } from './logger';

/**
 * Escape any value before injecting it into the HTML email body.
 *
 * Sprint 1 policy (see CODE_REVIEW.md §F-S9 / DEBT.md): every dynamic value
 * built from an order record, test result, environment variable or user input
 * MUST pass through this helper before landing in the template. Do NOT wrap
 * constant style strings or internal template scaffolding.
 */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Email Reporter - Sends test reports via email
 * Automatically sends order summaries and statistics after test execution
 */

export interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export interface EmailReportOptions {
  to: string | string[];
  cc?: string | string[];
  subject?: string;
  includeCSV?: boolean;
  onlyToday?: boolean;
}

export class EmailReporter {
  private transporter: nodemailer.Transporter;

  constructor(config: EmailConfig) {
    this.transporter = nodemailer.createTransport(config);
  }

  /**
   * Verify email configuration is working
   * @returns true if config is valid
   */
  async verify(): Promise<boolean> {
    try {
      await this.transporter.verify();
      console.log('✅ Email configuration verified successfully');
      return true;
    } catch (error) {
      console.error('❌ Email configuration error:', (error as Error).message);
      return false;
    }
  }

  /**
   * Generate HTML email body with order summary
   * Elegant CELINE-inspired design
   * @param orders - Array of orders to include
   * @returns HTML string
   */
  private async generateHTMLReport(orders: OrderRecord[]): Promise<string> {
    const stats = await orderTracker.getStats();
    const testStats = testResultTracker.getStats();
    const failedTests = testResultTracker.getFailedToday();

    const successRate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(0) : '0';

    // Calculate real elapsed time (wall-clock time for parallel execution)
    let testDuration = 'N/A';
    if (orders.length > 0) {
      // Get oldest and newest timestamps to calculate real elapsed time
      const timestamps = orders.map((o) => new Date(o.timestamp).getTime());
      const durations = orders.map((o) => Number(o.metadata?.duration) || 0);

      const oldestTimestamp = Math.min(...timestamps);
      const newestTimestamp = Math.max(...timestamps);
      const maxDuration = Math.max(...durations);

      // Real elapsed time = time from first order start to last order end
      // Approximation: (newest timestamp - oldest timestamp) + duration of last test
      // Or simply use the max duration if tests ran in parallel
      const realElapsedMs = orders.length > 1 ? newestTimestamp - oldestTimestamp + maxDuration : maxDuration;

      if (realElapsedMs > 0) {
        const minutes = Math.floor(realElapsedMs / 60000);
        const seconds = Math.floor((realElapsedMs % 60000) / 1000);
        testDuration = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
      }
    }

    // Get browser from orders metadata
    const browsers = [...new Set(orders.map((o) => o.metadata?.browser).filter(Boolean))];
    const browserInfo = browsers.length > 0 ? browsers.join(', ') : 'Non spécifié';

    const formatDate = (timestamp: string | number) => {
      const date = new Date(timestamp);
      return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    };

    const formatTime = (timestamp: string | number) => {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit',
      });
    };

    const getStatusBadge = (status: string) => {
      const styles = {
        success: 'background-color: #E8F5E9; color: #2E7D32; border: 1px solid #A5D6A7;',
        failed: 'background-color: #FFEBEE; color: #C62828; border: 1px solid #EF9A9A;',
        partial: 'background-color: #FFF3E0; color: #E65100; border: 1px solid #FFCC80;',
      };
      const icons = { success: '●', failed: '●', partial: '●' };
      const labels = { success: 'Succès', failed: 'Échec', partial: 'Partiel' };
      const style = styles[status as keyof typeof styles] || styles.partial;
      const icon = icons[status as keyof typeof icons] || '●';
      const label = labels[status as keyof typeof labels] || status;
      // `style`, `icon` are internal constants; `label` is a status literal or
      // an unknown status string — escape defensively.
      return `<span style="display: inline-block; padding: 4px 12px; border-radius: 20px; font-size: 11px; font-weight: 500; letter-spacing: 0.5px; ${style}">${icon} ${escapeHtml(label)}</span>`;
    };

    const orderRows = orders
      .map(
        (order) => `
        <tr>
          <td style="padding: 16px 20px; border-bottom: 1px solid #F0F0F0;">
            <div style="font-family: 'Courier New', monospace; font-size: 14px; font-weight: 600; color: #1A1A1A; letter-spacing: 0.5px;">${escapeHtml(order.orderNumber)}</div>
            <div style="font-size: 11px; color: #888; margin-top: 4px;">${escapeHtml(order.testName)}</div>
          </td>
          <td style="padding: 16px 20px; border-bottom: 1px solid #F0F0F0; text-align: center;">
            ${getStatusBadge(order.status)}
          </td>
          <td style="padding: 16px 20px; border-bottom: 1px solid #F0F0F0; text-align: right;">
            <div style="font-size: 13px; color: #1A1A1A;">${escapeHtml(formatDate(order.timestamp))}</div>
            <div style="font-size: 11px; color: #888; margin-top: 2px;">${escapeHtml(formatTime(order.timestamp))}</div>
          </td>
        </tr>
      `
      )
      .join('');

    // Generate failed regions section
    let failedRegionsSection = '';
    if (failedTests.length > 0) {
      const failedRows = failedTests
        .map(
          (test) => `
        <tr>
          <td style="padding: 12px 20px; border-bottom: 1px solid #F0F0F0;">
            <div style="font-size: 14px; font-weight: 600; color: #C62828;">🌍 ${escapeHtml(test.region)}</div>
            <div style="font-size: 11px; color: #888; margin-top: 4px;">${escapeHtml(test.testName)}</div>
          </td>
          <td style="padding: 12px 20px; border-bottom: 1px solid #F0F0F0; text-align: right;">
            <div style="font-size: 11px; color: #666;">${escapeHtml(new Date(test.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }))}</div>
          </td>
        </tr>
      `
        )
        .join('');

      failedRegionsSection = `
        <!-- Failed Tests Section -->
        <tr>
          <td style="padding: 30px 40px 15px 40px; border-top: 1px solid #F0F0F0;">
            <div style="font-size: 12px; font-weight: 500; color: #C62828; text-transform: uppercase; letter-spacing: 1.5px;">⚠️ Échecs (${failedTests.length})</div>
          </td>
        </tr>
        <tr>
          <td style="padding: 0 40px 30px 40px;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border: 1px solid #FFEBEE; border-radius: 2px; background-color: #FFF5F5;">
              <thead>
                <tr style="background-color: #FFEBEE;">
                  <th style="padding: 12px 20px; text-align: left; font-size: 10px; font-weight: 500; color: #C62828; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #FFEBEE;">Région</th>
                  <th style="padding: 12px 20px; text-align: right; font-size: 10px; font-weight: 500; color: #C62828; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #FFEBEE;">Heure</th>
                </tr>
              </thead>
              <tbody>
                ${failedRows}
              </tbody>
            </table>
          </td>
        </tr>
      `;
    }

    // Test execution summary section (only when at least one test was tracked)
    const testExecutionSection =
      testStats.total > 0
        ? `
        <!-- Test Execution Summary -->
        <tr>
          <td style="padding: 0 40px 30px 40px;">
            <div style="font-size: 12px; font-weight: 500; color: #1A1A1A; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px;">Synthèse d'exécution des tests</div>
            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #FAFAFA; border-radius: 2px;">
              <tr>
                <td style="padding: 24px;">
                  <table cellpadding="0" cellspacing="0" border="0" width="100%">
                    <tr>
                      <td align="center" style="width: 25%; padding: 0 10px;">
                        <div style="font-size: 28px; font-weight: 300; color: #1A1A1A;">${testStats.total}</div>
                        <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Total</div>
                      </td>
                      <td align="center" style="width: 25%; padding: 0 10px; border-left: 1px solid #E8E8E8;">
                        <div style="font-size: 28px; font-weight: 300; color: #2E7D32;">${testStats.success}</div>
                        <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Succès</div>
                      </td>
                      <td align="center" style="width: 25%; padding: 0 10px; border-left: 1px solid #E8E8E8;">
                        <div style="font-size: 28px; font-weight: 300; color: #C62828;">${testStats.failed}</div>
                        <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Échecs</div>
                      </td>
                      <td align="center" style="width: 25%; padding: 0 10px; border-left: 1px solid #E8E8E8;">
                        <div style="font-size: 28px; font-weight: 300; color: #1A1A1A;">${testStats.successRate}%</div>
                        <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Taux</div>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      `
        : '';

    const currentDate = new Date().toLocaleDateString('fr-FR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });

    return `
      <!DOCTYPE html>
      <html lang="fr">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>CELINE - Rapport de Tests E2E</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #F5F5F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">

          <!-- Container -->
          <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #F5F5F5;">
            <tr>
              <td align="center" style="padding: 40px 20px;">

                <!-- Email Content -->
                <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #FFFFFF; border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

                  <!-- Header -->
                  <tr>
                    <td style="padding: 40px 40px 30px 40px; border-bottom: 1px solid #F0F0F0;">
                      <table cellpadding="0" cellspacing="0" border="0" width="100%">
                        <tr>
                          <td>
                            <div style="font-size: 24px; font-weight: 300; letter-spacing: 8px; color: #1A1A1A; text-transform: uppercase;">CELINE</div>
                            <div style="font-size: 11px; color: #888; letter-spacing: 2px; text-transform: uppercase; margin-top: 8px;">Quality Assurance</div>
                          </td>
                          <td align="right" style="vertical-align: top;">
                            <div style="font-size: 11px; color: #888; text-transform: capitalize;">${escapeHtml(currentDate)}</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  <!-- Title -->
                  <tr>
                    <td style="padding: 30px 40px 20px 40px;">
                      <h1 style="margin: 0; font-size: 20px; font-weight: 400; color: #1A1A1A; letter-spacing: 0.5px;">Rapport de Tests E2E</h1>
                      <p style="margin: 8px 0 0 0; font-size: 13px; color: #666; line-height: 1.5;">Synthèse des commandes passées lors des tests automatisés</p>
                    </td>
                  </tr>

                  <!-- Statistics -->
                  <tr>
                    <td style="padding: 0 40px 30px 40px;">
                      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #FAFAFA; border-radius: 2px;">
                        <tr>
                          <td style="padding: 24px;">
                            <table cellpadding="0" cellspacing="0" border="0" width="100%">
                              <tr>
                                <td align="center" style="width: 25%; padding: 0 10px;">
                                  <div style="font-size: 28px; font-weight: 300; color: #1A1A1A;">${stats.total}</div>
                                  <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Total</div>
                                </td>
                                <td align="center" style="width: 25%; padding: 0 10px; border-left: 1px solid #E8E8E8;">
                                  <div style="font-size: 28px; font-weight: 300; color: #2E7D32;">${stats.success}</div>
                                  <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Succès</div>
                                </td>
                                <td align="center" style="width: 25%; padding: 0 10px; border-left: 1px solid #E8E8E8;">
                                  <div style="font-size: 28px; font-weight: 300; color: #C62828;">${stats.failed}</div>
                                  <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Échecs</div>
                                </td>
                                <td align="center" style="width: 25%; padding: 0 10px; border-left: 1px solid #E8E8E8;">
                                  <div style="font-size: 28px; font-weight: 300; color: #1A1A1A;">${successRate}%</div>
                                  <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Taux</div>
                                </td>
                              </tr>
                            </table>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                  ${testExecutionSection}

                  ${failedRegionsSection}

                  <!-- Orders Section Title -->
                  <tr>
                    <td style="padding: 0 40px 15px 40px;">
                      <div style="font-size: 12px; font-weight: 500; color: #1A1A1A; text-transform: uppercase; letter-spacing: 1.5px;">✅ Commandes réussies (${orders.length})</div>
                    </td>
                  </tr>

                  <!-- Orders Table -->
                  <tr>
                    <td style="padding: 0 40px 30px 40px;">
                      <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border: 1px solid #F0F0F0; border-radius: 2px;">
                        <thead>
                          <tr style="background-color: #FAFAFA;">
                            <th style="padding: 12px 20px; text-align: left; font-size: 10px; font-weight: 500; color: #888; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #F0F0F0;">N° Commande</th>
                            <th style="padding: 12px 20px; text-align: center; font-size: 10px; font-weight: 500; color: #888; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #F0F0F0;">Statut</th>
                            <th style="padding: 12px 20px; text-align: right; font-size: 10px; font-weight: 500; color: #888; text-transform: uppercase; letter-spacing: 1px; border-bottom: 1px solid #F0F0F0;">Date</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${orderRows || '<tr><td colspan="3" style="padding: 30px; text-align: center; color: #888; font-size: 13px;">Aucune commande</td></tr>'}
                        </tbody>
                      </table>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="padding: 30px 40px; background-color: #FAFAFA; border-top: 1px solid #F0F0F0;">
                      <table cellpadding="0" cellspacing="0" border="0" width="100%">
                        <tr>
                          <td>
                            <div style="font-size: 11px; color: #888; line-height: 1.6;">
                              Rapport généré automatiquement<br>
                              Environnement : <span style="color: #666;">${escapeHtml(process.env.NODE_ENV || 'development')}</span><br>
                              Navigateur : <span style="color: #666;">${escapeHtml(browserInfo)}</span><br>
                              Durée totale : <span style="color: #666;">${escapeHtml(testDuration)}</span>
                            </div>
                          </td>
                          <td align="right" style="vertical-align: bottom;">
                            <div style="font-size: 10px; color: #AAA; letter-spacing: 1px;">PLAYWRIGHT</div>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>

                </table>

                <!-- Email Footer -->
                <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px;">
                  <tr>
                    <td style="padding: 20px 40px; text-align: center;">
                      <div style="font-size: 10px; color: #AAA;">
                        Ce message est généré automatiquement par le système de tests E2E.
                      </div>
                    </td>
                  </tr>
                </table>

              </td>
            </tr>
          </table>

        </body>
      </html>
    `;
  }

  /**
   * Generate plain text version of the report
   * @param orders - Array of orders to include
   * @returns Plain text string
   */
  private async generateTextReport(orders: OrderRecord[]): Promise<string> {
    const stats = await orderTracker.getStats();
    const successRate = stats.total > 0 ? ((stats.success / stats.total) * 100).toFixed(2) : '0';

    let text = '📊 PLAYWRIGHT TEST REPORT - ORDER SUMMARY\n';
    text += '='.repeat(60) + '\n\n';

    text += '📈 STATISTICS:\n';
    text += `   Total Orders: ${stats.total}\n`;
    text += `   ✅ Successful: ${stats.success}\n`;
    text += `   ❌ Failed: ${stats.failed}\n`;
    text += `   ⚠️  Partial: ${stats.partial}\n`;
    text += `   Success Rate: ${successRate}%\n\n`;

    text += `📦 ORDERS LIST (${orders.length}):\n`;
    text += '-'.repeat(60) + '\n';

    orders.forEach((order, index) => {
      text += `\n${index + 1}. Order: ${order.orderNumber}\n`;
      if (order.displayedOrderNumber) {
        text += `   Displayed: ${order.displayedOrderNumber}\n`;
      }
      text += `   Status: ${order.status}\n`;
      text += `   Date: ${new Date(order.timestamp).toLocaleString('fr-FR')}\n`;
      text += `   Test: ${order.testName}\n`;
      // Prefer the masked field (default policy). Fall back to hash for
      // correlation. Full email is only present when INCLUDE_PII_IN_REPORT=true.
      const displayEmail = order.metadata?.emailMasked || order.metadata?.email || order.metadata?.emailHash;
      if (displayEmail) {
        text += `   Email: ${displayEmail}\n`;
      }
      if (order.metadata?.total) {
        text += `   Total: ${order.metadata.total}\n`;
      }
      text += '-'.repeat(60);
    });

    text += `\n\nReport generated at: ${new Date().toLocaleString('fr-FR')}\n`;

    return text;
  }

  /**
   * Send order report via email
   * @param options - Email sending options
   * @returns true if sent successfully
   */
  async sendOrderReport(options: EmailReportOptions): Promise<boolean> {
    try {
      // Get orders to include
      let orders: OrderRecord[];

      if (options.onlyToday) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        orders = await orderTracker.getByDateRange(today, tomorrow);
      } else {
        orders = await orderTracker.getAll();
      }

      if (orders.length === 0) {
        console.log('⚠️  No orders to send in report');
        return false;
      }

      // Prepare email content
      const subject =
        options.subject ||
        `🧪 Playwright Test Report - ${orders.length} Order${orders.length > 1 ? 's' : ''} - ${new Date().toLocaleDateString('fr-FR')}`;

      const htmlContent = await this.generateHTMLReport(orders);
      const textContent = await this.generateTextReport(orders);

      // Prepare attachments
      const attachments: any[] = [];

      if (options.includeCSV) {
        const csvPath = './test-data/orders-report.csv';
        await orderTracker.exportToCSV(csvPath);

        attachments.push({
          filename: `orders-${new Date().toISOString().split('T')[0]}.csv`,
          path: csvPath,
        });
      }

      // Send email
      const info = await this.transporter.sendMail({
        from: `"Playwright Tests 🎭" <${process.env.SMTP_USER}>`,
        to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
        cc: options.cc ? (Array.isArray(options.cc) ? options.cc.join(', ') : options.cc) : undefined,
        subject,
        text: textContent,
        html: htmlContent,
        attachments,
      });

      const maskedTo = Array.isArray(options.to)
        ? options.to.map(maskEmailForLog).join(', ')
        : maskEmailForLog(options.to);
      console.log(`✅ Email report sent successfully to ${maskedTo}`);
      console.log(`   Message ID: ${info.messageId}`);

      return true;
    } catch (error) {
      console.error('❌ Failed to send email report:', (error as Error).message);
      return false;
    }
  }

  /**
   * Send a quick notification email
   * Elegant CELINE-inspired design
   * @param to - Recipient email(s)
   * @param message - Custom message
   * @param orderNumbers - Optional order numbers to include
   */
  async sendQuickNotification(to: string | string[], message: string, orderNumbers?: string[]): Promise<boolean> {
    try {
      const currentDate = new Date().toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });

      let orderSection = '';
      if (orderNumbers && orderNumbers.length > 0) {
        const orderItems = orderNumbers
          .map(
            (num) => `
            <tr>
              <td style="padding: 12px 16px; border-bottom: 1px solid #F0F0F0; font-family: 'Courier New', monospace; font-size: 13px; letter-spacing: 0.5px; color: #1A1A1A;">${escapeHtml(num)}</td>
            </tr>
          `
          )
          .join('');

        orderSection = `
          <tr>
            <td style="padding: 0 40px 30px 40px;">
              <div style="font-size: 11px; font-weight: 500; color: #888; text-transform: uppercase; letter-spacing: 1.5px; margin-bottom: 12px;">Numéros de commande</div>
              <table cellpadding="0" cellspacing="0" border="0" width="100%" style="border: 1px solid #F0F0F0; border-radius: 2px; background-color: #FAFAFA;">
                ${orderItems}
              </table>
            </td>
          </tr>
        `;
      }

      const html = `
        <!DOCTYPE html>
        <html lang="fr">
          <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>CELINE - Notification</title>
          </head>
          <body style="margin: 0; padding: 0; background-color: #F5F5F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">

            <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #F5F5F5;">
              <tr>
                <td align="center" style="padding: 40px 20px;">

                  <table cellpadding="0" cellspacing="0" border="0" width="500" style="max-width: 500px; background-color: #FFFFFF; border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

                    <!-- Header -->
                    <tr>
                      <td style="padding: 35px 40px 25px 40px; border-bottom: 1px solid #F0F0F0;">
                        <div style="font-size: 20px; font-weight: 300; letter-spacing: 6px; color: #1A1A1A; text-transform: uppercase;">CELINE</div>
                        <div style="font-size: 10px; color: #AAA; letter-spacing: 2px; text-transform: uppercase; margin-top: 6px;">Quality Assurance</div>
                      </td>
                    </tr>

                    <!-- Content -->
                    <tr>
                      <td style="padding: 30px 40px 25px 40px;">
                        <h1 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 500; color: #1A1A1A; letter-spacing: 0.3px;">Notification</h1>
                        <p style="margin: 0; font-size: 14px; color: #444; line-height: 1.7;">${escapeHtml(message)}</p>
                      </td>
                    </tr>

                    ${orderSection}

                    <!-- Footer -->
                    <tr>
                      <td style="padding: 25px 40px; background-color: #FAFAFA; border-top: 1px solid #F0F0F0;">
                        <div style="font-size: 11px; color: #AAA;">${escapeHtml(currentDate)}</div>
                      </td>
                    </tr>

                  </table>

                  <table cellpadding="0" cellspacing="0" border="0" width="500" style="max-width: 500px;">
                    <tr>
                      <td style="padding: 15px 40px; text-align: center;">
                        <div style="font-size: 10px; color: #BBB;">Message automatique · Playwright E2E Tests</div>
                      </td>
                    </tr>
                  </table>

                </td>
              </tr>
            </table>

          </body>
        </html>
      `;

      await this.transporter.sendMail({
        from: `"CELINE QA" <${process.env.SMTP_USER}>`,
        to: Array.isArray(to) ? to.join(', ') : to,
        subject: 'CELINE · Notification Test E2E',
        html,
      });

      console.log(`✅ Notification sent to ${to}`);
      return true;
    } catch (error) {
      console.error('❌ Failed to send notification:', (error as Error).message);
      return false;
    }
  }
}

/**
 * Create email reporter from environment variables
 * @returns EmailReporter instance or null if config is missing
 */
export function createEmailReporter(): EmailReporter | null {
  const requiredVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS'];
  const missing = requiredVars.filter((v) => !process.env[v]);

  if (missing.length > 0) {
    console.warn(`⚠️  Email reporter disabled. Missing env vars: ${missing.join(', ')}`);
    return null;
  }

  const config: EmailConfig = {
    host: process.env.SMTP_HOST!,
    port: parseInt(process.env.SMTP_PORT!, 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
      user: process.env.SMTP_USER!,
      pass: process.env.SMTP_PASS!,
    },
  };

  return new EmailReporter(config);
}
