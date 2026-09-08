# Testing

```bash
npm test              # everything
npm run test:api      # 24 backend tests
npm run test:web      # 27 frontend tests
```

The backend tests run against a real Fastify instance through `app.inject()`,
with a freshly seeded dataset per file. They exercise the actual HTTP surface —
routing, validation, session handling, CSRF and authorisation — not mocked
internals.

---

## Backend — `apps/api/src/tests/`

### `authorization.test.ts` — who may do what

| Test | What it protects |
| --- | --- |
| A candidate cannot access another candidate's attempt | Asserts **404**, not 403 — a candidate must not even learn the attempt exists |
| A candidate cannot answer a question outside their assignment | Knowing an identifier is not enough |
| A candidate cannot select an undelivered option | Option membership is checked against the delivered set |
| A question author cannot approve their own question | Separation of duties; the author holds no review permission at all |
| A reviewer cannot modify an approved question | Reviewers hold no write permission |
| An approved question cannot be edited even by its author | Approval freezes content so the recorded fingerprint stays valid |
| An invigilator cannot publish an examination | Publication is outside the invigilator role |
| An invigilator cannot read the question bank | Invigilators see sessions, never content |
| An administrator cannot edit or delete an audit event | `PUT`, `PATCH` and `DELETE` all return 404 — no such route exists — and the chain stays intact |
| Mutations without a CSRF token are refused | Double-submit protection is active |

### `examIntegrity.test.ts` — the paper

| Test | What it protects |
| --- | --- |
| A modified question fails verification and blocks release | Tampers with a stored question, asserts the report fails, then asserts a candidate activation is refused with `PAPER_INTEGRITY_FAILED` |
| The signature verifies with the issuing key | Ed25519 over the manifest hash; AES-256-GCM profile recorded |
| The correct answer is never delivered to the candidate | Asserts the raw HTTP body contains neither `isCorrect` nor `explanation`, and that `Cache-Control: no-store` is set |
| Dual approval requires two different approvers | The same approver is refused a second decision |
| The audit chain detects a rewritten entry | Mutates an entry in place, asserts verification fails at that exact sequence number, restores it |

The tamper test is deliberately end to end. It is not enough that a hash
comparison fails in isolation — the candidate must actually be refused.

### `attemptLifecycle.test.ts` — delivery

| Test | What it protects |
| --- | --- |
| A revoked device cannot activate an attempt | Refused with `UNAUTHORIZED_DEVICE`, and the guidance tells the candidate not to continue |
| An unregistered workstation cannot activate an attempt | Device registration is required |
| An unapproved network is rejected when allowlisting is on | Simulates an off-network address, asserts `UNAUTHORIZED_NETWORK` |
| A reconnection restores exactly the same randomised paper | Reads five questions, reconnects, reads them again, asserts identical stems and option ordering — and that exactly one assignment exists |
| A replayed idempotency key does not duplicate an event | Asserts `DUPLICATE_IGNORED` and exactly one `COMMITTED` event for that key |
| Concurrent answer updates are version-controlled | A stale write returns `ANSWER_VERSION_CONFLICT` with `answersSafe: true` and the server version; retrying with the right version succeeds |
| A submitted attempt cannot be modified, and the receipt matches | Asserts counts, hash format, receipt retrieval, `ATTEMPT_FINALISED` on further writes, and no second receipt on resubmission |
| Camera monitoring restricts navigation without losing answers | Asserts the exact escalation sequence, that navigation is blocked, that the saved answer survives, and that only an invigilator can release it |
| Every invigilator action records a reason | A missing reason is a 400; a supplied reason lands in the audit trail |

---

## Frontend — `apps/web/src/tests/`

### `answerSaving.test.tsx` — the candidate's most important interaction

Renders the **real** `useAnswerSaver` hook and the **real** `SaveIndicator`
through a thin harness, so the tests cover production code rather than a copy.

| Test | What it protects |
| --- | --- |
| Sends on selection and confirms it saved | Asserts the request carries `expectedVersion` and an idempotency key |
| Shows an honest retry state on failure | Asserts the guidance appears **and** the candidate's selection is still on screen |
| Reuses the same idempotency key on retry | Asserts the second call's key equals the first — this is what makes a retry safe |
| Reports a conflict without claiming loss | Asserts the "Answer reloaded" state and the "safe on the server" wording |

### `warningFlow.test.tsx` — how failure is communicated

Every failure state in this product must answer four questions. These tests hold
that contract.

| Test | What it protects |
| --- | --- |
| Always answers what happened, whether answers are safe, what to do, whether staff know | All four headings must be present |
| Says plainly when an invigilator has *not* been notified | No false reassurance |
| Warns honestly when answers may not have reached the server | `answersSafe: false` must read differently |
| Reassures rather than alarms while offline | Wording check on the offline banner |
| Never signals a check result by colour alone | Every state carries a readable text label |
| Offers a recovery action the candidate can take | The retry action is wired |

### `roleNavigation.test.tsx` — navigation matches permissions

Mirrors the navigation map from `AppShell` and asserts what each role sees. The
sidebar is a usability measure — the API enforces the same rules — but showing
someone a link that will refuse them is still a defect.

Covers: invigilators never see the question bank; authors never see the review
queue; reviewers cannot write; security administrators see devices, health and
audit but not candidate management; candidates get no administrative navigation
at all; and publication approval never reaches an invigilator or an author.

### `securityWizard.test.tsx` — policy derivation and validation

| Test | What it protects |
| --- | --- |
| Each profile expands to include every inherited control | Maximum Assurance is a superset of Standard |
| Every control is labelled, and anything not fully implemented carries a note | **This test found and fixed a real gap** — a simulated control shipped without its honest disclosure note |
| Enforcement flags escalate with the assurance level | The flags the backend actually reads |
| Maximum Assurance is recommended for a controlled-premise centre | The recommendation the wizard shows |
| A blueprint whose difficulty split does not add up is rejected | With an instructive message |
| The candidate notice must be long enough to be meaningful | "Camera on." is refused |
| A malformed network range is rejected | With a CIDR-form hint |
| Only the four documented snapshot intervals are accepted | 10, 15, 30, 60 |

---

## What is not covered

Stated plainly rather than implied:

- **No end-to-end browser tests.** The full candidate journey was verified
  manually through the browser during development; it is not automated. Playwright
  would be the natural addition.
- **No load testing.** The seeded dataset simulates 500 concurrent candidates,
  but no test drives real concurrency at that scale.
- **No accessibility automation.** The interface is built to the stated
  requirements and was checked by hand; `axe-core` in CI would make that
  continuous.
- **No visual regression testing.**
- **No adapter tests for PostgreSQL, Redis or S3**, because those adapters are
  interfaces with in-memory implementations in this POC.
- **Simulated controls are tested as simulations.** The fingerprint and face
  tests confirm the *workflow* — retry, override, escalation, audit — not any
  matching accuracy, because there is no real matcher to measure.

---

## Adding a test

Backend tests use the helpers in `apps/api/src/tests/helpers.ts`:

```ts
const app = await startApp();                                  // seeds + builds
const admin = await loginStaff(app, 'exam.admin@examboard.demo');
const candidate = await loginCandidate(app, 'NTAE26-000006', 'WS-CEC-013');
const activated = await activate(candidate, 'WS-CEC-013');
```

Use a candidate from `NTAE26-000001`–`NTAE26-000022` when you need to activate an
attempt: everyone else already has a seeded live session, and the platform
correctly refuses a second one.

Frontend tests use `renderWithProviders` from `apps/web/src/tests/utils.tsx`,
which supplies the router, the query client and the toast provider.
