# Architecture overview

## Shape of the system

Three connected experiences share one backend and one authorisation model.

```
┌─────────────────────────┐  ┌─────────────────────────┐  ┌─────────────────────────┐
│  Administration portal  │  │ Examination workstation │  │ Invigilator / operations│
│  admin, author,         │  │ candidate,              │  │ invigilator, controller,│
│  reviewer, security     │  │ centre operator         │  │ support, security team  │
└────────────┬────────────┘  └────────────┬────────────┘  └────────────┬────────────┘
             │                            │                            │
             └────────────────────────────┼────────────────────────────┘
                                          │  same origin, HTTP-only session cookie
                                ┌─────────▼─────────┐
                                │   Fastify API     │
                                │   /api/v1         │
                                │                   │
                                │  RBAC · Zod · CSRF│
                                │  rate limit · CSP │
                                └─────────┬─────────┘
                                          │
        ┌──────────────┬──────────────┬───┴────────┬──────────────┬──────────────┐
        │              │              │            │              │              │
  ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐ ┌────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
  │ Database  │  │  Cache    │  │ Evidence  │ │   Key    │  │  Audit    │  │  Metrics  │
  │ adapter   │  │ adapter   │  │ store     │ │ provider │  │  chain    │  │           │
  │           │  │           │  │ adapter   │ │          │  │           │  │           │
  │ memory /  │  │ memory /  │  │ memory /  │ │ local /  │  │ append    │  │ in-process│
  │ Postgres  │  │ Redis     │  │ S3·MinIO  │ │ KMS      │  │ only      │  │           │
  └───────────┘  └───────────┘  └───────────┘ └──────────┘  └───────────┘  └───────────┘
```

Every infrastructure dependency sits behind an adapter with a production-shaped
interface and an in-memory implementation. That is why the POC runs with a single
`npm run dev` and no Docker, while the same code paths remain meaningful when
PostgreSQL, Redis and MinIO are wired in.

## Why the candidate application is a separate shell

`/exam/*` renders its own shell with no global navigation, no links out and one
task on screen at a time. In production it runs inside a native Windows shell
under Assigned Access. Keeping it structurally separate in the browser means the
future native port replaces one shell, not the whole client.

---

## The four promises, mapped to code

### 1. The right student takes the examination

`apps/api/src/services/attemptService.ts` → `runPreflight()`

Seven checks run **server-side** before an attempt can exist. Nothing here trusts
what the workstation says about itself:

| Check | Source of truth | Simulated? |
| --- | --- | --- |
| Account | `db.candidates`, account status | No |
| Eligibility | `candidate.examId`, eligibility field | No |
| Workstation certificate | `db.devices`, approval + certificate status | Partly — records are real, mTLS is not |
| Approved network | `evaluateNetwork()` against the exam's CIDR ranges | No |
| Fingerprint | Scripted scanner adapter | Yes |
| Face | Mock analyser | Yes |
| Paper integrity | `verifyPaperIntegrity()` | No |

A failure at *device*, *network* or *paper* refuses activation outright and
writes a `BLOCKED` audit event. A biometric failure never ends anything on its
own — it raises a warning and routes to a human.

### 2. The right question paper is delivered

`apps/api/src/lib/crypto/paper.ts`

```
approved question versions
        │
        ├─ canonicalQuestion()      deterministic JSON, sorted keys
        ├─ questionContentHash()    SHA-256 per version
        │
        ▼
   manifest { examId, examVersion, entries[], totalMarks }
        │
        ├─ sha256Canonical()  ──► manifestHash
        ├─ kms.sign()         ──► Ed25519 signature over manifestHash
        │
        ▼
   full question package (including the answer key)
        │
        └─ kms.encrypt()  AES-256-GCM
             key   random 256-bit per-exam data key
             nonce random 96-bit, unique per operation
             AAD   manifestHash  ← binds ciphertext to this manifest
```

Canonicalisation matters: two structurally identical objects must always produce
identical bytes, or a hash is worthless as an integrity check. Keys are sorted,
`undefined` is dropped, and no incidental whitespace is emitted.

`verifyPaperIntegrity()` runs **before every assignment**, not just at
publication. It recomputes every question fingerprint, compares against the
manifest, and verifies the signature. Any mismatch blocks release and marks the
manifest `BLOCKED`.

The answer key never leaves the encrypted package. `deliverQuestion()` builds the
candidate payload field by field and simply has no code path that copies
`isCorrect` or `explanation` — a property the test suite asserts against the raw
HTTP body.

### 3. Answers belong to the correct student and attempt

`apps/api/src/services/answerService.ts`

Five checks on every single save, in this order:

1. **Ownership** — the attempt is loaded by id *and* candidate id together, so a
   foreign attempt returns `404`, not `403`. A candidate must not even learn that
   another attempt exists.
2. **Attempt state** — active, not submitted, not expired.
3. **Assignment membership** — the question must be in *this* attempt's stored
   assignment. Knowing an identifier is not enough.
4. **Option membership** — every selected option must be in the option set
   actually delivered for that question.
5. **Optimistic concurrency** — the write states the version it expects; a
   mismatch returns `409 ANSWER_VERSION_CONFLICT` rather than overwriting.

An **idempotency ledger** keyed by `attemptId:idempotencyKey` makes a retry safe:
the repeat is recorded as `DUPLICATE_IGNORED` and the stored state is returned.
The client reuses the same key on retry precisely so this works
(`apps/web/src/hooks/useAnswerSaver.ts`).

### 4. The examination remains available

- Answers save on selection and again periodically; while offline they queue on
  the workstation and flush automatically on reconnection.
- Reconnection **replays** the stored assignment. `activateAttempt()` returns the
  existing attempt and assignment; it never regenerates a sequence.
- Camera evidence queues locally and the local copy is released only after the
  server acknowledges.
- Restriction pauses navigation. It never discards an answer and never ends an
  attempt.
- The operations console demonstrates detection, control activation, user impact
  and recovery for ten failure and attack scenarios.

---

## Deterministic randomisation

`apps/api/src/lib/random.ts`

Each attempt gets a random seed. A xoshiro-style generator seeded from
`SHA-256(attemptId:seed)` drives a Fisher–Yates shuffle of the manifest entries
and of each question's option list. The resulting `CandidateAssignment` is
**stored** and marked immutable.

This is what makes reconnection safe. The same seed always reproduces the same
paper, but the platform does not rely on that — it replays the stored assignment
rather than recomputing it. The seed's hash appears on the submission receipt so
a candidate's paper order can be identified later without revealing it.

Option labels are assigned from the *delivered* order, not the authored order, so
"the answer is C" is meaningless between candidates.

---

## The audit chain

`apps/api/src/lib/audit.ts`

```
event N-1 ──hash──┐
                  ▼
       ┌──────────────────────────────────────┐
       │ event N                              │
       │   sequence, timestamp, actor, role,  │
       │   action, target, result, reason,    │
       │   device, ip, traceId,               │
       │   previousHash ◄─────────────────────┼── hash of event N-1
       │   hash = SHA-256(canonical(body))    │
       └──────────────────────────────────────┘
```

The module exports `recordAudit` and `verifyAuditChain`. It deliberately exports
no update or delete function, and no route exposes one — an administrator cannot
edit an audit event through the application, which the test suite verifies by
attempting `PUT`, `PATCH` and `DELETE` against an event and asserting `404`.

`verifyAuditChain()` recomputes the whole chain and reports the first sequence
number at which a link or a self-hash fails. The audit page renders that verdict
prominently.

The most recent hash is anchored into every submission receipt, tying a
candidate's receipt to a specific point in the examination's history.

**POC boundary:** the chain lives in the application's own store. Production must
also mirror it to independent WORM storage, and grant the application role
`INSERT` and `SELECT` only.

---

## Monitoring and escalation

`apps/api/src/services/monitoringService.ts`

Per capture cycle the workstation requests a server-issued challenge, captures a
low-resolution frame, attaches attempt, device, sequence, challenge, timestamp
and the previous evidence hash, then uploads. Each evidence record is chained to
the one before it, so a removed frame is detectable.

Progressive response, driven by the examination's own policy:

| Consecutive failures | Response |
| --- | --- |
| 1 | Subtle warning |
| 2 | Prominent warning with camera preview |
| ≥ threshold (default 3) | Navigation restricted, incident raised, invigilator notified |

Two rules are absolute and are enforced in code, not just in policy:

- **Answers are never discarded while a session is restricted.**
- **Software never terminates an attempt on the strength of automated analysis.**
  Only an invigilator action can release or restrict a session when the policy is
  `INVIGILATOR_APPROVED`.

**POC boundary:** the presence verdict is produced by a mock analyser on the
client and sent with the capture. Production evaluates frames server-side with a
validated vision service and never trusts a client-declared verdict. The
escalation logic, evidence chaining and invigilator workflow around it are real.

---

## Device security abstraction

`apps/web/src/lib/deviceSecurity.ts`

A browser cannot enforce operating-system lockdown, read a TPM-backed key or
attest machine state. `DeviceSecurityProvider` names those capabilities so a
future native Windows shell can implement them without touching any screen:

```ts
interface DeviceSecurityProvider {
  readonly canEnforceOsLockdown: boolean;   // false in the browser, honestly
  readonly disclosure: string;              // rendered in the interface

  identity(): DeviceIdentity;
  health(): DeviceHealth;                   // REAL | SIMULATED | UNAVAILABLE
  enterKioskMode(): Promise<{ entered: boolean; note: string }>;
  requestCamera(): Promise<{ granted: boolean; reason?: string }>;
  captureFrame(): Promise<CameraFrame>;
  scanFingerprint(scripted?): Promise<FingerprintResult>;
  reportHealth(payload): Promise<void>;
}
```

`BrowserDeviceSecurityProvider` implements it with real camera access where the
browser allows it, full-screen as an explicitly-labelled kiosk *simulation*, and
scripted fingerprint outcomes. Every method that cannot be real reports
`SIMULATED`, and the interface displays that.

---

## Key management abstraction

`apps/api/src/lib/crypto/keyProvider.ts`

```ts
interface KeyManagementProvider {
  readonly productionReady: boolean;
  generateDataKey(purpose): Promise<DataKey>;
  encrypt(key, plaintext, aad): Promise<EncryptedEnvelope>;
  decrypt(key, envelope, aad): Promise<Buffer>;
  sign(payload): Promise<string>;
  verify(payload, signature): Promise<boolean>;
  describe(): KeyProviderDescription;   // includes an honest warning string
}
```

- `LocalDevelopmentKeyProvider` — real AES-256-GCM and Ed25519, ephemeral keys in
  process memory. `productionReady: false`, and its `describe()` warning is
  rendered anywhere key metadata appears.
- `CloudKmsProvider` — deliberately **unimplemented**. Every method throws with a
  clear message. The POC must not give the impression that a managed KMS is
  wired up.

Encryption keys and signing keys are separate. The API refuses to start when
`NODE_ENV=production` and `KEY_PROVIDER=local`.

---

## Request pipeline

```
request
  → helmet          CSP, frame protection, HSTS in production
  → CORS            exact origin only, credentials enabled
  → cookie          signed, HTTP-only session cookie
  → rate limit      per address, per minute
  → onRequest       build context: session, user, client address, trace id
  → preHandler      CSRF double-submit check on every cookie-auth mutation
  → route           Zod validation → permission check → service
  → onResponse      record response time for the p95 metric
  → error handler   AppError → structured body with guidance + answersSafe
```

Every error the user can see carries four things: a code, a message, `guidance`
telling them what to do, and `answersSafe` so the candidate interface can state
plainly whether their work is affected.

---

## Data model

`apps/api/prisma/schema.prisma` holds the full production model — 25 entities
covering identity, centres and devices, questions and versions, exams and
manifests, candidates and attempts, answers and events, evidence and proctoring,
incidents and audit.

Integrity rules expressed as constraints rather than convention:

| Rule | Mechanism |
| --- | --- |
| One attempt per candidate per exam | `@@unique([examId, candidateId])` on `ExamAttempt` |
| One immutable assignment per attempt | `attemptId String @unique` on `CandidateAssignment` |
| A replayed key is never applied twice | `@@unique([attemptId, idempotencyKey])` on `AnswerEvent` |
| Two different people must approve | `@@unique([manifestId, approverUserId])` on `ExamPublicationApproval` |
| Question versions are additive | `@@unique([questionId, version])`, new rows only |
| One answer per assigned question | `assignmentQuestionId String @unique` on `Answer` |
| Audit events are unique and ordered | `sequence @unique`, `hash @unique` |

The in-memory driver mirrors these collections one-for-one, so switching drivers
is a repository change rather than a redesign.
