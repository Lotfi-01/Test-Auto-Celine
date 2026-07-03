# Dette technique — Sprint 2+

Ce fichier tracks la dette identifiée pendant Sprint 1 mais **volontairement non
traitée** dans ce sprint pour rester ciblé. Ne pas laisser cette liste
grandir : chaque item doit passer par un ticket avec un propriétaire.

---

## 1. Silent `.catch(() => {})` (F-R2)

**Contexte** : la revue initiale estimait ~180 occurrences par un
`grep .catch\(` non filtré ; la **mesure exacte** produite par
`scripts/check-silent-catch-baseline.js` (regex stricte sur
`.catch(() => {})` / `.catch(async () => {})` à corps vide) recense
**82 occurrences réparties sur 8 fichiers**. C'est la vérité de référence
utilisée par le guard-rail — l'estimation initiale de la revue est
considérée obsolète.

Sprint 1 a :

- durci ESLint (`no-empty` strict, `no-restricted-syntax` sur les silent catch),
- gardé un override `warn` pour les fichiers historiques listés dans
  `eslint.config.js:HISTORICAL_SILENT_CATCH_FILES`,
- ajouté un **check baseline** (`scripts/check-silent-catch-baseline.js`,
  branché sur `npm run lint`) qui fige le compte par fichier et fait échouer
  CI si un fichier dépasse son quota. Pour intentionnellement réduire la
  dette : `npm run lint:silent-catch:update` puis committer le diff sur
  `scripts/silent-catch.baseline.json`.

**Mesure du baseline** (source de vérité — `scripts/silent-catch.baseline.json`,
figé le **2026-07-03**) :

| Fichier                                  | Occurrences | Action attendue                                      |
| ---------------------------------------- | ----------: | ---------------------------------------------------- |
| `pages/checkout/CheckoutShippingPage.ts` |          28 | Refactor : logger warn + surface l'erreur ou throw   |
| `pages/checkout/CheckoutPaymentPage.ts`  |          23 | Idem — surtout PayPal / Afterpay / Adyen 3DS         |
| `pages/CelineProductPage.ts`             |           7 | Extraire les fallbacks JS click en helpers testables |
| `tests/celine-purchase.spec.ts`          |           7 | Remplacer par assertions `expect` explicites         |
| `utils/selectorStrategy.ts`              |           6 | Documenter chaque tolérance                          |
| `pages/BasePage.ts`                      |           5 | Aligner sur la politique « catch = log »             |
| `pages/checkout/CheckoutLoginPage.ts`    |           4 | Séparer cas guest vs registered, propager            |
| `utils/formHelper.ts`                    |           2 | Documenter les deux tolérances scroll/clear          |
| **Total**                                |      **82** |                                                      |

Fichiers qui n'apparaissent PAS dans le baseline (0 silent catch strict) mais
qui sont dans la liste `HISTORICAL_SILENT_CATCH_FILES` d'ESLint parce qu'ils
contiennent d'autres patterns tolérés (`try {} catch {}` vides, ou catches
avec paramètre non utilisé) : `utils/adyenHelper.ts`, `utils/cybersourceHelper.ts`,
`utils/fileLock.ts`, `utils/orderTracker.ts`, `utils/pageHelpers.ts`,
`utils/testResultTracker.ts`, `pages/CelineHomePage.ts`. Ces fichiers doivent
rester dans l'override ESLint (leur dette est d'un autre type — cf. la revue
initiale) mais n'entrent pas dans le baseline silent-catch.

> Estimation initiale obsolète : la revue mentionnait
> `CheckoutShippingPage.ts=74`, `CheckoutPaymentPage.ts=49`,
> `celine-purchase.spec.ts=20`, `CheckoutLoginPage.ts=11`,
> `CelineProductPage.ts=10`, `BasePage.ts=8`, `pageHelpers.ts=2`,
> `adyenHelper.ts=2`, `cybersourceHelper.ts=1`, `orderTracker.ts=1`,
> `testResultTracker.ts=1`, `fileLock.ts=4`. Ces chiffres provenaient d'un
> `grep .catch\(` **non filtré** (matchait aussi `.catch((err) => ...)`,
> `.catch((e) => { log(...) })`, etc.). Ne pas les utiliser pour piloter le
> Sprint 2 — seule la mesure baseline ci-dessus fait foi.

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

**Contexte** : 34 occurrences, cumul >10s par test. Sprint 1 ne les touche pas.

À traiter en Sprint 2 avec la refonte des attentes web-first.

---

## 3. Fichiers trop gros (F-M1)

- `pages/checkout/CheckoutShippingPage.ts` — 1523 lignes → extraire `PickupDialogHandler`, `CivilitySelector`, `AddressFormFiller`.
- `pages/checkout/CheckoutPaymentPage.ts` — 851 lignes → extraire les flows PayPal / Afterpay / 3DS.
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

_Ce document est source de vérité pour le backlog Sprint 2. Ne pas dupliquer
dans README ou tickets — pointer ici._
