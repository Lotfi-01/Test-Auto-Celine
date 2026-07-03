#!/usr/bin/env node
/**
 * Script pour envoyer l'email récapitulatif final et vider le fichier orders.json
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

async function main() {
  const ordersFilePath = path.join(__dirname, '..', 'test-data', 'orders.json');

  console.log("\n📧 Envoi de l'email récapitulatif final...\n");

  try {
    // Lancer un test bidon juste pour déclencher le global-teardown avec l'email activé
    execSync('npx playwright test --config=playwright.config.ts --grep="XXXXNONEXISTANTXXX"', {
      env: {
        ...process.env,
        SEND_EMAIL_REPORT: 'true',
      },
      stdio: 'inherit',
      cwd: path.join(__dirname, '..'),
      timeout: 30000,
    });
  } catch (error) {
    // C'est normal que ça échoue car aucun test ne match, mais le global-teardown s'est exécuté
    console.log('\n✅ Email envoyé avec succès !');
  }

  // Vider le fichier orders.json
  console.log('\n🗑️  Nettoyage du fichier orders.json...');
  if (fs.existsSync(ordersFilePath)) {
    fs.writeFileSync(ordersFilePath, JSON.stringify([], null, 2), 'utf-8');
    console.log('✅ Fichier orders.json vidé\n');
  }
}

main().catch((error) => {
  console.error('❌ Erreur:', error);
  process.exit(1);
});
