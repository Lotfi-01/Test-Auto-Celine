#!/usr/bin/env node
/**
 * Script pour lancer des tests E2E avec un nombre spécifique de commandes par locale
 *
 * Usage:
 *   node scripts/run-orders.js --us=2 --fr=3
 *   npm run test:orders -- --us=2 --fr=3
 */

const { execSync } = require('child_process');
const path = require('path');

// Configuration des locales disponibles
const LOCALE_CONFIG = {
  us: {
    locale: 'en-us',
    productUrl:
      '/en-us/celine-women/mini-bags/more-lines/micro-sailor-in-triomphe-canvas-and-calfskin-10M742GCE.04LU.html',
    address: {
      city: 'New York',
      postalCode: '10001',
      phone: '6464233453',
      country: 'US',
    },
  },
  fr: {
    locale: 'fr-fr',
    productUrl: '/fr-fr/celine-boutique-femme/mini-sacs/trio-flap/trio-flap-agneau-lisse-10P862O86.28PO.html',
    address: {
      city: 'Paris',
      postalCode: '75001',
      phone: '0612345678',
      country: 'FR',
    },
  },
  it: {
    locale: 'it-it',
    productUrl:
      '/it-it/celine-shop-donna/mini-borse/altro/micro-sailor-in-tela-triomphe-e-pelle-di-vitello-10M742GCE.04LU.html',
    address: {
      city: 'Milano',
      postalCode: '20121',
      phone: '0212345678',
      country: 'IT',
    },
  },
};

// Parser les arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const orders = {};

  args.forEach((arg) => {
    const match = arg.match(/--(\w+)=(\d+)/);
    if (match) {
      const [, locale, count] = match;
      if (LOCALE_CONFIG[locale.toLowerCase()]) {
        orders[locale.toLowerCase()] = parseInt(count, 10);
      } else {
        console.warn(
          `⚠️  Locale "${locale}" non reconnue. Locales disponibles: ${Object.keys(LOCALE_CONFIG).join(', ')}`
        );
      }
    }
  });

  return orders;
}

// Lancer un test
function runTest(locale, index, total) {
  console.log(`\n🚀 Lancement commande ${index}/${total} pour ${locale.toUpperCase()}...`);

  const config = LOCALE_CONFIG[locale];
  const env = {
    ...process.env,
    TEST_LOCALE: config.locale,
    TEST_PRODUCT_URL: config.productUrl,
    TEST_CITY: config.address.city,
    TEST_POSTAL_CODE: config.address.postalCode,
    TEST_PHONE: config.address.phone,
    TEST_COUNTRY: config.address.country,
    SEND_EMAIL_REPORT: 'false', // Désactiver l'email pour chaque test individuel
    HEADLESS: process.env.HEADLESS || 'true', // Mode headless par défaut
    WORKERS: process.env.WORKERS || '2', // 2 workers par défaut
  };

  try {
    execSync('npx playwright test tests/celine-e2e.spec.ts --project=celine', {
      env,
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
    });
    console.log(`✅ Commande ${index}/${total} pour ${locale.toUpperCase()} réussie`);
    return true;
  } catch (error) {
    console.error(`❌ Commande ${index}/${total} pour ${locale.toUpperCase()} échouée`);
    return false;
  }
}

// Main
async function main() {
  const orders = parseArgs();

  if (Object.keys(orders).length === 0) {
    console.log(`
📦 Script de lancement de commandes E2E Celine

Usage:
  node scripts/run-orders.js --us=2 --fr=3 --it=1
  npm run test:orders -- --us=2 --fr=3

Locales disponibles:
  ${Object.keys(LOCALE_CONFIG)
    .map((k) => `--${k}=N`)
    .join('\n  ')}

Exemples:
  --us=2    → Lance 2 commandes sur le site US
  --fr=3    → Lance 3 commandes sur le site FR
  --it=1    → Lance 1 commande sur le site IT
`);
    process.exit(0);
  }

  console.log("\n📊 Plan d'exécution:");
  Object.entries(orders).forEach(([locale, count]) => {
    console.log(`  ${locale.toUpperCase()}: ${count} commande(s)`);
  });

  const totalOrders = Object.values(orders).reduce((sum, count) => sum + count, 0);
  console.log(`\n  TOTAL: ${totalOrders} commande(s)\n`);

  const results = {
    success: 0,
    failed: 0,
  };

  // Lancer les tests pour chaque locale
  for (const [locale, count] of Object.entries(orders)) {
    for (let i = 1; i <= count; i++) {
      const success = runTest(locale, i, count);
      if (success) {
        results.success++;
      } else {
        results.failed++;
      }
    }
  }

  // Résumé
  console.log('\n' + '='.repeat(50));
  console.log('📊 RÉSUMÉ');
  console.log('='.repeat(50));
  console.log(`✅ Réussies: ${results.success}`);
  console.log(`❌ Échouées: ${results.failed}`);
  console.log(`📦 Total: ${results.success + results.failed}`);
  console.log('='.repeat(50) + '\n');

  // Envoyer un email récapitulatif final si des commandes ont réussi
  if (results.success > 0) {
    try {
      execSync('node scripts/send-final-email.js', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..'),
      });
    } catch (error) {
      console.error("⚠️  Erreur lors de l'envoi de l'email final");
    }
  }

  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error('❌ Erreur:', error);
  process.exit(1);
});
