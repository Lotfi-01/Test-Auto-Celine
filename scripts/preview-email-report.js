/**
 * Local HTML preview of the email report — fake data only.
 * No SMTP, no sendMail, no verify, no Playwright, no real customer info.
 *
 * Replicates the critical sections of utils/emailReporter.ts#generateHTMLReport
 * (header / order Statistics / "Synthèse d'exécution des tests" / Échecs)
 * for visual validation of the testStats wiring.
 *
 * Usage: npm run preview:email
 * Output: test-results/email-report-preview.html
 */

const fs = require('fs');
const path = require('path');

// --- Fake, non-sensitive data ----------------------------------------------

const orderStats = {
  total: 3,
  success: 2,
  failed: 1,
  successRate: '67',
};

const testStats = {
  total: 28,
  success: 27,
  failed: 1,
  successRate: '96',
};

const failedTests = [
  {
    region: 'JP',
    testName: 'Example failed checkout test',
    timestamp: new Date().toISOString(),
  },
];

const browserInfo = 'Chromium';
const testDuration = '2m 15s';
const currentDate = new Date().toLocaleDateString('fr-FR', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

// --- HTML sections (copy of style from utils/emailReporter.ts) -------------

const failedRows = failedTests
  .map(
    (t) => `
    <tr>
      <td style="padding: 12px 20px; border-bottom: 1px solid #F0F0F0;">
        <div style="font-size: 14px; font-weight: 600; color: #C62828;">🌍 ${t.region}</div>
        <div style="font-size: 11px; color: #888; margin-top: 4px;">${t.testName}</div>
      </td>
      <td style="padding: 12px 20px; border-bottom: 1px solid #F0F0F0; text-align: right;">
        <div style="font-size: 11px; color: #666;">${new Date(t.timestamp).toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit',
        })}</div>
      </td>
    </tr>
  `
  )
  .join('');

const failedRegionsSection =
  failedTests.length > 0
    ? `
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
        <tbody>${failedRows}</tbody>
      </table>
    </td>
  </tr>
`
    : '';

const testExecutionSection =
  testStats.total > 0
    ? `
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

const html = `<!DOCTYPE html>
<html lang="fr">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CELINE - Rapport de Tests E2E (PREVIEW)</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #F5F5F5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
    <div style="background-color: #FFF3CD; color: #856404; padding: 12px 40px; text-align: center; font-size: 12px; border-bottom: 1px solid #FFEEBA;">
      ⚠️ LOCAL PREVIEW — fake data, no email sent. Generated by scripts/preview-email-report.js
    </div>
    <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #F5F5F5;">
      <tr>
        <td align="center" style="padding: 40px 20px;">
          <table cellpadding="0" cellspacing="0" border="0" width="600" style="max-width: 600px; background-color: #FFFFFF; border-radius: 2px; box-shadow: 0 1px 3px rgba(0,0,0,0.08);">

            <tr>
              <td style="padding: 40px 40px 30px 40px; border-bottom: 1px solid #F0F0F0;">
                <table cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td>
                      <div style="font-size: 24px; font-weight: 300; letter-spacing: 8px; color: #1A1A1A; text-transform: uppercase;">CELINE</div>
                      <div style="font-size: 11px; color: #888; letter-spacing: 2px; text-transform: uppercase; margin-top: 8px;">Quality Assurance</div>
                    </td>
                    <td align="right" style="vertical-align: top;">
                      <div style="font-size: 11px; color: #888; text-transform: capitalize;">${currentDate}</div>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>

            <tr>
              <td style="padding: 30px 40px 20px 40px;">
                <h1 style="margin: 0; font-size: 20px; font-weight: 400; color: #1A1A1A; letter-spacing: 0.5px;">Rapport de Tests E2E</h1>
                <p style="margin: 8px 0 0 0; font-size: 13px; color: #666; line-height: 1.5;">Synthèse des commandes passées lors des tests automatisés</p>
              </td>
            </tr>

            <tr>
              <td style="padding: 0 40px 30px 40px;">
                <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color: #FAFAFA; border-radius: 2px;">
                  <tr>
                    <td style="padding: 24px;">
                      <table cellpadding="0" cellspacing="0" border="0" width="100%">
                        <tr>
                          <td align="center" style="width: 25%; padding: 0 10px;">
                            <div style="font-size: 28px; font-weight: 300; color: #1A1A1A;">${orderStats.total}</div>
                            <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Total</div>
                          </td>
                          <td align="center" style="width: 25%; padding: 0 10px; border-left: 1px solid #E8E8E8;">
                            <div style="font-size: 28px; font-weight: 300; color: #2E7D32;">${orderStats.success}</div>
                            <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Succès</div>
                          </td>
                          <td align="center" style="width: 25%; padding: 0 10px; border-left: 1px solid #E8E8E8;">
                            <div style="font-size: 28px; font-weight: 300; color: #C62828;">${orderStats.failed}</div>
                            <div style="font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px;">Échecs</div>
                          </td>
                          <td align="center" style="width: 25%; padding: 0 10px; border-left: 1px solid #E8E8E8;">
                            <div style="font-size: 28px; font-weight: 300; color: #1A1A1A;">${orderStats.successRate}%</div>
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

            <tr>
              <td style="padding: 30px 40px; background-color: #FAFAFA; border-top: 1px solid #F0F0F0;">
                <div style="font-size: 11px; color: #888; line-height: 1.6;">
                  Rapport généré automatiquement (preview locale)<br>
                  Navigateur : <span style="color: #666;">${browserInfo}</span><br>
                  Durée totale : <span style="color: #666;">${testDuration}</span>
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

const outDir = path.join(__dirname, '..', 'test-results');
const outFile = path.join(outDir, 'email-report-preview.html');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}
fs.writeFileSync(outFile, html, 'utf-8');

console.log('Preview HTML written to:', path.relative(process.cwd(), outFile));
console.log('Open it manually in a browser to inspect the testStats section.');
