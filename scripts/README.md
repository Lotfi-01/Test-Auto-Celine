# Script de Lancement de Commandes E2E

Ce script permet de lancer un nombre spécifique de commandes de test pour différentes locales.

## Usage

```bash
# Lancer 2 commandes US et 3 commandes FR
npm run test:orders -- --us=2 --fr=3

# Lancer uniquement des commandes US
npm run test:orders -- --us=5

# Lancer des commandes pour toutes les locales
npm run test:orders -- --us=1 --fr=1 --it=1
```

## Locales Supportées

| Locale | Code | Exemple                         |
| ------ | ---- | ------------------------------- |
| US     | --us | `npm run test:orders -- --us=2` |
| FR     | --fr | `npm run test:orders -- --fr=3` |
| IT     | --it | `npm run test:orders -- --it=1` |

## Configuration

Le script utilise des configurations prédéfinies pour chaque locale :

### US (États-Unis)

- Locale: `en-us`
- Produit: Micro Sailor
- Ville: New York
- Code postal: 10001
- Téléphone: 6464233453

### FR (France)

- Locale: `fr-fr`
- Produit: Trio Flap
- Ville: Paris
- Code postal: 75001
- Téléphone: 0612345678

### IT (Italie)

- Locale: `it-it`
- Produit: Micro Sailor
- Ville: Milano
- Code postal: 20121
- Téléphone: 0212345678

## Fonctionnement

1. Le script parse les arguments de ligne de commande
2. Pour chaque locale spécifiée, il exécute N tests séquentiellement
3. Chaque test utilise les variables d'environnement pour configurer :
   - L'URL du produit
   - Les données d'adresse (ville, code postal, téléphone)
   - Le pays
4. À la fin, un rapport affiche le nombre de commandes réussies/échouées

> **Note — exécution sérialisée requise.** Ce script s'appuie volontairement sur
> une exécution séquentielle (un run Playwright à la fois, par locale). Les
> écritures dans `test-data/orders.json` (`utils/orderTracker.ts`) et
> `test-data/test-results.json` (`utils/testResultTracker.ts`) ne sont pas
> protégées contre la concurrence inter-workers : `OrderTracker` sérialise
> uniquement à l'intérieur d'un même process Node, et `TestResultTracker` n'a
> pas de write queue du tout. Tant que ces trackers ne sont pas durcis, ne pas
> paralléliser ce script (par exemple en lançant plusieurs instances de
> `npm run test:orders` simultanément). Voir `QUALITY_BASELINE.md` §11 pour la
> décision opérationnelle (TRACKER-CONCURRENCY-HARDENING reporté).

## Résultats

- Les commandes réussies sont sauvegardées dans `test-data/orders.json`
- Un email de rapport est envoyé automatiquement (si `SEND_EMAIL_REPORT=true`)
- Les screenshots et vidéos d'échec sont dans `test-results/`

## Ajouter une Nouvelle Locale

Éditez `scripts/run-orders.js` et ajoutez une nouvelle entrée dans `LOCALE_CONFIG` :

```javascript
es: {
  locale: 'es-es',
  productUrl: '/es-es/celine-tienda-mujer/mini-bolsos/...',
  address: {
    city: 'Madrid',
    postalCode: '28001',
    phone: '912345678',
    country: 'ES'
  }
}
```

## Exemples d'Utilisation

### Scénario 1: Test de charge

```bash
# Lancer 10 commandes US pour tester la charge
npm run test:orders -- --us=10
```

### Scénario 2: Test multi-locale

```bash
# Tester 2 commandes par locale
npm run test:orders -- --us=2 --fr=2 --it=2
```

### Scénario 3: Test de régression

```bash
# Une commande de chaque pour vérification rapide
npm run test:orders -- --us=1 --fr=1
```
