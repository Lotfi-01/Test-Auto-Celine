/**
 * Script de test du système de nettoyage des orders
 * Usage: node scripts/test-cleanup.js
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config();

console.log('\n🧪 Test du système de nettoyage des orders\n');
console.log('='.repeat(60));

// Afficher la configuration actuelle
console.log('\n📋 Configuration actuelle:');
console.log(`   SEND_EMAIL_REPORT: ${process.env.SEND_EMAIL_REPORT || '(non défini)'}`);
console.log(`   CLEAR_ORDERS_AFTER_EMAIL: ${process.env.CLEAR_ORDERS_AFTER_EMAIL || '(non défini - garder tous)'}`);

// Lire le fichier orders.json
const ordersFile = path.join(__dirname, '../test-data/orders.json');
let orders = [];

try {
  if (fs.existsSync(ordersFile)) {
    const content = fs.readFileSync(ordersFile, 'utf-8');
    orders = JSON.parse(content);
  }
} catch (error) {
  console.log('⚠️  Erreur lecture orders.json:', error.message);
}

// Calculer les statistiques
const stats = {
  total: orders.length,
  success: orders.filter((o) => o.status === 'success').length,
  failed: orders.filter((o) => o.status === 'failed').length,
  partial: orders.filter((o) => o.status === 'partial').length,
};

// Afficher les statistiques actuelles
console.log('\n📊 État actuel de la base de données:');
console.log(`   Total orders: ${stats.total}`);
console.log(`   ✅ Success: ${stats.success}`);
console.log(`   ❌ Failed: ${stats.failed}`);
console.log(`   ⚠️  Partial: ${stats.partial}`);

if (stats.total === 0) {
  console.log('\n✨ Base de données vide - Parfait !');
} else {
  // Trouver les dates
  const dates = orders.map((o) => new Date(o.timestamp));
  const oldest = new Date(Math.min(...dates));
  const newest = new Date(Math.max(...dates));

  console.log(`\n📅 Dates des orders:`);
  console.log(`   Plus ancien: ${oldest.toLocaleString('fr-FR')}`);
  console.log(`   Plus récent: ${newest.toLocaleString('fr-FR')}`);

  console.log(`\n📦 Derniers orders:`);
  orders.slice(-3).forEach((order, idx) => {
    console.log(
      `   ${orders.length - 2 + idx}. ${order.orderNumber} - ${order.status} - ${new Date(order.timestamp).toLocaleString('fr-FR')}`
    );
  });
}

// Instructions
console.log('\n' + '='.repeat(60));
console.log('\n📖 Pour activer le nettoyage automatique:');
console.log('\n1. Ajoutez à votre fichier .env:');
console.log('   SEND_EMAIL_REPORT=true');
console.log('   CLEAR_ORDERS_AFTER_EMAIL=all');
console.log('\n2. Configurez votre SMTP (si pas déjà fait):');
console.log('   SMTP_HOST=smtp.gmail.com');
console.log('   SMTP_PORT=587');
console.log('   SMTP_USER=votre-email@gmail.com');
console.log('   SMTP_PASS=votre-app-password');
console.log('   REPORT_EMAIL_TO=votre-email@test.com');
console.log('\n3. Lancez les tests:');
console.log('   npm test');
console.log('\n4. Vérifiez la console pour voir:');
console.log('   ✅ Email report sent successfully!');
console.log('   🧹 Cleaning up orders after email report...');
console.log('   ✅ All orders cleared from database');
console.log('\n5. Relancez ce script pour vérifier que la DB est vide:');
console.log('   node scripts/test-cleanup.js');

console.log('\n' + '='.repeat(60));
console.log('\n💡 Note: Le nettoyage ne se fait QUE si:');
console.log('   - SEND_EMAIL_REPORT=true');
console.log("   - L'email est envoyé avec succès");
console.log('   - CLEAR_ORDERS_AFTER_EMAIL=all');
console.log("\n   Si l'email échoue, les orders sont CONSERVÉS (sécurité).\n");
