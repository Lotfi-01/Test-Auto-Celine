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

**Évolution du baseline** :

| Sprint | Total | Fichiers concernés | Δ               |
| ------ | ----: | -----------------: | --------------- |
| 1      |    82 |                  8 | (baseline)      |
| 2      |    60 |                  4 | **−22**         |
| 3      |    32 |                  3 | **−28**         |
| 4      |    32 |                  3 | 0 (extract 1:1) |
| 5      |    32 |                  3 | 0 (extract 1:1) |

**État du baseline après Sprint 5** (source de vérité —
`scripts/silent-catch.baseline.json`, figé le **2026-07-04**) :

| Fichier                                             | Sprint 1 | Sprint 2 | Sprint 3 | Sprint 4 | Sprint 5 |
| --------------------------------------------------- | -------: | -------: | -------: | -------: | -------: |
| `pages/checkout/CheckoutShippingPage.ts`            |       28 |       28 |    **0** |        0 |        0 |
| `pages/checkout/shipping/PickupDialogHandler.ts`    |      N/A |      N/A |      N/A |    **0** |        0 |
| `pages/checkout/shipping/PickupCivilityStrategy.ts` |      N/A |      N/A |      N/A |      N/A |    **0** |
| `pages/checkout/shipping/CivilitySelector.ts`       |      N/A |      N/A |    **0** |        0 |        0 |
| `pages/checkout/CheckoutPaymentPage.ts`             |       23 |       23 |       23 |       23 |       23 |
| `tests/celine-purchase.spec.ts`                     |        7 |        7 |        7 |        7 |        7 |
| `utils/formHelper.ts`                               |        2 |        2 |        2 |        2 |        2 |
| `pages/CelineProductPage.ts`                        |        7 |        0 |        0 |        0 |        0 |
| `utils/selectorStrategy.ts`                         |        6 |        0 |        0 |        0 |        0 |
| `pages/BasePage.ts`                                 |        5 |        0 |        0 |        0 |        0 |
| `pages/checkout/CheckoutLoginPage.ts`               |        4 |        0 |        0 |        0 |        0 |
| **Total**                                           |   **82** |   **60** |   **32** |   **32** |   **32** |

Les 32 occurrences restantes sont concentrées à 72 % dans
`CheckoutPaymentPage.ts` — hors périmètre Sprint 5 par consigne (flows PSP
PayPal, Afterpay, Adyen, Cybersource, 3DS). À traiter Sprint 6 après
extraction préalable des helpers PayPal/Afterpay/3DS.

Les 7 occurrences restantes dans `tests/celine-purchase.spec.ts` sont des
`.catch(() => {})` autour d'actions de fallback UI (zip OK button, force
click shipping label). Elles seront traitées Sprint 6 en même temps que le
découpage du mégatest.

Les 2 dans `utils/formHelper.ts` sont sur des étapes optionnelles
(`scrollIntoView`, `clear`) au sein de wrappers `Result<T>` — traitables
sans risque en Sprint 6 avec la même approche `logger.debug`.

Fichiers qui n'apparaissent PAS dans le baseline (0 silent catch strict) mais
qui restent dans l'override ESLint parce qu'ils contiennent d'autres patterns
tolérés (`try {} catch {}` vides, ou catches avec paramètre non utilisé) :
`utils/adyenHelper.ts`, `utils/cybersourceHelper.ts`, `utils/fileLock.ts`,
`utils/orderTracker.ts`, `utils/pageHelpers.ts`, `utils/testResultTracker.ts`,
`pages/CelineHomePage.ts`.

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

| Sprint | Total | Détail                                                                                                             |
| ------ | ----: | ------------------------------------------------------------------------------------------------------------------ |
| 1      |    32 | 13 Shipping, 7 Payment, 5 spec, 5 Login, 2 Product                                                                 |
| 2      |    28 | idem sauf : spec −2 (JP/NL loading + form-panel padding), Login −2 (padding autour du Tab blur)                    |
| 3      |    25 | idem sauf : Shipping 13 → 10                                                                                       |
| 4      |    25 | idem — 10 sleeps Shipping split entre Shipping (4) et PickupDialogHandler (6). Extraction 1:1, aucune suppression. |
| Δ      |    −7 |                                                                                                                    |

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

**Sleeps restants dans PickupDialogHandler (6) — annotés
`TODO Sprint 5: replace with stable pickup signal.` dans le code** :

- `fillDialog` : 1 × 60 ms post `setNativeValue(postcode)` — autocomplete
  potentiel, pas de signal fiable identifié.
- `selectStateInDialog` : 1 × 150 ms post-`selectOption` — Celine
  re-render partiel post state select (AU/US).
- `fillByLabelInDialog` : 1 × 50 ms post `pressSequentially` + blur —
  padding onchange, pas de signal réseau identifié.
- `fillTextFields` : 1 × 50 ms post `setNativeValue(address)`.
- `fillKatakanaFields` : 1 × 50 ms post `setNativeValue(kana)`.
- `ensureFieldsBeforeSubmit` : 1 × 100 ms post refill report — padding
  avant SUBMIT, non observable.

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
  déplacé 1:1). Le fichier passe de ~1440 → 944 lignes (−34 %). L'API
  publique (`selectClickAndCollect`, `fillPickupAddressForm`) reste sur
  la façade et délègue au handler. `AddressFormFiller` reste à extraire
  en Sprint 6. Sprint 5 : fichier non modifié (extraction ciblée dans le handler).
- `pages/checkout/shipping/PickupDialogHandler.ts` — Sprint 4 : nouveau
  helper 720 lignes. Sprint 5 : `PickupCivilityStrategy` extrait → **720 →
  614 lignes (−106)**. **Toujours au-dessus du seuil `~500 lignes`** — la
  taille restante vient : (a) du full state-label map US+AU
  (`pickupStateLabelFor`, ~20L de map), (b) de `ensureFieldsBeforeSubmit`
  avec son `page.evaluate` de refill (~130 lignes, incluant la répétition
  des selectors de champs pickup), (c) de `selectStateInDialog` avec son
  `page.evaluate` de state search (~65 lignes), (d) des commentaires
  PII-safety Sprint 4. À traiter Sprint 6 : extraire `PickupRefillGuard`
  (le contenu de `ensureFieldsBeforeSubmit`) et éventuellement
  `PickupStateSelector` pour ramener le handler sous ~500 lignes.
- `pages/checkout/shipping/PickupCivilityStrategy.ts` — **nouveau (Sprint 5)** :
  164 lignes. 3 stratégies A/B/C intra-dialog + fallback D vers
  `CivilitySelector`. Réutilise `civilityTokens` — pas de duplication.
- `pages/checkout/CheckoutPaymentPage.ts` — 851 lignes → extraire les flows PayPal / Afterpay / 3DS (Sprint 6).
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

## 10. Actions Sprint 6 (backlog priorisé)

Priorité décroissante :

1. **Ramener `PickupDialogHandler` sous 500 lignes** — Sprint 5 a réduit
   720 → 614 via `PickupCivilityStrategy`. Reste à extraire :
   `PickupRefillGuard` (contenu de `ensureFieldsBeforeSubmit`, ~130 L,
   inclut 2 `page.evaluate` et la liste des selectors de champs pickup)
   et éventuellement `PickupStateSelector` (~65 L, `page.evaluate` de
   state search). Après ces deux extractions, le handler devrait passer
   sous 500 lignes.
2. **`AddressFormFiller`** — extraire les blocs `fillShippingAddress`,
   `fillField`, `fillOptionalField`, `ensureFormVisible`, `tryOpenFormToggle`
   de `CheckoutShippingPage.ts` (~200 lignes). Rapprocherait la façade
   d'un orchestrateur pur.
3. **`CheckoutPaymentPage.ts` refactor** — extraire helpers PayPal,
   Afterpay, Adyen, 3DS. Après extraction : liquider les 23 silent catches
   restants avec `swallowOptional` (même pattern que Sprint 2/3/4).
4. **`storageState` par région** — global-setup persistant pour supprimer
   le login registered à chaque test (gain ~5-8 s / test / région).
5. **Split du mégatest** — découper `celine-purchase.spec.ts` en
   `product.spec.ts`, `checkout-login.spec.ts`, `checkout-shipping.spec.ts`,
   `checkout-payment.spec.ts`, `checkout-confirmation.spec.ts`.
6. **7 silent catches spec + 2 formHelper** — traiter au fil du split
   ci-dessus (target : baseline total < 10).
7. **10 `waitForTimeout` Shipping+PickupDialogHandler** — remplacer par
   des signaux réels maintenant que le scope pickup est isolé dans son
   propre handler et sa stratégie civilité. Chaque sleep a désormais un
   contexte local suffisamment étroit pour identifier un signal DOM/URL
   fiable.
8. **Flake `tests/unit/fileLock.spec.ts:114`** — `cross-process contention
preserves all writes` échoue occasionnellement (~10-20 %). Race probable
   dans le child_process spawn. À investiguer isolément.
9. **Historique Git** — purger `.claude/settings.local.json` et
   `%TEMP%install-qwen.bat` (voir §9), après validation humaine.

---

_Ce document est source de vérité pour le backlog. Ne pas dupliquer
dans README ou tickets — pointer ici._
