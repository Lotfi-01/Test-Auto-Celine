# Security Notes — npm dependencies

Document de suivi des vulnérabilités `npm audit` pour ce projet de tests E2E.
Lecture obligatoire avant tout `npm install` ou upgrade.

## 1. Résumé `npm audit`

Snapshot au baseline post-stabilisation (`@types/node@24.12.3`, `nodemailer@7.0.12`) :

| Sévérité | Nombre |
|---|---:|
| info | 0 |
| low | 0 |
| moderate | 19 |
| high | 0 |
| **critical** | **1** |
| **total** | **20** |

Source : `npm audit` (lecture seule). Aucun fix appliqué.

## 2. Dépendances concernées

### 2.1 Direct (déclarée dans `package.json`)

| Package | Version | Type | Vulnérabilités directes |
|---|---|---|---|
| `nodemailer` | `7.0.12` | runtime | 1 moderate (SMTP injection) |

### 2.2 Indirect (transitives)

Toute la chaîne suivante provient de `@types/nodemailer@7.0.5` (devDep) :

```
@types/nodemailer@7.0.5
└── @aws-sdk/client-sesv2@3.971.0
    ├── @aws-sdk/core@3.970.0
    │   └── @aws-sdk/xml-builder@3.969.0
    │       └── fast-xml-parser@5.2.5     ← critical (7 advisories cumulées)
    ├── @aws-sdk/credential-provider-node
    │   ├── @aws-sdk/credential-provider-process    ← moderate
    │   ├── @aws-sdk/credential-provider-sso        ← moderate
    │   └── @aws-sdk/credential-provider-web-identity ← moderate
    ├── @aws-sdk/middleware-sdk-s3                  ← moderate
    │   └── @aws-sdk/signature-v4-multi-region      ← moderate
    ├── @aws-sdk/middleware-user-agent              ← moderate
    │   └── @aws-sdk/util-user-agent-node           ← moderate
    ├── @aws-sdk/nested-clients                     ← moderate
    └── @aws-sdk/token-providers                    ← moderate
```

≈ 18 packages `@aws-sdk/*` en `moderate` + 1 `fast-xml-parser` `critical`.

## 3. Surface d'attaque réelle dans ce projet

| Vulnérabilité | Mécanisme exploitable | Surface d'attaque dans ce projet |
|---|---|---|
| `fast-xml-parser` — DoS via entity expansion, regex injection, stack overflow, CDATA injection (7 advisories) | Parsing d'un XML hostile, ou construction d'un XMLBuilder à partir d'input non-trusted | **Faible dans ce projet** — `fast-xml-parser` est tiré par `@types/nodemailer` (devDep). Aucun code applicatif n'effectue de parsing XML d'inputs externes. Le package est présent dans `node_modules` mais n'est jamais chargé par `utils/emailReporter.ts` (qui n'utilise que `nodemailer.createTransport({...SMTP options})`). |
| `nodemailer` — SMTP command injection via `envelope.size` non sanitisé (advisory `GHSA-c7w3-x93f-qmm8`) et CRLF injection dans l'option `name` du transport (`GHSA-vvjj-xcjg-gr5g`) | Un opérateur peut injecter des commandes SMTP arbitraires si un attaquant contrôle `envelope.size` ou le `name` du transport | **Faible dans ce projet** — Toutes les options du transport (`SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`, et le `from` calculé à partir de `SMTP_USER`) proviennent de variables d'environnement contrôlées par l'opérateur. Les destinataires (`REPORT_EMAIL_TO`, `REPORT_EMAIL_CC`) sont eux aussi des env vars. Aucun input utilisateur non-trusted n'atteint nodemailer. `envelope.size` n'est jamais positionné par notre code. |
| Chaîne `@aws-sdk/*` (credential providers, middleware, token providers) | Vulnérabilités variées dépendant du sous-package — auth bypass, leak de credentials, etc. dans des contextes AWS | **Faible dans ce projet** — Aucun code applicatif n'utilise l'AWS SDK. Le SDK est présent dans `node_modules` uniquement parce que `@types/nodemailer` le déclare en `dependencies` pour typer le transport optionnel `nodemailer/lib/aws-ses-transport`. Notre projet n'instancie ni `SESv2Client`, ni aucun service AWS. |

## 4. Pourquoi `npm audit fix --force` est interdit

`npm audit fix --force` accepte les **breaking changes** sans validation manuelle. Dans notre cas, il propose :

- `nodemailer` `7.0.12` → `8.0.7` (major bump). API et options de transport peuvent diverger.
- Possible upgrade en cascade des transitives `@aws-sdk/*` vers des versions non testées avec `@types/nodemailer@7.0.5`.

Conséquences possibles si lancé sans validation :

- `utils/emailReporter.ts` casse silencieusement (le code compile mais `verify()` ou `sendMail()` échoue à l'exécution).
- `tests/unit/emailReporter.spec.ts` peut continuer à passer (les tests sont sur la logique pure, pas sur l'API nodemailer).
- Les rapports email après `globalTeardown` cessent de partir, ou partent mal formés, **sans signal d'erreur clair en CI**.

`npm audit fix` (sans `--force`) ne propose aucun fix in-range pour les vulnérabilités présentes — il ne ferait rien, donc inutile.

**Règle** : tout upgrade major doit passer par un lot dédié avec backup, test ciblé, et validation explicite.

## 5. Pourquoi `nodemailer@8` demande un lot séparé

Upgrade `nodemailer` 7.x → 8.x = **major bump avec breaking changes documentés**. Validation requise :

1. Backup propre du baseline avant.
2. Diff des call-sites contre la doc 8.x :
   - `nodemailer.createTransport(config)` — vérifier que la signature `EmailConfig` reste valide.
   - `transporter.verify()` — vérifier que la sémantique de retour n'a pas changé.
   - `transporter.sendMail({ from, to, cc, subject, text, html, attachments })` — vérifier chaque champ.
3. Lancer `npm run typecheck` + `npm run test:unit`.
4. Lancer un envoi réel en sandbox SMTP (test manuel — nécessite confirmation Lotfi).
5. Si OK, garder. Sinon, rollback `npm install nodemailer@7.0.12`.

Ce lot ne peut pas être combiné avec le présent lot de **documentation** sans risquer une régression silencieuse sur le rapport email.

## 6. Pourquoi `fast-xml-parser` vient de `@types/nodemailer`

`@types/nodemailer@7.0.5` déclare `@aws-sdk/client-sesv2: ^3.839.0` dans ses `dependencies` (pas `devDependencies` ni `peerDependencies`). C'est nécessaire parce que les types de `nodemailer` exposent un transport optionnel basé sur Amazon SES v2 (`nodemailer/lib/ses-transport` / `aws-ses-transport`) — pour typer ce transport, le `.d.ts` doit pouvoir importer `SESv2Client`.

`@aws-sdk/client-sesv2` tire toute la chaîne `@aws-sdk/core` → `@aws-sdk/xml-builder` → `fast-xml-parser` parce que les requêtes AWS SES utilisent du XML.

Conséquence : tant que `@types/nodemailer` reste, ces transitives restent dans `node_modules` même si notre code n'utilise jamais SES. Et tant que `@types/nodemailer` n'a pas mis à jour son `^3.839.0` vers une version d'AWS SDK qui ne tire plus `fast-xml-parser` vulnérable, le critical reste.

Suppression de `@types/nodemailer` testée précédemment : impossible — `nodemailer@7.x` ne fournit pas ses propres types (`package.json` sans champ `types`/`typings`, aucun `.d.ts` shipped).

## 7. Options de traitement

### Option A — Upgrade `nodemailer` 7 → 8 (lot dédié)

**Effet attendu sur l'audit** : élimine la moderate directe sur `nodemailer`. **Ne réduit pas** la chaîne `@types/nodemailer` (les transitives restent tant que `@types/nodemailer@7.0.5` est en place).

| Pour | Contre |
|---|---|
| Résout 1 vulnérabilité directe | Breaking change runtime |
| Upgrade aligné sur la version corrigée upstream | Nécessite test sandbox SMTP |
| Pas de surprise sur la chaîne types | Ne baisse pas le compteur global de manière significative |

### Option B — Override `fast-xml-parser` via `npm overrides`

Ajout dans `package.json` :
```json
"overrides": {
  "fast-xml-parser": "5.7.3"
}
```

> **Note version** : la version exemple initiale `^5.6.1` est **insuffisante** — l'advisory `GHSA-gh4j-gqv2-49f6` (XMLBuilder CDATA injection) exige `<5.7.0` pour être corrigée, donc `5.6.1` resterait vulnérable. Version safe minimale = `5.7.0`. Version retenue = `5.7.3` (latest patch, exact pin sans `^` pour reproductibilité).

**Effet attendu sur l'audit** : élimine la critical `fast-xml-parser` + plusieurs moderate transitives qui en découlent.

| Pour | Contre |
|---|---|
| Pas de breaking sur notre code (aucun usage de `fast-xml-parser` côté projet) | Force une version non testée par AWS SDK upstream |
| Diff minimal (3 lignes dans `package.json`) | Peut faire échouer `npm ci` si l'override viole une contrainte de peer-deps |
| Réduit fortement le compteur d'audit | Impact non garanti sans validation `npm ci` + audit |

### Option C — Acceptation temporaire documentée

Garder l'état actuel + ce document. Justification :

- Surface d'attaque faible dans ce projet pour les 3 catégories (XML parsing, SMTP injection, AWS SDK) — argumenté §3.
- Tests unitaires verts.
- Le projet est local, sans déploiement public, sans exposition à des inputs non-trusted.

| Pour | Contre |
|---|---|
| Aucun risque de régression | Compteur d'audit reste à 20 |
| Documentation tracée pour audit corporate | Demande revisite régulière (chaque MAJ amont) |
| Pas de lot supplémentaire requis | Ne corrige rien |

## 8. Recommandation finale

**Recommandation : Option B (override `fast-xml-parser`) en lot dédié, suivi d'Option A (upgrade nodemailer) si l'audit corporate ou un changement de scope l'exige.**

Justification :

1. Option B est **le plus petit diff utile** pour faire baisser le compteur (`package.json` + lock régénéré) et a la **surface de cassage la plus faible** car `fast-xml-parser` n'est utilisé qu'en transitif AWS SDK que nous n'instancions jamais.
2. Option A traite la seule vulnérabilité directe mais nécessite un test sandbox SMTP et une confirmation explicite — à programmer après B.
3. Option C reste valable comme position transitoire si Option B est repoussée. **Ce document constitue la trace d'acceptation tant que B n'est pas appliqué.**

**Aucune action immédiate requise** — le baseline est stable et toutes les vulnérabilités ont une surface d'attaque faible dans ce projet.

## 9. Résultat application Option B (2026-05-11)

Override `fast-xml-parser: "5.7.3"` appliqué dans `package.json`. Snapshot avant/après :

| | Avant | Après |
|---|---:|---:|
| critical | 1 | **0** |
| moderate | 19 | **1** (`nodemailer`, hors scope) |
| total | 20 | **1** |

### Vérifications passées

- `npm install` → `added 4 packages, changed 2 packages, audited 96`
- `npm ci` → `added 95 packages, audited 96` (lock file cohérent)
- `npm run typecheck` → OK (pas d'erreur TS)
- `npm run test:unit` → `28 passed, 1 skipped` (skip = `concurrent saves` connu, identique baseline)
- `npm ls fast-xml-parser` → `fast-xml-parser@5.7.3 overridden`
- `npm audit` → 1 moderate (uniquement `nodemailer` direct)

### Effet sur la chaîne transitives

Toutes les vulnérabilités `@aws-sdk/*` (18 moderate) ont disparu : `@aws-sdk/core` exposait la chaîne uniquement parce que `xml-builder` tirait `fast-xml-parser` vulnérable. L'override coupe la racine, donc les `effects` cascadants sont neutralisés.

### Décision

**KEEP** — diff minimal (5 lignes `package.json` + lock régénéré), aucun fichier code/test modifié, aucune régression unit, audit baisse de 95 %. Backup conservé : `../playwright-pom-project-fxp-override-baseline-20260511-180000`.

### Reste à traiter (hors scope ce lot)

- `nodemailer@7.0.12` → `8.0.7` (Option A) : 1 moderate restante. Lot dédié — voir §5.

## 10. Résultat application Option A (2026-05-11)

Upgrade `nodemailer` `7.0.12` → `8.0.7` (pin exact, pas de `^`).

| | Avant | Après |
|---|---:|---:|
| moderate | 1 (`nodemailer`) | **0** |
| total | 1 | **0** |

→ **`npm audit` passe à 0 vulnérabilité**.

### Adaptations code

**Aucune.** L'API publique utilisée par `utils/emailReporter.ts` est compatible entre 7 et 8 :

- `nodemailer.createTransport(config)` → signature inchangée pour les options SMTP basiques (`host`, `port`, `secure`, `auth.user`, `auth.pass`).
- `transporter.verify()` → comportement identique.
- `transporter.sendMail({ from, to, cc, subject, text, html, attachments })` → signature inchangée.
- Type `nodemailer.Transporter` résolu correctement par `@types/nodemailer@7.0.5` (les types restent compatibles avec le runtime 8.x pour ces APIs).

Aucun fichier de code, aucun test, aucun helper n'a été modifié.

### Vérifications passées

- `npm install nodemailer@8.0.7 --save-exact` → `changed 1 package, audited 185` + `found 0 vulnerabilities`
- `npm ci` → `found 0 vulnerabilities`
- `npm run typecheck` → OK
- `npm run test:unit` → `28 passed, 1 skipped` (= baseline)
- `npm run lint` → 0 errors, 18 warnings (= baseline)
- `npm run format:check` → All matched files use Prettier code style
- `npm audit` → `found 0 vulnerabilities`
- `npm ls nodemailer` → `nodemailer@8.0.7`

### Sandbox SMTP

**Non exécutée.** Aucun envoi réel testé dans ce lot. Le code `verify()` / `sendMail()` n'a pas été appelé contre un vrai serveur SMTP. Procédure documentée dans le rapport de lot ; à déclencher manuellement avec confirmation Lotfi.

### Décision

**KEEP** — diff minimal (1 ligne `package.json` + lock), aucune adaptation requise, aucune régression unit. Backup conservé : `../playwright-pom-project-nodemailer8-baseline-20260511-182217`.

### Reste à traiter

Plus rien côté `npm audit`. Action de suivi recommandée :
- Test sandbox SMTP réel (envoi d'un rapport via `globalTeardown` ou via REPL Node) pour valider que l'API runtime 8.x fonctionne contre le serveur SMTP cible avant de considérer cet upgrade comme totalement validé en CI.

---

_Document maintenu manuellement. À mettre à jour à chaque exécution de `npm audit` ou modification de dépendance._
