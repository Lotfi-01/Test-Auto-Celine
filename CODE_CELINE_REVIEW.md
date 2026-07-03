# Revue de code Playwright/Celine

## 1. Verdict global

La suite a une base exploitable : le découpage checkout existe, les helpers Adyen/Cybersource sont isolés, et la persistance des résultats a été durcie par verrou fichier. Mais l'état actuel n'est pas suffisamment fiable pour une CI de référence : `npm ci` échoue faute de lockfile, les variables CI sont commentées, et les rapports shardés ne sont pas produits au bon format. Le risque principal côté E2E est une accumulation de contournements (`waitForTimeout`, `force`, `evaluate`, catches silencieux) qui peut transformer un vrai bug produit ou un sélecteur cassé en diagnostic tardif au paiement. La couverture visible est supérieure à la couverture réellement vérifiable : un mégatest paramétré par région/paiement valide peu de postconditions intermédiaires et plusieurs Page Objects retournent `false` sans faire échouer le scénario.

## 2. Points forts

- `config/regionConfig.ts:20-73` centralise les six marchés FR/US/JP/AU/TH/NL et évite de dupliquer les projets Playwright.
- `pages/CelineCheckoutPage.ts:16-27` expose une façade simple vers `login`, `shipping` et `payment`, ce qui est une bonne direction POM.
- `utils/adyenHelper.ts:42-89` et `utils/cybersourceHelper.ts:20-84` isolent l'interaction avec les iframes de paiement, avec des tests unitaires ciblés dans `tests/unit/adyenHelper.spec.ts:61-184` et `tests/unit/cybersourceHelper.spec.ts:68-186`.
- `utils/fileLock.ts:97-150` protège les écritures concurrentes, et les tests `tests/unit/fileLock.spec.ts:114-202` / `tests/unit/testResultTracker.spec.ts:66-153` couvrent la contention inter-processus.
- Plusieurs points fail-fast vont dans le bon sens : échec explicite si les champs Adyen ne sont pas remplis (`pages/checkout/CheckoutPaymentPage.ts:253-259`), si les CGV ne sont pas cochées (`pages/checkout/CheckoutPaymentPage.ts:264-270`) ou si l'étape paiement n'est pas atteinte (`pages/checkout/CheckoutShippingPage.ts:985-987`).
- Les logs masquent les emails dans certains chemins (`utils/logger.ts:164-170`, `tests/celine-purchase.spec.ts:189`), à conserver et généraliser.

## 3. Problèmes par dimension

### 3.1 Robustesse & fiabilité des tests

#### R1 - La suite n'est pas reproductible depuis un checkout propre

**Fichiers/lignes :** `.gitignore:5`, `package.json:10`, `.github/workflows/playwright.yml:29-30`, `.github/workflows/playwright.yml:76-77`.

**Pourquoi :** `package-lock.json` est ignoré et absent du dépôt, alors que `validate` inclut `npm audit` et que la CI exécute `npm ci`. Vérification locale : `npm ci` échoue avec `EUSAGE` et `npm audit --audit-level=moderate` échoue avec `ENOLOCK`.

**Impact :** la CI ne peut pas installer les dépendances, les versions ne sont pas figées, l'audit sécurité documenté n'est pas reproductible.

**Correction proposée :**

```diff
- package-lock.json
```

Puis générer et committer `package-lock.json`, et garder `npm ci` comme unique installation CI.

#### R2 - Les tests/unités peuvent échouer au chargement de config avant d'exécuter quoi que ce soit

**Fichiers/lignes :** `playwright.config.ts:4`, `playwright.config.ts:9-18`, `config/testConfig.ts:62-73`, `.github/workflows/playwright.yml:36-42`.

**Pourquoi :** `playwright.config.ts` importe `createRegionProjects`, qui importe `TEST_CONFIG`, qui valide aussi `TEST_EMAIL`. La CI commente les secrets requis et ne fournit pas `HTTP_AUTH_USER`, `HTTP_AUTH_PASSWORD`, `BASE_URL`, ni `TEST_EMAIL`.

**Impact :** un run `--project=unit` ou une CI de PR peut mourir pendant l'import de config, sans résultat de test ni feedback utile.

**Correction proposée :** rendre la validation conditionnelle aux projets E2E, ou déplacer les projets régionaux derrière une fonction qui ne lit les secrets qu'au moment d'exécuter l'E2E. En CI, injecter explicitement les secrets.

```yaml
env:
  CI: true
  HTTP_AUTH_USER: ${{ secrets.HTTP_AUTH_USER }}
  HTTP_AUTH_PASSWORD: ${{ secrets.HTTP_AUTH_PASSWORD }}
  BASE_URL: ${{ secrets.BASE_URL }}
  TEST_EMAIL: ${{ secrets.TEST_EMAIL }}
```

#### R3 - Attentes fixes nombreuses au lieu d'attentes web-first

**Fichiers/lignes :** `tests/celine-purchase.spec.ts:292`, `tests/celine-purchase.spec.ts:366`, `tests/celine-purchase.spec.ts:392`, `tests/celine-purchase.spec.ts:458`, `pages/checkout/CheckoutPaymentPage.ts:180`, `pages/checkout/CheckoutPaymentPage.ts:212`, `pages/checkout/CheckoutPaymentPage.ts:501`, `pages/checkout/CheckoutShippingPage.ts:654`, `pages/checkout/CheckoutShippingPage.ts:719`.

**Quantification :** 32 occurrences de `waitForTimeout` dans `pages/`, `tests/` et `utils/`.

**Pourquoi :** les sleeps ne synchronisent pas sur l'état réel de la page. Ils sont trop courts quand le sandbox ralentit et trop longs quand tout est prêt.

**Impact :** flakiness + coût minimum cumulé. Sur le chemin standard carte, le spec ajoute déjà environ 2,1 s de sleeps fixes hors Page Objects (`1000 + 300 + 300 + 500` ms), sans compter les boucles paiement/confirmation.

**Correction proposée :** remplacer par des attentes sur le signal métier attendu.

```ts
// Avant
await page.waitForTimeout(1000);

// Après
await expect(page.locator('label.shipping-method-option').first()).toBeVisible({
  timeout: TEST_CONFIG.timeouts.navigation,
});
```

#### R4 - Trop de catches silencieux masquent les vrais échecs

**Fichiers/lignes :** `eslint.config.js:54`, `tests/celine-purchase.spec.ts:436-444`, `pages/CelineProductPage.ts:155-158`, `pages/checkout/CheckoutShippingPage.ts:325-327`, `pages/checkout/CheckoutShippingPage.ts:1521`, `pages/checkout/CheckoutPaymentPage.ts:283-290`.

**Quantification :** 87 catches vides ou `catch(() => {})` dans `pages/`, `tests/`, `utils/`, `config`, `scripts`.

**Tolérance intentionnelle :** `utils/selectorStrategy.ts:192-247` est du best-effort acceptable pour fermer des panneaux optionnels si les erreurs restent non bloquantes et loguées au niveau debug.

**Masquage de bug :** `tests/celine-purchase.spec.ts:436-444` ignore l'échec de navigation post-paiement, puis scanne le body. `pages/checkout/CheckoutPaymentPage.ts:283-290` logue "Cardholder name filled" et "Expiration date filled" même si les `fill()` ont été avalés.

**Impact :** diagnostic tardif, faux positifs partiels, perte de stack trace au moment où le bug est observable.

**Correction proposée :** interdire les catches vides hors helpers explicitement `bestEffort*`, et faire échouer les étapes obligatoires.

```ts
// Avant
await holder.fill(options.cardholderName).catch(() => {});
this.logSuccess('Cardholder name filled (Cybersource)');

// Après
await expect(holder).toBeVisible({ timeout: TIMEOUTS.element });
await holder.fill(options.cardholderName);
await expect(holder).toHaveValue(options.cardholderName);
this.logSuccess('Cardholder name filled (Cybersource)');
```

#### R5 - Les Page Objects retournent souvent des booléens que le spec ignore

**Fichiers/lignes :** `pages/BasePage.ts:100-118`, `pages/checkout/CheckoutShippingPage.ts:318-383`, `tests/celine-purchase.spec.ts:236-249`, `tests/celine-purchase.spec.ts:334-347`.

**Pourquoi :** `fillPickupAddressForm()` et `fillShippingAddress()` renvoient `boolean`, mais le spec ne vérifie pas la valeur. Un champ requis peut échouer, puis le test continue vers paiement.

**Impact :** échec déplacé, traces moins exploitables, risque de faux positif si le site conserve des données précédentes du compte.

**Correction proposée :**

```ts
// Avant
await checkoutPage.shipping.fillShippingAddress({...});
await checkoutPage.shipping.selectCountry(addr.country);

// Après
await expect
  .soft(await checkoutPage.shipping.fillShippingAddress({...}), 'shipping address filled')
  .toBe(true);
expect(await checkoutPage.shipping.selectCountry(addr.country), 'country selected').toBe(true);
```

À moyen terme, préférer des méthodes qui `throw` avec contexte plutôt que des booléens ignorables.

#### R6 - La validation de confirmation de commande est trop permissive

**Fichiers/lignes :** `tests/celine-purchase.spec.ts:436-458`, `tests/celine-purchase.spec.ts:469`.

**Pourquoi :** le prédicat URL accepte toute URL qui ne contient plus `stage=placeOrder` ni `stage=payment`. Ensuite le regex `/#([A-Z0-9]+(?:-\d+)?)/` scanne tout le body, ce qui peut matcher un texte parasite.

**Impact :** risque de faux positif ou d'erreur peu claire si la page revient à un portail externe, panier, login, ou page d'erreur contenant un identifiant ressemblant à une commande.

**Correction proposée :**

```ts
await expect(page).toHaveURL(/Order-Confirm/i, { timeout: 120_000 });
const orderHeading = page.locator('h1, h2, [class*="order"]').filter({ hasText: /#[A-Z0-9]+(?:-\d+)?/ });
await expect(orderHeading.first()).toBeVisible({ timeout: 30_000 });
const text = await orderHeading.first().innerText();
orderNumber = text.match(/#([A-Z0-9]+(?:-\d+)?)/)?.[1];
expect(orderNumber).toBeTruthy();
```

#### R7 - Sélecteurs CSS multi-fallback fragiles et texte localisé corrompu

**Fichiers/lignes :** `pages/selectors.ts:14-20`, `pages/selectors.ts:75-78`, `pages/selectors.ts:91-92`, `tests/celine-purchase.spec.ts:318`, `pages/checkout/CheckoutShippingPage.ts:1073-1078`.

**Pourquoi :** beaucoup de sélecteurs combinent classes CSS, `:has-text`, ids techniques et langues. Plusieurs chaînes sont mojibake (`InvitÃ©`, `CARTE DE CRÃ‰DIT`), donc les fallbacks textuels français ne sont pas fiables.

**Impact :** sélecteurs cassants à chaque changement CSS/DOM, difficulté à savoir quel fallback a été utilisé, diagnostic plus pauvre.

**Correction proposée :** demander des attributs stables côté app (`data-testid` ou `data-qa`) sur checkout/payment, puis privilégier `getByRole`/`getByLabel` quand le nom accessible est stable.

#### R8 - Contournements DOM et `force: true` trop répandus

**Fichiers/lignes :** `utils/formHelper.ts:223-246`, `utils/formHelper.ts:367-414`, `pages/checkout/CheckoutPaymentPage.ts:193-205`, `pages/checkout/CheckoutPaymentPage.ts:391-399`, `pages/checkout/CheckoutShippingPage.ts:257-302`, `pages/checkout/CheckoutShippingPage.ts:714-719`.

**Quantification :** 39 occurrences de `force: true` et 34 appels `evaluate(` dans `pages/`, `tests/`, `utils/`.

**Pourquoi :** modifier `checked`, `value`, `hidden`, ou dispatcher des events depuis le DOM ne reproduit pas toujours le parcours utilisateur. C'est parfois nécessaire pour un sandbox instable, mais ici ce pattern devient la voie normale.

**Impact :** faux positifs possibles : le test peut passer alors que le bouton réel est non cliquable, masqué ou non accessible.

**Correction proposée :** enfermer les contournements dans des helpers nommés `workaroundCeline...`, avec commentaire du bug produit, postcondition stricte, screenshot/trace au premier usage, et suppression dès que l'app expose un hook stable.

### 3.2 Bonnes pratiques d'automatisation de test

#### A1 - Le spec principal reste un mégatest monolithique

**Fichiers/lignes :** `tests/celine-purchase.spec.ts:77-506`.

**Pourquoi :** un seul test couvre produit, panier, login, shipping, paiement, portail externe, confirmation et tracking. Les `test.step` aident au reporting, mais n'isolent pas les responsabilités ni les données.

**Impact :** un échec précoce masque toute la suite, les retries relancent tout le tunnel, et les temps de diagnostic augmentent.

**Correction proposée :** garder un smoke complet par marché, mais extraire des tests ciblés : PDP/add-to-cart, checkout login, shipping home/pickup, payment card provider, PayPal, Afterpay. Pour le smoke, appeler une API POM de haut niveau.

#### A2 - La logique métier checkout fuit dans le test au lieu d'être dans le POM

**Fichiers/lignes :** `tests/celine-purchase.spec.ts:185-224`, `tests/celine-purchase.spec.ts:227-353`, `tests/celine-purchase.spec.ts:368-416`.

**Pourquoi :** le spec connaît les champs zipcode, les panels, la sélection pickup/home et les fallbacks de shipping. Le Page Object devient un sac de helpers au lieu d'une abstraction métier.

**Impact :** duplication future probable et difficulté à réutiliser un flow checkout sans recopier 150+ lignes.

**Correction proposée :** créer des méthodes orientées intention, par exemple `checkoutPage.loginAsRegisteredOrGuest(testData)`, `checkoutPage.shipping.complete({ mode, address })`, `checkoutPage.payment.pay({ method, data })`.

#### A3 - Les scénarios paiement sont pilotés par une variable globale, pas par la matrice Playwright

**Fichiers/lignes :** `tests/celine-purchase.spec.ts:368-380`, `config/regionConfig.ts:73-94`.

**Pourquoi :** `TEST_PAYMENT_METHOD` décide card/paypal/afterpay au runtime. Ce n'est pas visible dans le nom de projet, le sharding, les rapports ou les retries par scénario.

**Impact :** couverture apparente : un run par défaut ne couvre que `card`. PayPal et Afterpay nécessitent des runs manuels et peuvent être oubliés.

**Correction proposée :** ajouter des projets ou `test.describe` paramétrés par méthode, avec `test.skip` documenté pour les combinaisons non supportées (ex. Afterpay hors AU).

#### A4 - `storageState` n'est pas utilisé pour les comptes enregistrés

**Fichiers/lignes :** `fixtures/celineFixtures.ts:52-65`, `pages/checkout/CheckoutLoginPage.ts:188-278`.

**Pourquoi :** chaque scénario refait la détection email/password et la connexion checkout. La fixture `authenticatedPage` ne couvre que le Basic Auth et n'est pas utilisée par le spec principal.

**Impact :** temps de run plus long et dépendance répétée à un flux login volatile.

**Correction proposée :** setup par région qui génère un `storageState` utilisateur enregistré quand le scénario le permet, et tests guest séparés quand il faut valider la saisie login.

#### A5 - Certains tests unitaires recopient l'implémentation au lieu de tester l'API réelle

**Fichiers/lignes :** `tests/unit/emailReporter.spec.ts:80-88`, `tests/unit/emailReporter.spec.ts:123-126`, `tests/unit/emailReporter.spec.ts:257-263`.

**Pourquoi :** ces tests recalculent localement les formules du reporter et les assertions portent sur la copie dans le test, pas sur `EmailReporter`.

**Impact :** un bug dans `utils/emailReporter.ts` peut passer si la copie du test reste correcte.

**Correction proposée :** extraire les fonctions pures (`calculateElapsed`, `formatStatus`, `buildSubject`) et les tester directement, ou rendre `generateHTMLReport` testable via injection de trackers.

### 3.3 Performance

#### P1 - Coût fixe et retries globaux masquent les vrais points lents

**Fichiers/lignes :** `playwright.config.ts:28-35`, `config/regionConfig.ts:84-86`, `tests/celine-purchase.spec.ts:79`.

**Pourquoi :** timeout global de 5 min, retries CI à 2, retry TH local spécifique, et mégatest complet. Un défaut reproductible peut consommer 15 minutes par shard sur un seul scénario.

**Impact :** feedback CI lent, flakiness plus chère, saturation possible du sandbox.

**Correction proposée :** budgets par étape (`test.step` + `expect` ciblés), retries limités aux scénarios annotés flaky, et séparation smoke/couverture profonde.

#### P2 - CI shardée de manière inefficace et possiblement trop concurrente

**Fichiers/lignes :** `.github/workflows/playwright.yml:14-17`, `.github/workflows/playwright.yml:42`, `playwright.config.ts:32-35`.

**Pourquoi :** 4 shards lancent chacun Playwright avec jusqu'à 4 workers. Avec peu de tests E2E et des ressources sandbox partagées, cela peut créer plus de contention que de gain.

**Impact :** surcharge externe, comportements non représentatifs, coût CI inutile.

**Correction proposée :** sharder par projet/marché explicitement ou limiter `workers` par shard. Exemple : `--project=celine-fr` par job, ou `workers: 1` pour les parcours qui créent des commandes.

#### P3 - Les rapports Playwright shardés ne sont pas mergeables en l'état

**Fichiers/lignes :** `playwright.config.ts:36`, `.github/workflows/playwright.yml:44-50`, `.github/workflows/playwright.yml:85-86`.

**Pourquoi :** la config produit un reporter HTML, mais `npx playwright merge-reports` attend des blob reports. Les artifacts uploadés sont `playwright-report/`, pas `blob-report/`.

**Impact :** le job `merge-reports` risque d'échouer ou de produire un rapport incomplet. Même si les tests passent, le reporting PR est trompeur.

**Correction proposée :**

```ts
// playwright.config.ts
reporter: process.env.CI ? [['blob'], ['html']] : 'html',
```

Puis uploader `blob-report/` par shard et merger ces blobs.

#### P4 - Les artifacts d'échec ne correspondent pas à `outputDir`

**Fichiers/lignes :** `playwright.config.ts:26`, `.github/workflows/playwright.yml:52-58`.

**Pourquoi :** `outputDir` pointe vers `%TEMP%/playwright-results` ou `/tmp/playwright-results`, mais la CI upload `test-results/`.

**Impact :** traces/screenshots/error contexts peuvent manquer au moment où ils sont nécessaires.

**Correction proposée :** en CI, définir `outputDir: 'test-results'`, ou uploader `${{ runner.temp }}/playwright-results`.

### 3.4 Sécurité

#### S1 - Credentials sandbox et emails réels codés en dur

**Fichiers/lignes :** `.env.example:16-19`, `config/testData.ts:20-30`, `config/testData.ts:142-157`, `config/testData.ts:170-184`, `config/testData.ts:197-212`, `config/testData.ts:225-246`, `config/testData.ts:258-276`, `config/testData.ts:288-306`.

**Pourquoi :** même sandbox, ce sont des comptes et mots de passe réutilisables, dont PayPal/Afterpay. Les fallbacks encouragent l'exécution avec des credentials partagés.

**Impact :** abus possible du sandbox, commandes de test attribuées au mauvais compte, rotation difficile, audit LVMH défavorable.

**Correction proposée :** remplacer les fallbacks sensibles par des placeholders et exiger les variables d'environnement pour tout compte externe.

```ts
password: requiredEnv('TEST_PAYPAL_PASSWORD');
```

Garder seulement les cartes de test publiques si la politique sécurité les autorise, avec un commentaire clair.

#### S2 - Fichiers locaux et historiques opérateur committés

**Fichiers/lignes :** `.claude/settings.local.json:63-84`, `.claude/settings.local.json:217-220`, `%TEMP%install-qwen.bat:101-104`, `%TEMP%install-qwen.bat:179-188`.

**Pourquoi :** `.claude/settings.local.json` expose des chemins internes, commandes, URLs preview et historiques de test. Le batch installe globalement un outil tiers depuis un registry miroir et télécharge un MSI Node.

**Impact :** fuite d'informations internes, surface supply-chain inutile, bruit dans les revues.

**Correction proposée :** retirer ces fichiers du dépôt, ajouter `.claude/` et `%TEMP%*.bat` au `.gitignore`, et documenter localement les outils hors repo.

#### S3 - Données personnelles propagées dans les artefacts et emails

**Fichiers/lignes :** `utils/orderTracker.ts:21-26`, `tests/celine-purchase.spec.ts:482-489`, `utils/emailReporter.ts:406-408`.

**Pourquoi :** l'email test est stocké dans `orders.json`, puis repris dans le rapport texte. `test-data/` est ignoré, mais les emails sortent potentiellement en artifact ou SMTP.

**Impact :** exposition de données de test nominatives et difficulté à appliquer une rétention propre.

**Correction proposée :** stocker `emailMasked` ou un hash, et n'inclure l'email complet que si une variable explicite `INCLUDE_PII_IN_REPORT=true` est définie.

#### S4 - HTML email non échappé

**Fichiers/lignes :** `utils/emailReporter.ts:119-137`, `utils/emailReporter.ts:531-560`.

**Pourquoi :** `order.orderNumber`, `order.testName`, `message` et d'autres champs sont interpolés dans du HTML sans échappement.

**Impact :** faible si toutes les sources restent internes, mais une page de confirmation ou un message opérateur contenant du HTML peut injecter du contenu dans le rapport.

**Correction proposée :** ajouter `escapeHtml()` et l'appliquer à toutes les interpolations non constantes.

#### S5 - Audit dépendances non exécutable sans lockfile

**Fichiers/lignes :** `package.json:10`, `.gitignore:5`, `SECURITY_NOTES.md:221`.

**Pourquoi :** `SECURITY_NOTES.md` indique `npm audit` à 0 vulnérabilité, mais ce checkout n'a pas de lockfile. `npm audit` ne peut donc pas reproduire ce résultat.

**Impact :** faux sentiment de sécurité et incapacité à prouver l'état dépendances en CI.

**Correction proposée :** committer le lockfile, lancer `npm audit --audit-level=moderate` en CI après `npm ci`, et dater le snapshot dans `SECURITY_NOTES.md`.

### 3.5 Maintenabilité

#### M1 - ESLint désactive précisément les règles qui auraient détecté les problèmes majeurs

**Fichiers/lignes :** `eslint.config.js:49-55`.

**Pourquoi :** `no-explicit-any` est off, `preserve-caught-error` est off, `no-empty` autorise les catches vides, `no-console` est off partout.

**Impact :** les anti-patterns deviennent invisibles au lint et s'accumulent.

**Correction proposée :** réactiver par lots : d'abord `no-empty` sans `allowEmptyCatch`, puis `@typescript-eslint/no-explicit-any` sur les nouveaux fichiers, puis une règle locale interdisant `.catch(() => {})` hors helpers allowlistés.

#### M2 - Usage de `any` évitable dans le chemin checkout

**Fichiers/lignes :** `config/testData.ts:310`, `utils/emailReporter.ts:454`, `utils/orderTracker.ts:25`, `pages/checkout/CheckoutShippingPage.ts:1375`, `pages/checkout/CheckoutShippingPage.ts:1395`, `pages/checkout/CheckoutShippingPage.ts:1419`, `pages/checkout/CheckoutShippingPage.ts:1452`.

**Pourquoi :** les helpers pickup utilisent `options: any` alors qu'une interface existe déjà pour le formulaire. Le cast `getProductUrl('NL' as any)` contourne une union qui inclut pourtant NL ailleurs.

**Impact :** les changements de données régionales ne sont pas protégés par TypeScript.

**Correction proposée :** créer `PickupAddressOptions` et élargir proprement l'union `getProductUrl(region: keyof typeof DEFAULT_PRODUCTS)`.

#### M3 - Documentation contradictoire avec le code actuel

**Fichiers/lignes :** `README.md:108-145`, `QUALITY_BASELINE.md:289-305`, `README.md:99`, `package.json:5`, `config/regionConfig.ts:65-72`.

**Pourquoi :** README affirme que les trackers ne sont pas durcis et que les runs E2E doivent rester sérialisés, alors que `QUALITY_BASELINE.md` indique le durcissement par file lock. README et `package.json` parlent aussi de 5 régions alors que NL existe.

**Impact :** opérateurs et CI peuvent suivre des consignes obsolètes.

**Correction proposée :** mettre à jour README après chaque changement d'architecture, et supprimer les sections historiques ou les déplacer dans `QUALITY_BASELINE.md`.

#### M4 - Scripts obsolètes et non raccordés aux scripts npm

**Fichiers/lignes :** `scripts/run-orders.js:90`, `package.json:6-15`, `scripts/README.md:7-15`, `scripts/send-final-email.js:31-35`.

**Pourquoi :** `run-orders.js` appelle `tests/celine-e2e.spec.ts --project=celine`, qui n'existent pas. `scripts/README.md` documente `npm run test:orders`, absent de `package.json`. `send-final-email.js` vide `orders.json` directement avec `fs.writeFileSync`, hors `OrderTracker` et hors lock.

**Impact :** scripts cassés, risque de suppression concurrente ou non auditée d'ordres.

**Correction proposée :** soit supprimer ces scripts, soit les remettre à jour avec `tests/celine-purchase.spec.ts`, les projets `celine-*`, et `orderTracker.clear()`.

#### M5 - Fichiers encodés ou affichés en mojibake

**Fichiers/lignes :** `README.md:3`, `pages/selectors.ts:18`, `pages/selectors.ts:77`, `config/testData.ts:151`, `utils/logger.ts:21-30`.

**Pourquoi :** beaucoup de caractères UTF-8 sont affichés sous forme `Ã`, `â`, etc. Dans les commentaires/logs c'est gênant ; dans les sélecteurs textuels, c'est fonctionnellement risqué.

**Impact :** sélecteurs localisés invalides, rapports peu lisibles, dette de formatage.

**Correction proposée :** normaliser l'encodage en UTF-8, puis remplacer les sélecteurs textuels sensibles par rôles/labels/test ids stables.

#### M6 - `CheckoutShippingPage` concentre trop de responsabilités

**Fichiers/lignes :** `pages/checkout/CheckoutShippingPage.ts:30-1523`.

**Pourquoi :** le fichier gère shipping standard, pickup, civility, state, katakana, phone, DOM refills et fallback JS. La complexité rend les régressions probables.

**Impact :** coût de revue élevé, tests unitaires difficiles, duplication de stratégies.

**Correction proposée :** découper en `ShippingMethodSelector`, `AddressForm`, `PickupDialog`, `RegionalAddressFields`, avec tests unitaires sur chaque stratégie de sélection.

## 4. Plan d'action priorisé

| Priorité | Effort | Impact | Action |
|---|---:|---|---|
| P0 critique | S | Très fort | Générer/committer `package-lock.json`, retirer son ignore, vérifier `npm ci` et `npm audit` localement. |
| P0 critique | S | Très fort | Corriger la CI : Node 22, secrets non commentés, reporter blob pour sharding, upload du bon `outputDir`. |
| P0 critique | S | Très fort | Supprimer du dépôt `.claude/settings.local.json` et `%TEMP%install-qwen.bat`, puis ajouter des ignores adaptés. |
| P0 critique | M | Fort | Retirer les credentials sandbox sensibles des fallbacks et de `.env.example`; imposer env vars pour PayPal/Afterpay/comptes login. |
| P1 important | S | Fort | Faire échouer le spec quand un POM retourne `false` sur les étapes obligatoires shipping/pickup/payment. |
| P1 important | S | Fort | Remplacer la validation de confirmation par URL `Order-Confirm` + locator de numéro de commande visible. |
| P1 important | M | Fort | Remplacer les sleeps les plus coûteux par `expect(locator)`/`waitForResponse`/`expect.poll` ciblés. |
| P1 important | M | Fort | Encadrer les catches silencieux : allowlist pour best-effort overlays, throw/log structuré ailleurs. |
| P1 important | M | Fort | Créer une matrice Playwright explicite pour `card`, `paypal`, `afterpay` et les modes `home/pickup` supportés. |
| P1 important | M | Moyen/fort | Découper le mégatest en smoke complet + specs ciblées par domaine checkout. |
| P1 important | M | Moyen | Mettre à jour README/scripts pour refléter NL, file locks, projets actuels et scripts réellement disponibles. |
| P2 moyen terme | L | Fort | Obtenir des `data-testid`/`data-qa` stables côté app checkout et réduire les sélecteurs CSS/textuels. |
| P2 moyen terme | L | Moyen/fort | Refactorer `CheckoutShippingPage` en composants plus petits et testables. |
| P2 moyen terme | M | Moyen | Introduire `storageState` par région pour les scénarios registered, tout en gardant des tests guest dédiés. |
| P2 moyen terme | M | Moyen | Réactiver progressivement les règles ESLint sur `any`, catches vides et erreurs capturées. |
| P2 moyen terme | S | Moyen | Ajouter `escapeHtml()` au reporter email et masquer les emails dans les artefacts persistés. |

## 5. Quick wins

1. **Lockfile + CI install** : retirer `package-lock.json` du `.gitignore`, générer le lockfile et relancer `npm ci`. C'est le plus gros ROI : la CI devient installable.
2. **Assertions sur retours POM** : ajouter des `expect(...).toBe(true)` autour de `fillPickupAddressForm`, `fillShippingAddress`, `selectCountry`, `continueToShipping`. Moins d'une heure, gros gain diagnostic.
3. **Confirmation stricte** : remplacer `waitForURL(...).catch(() => {})` + scan body par `toHaveURL(/Order-Confirm/)` et locator visible du numéro de commande.
4. **Hygiène dépôt** : retirer `.claude/settings.local.json` et `%TEMP%install-qwen.bat`, ajouter les ignores. Réduit immédiatement les fuites internes et le bruit de revue.
5. **Corriger les scripts morts** : soit supprimer `scripts/run-orders.js`/`scripts/send-final-email.js`, soit les aligner sur `tests/celine-purchase.spec.ts` et `orderTracker.clear()`.

