# Security controls

This document separates what the proof of concept genuinely implements from what
it demonstrates, and lists what a production deployment must add.

---

## Authentication and session management

| Control | Status | Implementation |
| --- | --- | --- |
| Password hashing | **Implemented** | scrypt, N=16384 r=8 p=1, 64-byte key, per-user random salt, constant-time comparison |
| Session cookies | **Implemented** | HTTP-only, `SameSite=Lax`, signed, `Secure` in production. The client never holds a readable token. |
| Session lifetime | **Implemented** | Configurable TTL, expiry checked on every request, expired sessions deleted |
| Role-based access control | **Implemented** | Checked server-side on every route. The client copy shapes navigation only. |
| Login rate limiting | **Implemented** | Per-address limit via `@fastify/rate-limit` |
| Account lockout | **Implemented** | 5 consecutive failures → 10-minute lockout, tracked per identifier |
| CSRF protection | **Implemented** | Double-submit token issued with the session, required on every cookie-authenticated mutation |
| CORS | **Implemented** | Exact origin only, no wildcard, credentials enabled |
| Refresh-token rotation | Not implemented | Short-lived sessions are used instead; see the hardening checklist |

## Application security

| Control | Status | Implementation |
| --- | --- | --- |
| Request validation | **Implemented** | Zod schemas on every body and query. Unknown input is rejected, not coerced. |
| Parameterised data access | **Implemented** | No string-concatenated queries anywhere. Prisma parameterises by construction. |
| Content Security Policy | **Implemented** | `default-src 'self'`, no inline scripts, `frame-ancestors 'none'`, `object-src 'none'` |
| Frame protection | **Implemented** | `X-Frame-Options: DENY` and CSP `frame-ancestors` |
| HSTS | Production-gated | Enabled when `NODE_ENV=production`, since it is meaningless without TLS |
| Request-size limits | **Implemented** | 1 MB body limit |
| Rate limits | **Implemented** | Per address, per minute, configurable |
| Secure error handling | **Implemented** | Internal errors are logged in full and never echoed. The client gets a code, a message, guidance and a trace id. |
| Log redaction | **Implemented** | Cookies, authorisation headers, CSRF tokens, passwords and `Set-Cookie` are redacted |
| Secrets in source control | **Implemented** | None. `.env` is git-ignored; `.env.example` holds only clearly-marked placeholders. |
| Environment validation | **Implemented** | The process refuses to start on an invalid configuration, or in production with development keys |
| `Cache-Control: no-store` | **Implemented** | On every response carrying question content, identity or cryptographic metadata |
| Dependency auditing | Manual | `npm audit`; see the hardening checklist |

## Question security

| Control | Status | Implementation |
| --- | --- | --- |
| Canonical representation | **Implemented** | Sorted keys, `undefined` dropped, no incidental whitespace |
| Content hashing | **Implemented** | SHA-256 per approved question version |
| Exam manifest | **Implemented** | Ordered entry list with per-question hashes, and its own hash |
| Digital signature | **Implemented** | Ed25519 over the manifest hash |
| Encryption | **Implemented** | AES-256-GCM, random 256-bit per-exam data key, unique 96-bit nonce per operation, manifest hash bound as AAD |
| Separate signing and encryption keys | **Implemented** | Distinct key material and references |
| Integrity verification before assignment | **Implemented** | Runs on every activation, not only at publication |
| Answer key withheld from the client | **Implemented** | `deliverQuestion()` has no code path that copies `isCorrect` or `explanation`; asserted against the raw HTTP body in tests |
| No unnecessary preloading | **Implemented** | Questions are fetched one at a time by sequence |
| Key custody | **Simulated** | `LocalDevelopmentKeyProvider` holds ephemeral keys in process memory |

## Answer security

| Control | Status | Implementation |
| --- | --- | --- |
| Ownership check | **Implemented** | Attempt loaded by id *and* candidate id; a foreign attempt returns `404`, not `403` |
| Assignment membership | **Implemented** | The question must be in this attempt's stored assignment |
| Option membership | **Implemented** | Every selected option must be in the delivered option set |
| Versioned updates | **Implemented** | Optimistic concurrency; a mismatch is a `409`, never an overwrite |
| Idempotent writes | **Implemented** | Ledger keyed by `attemptId:idempotencyKey`; a repeat is `DUPLICATE_IGNORED` |
| Append-only answer events | **Implemented** | Every attempt — committed, duplicate or conflicting — is recorded |
| Acknowledgement after commit | **Implemented** | The response is sent only after the record is written |
| Final answer-set hash | **Implemented** | SHA-256 over the canonical final answer set |
| Submission receipt | **Implemented** | Signed, carrying the answer-set hash, manifest hash, seed hash and audit anchor |
| Server-authoritative time | **Implemented** | Remaining time is derived from `expiresAt`; the client's clock is never trusted |
| Server-enforced navigation mode | **Implemented** | Sequential navigation is enforced by the API, not only hidden in the interface |

## Audit

| Control | Status | Implementation |
| --- | --- | --- |
| Hash chaining | **Implemented** | Each entry carries the previous entry's hash; its own hash covers that link |
| No update or delete path | **Implemented** | The audit module exports none, and no route exposes one. Tested. |
| Chain verification | **Implemented** | Recomputes the whole chain and reports the first broken sequence number |
| Mandatory reason | **Implemented** | Every administrative override and invigilator action requires one |
| Receipt anchoring | **Implemented** | The latest hash is embedded in every submission receipt |
| Independent WORM storage | **Not implemented** | Required for production; see the hardening checklist |

## Network and device

| Control | Status | Implementation |
| --- | --- | --- |
| IP allowlist | **Implemented** | CIDR evaluation against the exam's primary and backup ranges, enforced on activation |
| Device registration | **Implemented** | Only approved workstations can start an attempt |
| Device revocation | **Implemented** | Revoked devices are refused before eligibility is even evaluated |
| Certificate lifecycle | **Implemented** | Issue, expiry, expiring warning, rotation and revocation, all audited |
| Attempt–device binding | **Implemented** | An attempt stays tied to its workstation unless staff approve a recovery |
| Mutual TLS | **Simulated** | Certificate records are real; mTLS termination is not |
| Kiosk enforcement | **Simulated** | A browser cannot lock the operating system |
| Device attestation | **Simulated** | A browser cannot attest secure boot, disk encryption or application signature |

## Monitoring and privacy

| Control | Status | Implementation |
| --- | --- | --- |
| Server-issued capture challenge | **Implemented** | Each capture is bound to a challenge the server issued |
| Evidence hash chaining | **Implemented** | Each capture is chained to the previous one, so a removed frame is detectable |
| Local queue with acknowledged release | **Implemented** | The workstation copy is released only after the server acknowledges |
| Progressive response | **Implemented** | Subtle warning → prominent warning → restriction, thresholds from policy |
| Answers preserved under restriction | **Implemented** | Restriction pauses navigation only |
| Human decision required | **Implemented** | Software never terminates an attempt on automated analysis alone |
| Retention and scheduled deletion | **Implemented** | Every object carries a deletion date derived from policy |
| Access logging | **Implemented** | Every evidence access is recorded with reviewer, time and reason |
| No public URLs | **Implemented** | Evidence is referenced by internal key only |
| No sensitive attribute inference | **Implemented** | Nothing infers race, emotion, age, gender or health, by design |
| No model training use | **Implemented** | Stated in policy and not implemented anywhere |
| Face/liveness analysis | **Simulated** | A mock analyser produces the verdict |

---

## Threat coverage

| Threat | Response |
| --- | --- |
| Impersonation at the workstation | Application ID and password, optional fingerprint and face, invigilator override with a recorded reason |
| Paper leaked from storage or a backup | AES-256-GCM encryption; the stored package is unreadable without the key |
| Question altered after approval | SHA-256 comparison before every release; a mismatch blocks it and raises a critical incident |
| Paper substituted wholesale | Ed25519 signature over the manifest; the ciphertext is bound to the manifest hash as AAD |
| Early access to the paper | Release window gating on the key |
| Answer submitted for another candidate | Ownership derived from the session; a foreign attempt is `404` |
| Answer injected for an unassigned question | Assignment-membership check |
| Forged option identifier | Option-membership check against the delivered set |
| Duplicate answer from a retry | Idempotency ledger |
| Lost update from a race | Optimistic concurrency with an explicit conflict |
| Answer changed after submission | The attempt is locked; further writes are `409` |
| Unapproved machine on the network | Device registration and approval, checked before release |
| Compromised machine reused after revocation | Revocation is checked first, before eligibility |
| Connection from outside the centre | IP allowlist against the centre's registered ranges |
| Credential stuffing | Rate limiting plus temporary lockout, both audited |
| SQL injection | Zod validation and parameterised access |
| Cross-site request forgery | Double-submit token on every cookie-authenticated mutation |
| Cross-site scripting | CSP with no inline scripts; React escapes by default |
| Clickjacking | `frame-ancestors 'none'` and `X-Frame-Options: DENY` |
| History rewritten to hide an action | Hash-chained audit with no update or delete path |
| One person controlling the whole paper | Separation of duties: authors cannot approve their own questions; assemblers cannot approve their own publication; Maximum Assurance requires two approvers |
| Availability loss | Continuous saving, offline queueing, reconnection to the same paper, degraded-but-available reporting |
| Volumetric attack | Rate limiting in the POC; managed upstream DDoS protection in production |

---

## Production hardening checklist

### Cryptography and key management
- [ ] Replace `LocalDevelopmentKeyProvider` with a cloud KMS or a dedicated HSM
- [ ] Hold signing keys in the HSM; never let private key material enter the application process
- [ ] Enforce release-window policy inside the key service, not only in application code
- [ ] Define and automate key rotation for signing and encryption keys separately
- [ ] Publish the manifest verification public key so signatures are independently verifiable
- [ ] Log every sign and decrypt operation to the key service's own audit trail

### Identity and biometrics
- [ ] Integrate a certified fingerprint scanner and an accredited matching service
- [ ] Integrate a validated liveness-detection and face-matching provider with published accuracy
- [ ] Keep biometric templates with the biometric service; store only opaque references
- [ ] Publish accuracy, false-accept and false-reject rates, and set thresholds explicitly
- [ ] Define and publish the accessibility exception path for candidates who cannot use biometrics
- [ ] Complete a data protection impact assessment before enabling biometric verification

### Device and network
- [ ] Deploy the native Windows shell with Assigned Access or WDAC
- [ ] Issue device certificates from a managed certificate authority with TPM-bound keys
- [ ] Terminate real mutual TLS and check revocation on every connection
- [ ] Verify TPM-backed attestation through an attestation service before releasing a paper
- [ ] Enforce network isolation, USB and Bluetooth policy at the operating system and network layer
- [ ] Automate certificate expiry monitoring and rotation

### Platform
- [ ] Terminate TLS at the edge and enable HSTS with preload
- [ ] Put managed DDoS protection and a WAF in front of the service
- [ ] Move sessions and rate-limit counters to Redis with persistence
- [ ] Run PostgreSQL with encryption at rest, point-in-time recovery and tested restores
- [ ] Mirror the audit chain to independent immutable / WORM storage
- [ ] Grant the application database role `INSERT` and `SELECT` only on the audit table
- [ ] Deploy multiple instances behind a load balancer with health-based routing
- [ ] Add refresh-token rotation with reuse detection if long sessions are needed

### Operations
- [ ] Add `npm audit` and dependency scanning to CI, and fail the build on high severity
- [ ] Add SAST and secret scanning to CI
- [ ] Commission an independent penetration test before the first live examination
- [ ] Ship structured logs to a SIEM with alerting on blocked and failed audit results
- [ ] Define and rehearse the incident-response runbook with the examination controller
- [ ] Load-test at the full candidate concurrency the centre will host
- [ ] Rehearse the business-continuity plan: network failure, instance failure, database failover

### Governance
- [ ] Publish the candidate privacy notice and the appeal process
- [ ] Agree evidence retention periods with the data protection officer
- [ ] Define who may access evidence and under what circumstances, and review the access log
- [ ] Establish the dual-approval roster and the escalation path for publication
- [ ] Record the accessibility conformance statement for the candidate application
- [ ] Remove every demonstration account and disable demo mode before go-live
