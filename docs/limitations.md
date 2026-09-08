# POC limitations

An honest account of what this proof of concept does not do. Read it before any
client conversation, and do not let a screen be presented as more than it is.

---

## The headline

**This is a proof of concept, not a production-certified security system.**

It demonstrates architecture, workflow and user experience. Several controls that
would carry real security weight in production are simulated here, and every one
of them is labelled as such in the interface.

---

## Simulated controls

### Fingerprint verification

- A browser cannot read a fingerprint sensor. Nothing is scanned.
- Outcomes (`MATCH`, `LOW_QUALITY`, `MISMATCH`, `SCANNER_UNAVAILABLE`) are
  scripted through the presenter controls.
- No raw biometric data is handled anywhere. `biometricReferenceId` is a
  synthetic identifier with no relationship to any biometric.
- **Real:** the retry flow, the invigilator override, the mandatory reason and the
  audit record.
- **Production needs:** a certified scanner, an accredited matching service, and
  published false-accept and false-reject rates.

### Facial verification and presence

- Camera access and image capture are **real** where the browser allows them.
- The comparison is **not**. A mock analyser produces the verdict, and the
  workstation sends it with the capture — a production system evaluates frames
  server-side and never trusts a client-declared verdict.
- No liveness detection exists.
- Nothing infers race, emotion, age, gender or health, by design.
- **Real:** the challenge–capture–queue–upload–acknowledge cycle, evidence
  hash-chaining, the three-stage escalation, restriction that preserves answers,
  and the human review workflow.
- **Production needs:** a validated liveness and matching provider operating
  server-side.

### Key management

- `LocalDevelopmentKeyProvider` generates ephemeral keys in process memory.
- **They are regenerated on every restart.** Papers sealed before a restart
  cannot have their signatures verified afterwards. This is why the seed reseals
  everything at startup.
- `CloudKmsProvider` is deliberately unimplemented — every method throws.
- Release-window enforcement is application logic, not a key-service policy.
- **Real:** AES-256-GCM with a random per-exam data key and a unique nonce per
  operation, Ed25519 signing and verification, separate signing and encryption
  keys, and the manifest hash bound as additional authenticated data.
- **Production needs:** a cloud KMS or a dedicated HSM, with private key material
  never entering the application process.

### Device attestation and kiosk mode

- A browser cannot inspect secure boot, disk encryption, kiosk policy or
  application signature. Those readiness results are demonstration values.
- "Full-screen examination mode" is a presentation aid. It does not lock the
  operating system, and the interface says so.
- **Real:** device registration, approval, revocation, certificate lifecycle and
  expiry, and the enforcement that a revoked or unapproved workstation cannot
  start an attempt.
- **Production needs:** a native Windows shell with Assigned Access or WDAC, and
  TPM-backed attestation verified by an attestation service.

### Mutual TLS

- Certificate records, expiry, rotation and revocation are real data.
- No mutual TLS handshake occurs. The POC runs over plain HTTP locally.
- **Production needs:** a managed certificate authority, TPM-bound client keys and
  real mTLS termination with revocation checking.

### DDoS protection

- The incident simulator creates synthetic monitoring events. **No attack traffic
  exists.**
- **Real:** per-address rate limiting and temporary account lockout.
- **Production needs:** managed upstream DDoS protection and a WAF.

### Immutable audit

- The chain is genuinely hash-linked and genuinely has no update or delete path
  in the API.
- But it lives in the application's own store, so an actor with direct database
  access could rewrite it wholesale — the chain would be internally consistent
  again.
- **Production needs:** mirroring to independent WORM storage, and an application
  database role with `INSERT` and `SELECT` only.

---

## Infrastructure

### In-memory persistence by default

- `PERSISTENCE_DRIVER=memory` keeps everything in process memory.
- **All data is lost on restart**, including submitted attempts and receipts.
- The Prisma schema is the complete production model, but the PostgreSQL
  repository implementation is not written. Setting `PERSISTENCE_DRIVER=postgres`
  will not work until it is.
- The same applies to `CACHE_DRIVER=redis` and `OBJECT_STORE_DRIVER=s3`.

### Single instance

- No clustering, no leader election, no distributed locking.
- Rate-limit counters and the idempotency ledger are per process. Multiple
  instances would need Redis for both.
- The metrics series is in-process and resets on restart.

### Evidence storage

- Captured images are **not** stored. The evidence store writes a small synthetic
  placeholder and records real metadata: key, size, SHA-256, retention date and
  access log.
- Scheduled deletion is recorded but no deletion job runs.

---

## Functional gaps

### Marking and results

- Nothing is marked. No score is calculated, and no result is produced.
- `resultMode` is captured in the examination configuration but nothing acts on
  it.
- Negative marking is configured and displayed to the candidate, but never
  applied.

### Question types

- Single choice, multiple choice and true/false are fully delivered.
- **Short text and paragraph answers** can be authored, reviewed, delivered and saved.
  Paragraph word limits are enforced. A manual marking interface is still outstanding.
- No images, tables, mathematical notation, code blocks or media in questions.
- No comprehension passages shared across several questions.

### Navigation modes

- **Free** and **sequential** are enforced server-side.
- **Section-based** is selectable and stored, but sections are not modelled, so it
  currently behaves as free navigation.

### Candidate management

- CSV files can now select registered candidates in the wizard. The Import records
  page validates candidate, workstation, network and seat-assignment rows before commit.
- No candidate photograph upload or admit-card generation. Question bulk import is
  rejected explicitly; questions use the author/reviewer workflow.
- Candidate accounts cannot be created through the candidate-facing flow.

### Scheduling

- No multi-session scheduling, no seat allocation algorithm, no shift management.
- The examination window is a single start time plus a duration.

### Communications

- No email or SMS. No notifications leave the system.
- The notification centre reads incidents; it is not a message queue.

---

## Security gaps

- **No refresh-token rotation.** Short-lived sessions are used instead.
- **No multi-factor authentication for staff.** A high-stakes examination board
  should require it, particularly for publication approval.
- **No password policy** beyond a minimum length, and no password reset flow.
- **No IP allowlisting for staff**, only for candidate workstations.
- **No independent penetration test.** None has been commissioned.
- **No dependency scanning in CI.**
- **Session fixation on privilege change** is not specifically handled.
- **Client-declared monitoring verdicts** are trusted by the POC API. This is
  acceptable only because the whole monitoring path is a simulation; a production
  API must compute the verdict itself.
- **The demo headers** (`X-Demo-Client-Ip`) let a caller change the address used
  for allowlist evaluation. They are gated behind `ENABLE_DEMO_MODE`, which is
  forced off in production, but they must be removed before any real deployment.

---

## Accessibility

Built to the stated requirements — full keyboard operation, visible focus, real
labels, `role="alert"` validation, status never conveyed by colour alone, and
`prefers-reduced-motion` respected.

Not done:

- No formal WCAG 2.2 AA audit or conformance statement.
- No screen-reader testing with NVDA, JAWS or VoiceOver.
- No automated accessibility checks in CI.
- Colour contrast follows the specified palette but has not been measured
  ratio-by-ratio across every combination.
- No high-contrast theme, no text-resize testing beyond browser zoom.

---

## Scale and performance

- Seeded for 500 candidates; never load-tested at that concurrency.
- The invigilator table paginates, but the in-memory store filters and sorts the
  full collection on every request.
- The web bundle is ~1.15 MB (310 KB gzipped) and is not code-split. Acceptable
  on a controlled centre network; it would want splitting for a wider deployment.
- No caching layer in front of read-heavy endpoints.

---

## Browser support

- Targets current Chrome, Edge and Firefox.
- Camera capture needs `localhost` or HTTPS and user permission.
- Full-screen requires a user gesture, and browsers may still refuse it.
- Not tested on Safari, on mobile browsers, or on any assistive technology.

---

## Data

Everything in this repository is synthetic:

- All 500 candidates are fictional, generated from name pools.
- Every question was written for this POC. No real examination material is used.
- Photographs are neutral generated avatars, not images of real people.
- Biometric references are simulated identifiers.
- All credentials are development placeholders, marked as such in the interface,
  and must not exist in a production deployment.

---

## Before this becomes a product

The full list is in [security.md](security.md#production-hardening-checklist).
The five that gate everything else:

1. Replace the local key provider with a KMS or HSM.
2. Integrate certified biometric hardware and accredited matching services.
3. Build the native Windows shell for real kiosk enforcement and attestation.
4. Implement the PostgreSQL, Redis and S3 adapters, and mirror the audit chain to
   WORM storage.
5. Commission an independent penetration test and a load test at full candidate
   concurrency.
