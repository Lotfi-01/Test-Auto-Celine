# Celine Playwright POM

Tests E2E Playwright pour le checkout Celine, multi-régions (FR, US, JP, AU, TH).
Architecture : Page Object Model + fixtures + helpers regroupés sous `pages/`, `fixtures/`, `utils/`.

## Prérequis

- Node.js >= 22
- npm >= 10
- Accès au sandbox Celine (`BASE_URL` + identifiants HTTP Basic)

## Installation

```bash
npm ci
```

Puis installer le navigateur Chromium pour Playwright. La commande dépend
de l'OS :

```bash
# Windows / macOS — pas de paquets système à installer
npx playwright install chromium

# Linux / CI — installe aussi les dépendances système (libs X11, fonts, etc.)
npx playwright install --with-deps chromium
```

`npm ci` installe exactement les versions du `package-lock.json`.
`npx playwright install` télécharge le binaire Chromium (~150 MB) la
première fois ; il est mis en cache hors du dossier projet
(`~/.cache/ms-playwright/` sur Linux/macOS, `%LOCALAPPDATA%\ms-playwright\` sur Windows).

## Variables d'environnement

Copier `.env.example` vers `.env` et remplir :

```bash
cp .env.example .env
```

Variables requises (cf. `.env.example` pour la liste complète) :

- `BASE_URL` — URL du sandbox Celine
- `HTTP_AUTH_USER`, `HTTP_AUTH_PASSWORD` — identifiants Basic Auth du sandbox
- `BASE_URL_<REGION>` — overrides régionaux optionnels (`FR`, `US`, `JP`, `AU`, `TH`)
- `TEST_EMAIL_<REGION>` — email de test par région
- `TEST_DELIVERY_MODE_<REGION>` — `pickup` pour Click & Collect, sinon `home`
- `TEST_PRODUCT_URL_<REGION>` — override produit, virgule pour multi-produits
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` — facultatif, pour le rapport email
- `REPORT_EMAIL_TO`, `REPORT_EMAIL_CC` — destinataires du rapport
- `SEND_EMAIL_REPORT=true` — activer l'envoi en `globalTeardown`

**Aucune vraie donnée client ne doit être committée dans `.env.example`.**

## Commandes

| Commande | Usage |
|---|---|
| `npm run typecheck` | Vérification TypeScript stricte sans build |
| `npm run lint` | ESLint sur tout le projet (config flat `eslint.config.js`) |
| `npm run format:check` | Prettier en mode lecture seule (scope limité, voir note ci-dessous) |
| `npm run test:unit` | Tests unitaires (`tests/unit/*.spec.ts`) — rapide, pas de navigateur |
| `npm run test:e2e` | Lance le flow purchase E2E sur tous les projets régionaux |
| `npm run test:e2e:headed` | E2E en navigateur visible, 1 worker (debug visuel) |
| `npm run test:e2e:debug` | E2E en mode Playwright Inspector |

### Note scope `lint` / `format:check`

- `npm run lint` couvre tout le projet et passe (0 errors, ~18 warnings unused-vars
  non-bloquants dans le code historique). Quelques règles strictes sont volontairement
  désactivées dans `eslint.config.js` pour éviter de régresser sur l'existant
  (`@typescript-eslint/no-explicit-any`, `preserve-caught-error`, etc.).
- `npm run format:check` couvre uniquement les fichiers de tooling créés avec
  ce socle (`package.json`, `eslint.config.js`, `.prettierrc`). Le code source
  et la documentation existants sont listés dans `.prettierignore` car ils n'ont
  jamais été passés à Prettier — un reformatage global est volontairement reporté
  à un lot dédié.

### Cibler une région ou un mode

Les scripts `test:e2e*` acceptent les flags Playwright en argument :

```bash
npm run test:e2e -- --project=celine-fr
npm run test:e2e:headed -- --project=celine-jp
TEST_DELIVERY_MODE_FR=pickup npm run test:e2e -- --project=celine-fr
```

## Structure

```
config/         # testConfig, testData (par région), regionConfig
fixtures/       # Playwright test extensions (page objects auto-injectés)
pages/          # Page Object Model (BasePage + pages métiers)
  checkout/     # Login, Shipping, Payment
utils/          # safeClick/safeFill, retry, logger, AdyenHelper, CybersourceHelper
tests/
  celine-purchase.spec.ts   # Flow E2E complet (5 régions × 2 modes)
  unit/                     # OrderTracker, EmailReporter (logique pure)
```

## CI

`fullyParallel: true` est activé. `retries: 2` en CI (`process.env.CI`).
Le `globalTeardown` envoie un rapport email si `SEND_EMAIL_REPORT=true`.

## Politique d'exécution E2E (serial only)

Les fichiers d'état partagés `test-data/orders.json` (via `utils/orderTracker.ts`)
et `test-data/test-results.json` (via `utils/testResultTracker.ts`) **ne sont pas
durcis pour les écritures concurrentes inter-workers**. Tant que c'est le cas,
les runs E2E qui produisent des commandes ou des résultats de test doivent rester
sérialisés sur **un seul worker Playwright**.

Patterns recommandés :

```bash
# Sûr — utilisé pour les smokes (cf. QUALITY_BASELINE.md §6, §6b, §6c) :
SEND_EMAIL_REPORT=false npm run test:e2e:headed -- --project=celine-fr

# Sûr — single worker headless (à passer explicitement) :
SEND_EMAIL_REPORT=false npm run test:e2e -- --project=celine-fr --workers=1
```

| Commande                        | Workers              | Sérialisation garantie par                                       |
| ------------------------------- | -------------------- | ---------------------------------------------------------------- |
| `npm run test:e2e:headed`       | 1                    | `--headed --workers=1` codé en dur dans `package.json`           |
| `npm run test:e2e:debug`        | 1                    | `--debug` force un worker unique                                 |
| `npm run test:orders -- --xx=N` | 1 (séquentiel)       | `scripts/run-orders.js` (cf. `scripts/README.md`)                |
| `npm run test:e2e`              | indéfini (tous CPUs) | **NON garantie** — passer `--workers=1` pour rester compatible   |

`npm run test:e2e` sans `--workers=1` ne doit être utilisé que si vous
**ne dépendez pas** de l'état JSON (`orders.json` / `test-results.json`).
Voir QUALITY_BASELINE.md §11 pour la décision opérationnelle complète.

## Limitations connues

- Le projet n'est pas versionné Git (choix volontaire, local).
- `OrderTracker` ne protège pas contre les écritures concurrentes inter-workers
  (cf. test `concurrent saves` en `.skip`). `TestResultTracker` n'a pas non plus
  de write queue. Conséquence : les runs E2E doivent rester sérialisés (cf.
  section "Politique d'exécution E2E (serial only)" ci-dessus et
  QUALITY_BASELINE.md §11). Le durcissement (TRACKER-CONCURRENCY-HARDENING) est
  reporté tant que les runs multi-projets parallèles ne deviennent pas un besoin.
- `package.json` et `package-lock.json` sont générés à partir des versions
  installées localement, pas d'un manifest historique.
