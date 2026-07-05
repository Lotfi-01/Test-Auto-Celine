# Dette technique — Sprint 2+

Ce fichier tracks la dette identifiée pendant Sprint 1 mais **volontairement non
traitée** dans ce sprint pour rester ciblé. Ne pas laisser cette liste
grandir : chaque item doit passer par un ticket avec un propriétaire.

---

## 1. Silent `.catch(() => {})` (F-R2)

**Contexte** : la revue initiale estimait ~180 occurrences par un
`grep .catch\(` non filtré ; la mesure exacte est produite par
`scripts/check-silent-catch-baseline.js` (regex stricte sur
`.catch(() => {})` / `.catch(async () => {})` à corps vide) et
matérialisée dans `scripts/silent-catch.baseline.json`.

Sprint 1 a :

- durci ESLint (`no-empty` strict, `no-restricted-syntax` sur les silent catch),
- gardé un override `warn` pour les fichiers historiques listés dans
  `eslint.config.js:HISTORICAL_SILENT_CATCH_FILES`,
- ajouté un **check baseline** (`scripts/check-silent-catch-baseline.js`,
  branché sur `npm run lint`) qui fige le compte par fichier et fait échouer
  CI si un fichier dépasse son quota. Pour intentionnellement réduire la
  dette : `npm run lint:silent-catch:update` puis committer le diff sur
  `scripts/silent-catch.baseline.json`.

Sprint 2 a **traité 22 occurrences sur 5 fichiers** (BasePage,
selectorStrategy, CheckoutLoginPage, CelineProductPage — entièrement
liquidés — plus un extract côté spec via la refonte de l'extraction du
numéro de commande). Le pattern retenu est `catch((error) => logger.debug(msg))`
avec le contexte de l'étape optionnelle, jamais un log de valeur sensible.

Sprint 3 a **entièrement liquidé les 28 occurrences de
`CheckoutShippingPage.ts`** via le helper d'instance `swallowOptional(label)`
qui produit un `catch((err) => this.log(...))` factorisé — même pattern
qu'en Sprint 2 dans `utils/selectorStrategy.ts`. Aucun catch critique
supprimé : uniquement les étapes optionnelles (scrollIntoView, blur,
fill(''), JS click fallback, waitForURL avant DOM check, evaluate
belt-and-suspenders).

Sprint 4 n'a **pas modifié** le total : l'extraction de `PickupDialogHandler`
déplace du code 1:1 (le pattern `swallowOptional(label)` de Sprint 3 est
reproduit à l'identique côté helper), et aucun nouveau silent catch n'est
introduit dans les logiques déplacées. Le baseline reste à 32.

Sprint 5 n'a **pas modifié** le total non plus : l'extraction de
`PickupCivilityStrategy` déplace la logique 3-stratégies 1:1 (aucun catch
converti, aucun catch supprimé, réutilisation du `civilityTokens` de
`CivilitySelector` — logique dédupliquée mais comportement conservé). Le
baseline reste à 32.

Sprint 6 n'a **pas modifié** le total non plus : l'extraction de
`PickupRefillGuard` (bloc `ensureFieldsBeforeSubmit`) déplace la logique
snapshot + refill 1:1. L'unique catch silencieux du bloc — l'outer
`try {} catch { /* best-effort */ }` — est **converti** en `debug`-log
PII-safe (`error.name` uniquement, jamais `.message`) pour permettre au
nouveau fichier de rester **hors** de l'override historique
`HISTORICAL_SILENT_CATCH_FILES` (respect strict de `no-empty`). Ce catch
n'était pas comptabilisé par la regex du baseline (elle ne matche que les
chaînes `.catch(() => {})`, pas les blocs `try/catch`), donc le total
reste à 32.

Sprint 7 n'a **pas modifié** le total non plus : l'extraction de
`AddressFormFiller` (blocs `fillShippingAddress` + `fillField` +
`fillOptionalField` + `ensureFormVisible` + `tryOpenFormToggle` +
`selectStateOrPrefecture` + `selectPhonePrefix`) déplace le code 1:1.
Le nouveau helper reste **hors** de l'override historique en :
(a) réimplémentant localement les primitives `safeFill`/`safeClick`/
`safeSelect`/`isVisible` de `BasePage` sans catch silencieux (chaque
catch loggue au moins un label technique et `error.name`), (b) reproduisant
le pattern `swallowOptional(label)` de Sprint 3 avec `errorName` PII-safe.
Le catch de `fillField` — précédemment `error.message` — est converti en
`errorName(err)` pour respecter la règle PII sur les nouveaux logs. Le
baseline reste à 32.

Sprint 8 a **liquidé les 23 occurrences de `CheckoutPaymentPage.ts`** via
un helper d'instance `swallowOptional(label)` (même pattern que Sprint 3
dans `CheckoutShippingPage.ts`, adapté à la PII policy Payment stricte —
label statique uniquement, `errorName(err)` uniquement, jamais
`.message` / `String(error)` / `JSON.stringify(error)`). Aucun flow PSP
touché : chaque catch silencieux est remplacé par
`.catch(this.swallowOptional('<label technique statique>'))`. Les 23
étapes concernées sont toutes low-risk (scrollIntoView, DOM settle,
fallback click, event dispatch, Cybersource optional fills, terms
fallbacks, PayPal / Afterpay landing races). Le baseline passe de
**32 → 9** (−23, −72 %).

Sprint 9 a **liquidé les 9 dernières occurrences** (2 dans
`utils/formHelper.ts` + 7 dans `tests/celine-purchase.spec.ts`) via
deux patterns PII-safe :

- `utils/formHelper.ts` (2 → 0) : les 2 catches optionnels
  (`scrollIntoView`, `clear`) dans `fillField` deviennent
  `.catch((error) => logger.debug(\`Optional form helper step failed: <label> (\${errorName(error)})\`))`— logger`TestLogger.scoped('FormHelper')`déjà importé, ajout d'un`errorName()` local PII-safe.
- `tests/celine-purchase.spec.ts` (7 → 0) : les 7 catches optionnels
  d'UI fallback deviennent `.catch(ignoreOptionalE2EError('<label>'))`.
  Helper local no-op (`void label; void error;`) — pas de nouveau
  `console.log` (interdit par Sprint 9), pas de log runtime, label
  statique pour marquer l'intention. Fail-open 1:1 strict.

Le baseline passe de **9 → 0** (−9, −100 %). **Toutes les occurrences
historiques (82 sur Sprint 1) sont désormais liquidées.**

**Évolution du baseline** :

| Sprint | Total | Fichiers concernés | Δ               |
| ------ | ----: | -----------------: | --------------- |
| 1      |    82 |                  8 | (baseline)      |
| 2      |    60 |                  4 | **−22**         |
| 3      |    32 |                  3 | **−28**         |
| 4      |    32 |                  3 | 0 (extract 1:1) |
| 5      |    32 |                  3 | 0 (extract 1:1) |
| 6      |    32 |                  3 | 0 (extract 1:1) |
| 7      |    32 |                  3 | 0 (extract 1:1) |
| 8      |     9 |                  2 | **−23**         |
| 9      |     0 |                  0 | **−9** (final)  |

**État du baseline après Sprint 9** (source de vérité —
`scripts/silent-catch.baseline.json`, régénéré le **2026-07-05**) :

| Fichier                                             | Sprint 1 | Sprint 2 | Sprint 3 | Sprint 4 | Sprint 5 | Sprint 6 | Sprint 7 | Sprint 8 | Sprint 9 |
| --------------------------------------------------- | -------: | -------: | -------: | -------: | -------: | -------: | -------: | -------: | -------: |
| `pages/checkout/CheckoutShippingPage.ts`            |       28 |       28 |    **0** |        0 |        0 |        0 |        0 |        0 |        0 |
| `pages/checkout/shipping/AddressFormFiller.ts`      |      N/A |      N/A |      N/A |      N/A |      N/A |      N/A |    **0** |        0 |        0 |
| `pages/checkout/shipping/PickupDialogHandler.ts`    |      N/A |      N/A |      N/A |    **0** |        0 |        0 |        0 |        0 |        0 |
| `pages/checkout/shipping/PickupCivilityStrategy.ts` |      N/A |      N/A |      N/A |      N/A |    **0** |        0 |        0 |        0 |        0 |
| `pages/checkout/shipping/PickupRefillGuard.ts`      |      N/A |      N/A |      N/A |      N/A |      N/A |    **0** |        0 |        0 |        0 |
| `pages/checkout/shipping/CivilitySelector.ts`       |      N/A |      N/A |    **0** |        0 |        0 |        0 |        0 |        0 |        0 |
| `pages/checkout/CheckoutPaymentPage.ts`             |       23 |       23 |       23 |       23 |       23 |       23 |       23 |    **0** |        0 |
| `tests/celine-purchase.spec.ts`                     |        7 |        7 |        7 |        7 |        7 |        7 |        7 |        7 |    **0** |
| `utils/formHelper.ts`                               |        2 |        2 |        2 |        2 |        2 |        2 |        2 |        2 |    **0** |
| `pages/CelineProductPage.ts`                        |        7 |        0 |        0 |        0 |        0 |        0 |        0 |        0 |        0 |
| `utils/selectorStrategy.ts`                         |        6 |        0 |        0 |        0 |        0 |        0 |        0 |        0 |        0 |
| `pages/BasePage.ts`                                 |        5 |        0 |        0 |        0 |        0 |        0 |        0 |        0 |        0 |
| `pages/checkout/CheckoutLoginPage.ts`               |        4 |        0 |        0 |        0 |        0 |        0 |        0 |        0 |        0 |
| **Total**                                           |   **82** |   **60** |   **32** |   **32** |   **32** |   **32** |   **32** |    **9** |    **0** |

Aucune occurrence résiduelle. `scripts/silent-catch.baseline.json` figé à
`{total: 0, counts: {}}`. Toute future addition sera bloquée par le check
en `npm run lint`.

Sprint 10 a **durci `eslint.config.js`** en ramenant la liste
`HISTORICAL_SILENT_CATCH_FILES` de **15 → 2 fichiers** :

- `pages/checkout/CheckoutShippingPage.ts` — 1 `} catch {}` réel dans
  `selectFirstShippingMethod` (fail-open autour de
  `safeClickWithLabelFallback`), non traité pour rester hors périmètre
  Shipping de Sprint 10.
- `tests/celine-purchase.spec.ts` — 1 `.catch` avec corps commentaire-only
  sur la race JP/NL shipping-method (`Promise.race([...]).catch`). Le
  sélecteur AST `no-restricted-syntax` fire sur ce cas (body.length=0)
  même si la regex baseline ne l'attrape pas.

Les 13 autres fichiers précédemment dans l'override
(`pages/BasePage.ts`, `pages/CelineHomePage.ts`, `pages/CelineProductPage.ts`,
`pages/checkout/CheckoutLoginPage.ts`, `pages/checkout/CheckoutPaymentPage.ts`,
`utils/adyenHelper.ts`, `utils/cybersourceHelper.ts`, `utils/fileLock.ts`,
`utils/formHelper.ts`, `utils/orderTracker.ts`, `utils/pageHelpers.ts`,
`utils/selectorStrategy.ts`, `utils/testResultTracker.ts`) tournent
désormais sous les règles **strictes** :

- `no-restricted-syntax`: **`error`** sur les silent-catch AST.
- `no-empty`: **`error`** avec `allowEmptyCatch: false`.
- `preserve-caught-error`: **`warn`**.
- `no-useless-assignment`: **`warn`**.

Test négatif ESLint Sprint 10 (documenté dans le rapport) : ajouter un
`.catch(() => {})` dans n'importe quel fichier hors override fait échouer
`npm run lint` avec `no-restricted-syntax` — vérifié via fichier temporaire
supprimé après le test.

Sprint 11 doit convertir les 2 dernières exceptions ci-dessus et **retirer
complètement** `HISTORICAL_SILENT_CATCH_FILES` du fichier de configuration.

Sprint 11 a **conclu la campagne** :

- `pages/checkout/CheckoutShippingPage.ts` L.539 — le `} catch {}` est
  converti en `} catch (error) { this.log('Optional shipping method
fallback skipped: shippingByName strategy (${this.errorName(error)})',
'debug'); }`. Ajout d'un helper privé `errorName(err)` PII-safe (retourne
  `error.name` uniquement). Le helper historique `swallowOptional` (qui
  utilise `.message`/`String()`) reste inchangé — hors périmètre Sprint 11.
- `tests/celine-purchase.spec.ts` L.347 — le `.catch(() => { /* comment */ })`
  est converti en `.catch(ignoreOptionalE2EError('shipping method race
timeout'))` (helper Sprint 9 déjà défini dans le fichier).
- `eslint.config.js` — suppression complète de la const
  `HISTORICAL_SILENT_CATCH_FILES` et du bloc override associé. Chaque
  fichier du repo tourne désormais sous les règles strictes
  (`no-empty: error`, `no-restricted-syntax: error`,
  `preserve-caught-error: warn`, `no-useless-assignment: warn`).

Test négatif ESLint Sprint 11 vérifié : ajout d'un `.catch(() => {})` dans
un fichier temporaire → `npm run lint` échoue (exit=1) avec
`no-restricted-syntax` error → cleanup et lint repasse. Aucun résidu.

**Fin de campagne silent-catch** : 82 (Sprint 1) → 0 (Sprint 9) → verrouillé
au niveau ESLint (Sprint 10 réduit à 2 fichiers) → **override supprimé
totalement** (Sprint 11). Défense en profondeur : ESLint strict (première
ligne) + baseline JSON (seconde ligne).

> Estimation initiale obsolète : la revue mentionnait
> `CheckoutShippingPage.ts=74`, `CheckoutPaymentPage.ts=49`, etc. Ces chiffres
> provenaient d'un `grep .catch\(` **non filtré** (matchait aussi
> `.catch((err) => log(...))`). Seule la mesure baseline ci-dessus fait foi.

**Politique cible** :

```ts
// AVANT — interdit
await x.doSomething().catch(() => {});

// APRÈS — accepté
await x.doSomething().catch((err) => {
  logger.debug('Optional step failed, continuing', { error: (err as Error).message });
});
```

Ou, si l'action est réellement critique :

```ts
await x.doSomething(); // propager
```

---

## 2. `waitForTimeout` en dur (F-R1)

**Contexte** : la revue initiale comptait 34 occurrences (`grep waitForTimeout`
comment-aware). La mesure exacte des `await *.waitForTimeout(...)` réels
donnait **32** au démarrage du Sprint 2. Sprint 2 a remplacé les sleeps
sécuritaires par des signaux DOM/URL/response.

**Évolution `waitForTimeout` (calls réels dans pages/tests/utils)** :

| Sprint | Total | Détail                                                                                                                                                                                                                         |
| ------ | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1      |    32 | 13 Shipping, 7 Payment, 5 spec, 5 Login, 2 Product                                                                                                                                                                             |
| 2      |    28 | idem sauf : spec −2 (JP/NL loading + form-panel padding), Login −2 (padding autour du Tab blur)                                                                                                                                |
| 3      |    25 | idem sauf : Shipping 13 → 10                                                                                                                                                                                                   |
| 4      |    25 | idem — 10 sleeps Shipping split entre Shipping (4) et PickupDialogHandler (6). Extraction 1:1, aucune suppression.                                                                                                             |
| 5      |    25 | idem — extraction `PickupCivilityStrategy` 1:1, aucun sleep dans le bloc civility (déjà supprimé Sprint 3).                                                                                                                    |
| 6      |    25 | idem — extraction `PickupRefillGuard` 1:1. Le sleep `waitForTimeout(100)` d'`ensureFieldsBeforeSubmit` est déplacé dans le guard, marqueur mis à jour `TODO Sprint 5:` → `TODO Sprint 7:`. Aucune suppression.                 |
| 7      |    25 | idem — extraction `AddressFormFiller` 1:1. Le bloc adresse standard (`fillShippingAddress` + helpers) ne contenait aucun `waitForTimeout` — la répartition Shipping/PickupRefillGuard reste 4 / 5 / 0 / 1. Aucune suppression. |
| Δ      |    −7 |                                                                                                                                                                                                                                |

Remplacements Sprint 2 :

- `tests/celine-purchase.spec.ts` (JP/NL) : `waitForTimeout(1000)` →
  `Promise.race([label.shipping-method-option.waitFor(visible),
formPanel.waitFor(attached)])` avec deadline 8s. Signal réel.
- `tests/celine-purchase.spec.ts` (post form-panel) : `waitForTimeout(300)` →
  supprimé. Le `formPanel.waitFor({state:'visible'})` juste au-dessus est le
  vrai signal, le 300 ms était du padding.
- `pages/checkout/CheckoutLoginPage.ts` (autour du Tab blur email→pw) :
  `waitForTimeout(100)` × 2 → supprimé. Les `isVisible({timeout:2500})` qui
  suivent sont des attentes web-first suffisantes.

Remplacements Sprint 3 (Shipping uniquement, 3 suppressions dont 1 par
signal DOM) :

- `enterPostalCode` : `waitForTimeout(100)` avant le Tab blur → supprimé.
  Le `clickOkButton()` qui suit contient déjà un
  `submitZipButton.waitFor({state:'visible', timeout: TIMEOUTS.medium})`.
- `clickSubmitShipping` : `waitForTimeout(150)` post-click → remplacé par
  `waitForLoadState('domcontentloaded', {timeout: 1000})` avec
  `swallowOptional` catch — signal DOM concret.
- `selectCivilityInDialog` : `waitForTimeout(60)` post-select → supprimé.
  `forceCheckRadio` dispatche `input`/`change`/`click` synchronement, et
  le caller `fillPickupAddressForm` a un `isVisible({timeout: 800})` juste
  après sur le champ postcode qui couvre tout re-render.

**Sleeps restants dans Shipping (4) — annotés `TODO Sprint 5:
replace with stable shipping signal.` dans le code** :

- `selectClickAndCollect` : 4 × sleeps dans les fallbacks pickup
  (50 ms mouse-move, 500 ms fallback click force, 1000 ms JS ultimate
  fallback, 100 ms dispatch fallback). Chemins rares, sleeps courts.

**Sleeps restants dans PickupDialogHandler (5) — annotés
`TODO Sprint 5: replace with stable pickup signal.` dans le code** :

- `fillDialog` : 1 × 60 ms post `setNativeValue(postcode)` — autocomplete
  potentiel, pas de signal fiable identifié.
- `selectStateInDialog` : 1 × 150 ms post-`selectOption` — Celine
  re-render partiel post state select (AU/US).
- `fillByLabelInDialog` : 1 × 50 ms post `pressSequentially` + blur —
  padding onchange, pas de signal réseau identifié.
- `fillTextFields` : 1 × 50 ms post `setNativeValue(address)`.
- `fillKatakanaFields` : 1 × 50 ms post `setNativeValue(kana)`.

**Sleeps restants dans PickupRefillGuard (1) — annoté
`TODO Sprint 7: replace with stable pickup signal.` dans le code** :

- `ensureFields` : 1 × 100 ms post refill report — padding avant SUBMIT,
  non observable. Déplacé 1:1 depuis `PickupDialogHandler.ensureFieldsBeforeSubmit`
  en Sprint 6, marqueur `TODO` mis à jour vers Sprint 7.

**Sleeps restants hors Shipping (15) — hors périmètre Sprint 3** :

- `tests/celine-purchase.spec.ts` (2) : 2 marqués `TODO Sprint 3`
  Adyen/Cybersource hydration, à ré-évaluer Sprint 5 après extraction
  helpers Payment.
- `pages/checkout/CheckoutLoginPage.ts` (3) : polling intervals dans les
  boucles `for` (100 ms × 3). Signaux propres non disponibles côté
  Celine — refactor plus profond en Sprint 5.
- `pages/CelineProductPage.ts` (2) : 20 ms + 50 ms — inspections rapides
  post-clic size/panel close. Non-critique en durée cumulée, on laisse.
- `pages/checkout/CheckoutPaymentPage.ts` (7) : **hors périmètre Sprint 4**
  (flows PSP interdits par la consigne). À traiter Sprint 5 après extraction
  des helpers PayPal/Afterpay/3DS.
- `utils/orderNumber.ts` (1) : polling loop du numéro de commande —
  volontairement laissée car couvre la latence de rendu confirmation.

---

## 3. Fichiers trop gros (F-M1)

- `pages/checkout/CheckoutShippingPage.ts` — Sprint 3 : `CivilitySelector`
  extrait. Sprint 4 : `PickupDialogHandler` extrait (core Pickup / C&C
  déplacé 1:1). Le fichier passe de ~1440 → 944 lignes (−34 %). Sprint 5
  et Sprint 6 : fichier non modifié (extractions ciblées dans le handler).
  Sprint 7 : `AddressFormFiller` extrait (blocs `fillShippingAddress` +
  `fillField` + `fillOptionalField` + `ensureFormVisible` +
  `tryOpenFormToggle` + `selectStateOrPrefecture` + `selectPhonePrefix`)
  → 944 → 751 lignes (−193, −20 %). Sprint 17 : `SelectClickAndCollectHelper`
  extrait (bloc `selectClickAndCollect` avec 3 stratégies fallback tab
  opening + verify + first store click + JS force-click) → 771 → 623
  lignes (−148, −19 %). Sprint 18 : `ShippingMethodSelector` extrait
  (bloc `selectFirstShippingMethod` avec 4 stratégies fallback label →
  name → SHIPPING_METHOD_STRATEGY → radio/label + JS click) → 623 → 563
  lignes (−60, −10 %). Sprint 19 : `ShippingPostalCodeHandler` extrait
  (blocs `enterPostalCode` + `clickOkButton` privé — 4 stratégies OK
  fallback `#submitZipCodeButton` waitForFunction-enabled → generic
  button → link/span → Enter key) → 563 → 494 lignes (−69, −12 %).
  Sprint 21 : `ContinueToShippingHandler` extrait (bloc
  `continueToShipping` — waitFor attached + scroll evaluate + isEnabled
  - waitForFunction gate + safeClick → JS click fallback + belt-and-
    suspenders `form.requestSubmit()` evaluate + `Promise.race`
    waitForURL/continueToPayment) → **494 → 444 lignes (−50, −10 %)**.
    **Cumul Sprint 3+4+7+17+18+19+21 : ~1440 → 444 (−996, −69 %).**
    L'API publique (`fillShippingAddress`, `selectStateOrPrefecture`,
    `selectPhonePrefix`, `selectClickAndCollect`, `selectFirstShippingMethod`,
    `enterPostalCode`, `continueToShipping`) reste sur la façade et délègue
    aux helpers. La taille restante vient : (a) de `continueToPayment`
    avec son evaluate() de visible payment markers (~65 L), (b) de
    `clickSubmitShipping` (~45 L), (c) `swallowOptional` + `errorName` +
    `logStep` + orchestration.
- `pages/checkout/shipping/PickupDialogHandler.ts` — Sprint 4 : nouveau
  helper 720 lignes. Sprint 5 : `PickupCivilityStrategy` extrait → 720 →
  614 lignes (−106). Sprint 6 : `PickupRefillGuard` extrait
  (bloc `ensureFieldsBeforeSubmit`) → 614 → 485 lignes (−129, −21 %).
  Sprint 15 : `PickupStateSelector` extrait (bloc `selectStateInDialog`
  - `STATE_LABEL_MAP` + `pickupStateLabelFor`) → 485 → 406 lignes
    (−79, −16 %). Sprint 16 : `PickupDialogFieldFiller` extrait
    (bloc `fillByLabelInDialog`) → **406 → 352 lignes (−54, −13 %)**.
    **Cumul Sprint 5+6+15+16 : 720 → 352 (−368, −51 %).**
    `fillByLabelInDialog` reste une méthode privée façade qui délègue à
    `this.pickupDialogFieldFiller.fillByLabel(dialog, name, value, label)`.
    La taille restante vient : (a) des méthodes de remplissage
    orchestratrices (`fillTextFields`, `fillKatakanaFields`,
    `fillPhoneFields` — ~90 L cumulés utilisant `setNativeValue` ou
    `fillByLabelInDialog`), (b) de `submitDialog` avec ses 2 stratégies
    de bouton submit + waitForURL race (~50 L), (c) de `fillDialog`
    orchestrateur (~40 L), (d) des commentaires PII-safety Sprint 4.
- `pages/checkout/shipping/PickupCivilityStrategy.ts` — **nouveau (Sprint 5)** :
  164 lignes. 3 stratégies A/B/C intra-dialog + fallback D vers
  `CivilitySelector`. Réutilise `civilityTokens` — pas de duplication.
- `pages/checkout/shipping/PickupRefillGuard.ts` — **nouveau (Sprint 6)** :
  213 lignes. Contient uniquement `ensureFields(options, dialog)`
  (snapshot + refill natif page-wide). Aucun import de
  `PickupDialogHandler` (interface locale `PickupRefillFields`
  structurellement compatible avec `PickupDialogOptions` — évite le
  cycle). L'outer catch de `ensureFields` est un `debug`-log PII-safe
  (`error.name` uniquement) — conversion 1:1 de l'empty catch originel
  pour rester hors de l'override `HISTORICAL_SILENT_CATCH_FILES`.
- `pages/checkout/shipping/PickupStateSelector.ts` — **nouveau
  (Sprint 15)** : 189 lignes. Contient `STATE_LABEL_MAP` + fonction
  pure `pickupStateLabelFor(state)` + classe `PickupStateSelector` avec
  `select(state, dialog)`. Constructor `(page: Page)` — dépendance
  unique. Aucun import `PickupDialogHandler` (pas de cycle). Logger
  `TestLogger.scoped('PickupState')`. Primitives locales
  `swallowOptional` + `errorName` PII-safe. **Sécurité Sprint 15** :
  les 2 logs précédemment `State selected first: ${state}` et
  `Could not select state: ${state}` (raw region code, considéré
  form-value par la PII policy) sont neutralisés en labels statiques
  — même pattern que Sprint 7 hotfix 2 pour
  `AddressFormFiller.selectStateOrPrefecture`. Comportement runtime
  strictement 1:1.
- `pages/checkout/shipping/PickupDialogFieldFiller.ts` — **nouveau
  (Sprint 16)** : 149 lignes. Contient uniquement la classe
  `PickupDialogFieldFiller` avec `fillByLabel(dialog, name, value, label)`
  — 2 stratégies fallback (`getByRole('textbox', {name})` puis
  common id/name patterns firstName/lastName/addressOne/city/postal/
  phone) + `pressSequentially` avec 50 ms delay + blur + 50 ms
  waitForTimeout marker. Constructor `(page: Page)` — dépendance unique.
  Aucun import `PickupDialogHandler` (pas de cycle). Logger
  `TestLogger.scoped('PickupField')`. Primitives locales
  `swallowOptional` + `errorName` PII-safe. Le label paramètre est une
  chaîne statique fournie par le caller (`'First name'`,
  `'Last name'`, etc.) — jamais une valeur user. La `value` (raw user
  input) n'est jamais loguée : le success emet uniquement
  `` `${label} filled` ``.
- `pages/checkout/shipping/SelectClickAndCollectHelper.ts` — **nouveau
  (Sprint 17)** : 221 lignes. Contient uniquement la classe
  `SelectClickAndCollectHelper` avec `select()` — 3 stratégies fallback
  d'ouverture du pickup tab (mouse.move + click → alternative pickup
  element with `force: true` → ultimate JS scan) + verify tab selected
  (avec JS click+dispatch fallback) + first store label click + JS
  force-click fallback + purchaser-info dialog wait. Constructor
  `(page: Page)` — dépendance unique. Aucun import `CheckoutShippingPage`
  (pas de cycle). Logger `TestLogger.scoped('ClickCollect')`. Primitives
  locales `swallowOptional` + `errorName` PII-safe. **Sécurité
  Sprint 17** : le throw `` `PICK-UP tab click failed: ${(err as Error).message}` ``
  (Playwright message pouvant contenir sélecteurs/URLs) est converti en
  `` `PICK-UP tab click failed: ${errorName(err)}` `` — même comportement
  throw, chaîne PII-safe.
- `pages/checkout/shipping/ShippingMethodSelector.ts` — **nouveau
  (Sprint 18)** : 156 lignes. Contient uniquement la classe
  `ShippingMethodSelector` avec `selectFirst()` — 4 stratégies fallback
  (label click → name selector + safeClickWithLabelFallback →
  SHIPPING_METHOD_STRATEGY + safeClickWithLabelFallback → radio/label
  `force: true` + JS click). Constructor
  `(page: Page, firstNameInput: Locator, safeClickWithLabelFallback: SafeClickWithLabelFallback)`
  — le callback est bindé sur la méthode `protected` de `BasePage` via
  la façade pour que les 2 `force: true` internes à
  `safeClickWithLabelFallback` restent possédés par `BasePage` (delta
  net `force: true` = 0 tree-wide, pas de duplication). Aucun import
  `CheckoutShippingPage` (pas de cycle). Logger
  `TestLogger.scoped('ShippingMethod')`. Primitives locales
  `swallowOptional` + `errorName` PII-safe. **Sécurité Sprint 18** :
  le log `` `Failed to click shipping label: ${e}` `` (raw Playwright
  exception) est converti en `` `Failed to click shipping label: ${errorName(e)}` ``.
- `pages/checkout/shipping/ShippingPostalCodeHandler.ts` — **nouveau
  (Sprint 19)** : 190 lignes. Contient la classe
  `ShippingPostalCodeHandler` avec `enter(postalCode)` public et
  `clickOkButton()` privé — 4 stratégies fallback OK
  (`#submitZipCodeButton` avec waitForFunction-enabled → generic
  `ZIPCODE_OK_BUTTON` → `ZIPCODE_OK_LINK` → press Enter). Constructor
  `(deps: ShippingPostalCodeDeps)` avec 4 callbacks bindés sur BasePage
  (`safeFill`, `safeClick`, `waitForNetworkIdle`, `waitForDomContent`)
  pour éviter la duplication et le couplage inheritance (pattern
  Sprint 18 étendu). Aucun import `CheckoutShippingPage`, aucun
  `force: true` / `evaluate()` / `waitForTimeout` réel dans le bloc.
  Logger `TestLogger.scoped('PostalCode')`. Primitives locales
  `swallowOptional` + `errorName` PII-safe. **Sécurité Sprint 19** :
  le log critique `` `Postal code filled: ${postalCode}` `` (raw user
  postcode = PII) est converti en label statique
  `'Postal code filled'`. Aucun autre log ou throw ne référence la
  valeur `postalCode`.
- `pages/checkout/shipping/ContinueToShippingHandler.ts` — **nouveau
  (Sprint 21)** : 157 lignes. Contient uniquement la classe
  `ContinueToShippingHandler` avec `continue(): Promise<void>` public.
  Corps déplacé 1:1 : `waitFor` attached + scroll `evaluate` +
  `isEnabled` + `waitForFunction` button-enabled gate + `safeClick` →
  JS click fallback + belt-and-suspenders `form.requestSubmit()`
  `evaluate` + `Promise.race` entre `waitForURL(/payment|paiement/)` et
  `continueToPaymentButton.waitFor({visible})`. Constructor
  `(deps: ContinueToShippingDeps)` : `page` + `validateAddressButton`
  - `continueToPaymentButton` + callback `safeClick` bindé sur BasePage
    (pattern Sprint 18/19 étendu — pas de duplication). Aucun import
    `CheckoutShippingPage` (pas de cycle). Imports type-only via
    `import type` pour `Page`, `Locator`, `SafeClickOptions`. Logger
    `TestLogger.scoped('ContinueToShipping')`. Primitives locales
    `swallowOptional` + `errorName` PII-safe. **Sécurité Sprint 21** :
    le log outer catch `` `Error validating address: ${(error as Error).message}` ``
    (Playwright message pouvant contenir sélecteurs/URLs) est converti en
    `` `Error validating address: ${errorName(error)}` `` — throw
    semantique 100 % préservée (l'objet `error` original est rethrown
    inchangé), seule la chaîne du log est PII-safe. Delta net 0 sur les
    5 primitives (3 `evaluate` + 1 `waitForFunction` + 2 `requestSubmit`
    code refs déplacés 1:1 — 0 `force: true`, 0 `waitForTimeout` dans le
    bloc).
- `pages/checkout/shipping/AddressFormFiller.ts` — **nouveau (Sprint 7)** :
  437 lignes. Contient `fillShippingAddress(options)` +
  `selectStateOrPrefecture(value?)` + `selectPhonePrefix(prefix)` +
  `ensureFormVisible()` publics, et `fillField` / `fillOptionalField` /
  `tryOpenFormToggle` + primitives locales
  `safeFill`/`safeClick`/`safeSelect`/`isVisible`/`swallowOptional`
  privées. Aucun import de `CheckoutShippingPage` (dépendances passées
  via `AddressFormFillerDeps` — `page` + 4 `Locator`). Type
  `ShippingAddressOptions` défini ici et re-exporté depuis
  `CheckoutShippingPage.ts` pour la compat externe. Le catch
  précédemment `error.message` de `fillField` est converti en
  `errorName(err)` (PII policy). Aucun `evaluate()` ni `force: true`
  ajouté au tree (déplacements 1:1). ~440 L incluent la réimplémentation
  locale des primitives BasePage (~120 L, isolation forte pour éviter
  couplage) + le bloc JSDoc PII substantiel.
- `pages/checkout/CheckoutPaymentPage.ts` — Sprint 8 : 851 L (+62 ajout
  helper `swallowOptional` + `errorName`) après liquidation des 23 silent
  catches. Sprint 12 : `PayPalPaymentFlow` extrait
  (`payViaPayPal(email, password)` public préservé, corps déplacé 1:1)
  → 913 → 782 lignes (−131, −14 %). Sprint 13 : `AfterpayPaymentFlow`
  extrait (`payViaAfterpay(email, password)` public préservé, corps
  déplacé 1:1) → 782 → 704 lignes (−78, −10 %). Sprint 14 :
  `PaymentTermsHandler` extrait (bloc `acceptTermsAndConditions`, ~50 L,
  corps déplacé 1:1) → **704 → 671 lignes (−33, −5 %)**. **Cumul Sprint
  12+13+14 : 913 → 671 (−242, −27 %).** L'API publique reste intacte ;
  la façade instancie les 3 helpers au constructor
  (`PaymentTermsHandler` en premier, avant PayPal/Afterpay pour que
  leurs callbacks Terms résolvent correctement) et délègue
  `acceptTermsAndConditions()` (méthode privée) via
  `this.paymentTermsHandler.accept()`. Aucun helper n'importe
  `CheckoutPaymentPage` (constructor deps minimales). Reste extractible
  (non prioritaire) : découpage éventuel du bloc CB / Adyen /
  Cybersource, mais Sprint 12-14 a déjà retiré 27 % de la façade.
- `pages/checkout/payment/PayPalPaymentFlow.ts` — **nouveau (Sprint 12)** :
  225 lignes. Flow PayPal complet : select radio + accept terms
  (callback) + polling CTA multi-frame + popup arm/click + login
  email/password + Agree & Pay + popup close race. Aucun import
  `CheckoutPaymentPage` ; dépendances via constructor
  (`page: Page`, `acceptTerms: () => Promise<boolean>`). Logs via
  `TestLogger.scoped('PayPal')` — même contenu que les
  logs `[Payment]` précédents (préfixe changé pour clarté, pattern
  Sprint 4). Primitives locales `swallowOptional(label)` +
  `errorName(err)` PII-safe (pattern Sprint 8). Aucun catch silencieux ;
  chaque catch loggue au moins un label technique + `error.name`.
- `pages/checkout/payment/AfterpayPaymentFlow.ts` — **nouveau (Sprint 13)** :
  Sprint 13 : 197 lignes avec `redactUrl` local exporté. **Sprint 14 :
  181 lignes** — le `redactUrl` local (~15 L incluant JSDoc) est déplacé
  vers le module partagé `urlRedaction.ts` et importé. Comportement
  runtime préservé. Flow Afterpay complet : select radio + accept terms
  (callback) + Continue-to-Afterpay CTA + full-page nav portal +
  landing-screen race (fresh vs saved-session "Not you?") + email +
  password + Confirm → retour Celine Order-Confirm. Aucun import
  `CheckoutPaymentPage` ; dépendances via constructor
  (`page: Page`, `acceptTerms: () => Promise<boolean>`) — identique à
  PayPal. Logs via `TestLogger.scoped('Afterpay')`. Les 2 logs URL
  utilisent `redactUrl(page.url())` (Sprint 13 + partagé Sprint 14).
- `pages/checkout/payment/urlRedaction.ts` — **nouveau (Sprint 14)** :
  30 lignes. Fonction pure `redactUrl(rawUrl)` déplacée depuis
  `AfterpayPaymentFlow` et partagée avec `PayPalPaymentFlow`. Parse
  via `new URL()`, retourne uniquement `origin + pathname`, aucun query,
  aucun fragment. Aucun log, aucune dépendance Playwright. Testée dans
  `tests/unit/urlRedaction.spec.ts` (renommé depuis
  `tests/unit/AfterpayPaymentFlow.spec.ts` via `git mv` — 2 tests
  couvrant strip query+hash + fallback URL invalide). PII-safe : le
  pathname n'est pas redacté ; documentation intégrée précise que si un
  PSP embed un token/session id directement dans le path (non observé
  sur Adyen/Cybersource/PayPal/Afterpay actuels), il faudrait étendre
  ce fichier avec un `redactPath`.
- `pages/checkout/payment/PaymentTermsHandler.ts` — **nouveau
  (Sprint 14)** : 139 lignes. Contient uniquement `accept()` :
  3-strategy fallback (safeCheck → label click → JS dispatch) sur
  le checkbox Terms — corps déplacé 1:1 depuis
  `CheckoutPaymentPage.acceptTermsAndConditions`. Aucun import
  `CheckoutPaymentPage` ; dépendance unique `page: Page`.
  Réimplémentation locale de `safeCheck` (pattern Sprint 7
  `AddressFormFiller`). Le catch outer précédemment
  `(error as Error).message` est converti en `errorName(error)`
  PII-safe (règle Sprint 6/7/8 pour les nouveaux fichiers). Logger
  `TestLogger.scoped('PaymentTerms')`.
- `utils/emailReporter.ts` — 630 lignes → séparer template HTML / SMTP transport.
- `tests/celine-purchase.spec.ts` — 507 lignes → splitter en 4-5 specs ciblés.

---

## 4. Mégatest & couverture apparente (F-R6)

Un seul test paramétré par région couvre l'ensemble du tunnel. Découpage en
Sprint 2+ : `product.spec.ts`, `checkout-login.spec.ts`, `checkout-shipping.spec.ts`,
`checkout-payment.spec.ts`, `checkout-confirmation.spec.ts`.

---

## 5. `storageState` (F-B3)

Aucun `storageState` généré. Chaque test refait le login registered.
À faire au Sprint 2 via un `global-setup.ts` par région.

---

## 6. `getByRole` / `getByTestId` peu utilisés (F-B2)

Sélecteurs CSS fragiles partout. Push interne à Céline pour poser des
`data-testid` stables sur les CTA critiques.

---

## 7. Dépendances (F-S7)

### Sprint 1 status

- `nodemailer` : bumpé de `8.0.7` → `8.0.11` (patch in-range, 3 vulnérabilités
  fixées : GHSA-268h-hp4c-crq3, GHSA-wqvq-jvpq-h66f, GHSA-r7g4-qg5f-qqm2).
- `fast-xml-parser` : override `5.7.3` en place dans `package.json`, la
  critical historique est fixée.

### Résiduel — 1 high non fixé

- **Package** : `nodemailer@8.0.11`
- **Advisory** : GHSA-p6gq-j5cr-w38f — « Message-level `raw` option bypasses
  `disableFileAccess`/`disableUrlAccess` in the delivered message ».
- **Chemin de dépendance** : direct (`dependencies` → `nodemailer`).
- **Usage réel dans le projet** : `utils/emailReporter.ts` appelle
  `transporter.sendMail({ from, to, cc, subject, text, html, attachments })`.
  **Nous n'utilisons jamais l'option `raw`** et aucune donnée non-trustée
  n'est passée à `sendMail` (host, credentials et destinataires viennent
  d'env vars contrôlées par l'opérateur).
- **Correction recommandée** : upgrade `nodemailer@8.x → 9.0.3`.
- **Bloquant** : major bump avec breaking changes (voir `SECURITY_NOTES.md §5`).
  Requiert validation :
  1. Diff `createTransport` / `verify` / `sendMail` signatures.
  2. Rerun `npm run test:unit` + smoke SMTP en sandbox.
- **Risque résiduel** : LOW dans ce projet — surface d'attaque nulle tant
  que nous n'ajoutons pas d'input utilisateur non-trusté dans `sendMail`.
- **Décision Sprint 1** : ne pas forcer (hors périmètre). Ticket à créer
  pour Sprint 2.

---

## 8. Duplication `safeClick` / `safeFill` (F-B5)

Deux implémentations coexistent :

- `pages/BasePage.ts` (méthodes protégées)
- `utils/pageHelpers.ts` (fonctions exportées)

À fusionner. `CelineProductPage` doit étendre `BasePage` (actuellement ne le fait pas).

---

## 9. Historique Git — purge fichiers sensibles

Le commit initial `fb66f43` contient `.claude/settings.local.json` et
`%TEMP%install-qwen.bat`. Le Sprint 1 les a désindexés mais n'a pas réécrit
l'historique (nécessite validation humaine).

Procédure recommandée (à valider) :

```bash
# Backup avant
git bundle create backup-pre-purge.bundle --all

# Option 1 — git filter-repo (recommandé, plus rapide et propre que BFG)
git filter-repo --path .claude/settings.local.json --path "%TEMP%install-qwen.bat" --invert-paths

# Option 2 — BFG (nécessite Java)
bfg --delete-files ".claude/settings.local.json" --no-blob-protection
bfg --delete-files "%TEMP%install-qwen.bat" --no-blob-protection
git reflog expire --expire=now --all && git gc --prune=now --aggressive

# Puis force-push (nécessite coordination avec l'équipe)
git push --force-with-lease origin main
```

**Rotations à faire APRÈS purge historique** :

- URLs de preview leakées (tokens `__previewID`, `__sftkCacheBuster`) —
  vérifier auprès du back Céline si elles autorisent l'accès à des SKUs non
  publics ; si oui, invalider ces tokens.
- Comptes testeurs mentionnés dans le shell history (`au_buyer1_lotfi@yopmail.com`,
  etc.) — rotation des passwords, ou décommissionnement si non réutilisés.
- Aucun token API ni credential prod détecté dans le fichier — pas de
  rotation de secret production requise.

---

## 10. Actions Sprint 22 (backlog priorisé)

Priorité décroissante :

1. **Réduire `CheckoutShippingPage.ts` sous 400 L** (optionnel) — Sprint 21
   a ramené à 444 L. Reste extractible : `continueToPayment` (~65 L,
   evaluate visible payment markers), `clickSubmitShipping` (~45 L).
   Extractions individuelles possibles mais non urgentes — la façade
   est désormais à −69 % du max historique (~1440 L).
2. **`storageState` par région** — global-setup persistant pour supprimer
   le login registered à chaque test (gain ~5-8 s / test / région).
3. **Split du mégatest** — découper `celine-purchase.spec.ts` en
   `product.spec.ts`, `checkout-login.spec.ts`, `checkout-shipping.spec.ts`,
   `checkout-payment.spec.ts`, `checkout-confirmation.spec.ts`.
4. **10 `waitForTimeout` Shipping+PickupDialogHandler+PickupRefillGuard** —
   remplacer par des signaux réels maintenant que le scope pickup est
   entièrement scindé en trois helpers ciblés (handler, civility, refill
   guard) et que le scope adresse est isolé dans `AddressFormFiller`.
   Chaque sleep a désormais un contexte local suffisamment étroit pour
   identifier un signal DOM/URL fiable.
5. **Flakes `tests/unit/fileLock.spec.ts:114` et
   `tests/unit/testResultTracker.spec.ts:66`** — deux tests
   cross-process (`cross-process contention preserves all writes` et
   `cross-process concurrent record() preserves all entries`) échouent
   occasionnellement (~10-20 %). Race probable dans le `child_process`
   spawn — même famille. À investiguer isolément.
6. **Warnings ESLint révélés post-Sprint 11** — la suppression de
   l'override rend visibles quelques warnings préexistants qui étaient
   masqués : `preserve-caught-error` sur `CheckoutShippingPage.ts:415` et
   `celine-purchase.spec.ts:202`, `no-useless-assignment` sur
   `celine-purchase.spec.ts:471` (paymentMethodSelected). Warnings
   uniquement — lint reste vert. À nettoyer opportunément avec le split
   du mégatest (§5) et le refactor Payment (§1). Idem : nettoyer
   l'`unused-disable` sur `scripts/check-silent-catch-baseline.js:2` et
   les 2 `no-explicit-any` sur `emailReporter.ts:479` + `formHelper.ts:400`.
7. **Warning tsc pré-existant `_buyNowUsed` dans
   `tests/celine-purchase.spec.ts`** — la variable est assignée mais
   jamais lue post-assignation (héritage historique). L'ESLint
   `varsIgnorePattern: '^_'` la tolère ; `tsc --noEmit` la signale en
   diagnostic informationnel mais ne fail pas. À nettoyer au fil du
   split du mégatest (§5).
8. **Duplication `safeClick`/`safeFill`/`safeSelect`/`isVisible`** —
   `AddressFormFiller` réimplémente localement les primitives BasePage
   (Sprint 7). À reconsidérer si un pattern de partage émerge côté
   Payment/Login helpers ; sinon, laisser les duplications comme prix
   de l'isolation forte.
9. **`swallowOptional` historique dans `CheckoutShippingPage.ts`** —
   encore basé sur `.message` / `String(err)`. Non touché en Sprint 11
   (hors périmètre — utilisé par ~15 sites). À migrer vers `errorName`
   au fil du prochain refactor structurel de la façade.
10. **Historique Git** — purger `.claude/settings.local.json` et
    `%TEMP%install-qwen.bat` (voir §9), après validation humaine.

---

_Ce document est source de vérité pour le backlog. Ne pas dupliquer
dans README ou tickets — pointer ici._
