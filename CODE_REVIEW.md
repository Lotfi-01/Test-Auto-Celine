# Code Review — Test-Auto-Celine

Revue en lecture seule de la suite Playwright/TypeScript couvrant le checkout Céline (FR, US, JP, AU, TH, NL) avec Adyen, Cybersource, PayPal, Afterpay.
Périmètre analysé : `playwright.config.ts`, `tsconfig.json`, `eslint.config.js`, `.github/workflows/`, `config/`, `fixtures/`, `pages/**`, `utils/**`, `tests/**`, `scripts/**`, `global-teardown.ts`, `.env.example`, `.gitignore`, `.claude/settings.local.json`.

---

## 1. Verdict global

La base présente une **architecture globalement saine** (POM + fixtures + BasePage, régions centralisées, iframes Adyen/Cybersource isolés dans des helpers) et une intention claire de robustesse (retry helpers, verrous inter-processus sur les JSON de tracking). Mais **cette intention est étouffée par une couche défensive massive** : ~34 `waitForTimeout` en dur, ~180 `.catch(() => {})` qui avalent des erreurs, des cascades de sélecteurs (jusqu'à 5-6 fallback par champ) et plusieurs stratégies concurrentes dans la même méthode (`Playwright.click` → `force: true` → `evaluate(el.click)` → `form.requestSubmit`). Résultat : les vrais bugs sont indétectables, la lisibilité est très dégradée dans `CheckoutShippingPage.ts` (1523 l.) et `CheckoutPaymentPage.ts` (851 l.), et la « robustesse » est en réalité un masquage de flakiness.

Deux problèmes de sécurité/hygiène sont **critiques et à traiter immédiatement** : (a) `.claude/settings.local.json` est committé avec plus de 200 commandes shell contenant des chemins internes LVMH, deux noms d'utilisateurs Windows (`herml`, `sawss`), des emails testeurs, et des URLs produits avec tokens de preview ; (b) un fichier `%TEMP%install-qwen.bat` (un script d'installation Node/Qwen sans rapport avec le projet) est committé à la racine. Le typage TypeScript est strict mais partiellement neutralisé (`no-explicit-any: off`, `allowEmptyCatch: true`), et un mégatest unique de 500 lignes couvre l'ensemble du tunnel — impossible à isoler.

Le socle est réutilisable, la refactorisation ne nécessite pas de réécriture, mais un **lot de discipline** (nettoyage secrets, extraction de sous-classes, remplacement des `waitForTimeout` par des attentes web-first) rendrait la suite à la fois plus rapide et plus honnête sur ses vrais échecs.

---

## 2. Points forts

- **Séparation POM claire** : `BasePage` → `CelineHomePage / CelineProductPage / CelineCheckoutPage` avec sous-pages `checkout/CheckoutLoginPage`, `CheckoutShippingPage`, `CheckoutPaymentPage`. La façade `CelineCheckoutPage` est bien pensée.
- **Fixtures Playwright idiomatiques** (`fixtures/celineFixtures.ts`) qui pré-instancient les POs — pas de boilerplate dans les tests.
- **Isolation des iframes tiers** : `AdyenHelper` et `CybersourceHelper` encapsulent la découverte de frame par `page.frames()` — plus fiable que `frameLocator('iframe[title=...]')` qui casse dès que Céline change le `title`.
- **Verrous inter-processus** (`utils/fileLock.ts`) avec cleanup de stale-locks + tests unitaires dédiés (`tests/unit/fileLock.spec.ts`). C'est un bijou souvent absent des suites Playwright.
- **Écriture atomique via temp + rename** dans `OrderTracker` et `TestResultTracker` — protège contre les corruptions JSON en cas de kill process.
- **Configuration régionale centralisée** (`config/regionConfig.ts`, `config/testData.ts`) — un seul endroit pour ajouter une région.
- **Détection Adyen vs Cybersource** au runtime dans `CheckoutPaymentPage.detectCybersource()` — permet à un même flow de couvrir deux PSP différents.
- **Sharding CI** en 4 avec `merge-reports` pour un rapport unifié — pattern moderne recommandé par Playwright.
- **Suite unit tests** raisonnable (`tests/unit/`) qui couvre les helpers pures (fileLock, orderTracker, formHelper, emailReporter).
- **`maskEmailForLog`** empêche que les emails testeurs pollutent les logs CI.

---

## 3. Problèmes par dimension

### 3.1 Robustesse & fiabilité des tests

**F-R1 · `waitForTimeout` en dur — 34 occurrences.** *(P0)*

Fichiers principaux : `pages/checkout/CheckoutShippingPage.ts` (13), `pages/checkout/CheckoutPaymentPage.ts` (7), `pages/checkout/CheckoutLoginPage.ts` (5), `tests/celine-purchase.spec.ts` (5), `pages/CelineProductPage.ts` (2).

Exemples :
- `CheckoutLoginPage.ts:197` `await this.page.waitForTimeout(100);` juste après le fill email.
- `CheckoutShippingPage.ts:717` `await this.page.waitForTimeout(1000);` après clic sur pickup — 1s de perdu à chaque run.
- `CheckoutPaymentPage.ts:180` `await this.page.waitForTimeout(500);` « stabilisation payment » — non déterministe.
- `CheckoutPaymentPage.ts:212` `await this.page.waitForTimeout(600);` « Extra wait for Adyen to mount ».
- `celine-purchase.spec.ts:292, 366` `waitForTimeout(1000)` et `waitForTimeout(300)` pour laisser respirer JP/NL.

**Pourquoi c'est un problème.** Ces sleeps masquent des attentes qui devraient être basées sur un état réel du DOM ou un événement réseau. Ils ralentissent la suite (cumul estimé : **>10 s par test sur 6 régions × 500 runs/mois ≈ 8h/mois gaspillées**) et introduisent un mode d'échec particulièrement sournois : sur un runner CI plus lent que le local, ces sleeps deviennent insuffisants et le test flake « aléatoirement ».

**Fix.** Remplacer chaque `waitForTimeout` par soit :
- `expect(locator).toBeVisible({ timeout })` / `toBeEnabled` — web-first, auto-retrying.
- `page.waitForFunction(pred, { timeout })` — condition DOM explicite.
- `page.waitForResponse(pattern)` — pour les mutations back.
- `locator.waitFor({ state: 'visible' | 'hidden' | 'attached' })` — l'attente DOM canonique.

Avant :
```ts
await afterpayLabel.click().catch(() => {});
await this.page.waitForTimeout(300); // 2s wait for Celine's billing-form hydration
await afterpayRadio.evaluate((el) => { if (!el.checked) el.checked = true; ... });
```

Après :
```ts
await afterpayLabel.click();
await expect(afterpayRadio).toBeChecked({ timeout: TIMEOUTS.medium });
```

---

**F-R2 · Blocs `catch` silencieux — ~180 occurrences.** *(P0)*

`.catch(() => {})`, `.catch(() => false)`, `.catch(() => null)` sont partout. Comptes : `CheckoutShippingPage.ts` (74), `CheckoutPaymentPage.ts` (49), `celine-purchase.spec.ts` (20), `CheckoutLoginPage.ts` (11), `CelineProductPage.ts` (10). En plus, `eslint.config.js:54` active explicitement `'no-empty': ['error', { allowEmptyCatch: true }]` — la règle qui alertait est désactivée.

Exemples :
- `CheckoutShippingPage.ts:718` `await this.page.evaluate(...).catch(() => {});` sur le fallback JS Ultime pour le tab pickup.
- `CheckoutPaymentPage.ts:184-187` : label click → `.catch(async () => { await label.click({ force: true, timeout: 1500 }).catch(() => {}); });` — la seconde erreur est totalement invisible.
- `CheckoutPaymentPage.ts:501` : `await paypalLabel.click().catch(() => {});` — le tunnel PayPal continue même si le clic sur le label a échoué.

**Pourquoi c'est un problème.** Un test qui « passe » alors qu'un clic critique a échoué n'a plus aucune valeur — c'est le pire mode d'échec en QA. Combiné aux 5 niveaux de fallback (voir F-R3), il devient littéralement impossible de savoir pourquoi une commande n'est pas passée : quelle stratégie a marché ? Aucune ? Les 5 ? La log dit juste `'success'` en fin de méthode.

**Fix.** Deux règles :
1. Un `catch` qui swallow doit contenir **au minimum** un `this.log(..., 'debug' | 'warn')` documenté (comme le fait bien `BasePage.isVisible` l:220).
2. La règle ESLint doit être réactivée : `'no-empty': ['error']` (sans `allowEmptyCatch`), avec ajout ponctuel de `// eslint-disable-next-line` là où la tolérance est intentionnelle et commentée.

---

**F-R3 · Cascades de fallback qui masquent des vrais bugs.** *(P0)*

Pattern archétypal : `CheckoutShippingPage.selectClickAndCollect()` (l.671-825) tente **4 stratégies successives** pour cliquer le tab PICK-UP :
1. `pickupTab.click({ timeout: 10s })`
2. Si visible : vérifier si le panel est déjà ouvert → « proceed anyway ».
3. Chercher `label:has-text("PICK-UP")` — `force: true`.
4. `page.evaluate` qui scanne `button, label, a, div[role="tab"]` par regex de textContent et clique le premier match.

Autre exemple : `CheckoutShippingPage._selectCivilityRobust()` (l.188-311) — 3 stratégies dont une évaluation JS massive qui recherche tous les radios par nom/id et clique le premier « title-like ».

Sur `CheckoutShippingPage.continueToShipping()` (l.542-609), on fait successivement : `safeClick` → `el.click()` (JS) → `form.requestSubmit()` → `form.submit()` — chacun étant censé fonctionner seul.

**Pourquoi c'est un problème.** Le nombre de sélecteurs et de stratégies veut dire que **l'auteur ne sait pas quel sélecteur marche**. Le test « passe » parce que l'un des 4 a réussi, mais on ignore lequel. Si Céline renomme `data-osidepanel-name`, le test continue de passer via le fallback JS regex, jusqu'au jour où le CTA final échoue — et là le diagnostic est ingérable. Les fallback multiples sont un **anti-pattern** en E2E : on veut un sélecteur qui marche et un échec loud.

**Fix.**
1. Instrumenter chaque cascade : compter en télémétrie / log quelle branche a matché. Après 2 semaines, éliminer les branches jamais utilisées.
2. Travailler avec l'équipe front Céline pour poser des `data-testid` stables (`data-testid="checkout-tab-pickup"`, `data-testid="civility-mr"`, etc.). C'est le seul remède durable.
3. Fallback maximum : **2 stratégies** (le sélecteur canonique + une secondary basée sur ARIA `getByRole` / `getByLabel`). Au-delà, on refuse le PR.

---

**F-R4 · `isVisible({ timeout: N })` pour polling — anti-pattern documenté par Playwright.** *(P1)*

Utilisé partout : `CheckoutPaymentPage.ts:86,540,551,916` etc., `CheckoutShippingPage.ts` innombrable. Depuis Playwright 1.33, `Locator.isVisible()` n'attend plus — le paramètre `timeout` est trompeur (il fait juste un `waitFor` implicite). Le code polle donc en boucle avec des `isVisible({ timeout: 100 })` qui, semantiquement, veulent dire « attendre 100ms puis regarder », mais qui en pratique masquent des attentes non-web-first.

Ex. `CheckoutPaymentPage.ts:540` :
```ts
while (Date.now() < ctaDeadline && !paypalCta) {
  const topBtn = this.page.locator(ctaSelector).first();
  if (await topBtn.isVisible({ timeout: 250 }).catch(() => false)) { ... }
  ...
  await this.page.waitForTimeout(80);
}
```

**Pourquoi.** Ce pattern (`isVisible + waitForTimeout` en boucle) contourne le moteur d'attente web-first de Playwright. Il est plus lent, plus flaky, et illisible.

**Fix.** Remplacer par une seule ligne :
```ts
const paypalCta = this.page.locator(ctaSelector).first();
await expect(paypalCta).toBeVisible({ timeout: TIMEOUTS.navigation });
```

Ou, pour les frames PayPal, utiliser `page.frameLocator(...)` avec un poll strict.

---

**F-R5 · Extraction de numéro de commande via `document.body.textContent`.** *(P1)*

`tests/celine-purchase.spec.ts:452-457` :
```ts
const text = await page.evaluate(() => document.body?.textContent || '').catch(() => '');
const m = text.match(/#([A-Z0-9]+(?:-\d+)?)/);
if (m) { orderNumber = m[1]; break; }
```

**Pourquoi.** Le pattern `#XXX...` peut matcher n'importe quel token présent dans le body (`#footer`, `#modal-title`, une pub, un hash de tracking analytics, etc.). On a déjà eu un cas documenté dans le code (`CheckoutPaymentPage.ts:717`) où « the order-number regex matches stray UI text on the Afterpay page ». C'est explicite : **on sait que ce regex est faux, mais on l'utilise quand même en fallback**.

**Fix.** Utiliser le sélecteur DOM ciblé `SELECTORS.CHECKOUT.CONFIRMATION.ORDER_NUMBER` (`h2.f-title`, etc.) via `Locator.textContent()` puis appliquer `SELECTORS.CHECKOUT.CONFIRMATION.ORDER_NUMBER_PATTERN`. Le pattern regex sur le body entier ne devrait jamais être utilisé en confirmation d'achat.

---

**F-R6 · Un seul mégatest de 500 lignes couvre tout le flow.** *(P1)*

`tests/celine-purchase.spec.ts` — un seul `test('Complete purchase flow — Optimized', ...)` couvre : navigation produit, add-to-cart, login, shipping, payment, 3DS, confirmation, tracking. Environ 500 lignes, découpé en `test.step` mais un seul test au sens Playwright.

**Pourquoi.**
- Impossible d'isoler un bug de payment sans rejouer tout l'add-to-cart.
- `retries: 2` en CI signifie que si l'étape payment flake, on rejoue tout depuis la home — 3× le temps du flow.
- Aucun test dédié « login échoue avec mauvais mot de passe », « address invalide », « CVV rejeté », « stock épuisé ». La suite dit couvrir le tunnel, elle ne couvre **qu'un chemin nominal**.
- La couverture apparente (« 6 régions × payment × Click&Collect × home ») est en réalité **1 seul cas de test répété par région**.

**Fix.** Découpage minimal :
- `product.spec.ts` — chargement PDP + add-to-cart (sans checkout).
- `checkout-login.spec.ts` — email invalide, guest, registered avec/sans password, avec `storageState` pré-loggué.
- `checkout-shipping.spec.ts` — home vs pickup, address invalide, prefecture manquante.
- `checkout-payment.spec.ts` — carte OK, carte 3DS, PayPal, Afterpay, terms unchecked.
- `checkout-confirmation.spec.ts` — via un `storageState` reproduisant l'état pré-checkout, ou via mock du back Céline.

Bonus : mettre en place `storageState` **connecté** partagé entre tests (login-time saved once) pour éviter de re-logger sur chaque test.

---

**F-R7 · `waitForNetworkIdle` est mal nommé et trompeur.** *(P2)*

`BasePage.ts:229` :
```ts
protected async waitForNetworkIdle(timeout: number = TIMEOUTS.medium): Promise<void> {
  await this.page.waitForLoadState('domcontentloaded', { timeout }).catch(() => {});
}
```

Le nom laisse croire à `waitForLoadState('networkidle')`. En réalité c'est un simple `domcontentloaded`. Le commentaire dans `continueToShipping()` (l.598-599) confirme : « do NOT race against networkIdle here. Pages have continuous GTM/analytics polling ». Bien vu — mais la méthode s'appelle toujours `waitForNetworkIdle`.

**Fix.** Renommer en `waitForDomLoaded` (déjà en doublon avec `waitForDomContent` l.236 — même corps, à consolider en une seule méthode).

---

**F-R8 · `Page.isClosed()` check en pleine méthode.** *(P2)*

`CheckoutPaymentPage.ts:74` :
```ts
if (this.page.isClosed()) {
  this.log('Page is closed!', 'error');
  return false;
}
```

**Pourquoi.** Un test qui tourne avec la page fermée doit **fail loud** (throw), pas retourner `false`. C'est la trace d'un teardown qui court à côté du test — probablement lié au fait que le test principal ne `close()` pas explicitement (cf. commentaire `celine-purchase.spec.ts:502-504`). Une afterEach ou une fixture ferme la page pendant que le test tourne encore.

**Fix.** Investigation à faire du cycle de vie ; à défaut, `throw new Error('Page closed during payment step')` — mieux vaut un échec explicite.

---

### 3.2 Bonnes pratiques d'automatisation

**F-B1 · `TIMEOUTS.short` vs `TEST_CONFIG.timeouts.short` — collision de noms, valeurs différentes.** *(P0 pour clarté)*

`config/testConfig.ts:118` : `TEST_CONFIG.timeouts.short = 30_000` (30s).
`config/testConfig.ts:203` : `TIMEOUTS.short = 5_000` (5s).

Les deux sont exportés du même fichier, avec le même nom. Selon lequel on importe, `short` veut dire 30s **ou** 5s. Rien dans le code pour le signaler.

**Pourquoi.** Un dev qui lit `timeout: TIMEOUTS.short` pense « ok, 30 secondes, ça a le temps » alors que non, c'est 5s. Ou inversement. C'est la première recette du timeout invisible en CI.

**Fix.** Renommer et supprimer l'ambiguïté. Choix : garder `TIMEOUTS` (constantes granulaires) et supprimer `TEST_CONFIG.timeouts.{long,medium,short}` (redondants) — ne garder que `test`, `element`, `navigation`, `api`.

---

**F-B2 · `getByRole` / `getByTestId` peu utilisés — sélecteurs CSS fragiles partout.** *(P1)*

Statistique rapide : `getByRole` apparaît ~14 fois (surtout dans Cybersource / PayPal / Afterpay), `getByTestId` **jamais** (le helper `testId()` de `pages/selectors.ts:170` est défini mais n'est appelé nulle part). En face, on a des monstres comme :

`pages/selectors.ts:15-18` :
```ts
GUEST_CHECKOUT: 'button[class*="guest"], button[data-testid*="guest"], button:has-text("Guest"), button:has-text("Invité")',
```

`pages/selectors.ts:29` :
```ts
ZIPCODE_OK_BUTTON: 'button[type="submit"], button[class*="ok-btn"], button:has-text("OK")',
```

`button[type="submit"]` sur une page de checkout = potentiellement 5 boutons. `.first()` prendra celui qui est en tête du DOM, pas forcément celui de zipcode.

**Pourquoi.** Les sélecteurs `class*=` cassent au moindre reload de CSS bundle Céline. Les `has-text` cassent au moindre changement de wording (et il faut maintenir FR + EN + JA + TH). `button[type="submit"]` est un sélecteur bien trop large.

**Fix.**
1. Push interne à Céline pour ajouter des `data-testid` stables sur les CTA critiques (login continue, submit address, place order, terms, cookie accept). C'est un vrai levier structurel.
2. Sur les éléments accessibles (radio, textbox, button avec `aria-label`), privilégier `getByRole(...)` avec `{ name: /.../i }` bilingue.
3. Éviter `has-text` pour des chaînes localisées ; préférer `getByRole` scoped par ARIA name.

---

**F-B3 · Aucun `storageState` — chaque test re-fait le login.** *(P1)*

`fixtures/celineFixtures.ts:52-66` définit un `authenticatedPage` qui ouvre un nouveau contexte avec `httpCredentials`, mais aucun test n'utilise `storageState` pour sauver les cookies applicatifs après login. Le test principal appelle `loginAsRegistered` à chaque exécution.

**Pourquoi.** Le login checkout de Céline peut prendre 10-15s. Sur 6 régions × 2 modes = 12 tests, on brûle **~2-3 minutes par run** rien qu'à re-logger.

**Fix.** Créer un `global-setup.ts` qui, par région, se log une fois et sauvegarde `context.storageState({ path: 'auth/celine-fr.json' })`. Configurer les projects avec `use.storageState: 'auth/celine-{region}.json'`. Prévoir un flag `SKIP_STORAGE_STATE=1` pour re-générer.

---

**F-B4 · Assertions manuelles au lieu d'assertions web-first.** *(P1)*

Exemples :
- `celine-purchase.spec.ts:132-133` : `const buyNowVisible = (await productPage.buyNowButton.isVisible({ timeout: 100 }).catch(() => false));` — au lieu de `expect(buyNowButton).toBeVisible({ timeout: TIMEOUTS.short })`.
- `CheckoutShippingPage.ts:1038` : `const isAttached = await this.submitShippingButton.count().then(c => c > 0)...` — au lieu de `expect(...).toHaveCount(N)`.

**Pourquoi.** `expect(locator).toBeVisible()` retente automatiquement, produit un message d'erreur clair avec screenshot, et évite les race conditions. `isVisible().catch()` est une décision manuelle qui ne se retente pas.

**Fix.** Convention codebase : jamais `.isVisible().catch()` en flux principal. Utiliser `expect` (soft ou hard) pour toute condition d'invariant.

---

**F-B5 · Duplication `safeClick` / `safeFill` entre `BasePage` et `pageHelpers.ts`.** *(P2)*

`BasePage.safeClick` (l.100) et `pageHelpers.safeClick` (l.27) coexistent avec des signatures et des sémantiques légèrement différentes. `BasePage.safeFill` (l.164) et `pageHelpers.safeFill` (l.171) idem. Les pages `CelineProductPage` (qui n'étend PAS BasePage — cf. l.9) utilisent la version pageHelpers.

**Pourquoi.** Deux implémentations qui divergent = deux surfaces à maintenir et un moyen sûr de créer des incohérences (l'une valide via `inputValue()`, l'autre pas, etc.). `CelineProductPage` sort de la hiérarchie sans raison documentée.

**Fix.** Uniformiser : soit tout le monde étend `BasePage` (mon préféré — `CelineProductPage` devrait), soit `pageHelpers` est le canonique et `BasePage` délègue. Ne pas garder les deux.

---

**F-B6 · `await import(...)` dynamique au milieu de méthodes.** *(P2)*

`CelineProductPage.ts:237, 323, 364` et `CheckoutLoginPage.ts:222, 249`, `CheckoutShippingPage.ts:931, 1031` :
```ts
const { closeAllSidePanels } = await import('../../utils/selectorStrategy');
```

**Pourquoi.** L'import statique en haut du fichier fonctionnerait tout aussi bien — `selectorStrategy` est chargé depuis d'autres fichiers de toute façon. L'import dynamique dans un flow chaud fait un `require()` lazy, ajoute une microtask, et n'apporte rien (pas de cycle d'imports à casser — vérifié : `selectorStrategy` n'importe pas `CheckoutShippingPage`).

**Fix.** `import { closeAllSidePanels } from '../../utils/selectorStrategy';` en haut. Le `celine-purchase.spec.ts:19` a d'ailleurs déjà cet import statique et commente « imported at top for speed (no dynamic import per step) » — la bonne pratique existe déjà, il faut la propager.

---

**F-B7 · Signature `options: any` dans les helpers de dialog pickup.** *(P2)*

`CheckoutShippingPage.ts:1375, 1395, 1419, 1452` :
```ts
private async fillPickupTextFields(options: any, dialog: Locator): Promise<void>
```

**Pourquoi.** Le type est déjà défini dans `fillPickupAddressForm()` (l.617-629). Utiliser `any` défait la protection TS et empêche la refactorisation sûre.

**Fix.** Extraire un `interface PickupAddressOptions` et l'utiliser dans les helpers privés.

---

### 3.3 Performance

**F-P1 · Retards fixes cumulés.** *(P1)*

Sur un flow purchase complet, on cumule (relevé exhaustif) : `waitForTimeout(50)` + `(100)` + `(100)` + `(300)` (login) + `(1000)` (JP/NL) + `(300)` + `(500)` + `(600)` + `(300)` (payment) + `(60)` + `(50)` × 5 (dialog pickup)... **≥ 4-5 secondes de sleep pur par test**, sans compter les timeouts de recherche « courtes ». Sur 6 régions × 2 modes = ~1 minute de blocking wait par run E2E complet.

Combiné à F-R1 (34 `waitForTimeout` recensés), **estimation totale : ~10-15 s de sleep par run × 12 tests régionaux = 2-3 minutes gaspillées par CI**.

**Fix.** Cf. F-R1 — chaque suppression d'un `waitForTimeout` remplacé par une attente web-first récupère du temps ET stabilise.

---

**F-P2 · `retries: 2` en CI + mégatest de 500 lignes.** *(P1)*

`playwright.config.ts:34`. Sur un test de ~1-2min (per commentaire spec l:79), 2 retries = **6 minutes wasted** au worst case pour un test flaky. Pour 12 projets régionaux, un jour avec beaucoup de flake fait exploser le budget CI.

**Fix.** Combiné avec F-R6 (splitter le mégatest), les retries deviennent locaux à l'étape qui flake réellement (payment 3DS, add-to-cart) et non plus au tunnel entier.

---

**F-P3 · Sharding CI 4× sans réduction de load per-region.** *(P2)*

`.github/workflows/playwright.yml:17` : `matrix.shard: [1/4, 2/4, 3/4, 4/4]`. Playwright shard répartit les *tests* — mais on n'a qu'un seul test par projet régional. Résultat probable : shard 1 = celine-fr + celine-us, shard 2 = celine-jp + celine-au, etc. Ok en pratique, mais on ne gagne rien si un test dure 3min : le shard qui a la région lente devient le bottleneck.

**Fix.** Après F-R6 (split), le sharding devient utile. En l'état, un `parallelism` basé sur `project` (matrix regional) serait plus lisible qu'un shard.

---

**F-P4 · Contradiction workers CI vs README « single worker only ».** *(P0 pour clarté)*

`playwright.config.ts:35` : `workers: process.env.CI ? 4 : undefined,` — 4 workers en CI.
`README.md:108-135` : « les runs E2E doivent rester sérialisés sur **un seul worker Playwright** ».
`utils/fileLock.ts` : implémente pourtant un verrou inter-processus **fonctionnel** avec tests unitaires.

**Pourquoi.** Soit le lock protège vraiment (auquel cas `workers: 4` est OK et le README est obsolète), soit le lock ne suffit pas (auquel cas `workers: 4` en CI provoque de la corruption silencieuse de `orders.json`). Vu le code de `withFileLock` (`fs.openSync(lockPath, 'wx')` + stale removal + write atomique), **le lock fonctionne** et le README est simplement obsolète.

**Fix.** Mettre à jour le README pour supprimer la section « serial only » ; ou, si des cas edge non couverts par le lock persistent, les documenter. Choisir un discours cohérent.

---

**F-P5 · `page.frames()` iteration + wait 250ms — Cybersource helper.** *(P2)*

`utils/cybersourceHelper.ts:37-45` :
```ts
while (Date.now() - start < timeout) {
  const frame = await this.findFrameContaining(page, '...');
  if (frame) return true;
  await new Promise((r) => setTimeout(r, 250));
}
```

**Pourquoi.** Polling frame-by-frame chaque 250ms sur un timeout de 8s = 32 boucles × O(frames). Sur une page avec 15 iframes (Adyen + Cybersource + GTM), c'est 480 requêtes internes par test. Playwright fournit `page.on('frameattached')` pour ne poller qu'à l'apparition d'une nouvelle frame.

**Fix.** Utiliser `page.waitForResponse(url => /cybersource|flex|microform/.test(url))` (les iframes ont une URL) ou attendre `frameattached`.

---

### 3.4 Sécurité

**F-S1 · `.claude/settings.local.json` committé — MAJOR DATA LEAK.** *(P0 CRITIQUE)*

Fichier : `.claude/settings.local.json` (216 lignes, tracké par git). Contenu :
- Chemins Windows/OneDrive de plusieurs machines de développeurs (`C:\\Users\\herml\\OneDrive - LVMH Fashion Group\\Bureau\\playwright-pom-project\\...`).
- Emails testeurs concrets (`au_buyer1_lotfi@yopmail.com`, `Sarah Williams`, `42 Bridge Street Sydney`).
- URLs produits avec tokens `__previewID` et `__sftkCacheBuster` (l:64-91) — potentiellement des URLs de preview non-publiques du site.
- Références à des dossiers de baseline internes (`playwright-pom-project-prettier-scope3-baseline-20260511-184052`).
- Plus de 200 shell commands historiques, donnant carte à un attaquant le layout complet de l'infra de test LVMH.

**Pourquoi.** `.claude/settings.local.json` est censé être **local** (le suffixe `.local` est explicite). Il ne devrait jamais être versionné. En plus des données sensibles ci-dessus, il expose les habitudes de test et les credentials de sandbox.

**Fix immédiat.**
1. Ajouter `.claude/settings.local.json` (et probablement `.claude/` en entier sauf `settings.json` partagé) au `.gitignore`.
2. `git rm --cached .claude/settings.local.json` puis commit.
3. **Réécrire l'historique git** (`git filter-repo` ou BFG) car le fichier reste dans le passé — surtout si le repo est ou sera public.
4. Rotation des URLs de preview leakées si elles autorisent l'accès à des SKUs non publics.

---

**F-S2 · `%TEMP%install-qwen.bat` committé à la racine.** *(P0)*

Fichier `%TEMP%install-qwen.bat` (10 KB, tracké). C'est un script d'installation Node.js + Qwen Code (LLM tooling) sans rapport avec le projet Playwright.

**Pourquoi.** Fichier accidentellement committé — le nom `%TEMP%` suggère qu'il devait être placé dans le dossier temp Windows. Il pollue l'histoire, potentiellement expose la configuration d'installation d'un outil interne.

**Fix.** `git rm '%TEMP%install-qwen.bat'` et commit. Le déplacer hors du repo.

---

**F-S3 · Credentials sandbox hardcodés dans `testData.ts`.** *(P1)*

`config/testData.ts` :
- L.20-21 : `PAYPAL_CREDENTIALS` avec fallback `celine-marchand-sandbox@gmail.com` / `Celine19!`.
- L.29-30 : `AFTERPAY_AU_CREDENTIALS` avec `sebastien.dejoue+AU@celine.fr` / `Testing!!Celine!`.
- L.144, 198, 259, 290 : `password: 'Test1234!'` pour chaque région.
- L.157, 184, 213, 273, 303 : `cardNumber: '4111111111111111'` (Visa test) répété.

Le code documente que ce sont des sandbox et émet un warning via `getEnvVar(..., isSensitive=true)`. C'est **mieux que rien** mais insuffisant :
- L'email `sebastien.dejoue@celine.fr` est un vrai domaine `celine.fr` — potentiel targeting.
- Un attaquant qui obtient le repo (public ou fuité) a un vecteur immédiat contre le sandbox Céline (pas de rate limit forcément, historique de comportements, etc.).

**Pourquoi.** Un sandbox reste une surface d'attaque : phishing des testeurs, remplissage massif du sandbox pour dénoncer la marque, expérimentations non autorisées. « Sandbox » ne veut pas dire « public ».

**Fix.**
1. Supprimer TOUS les fallback hardcodés — throw explicite si l'env var manque.
2. Utiliser un **secret store** partagé (1Password, Vault, GitHub Secrets, LVMH KMS) pour les creds sandbox.
3. Documenter dans README où lire les creds — pas d'incantation de rotation nécessaire dans le code.

---

**F-S4 · CI workflow — secrets commentés, tests tournent sans credentials.** *(P0)*

`.github/workflows/playwright.yml:37-42` :
```yml
env:
  CI: true
  # Add your environment variables here
  # HTTP_AUTH_USER: ${{ secrets.HTTP_AUTH_USER }}
  # HTTP_AUTH_PASSWORD: ${{ secrets.HTTP_AUTH_PASSWORD }}
  # BASE_URL: ${{ secrets.BASE_URL }}
```

Mais `playwright.config.ts:13-18` **throw** si `HTTP_AUTH_USER`/`HTTP_AUTH_PASSWORD`/`BASE_URL` manquent. La CI actuelle **échoue au boot** de Playwright.

**Pourquoi.** Soit la CI n'a jamais tourné avec ce config, soit elle a toujours échoué en silence (et personne ne s'en occupe). Dans les deux cas, le workflow est cassé.

**Fix.**
1. Décommenter les 3 lignes et configurer les secrets GitHub Actions.
2. Ajouter un job « lint + typecheck + unit » avant `test` qui NE dépend PAS des secrets, pour vérifier que les PRs de refacto passent.
3. Ajouter également les `TEST_EMAIL`, `SMTP_*`, `TEST_PASSWORD_*`, etc. selon les régions activées.

---

**F-S5 · `.env.example` documente des emails réels.** *(P2)*

`.env.example:16-21` :
```
TEST_EMAIL_JP=japan_tva_test1@yopmail.com
TEST_PASSWORD_JP=Test1234!
TEST_EMAIL_NL=nl_customer_lotfi@yopmail.com
TEST_PASSWORD_NL=Test1234!
```

**Pourquoi.** `yopmail.com` est un service jetable — pas de vraie fuite PII, mais on donne à un attaquant un compte cible immédiat. Et le mot de passe `Test1234!` est fourni.

**Fix.** Remplacer par des placeholders : `TEST_EMAIL_JP=<your-jp-test@example.com>`, `TEST_PASSWORD_JP=<see-vault>`.

---

**F-S6 · `outputDir` sous `%TEMP%` — cross-user pollution.** *(P2)*

`playwright.config.ts:26` : `outputDir: path.join(process.env.TEMP || './test-results', 'playwright-results'),`.

**Pourquoi.** Le commentaire dit « avoids OneDrive file locks that block the test runner » — vrai. Mais `%TEMP%` sous Windows est `C:\Users\<user>\AppData\Local\Temp` — spécifique au user courant. Sur un runner CI Linux, `TEMP` n'est souvent pas défini → fallback `./test-results` qui n'est **pas** dans les artefacts uploadés (`playwright.yml:56` upload `test-results/` — qui n'existe pas si `TEMP` était défini). Résultat : sur macOS/Linux, les artefacts sont potentiellement perdus.

**Fix.** Utiliser un path relatif projet en priorité et `os.tmpdir()` en fallback documenté ; ne pas dépendre de la variable `TEMP`.

---

**F-S7 · Dépendances vulnérables (documentées dans SECURITY_NOTES.md).** *(P1)*

19 moderate + 1 critical (`fast-xml-parser` via `@types/nodemailer` → `@aws-sdk/client-sesv2`). SECURITY_NOTES.md explique correctement la surface d'attaque nulle dans notre code — c'est une bonne analyse. Mais :
- 1 critical qui traîne peut bloquer un audit sécu (SBOM automatisé qui ne lit pas les justificatifs manuels).
- Aucune stratégie de « quand upgrade nodemailer 7→8 ».

**Fix.** Planifier l'upgrade nodemailer 8 comme un ticket dédié (le SECURITY_NOTES.md §5 le décrit déjà). Envisager `npm-force-resolutions` pour épingler une version safe de `fast-xml-parser` en `overrides` (déjà en place l:32-34 `fast-xml-parser: 5.7.3` — vérifier qu'elle est bien la version fixée).

---

**F-S8 · `Test-Auto-Celine.code-workspace` pointe hors du repo vers `../OrTrack`.** *(P2)*

`Test-Auto-Celine.code-workspace` (non tracké, mais présent localement) référence `../OrTrack/Test-Auto-Celine` et `../OrTrack`. Pas dans git — mais révèle un layout local particulier qu'un futur contributeur pourrait committer par mégarde.

**Fix.** Le `.gitignore` inclut déjà `*.code-workspace` — bon. Vérifier que aucun contributeur ne fait `git add -A` sans regarder ce qui rentre.

---

### 3.5 Maintenabilité

**F-M1 · Fichiers trop gros.** *(P1)*

- `pages/checkout/CheckoutShippingPage.ts` : **1523 lignes**.
- `pages/checkout/CheckoutPaymentPage.ts` : **851 lignes**.
- `utils/emailReporter.ts` : **630 lignes**.
- `tests/celine-purchase.spec.ts` : **507 lignes** (dont un seul test).

`CheckoutShippingPage` mixe : postal code, shipping method, address form standard, Click & Collect (tab + store + dialog), state selectors, civility, katakana, phone prefix. La classe fait 10 responsabilités.

**Pourquoi.** Un fichier de 1500 lignes n'est pas lisible d'une traite, les changements se marchent dessus en review, la surface de test unitaire est trop large.

**Fix.**
- Extraire `PickupDialogHandler` (tout ce qui est C&C dialog : `getPurchaserDialog`, `selectStateInDialog`, `selectCivilityInDialog`, `fillByLabelInDialog`, `fillPickupTextFields`, `fillKatakanaFields`, `fillPhoneFields`, `ensureFieldsBeforeSubmit`, `submitPickupDialog`).
- Extraire `CivilitySelector` (`_selectCivilityRobust` — utilisé par shipping ET pickup).
- Extraire `AddressFormFiller` (les `fillField` / `fillOptionalField` + `ensureFormVisible` / `tryOpenFormToggle`).

Objectif : `CheckoutShippingPage.ts` < 400 lignes, orchestrant des services.

---

**F-M2 · `TEST_CONFIG.timeouts.short` = 30s vs `TIMEOUTS.short` = 5s (cf. F-B1).** *(P0)*

Duplicate ambiguity, déjà couvert. À traiter en priorité maintenance car source de bugs subtils.

---

**F-M3 · ESLint neutralise plusieurs règles importantes.** *(P1)*

`eslint.config.js:49-55` :
```js
'@typescript-eslint/no-explicit-any': 'off',
'@typescript-eslint/no-empty-object-type': 'off',
'@typescript-eslint/no-require-imports': 'off',
'preserve-caught-error': 'off',
'no-console': 'off',
'no-empty': ['error', { allowEmptyCatch: true }],
'no-useless-escape': 'off',
```

Justification README : « Guard-rail only, NOT a global cleanup pass ». Ok, mais :
- `no-explicit-any` off masque déjà 8 `any` typés (dont `options: any` sur méthodes privées — F-B7).
- `allowEmptyCatch` masque 50+ `catch {}` — le vrai problème (F-R2).
- `no-console` off empêche de repérer les `console.log` de debug qui traînent (spec l:93-100, 138, 141, 189...).

**Pourquoi.** Un ESLint tolérant est utile en migration ; permanent, il devient une accumulation silencieuse de dette.

**Fix.** Renforcer par vagues, avec ratchet : activer `warn` d'abord (mesure), puis `error` avec exceptions ciblées via `// eslint-disable-next-line` documentées.

---

**F-M4 · Documentation en désaccord avec le code (fileLock).** *(P1)*

- `README.md:108-114` dit : « `orders.json` … **ne sont pas durcis pour les écritures concurrentes inter-workers** ».
- `utils/fileLock.ts` implémente un lock inter-processus **fonctionnel** avec test unitaire.
- `utils/orderTracker.ts:132-149` utilise `withFileLock` sur `save`, `clear`, `cleanupOld`.
- `utils/testResultTracker.ts:79-85` utilise `withFileLockSync` sur `record` et `clear`.

**Pourquoi.** Un dev qui lit le README croit devoir sérialiser à `--workers=1`. Le code peut être parallèle. Documentation obsolète = source d'erreurs opérationnelles.

**Fix.** Mettre à jour le README pour refléter que le lock existe et fonctionne. Documenter dans quelles conditions il pourrait échouer (mount partagé sans support de `openSync('wx')` atomique — peu probable en Windows/macOS/Linux courants).

---

**F-M5 · Variables inutilisées (`_buyNowUsed`).** *(P2)*

`celine-purchase.spec.ts:105` : `let _buyNowUsed = false;` set à `true` l:137 mais jamais lu. Vestige.

**Fix.** Supprimer.

---

**F-M6 · `console.log` de production dans le test.** *(P2)*

`celine-purchase.spec.ts` — au moins 20 `console.log('   ...')`. Bien pour debug, mauvais en CI où ça pollue les logs sans structure et sans niveau. Le `logger` custom (`utils/logger.ts`) existe et suppress en CI (l:33 `if (this.isCI) return;`) — pourquoi ne pas l'utiliser ?

**Fix.** Remplacer par `logger.info` / `logger.step` — bénéfice : silencieux en CI, structuré en local, sans `[timestamp]` manuel.

---

**F-M7 · `getProductUrl('NL' as any)` — cast forcé.** *(P2)*

`config/testData.ts:310` :
```ts
productUrl: getProductUrl('NL' as any),
```

Alors que la signature accepte `'FR' | 'JP' | 'AU' | 'TH' | 'NL' | 'US'` (l:83). Le `as any` est là parce que… `'NL'` est déjà accepté. Le cast est inutile — TS l'aurait accepté sans.

**Fix.** Supprimer le `as any`.

---

**F-M8 · Doc décrit « 5 régions » mais code en supporte 6.** *(P2)*

`README.md:1-4` : « multi-régions (FR, US, JP, AU, TH) ». Code : FR, US, JP, AU, TH, **NL**. La région Netherlands (Adyen) a été ajoutée mais pas documentée dans le titre du README.

**Fix.** Renuméroter.

---

**F-M9 · Regex fragile pour extraire la locale d'URL.** *(P2)*

`CelineHomePage.ts:37` :
```ts
const localeMatch = TEST_CONFIG.urls.testProduct.match(/^\/(en-us|fr-fr|it-it|es-es|de-de|ja-jp|zh-cn)\//);
```

Liste hardcodée qui ne matche pas `en-nl` (NL), `en-au`, `en-jp`, `en-th`. Un vrai test NL devrait passer par ce chemin et… fallback silencieux `'en-us'` (l:38).

**Fix.** Regex générique : `/^\/([a-z]{2}-[a-z]{2})\//` — accepte tous les codes ISO.

---

## 4. Plan d'action priorisé

| # | Prio | Effort | Impact | Action |
|---|:---:|:---:|---|---|
| 1 | **P0** | S | Sécurité (fuite données internes) | `git rm --cached .claude/settings.local.json` + `.gitignore`, envisager BFG pour purge historique (F-S1) |
| 2 | **P0** | S | Hygiène | Supprimer `%TEMP%install-qwen.bat` (F-S2) |
| 3 | **P0** | S | Robustesse | Renommer `TEST_CONFIG.timeouts.short/medium/long` pour supprimer collision avec `TIMEOUTS.*` (F-B1, F-M2) |
| 4 | **P0** | M | Robustesse / diag | Désactiver `allowEmptyCatch` + logger dans chaque `catch` swallow (F-R2) |
| 5 | **P0** | S | CI | Décommenter secrets dans `.github/workflows/playwright.yml`, ajouter job « lint+typecheck+unit » sans secrets (F-S4) |
| 6 | **P0** | M | Perf / clarté | Trancher single-worker vs `workers: 4` en CI et aligner README avec le fileLock existant (F-P4, F-M4) |
| 7 | **P1** | M | Fiabilité | Remplacer les 34 `waitForTimeout` par attentes web-first (`expect`, `waitForFunction`, `waitForResponse`) (F-R1, F-P1) |
| 8 | **P1** | L | Fiabilité | Diminuer les cascades de fallback à 2 max par sélecteur ; instrumenter la branche prise (F-R3) |
| 9 | **P1** | S | Fiabilité | Extraction du numéro de commande via `SELECTORS.CHECKOUT.CONFIRMATION.ORDER_NUMBER`, pas via `document.body.textContent` (F-R5) |
| 10 | **P1** | L | Fiabilité / vitesse | Splitter `celine-purchase.spec.ts` en 4-5 specs ciblés (product, login, shipping, payment, confirmation) (F-R6, F-P2) |
| 11 | **P1** | M | Vitesse | `storageState` par région, généré par `global-setup` (F-B3) |
| 12 | **P1** | M | Maintenabilité | Extraire `PickupDialogHandler` + `CivilitySelector` + `AddressFormFiller` de `CheckoutShippingPage.ts` (F-M1) |
| 13 | **P1** | S | Sécurité | Supprimer fallback hardcodés dans `testData.ts` — throw si env absent (F-S3) |
| 14 | **P1** | M | Maintenabilité | Renforcer ESLint : `no-explicit-any: warn`, `no-console: warn`, `no-empty` strict avec exceptions ponctuelles (F-M3) |
| 15 | **P1** | S | Sécurité | Planifier ticket upgrade `nodemailer 7 → 8`, valider `fast-xml-parser` override (F-S7) |
| 16 | **P2** | S | Maintenabilité | Merger `BasePage.safeClick/Fill` et `pageHelpers.safeClick/Fill` en une seule implémentation (F-B5) |
| 17 | **P2** | S | Maintenabilité | Remplacer `await import(...)` dynamiques par imports statiques (F-B6) |
| 18 | **P2** | S | Maintenabilité | Typer `options` correctement dans dialog pickup, supprimer `any` (F-B7) |
| 19 | **P2** | S | Maintenabilité | Renommer `waitForNetworkIdle` en `waitForDomLoaded`, fusionner avec `waitForDomContent` (F-R7) |
| 20 | **P2** | S | Perf | Cybersource : `page.waitForResponse` ou `frameattached` au lieu de poll 250ms (F-P5) |
| 21 | **P2** | S | Sécurité | `.env.example` avec placeholders au lieu de vrais Yopmail (F-S5) |
| 22 | **P2** | S | Perf | `outputDir` robuste cross-OS via `os.tmpdir()` (F-S6) |
| 23 | **P2** | S | Maintenabilité | Nettoyage : `_buyNowUsed`, `as any`, regex locale hardcodée (F-M5, F-M7, F-M9) |
| 24 | **P2** | S | Maintenabilité | Remplacer `console.log` du spec par `logger.*` (F-M6) |
| 25 | **P2** | S | Doc | Corriger README (5 → 6 régions, section serial-only obsolète) (F-M8) |

Tri par ratio impact/effort : les P0 S sont les premiers gains à prendre immédiatement (secrets, hygiène, collision de noms).

---

## 5. Quick wins (< 1h chacun)

1. **Purge du repo** (F-S1, F-S2) : `git rm --cached .claude/settings.local.json '%TEMP%install-qwen.bat'` + ajout au `.gitignore`. ~10min. Impact : arrête l'accumulation de données internes. NB : la purge historique via BFG / `git filter-repo` est un chantier séparé si le repo est déjà publié.
2. **Corriger la collision `TIMEOUTS.short` / `TEST_CONFIG.timeouts.short`** (F-B1) : renommer les champs de `TEST_CONFIG.timeouts` en `testTimeout`, `elementTimeout`, `navigationTimeout` (ou supprimer les redondants avec `TIMEOUTS`). ~30min. Impact : élimine une source de bugs invisibles.
3. **Fix regex locale** (F-M9) : `CelineHomePage.ts:37` → `/^\/([a-z]{2}-[a-z]{2})\//`. ~5min. Impact : débloque NL / AU / TH / JP silencieusement mal servis en `en-us`.
4. **Décommenter secrets CI + ajouter job non-secret** (F-S4) : ~30min si les secrets GitHub sont déjà provisionnés. Impact : la CI a la moindre chance de tourner.
5. **Nettoyage `console.log` du spec → `logger.*`** (F-M6) : ~40min de remplacements ciblés. Impact : logs CI structurés, silencieux en headless.

---

*Revue produite en lecture seule. Aucun fichier applicatif modifié.*
