# Celine Playwright POM

Tests E2E Playwright pour le checkout Celine, multi-régions : **FR, US, JP, AU, TH, NL**.
Architecture : Page Object Model + fixtures + helpers regroupés sous `pages/`,
`fixtures/`, `utils/`.

## Prérequis

- Node.js **>= 22** (vérifié sur 22 LTS et 24)
- npm **>= 10**
- Accès au sandbox Celine (`BASE_URL` + Basic Auth)

## Installation

Depuis un checkout propre :

```bash
npm ci
npx playwright install --with-deps chromium   # Linux / CI
# ou : npx playwright install chromium         # Windows / macOS
```

`npm ci` s'appuie sur `package-lock.json` (versionné depuis Sprint 1 —
installation reproductible bit-à-bit). Ne pas relancer `npm install` en local
si vous voulez rester aligné sur le lockfile.

Pour régénérer le lockfile après un changement de dépendance :

```bash
npm install --package-lock-only
```

## Variables d'environnement

Copier `.env.example` vers `.env` et remplir depuis votre secret store
(Vault, 1Password, GitHub Actions secrets) :

```bash
cp .env.example .env
```

### Politique de secrets

- **Aucun credential n'est hardcodé dans le repo.** Tous les fallbacks
  sandbox ont été supprimés au Sprint 1.
- Les tests unitaires, `lint`, `typecheck` et `format:check` **fonctionnent
  sans aucun secret** — les env vars E2E ne sont validées qu'au runtime
  d'un test régional (via `assertE2EEnv()` dans `fixtures/celineFixtures.ts`).
- Un test E2E lancé sans les vars requises échoue immédiatement avec le
  nom de la variable manquante.
- Les cartes de test acceptées sont uniquement les PAN documentés par
  **Adyen** et **Cybersource** en environnement sandbox. Aucune vraie carte,
  aucun PAN de production.

### Politique PII

Par défaut, les rapports (`orders.json`, `test-results.json`, email HTML,
artefacts CI) stockent seulement les emails **masqués** (`lo***@***.com`) et
un **hash court** pour la corrélation cross-systèmes.

Pour inclure l'email brut (runners dédiés et à accès restreint uniquement) :

```env
INCLUDE_PII_IN_REPORT=true
```

## Commandes

| Commande | Usage |
|---|---|
| `npm ci` | Installation reproductible depuis `package-lock.json` |
| `npm run typecheck` | Vérification TypeScript stricte |
| `npm run lint` | ESLint (durci Sprint 1 — voir `docs/DEBT.md`) |
| `npm run format:check` | Prettier lecture seule |
| `npm run test:unit` | Tests unitaires — pas de navigateur, pas de secret |
| `npm run test:e2e` | Flow purchase E2E sur tous les projets régionaux |
| `npm run test:e2e:headed` | E2E navigateur visible, 1 worker |
| `npm run test:e2e:debug` | E2E via Playwright Inspector |
| `npm run validate` | typecheck + lint + format + unit + audit |

### Cibler une région ou un mode

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
  celine-purchase.spec.ts   # Flow E2E complet (6 régions × 2 modes)
  unit/                     # OrderTracker, EmailReporter, fileLock, formHelper, etc.
docs/
  DEBT.md                   # Dette technique et backlog Sprint 2+
```

## CI

Le workflow `.github/workflows/playwright.yml` (Sprint 1) sépare deux jobs :

### `quality-gate` — obligatoire, sans secret

Sur chaque push / PR :

```bash
npm ci
npm run lint
npm run typecheck
npm run format:check
npm run test:unit
npm audit --audit-level=moderate   # informatif
```

Ce job **doit** passer sur les PRs externes (pas de secret requis).

### `e2e` — conditionné

Ne tourne que :

- sur `push` vers `main` ou `develop`,
- ou sur `workflow_dispatch` manuel,
- avec l'environnement GitHub protégé `e2e` qui provisionne les secrets.

Les PRs depuis un fork (qui ne peuvent pas lire les secrets) sautent
volontairement ce job pour éviter les faux échecs.

Un guard step vérifie que `HTTP_AUTH_USER` et `BASE_URL` sont bien
provisionnés avant de lancer Playwright.

### Rapports & artifacts

En CI :

- Reporter `blob` par shard (mergeable),
- Reporter `html` navigable,
- Annotations GitHub via reporter `github`.

Artefacts uploadés :

| Nom | Contenu |
|---|---|
| `blob-report-<shard>` | Rapport blob par shard (7 jours) |
| `playwright-report-<shard>` | HTML report par shard (30 jours) |
| `test-results-<shard>` | Traces / screenshots (14 jours, si échec) |
| `playwright-report-merged` | HTML mergé multi-shards (30 jours) |

Chemins Playwright par défaut : `blob-report/`, `playwright-report/`,
`test-results/`. Override possible via `PW_OUTPUT_DIR`.

## Politique d'exécution E2E

`fullyParallel: true`. `workers: 4` en CI, illimité en local. La
persistence dans `test-data/orders.json` et `test-data/test-results.json`
est **protégée par un verrou fichier cross-process** (`utils/fileLock.ts`)
avec :

- Acquisition atomique via `fs.openSync(lockPath, 'wx')`.
- Cleanup des locks stale (> 30s) pour éviter le blocage sur crash worker.
- Écriture atomique tempfile + rename pour se prémunir des corruptions
  JSON en cas de kill process.
- Couverture par tests unitaires (`tests/unit/fileLock.spec.ts`,
  `tests/unit/orderTracker.spec.ts`, `tests/unit/testResultTracker.spec.ts`).

Il n'est donc **pas nécessaire** de forcer `--workers=1` pour les runs E2E.
La documentation antérieure « serial only » a été retirée au Sprint 1.

## Limitations connues (Sprint 2+)

Voir `docs/DEBT.md` pour le backlog complet. Résumé :

- ~180 blocs `.catch(() => {})` silencieux dans les POM checkout historiques.
- 34 `waitForTimeout` en dur à remplacer par des attentes web-first.
- Mégatest unique de 500 lignes à splitter en 4-5 specs ciblés.
- Aucun `storageState` — chaque test refait le login.
- `CheckoutShippingPage.ts` (1523 l.) et `CheckoutPaymentPage.ts` (851 l.)
  à découper en services.
- Historique Git contient encore le commit initial avec
  `.claude/settings.local.json` et `%TEMP%install-qwen.bat` — purge via
  `git filter-repo` planifiée (validation humaine requise).

## Sécurité — voir aussi

- `docs/DEBT.md` — dette technique et purge historique planifiée.
- `SECURITY_NOTES.md` — analyse des dépendances vulnérables (npm audit).
- `CODE_REVIEW.md` — revue complète pré-Sprint 1.
