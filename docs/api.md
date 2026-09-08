# API reference

Base path: `/api/v1` · Interactive documentation: `http://localhost:4000/docs`

All responses that carry question content, candidate identity or cryptographic
metadata are sent with `Cache-Control: no-store`.

---

## Authentication and headers

The session lives in an HTTP-only, signed cookie. The client never holds a token
it can read.

| Header | When | Purpose |
| --- | --- | --- |
| `X-CSRF-Token` | Every cookie-authenticated mutation | Double-submit token issued with the session. Missing or wrong → `403`. |
| `Idempotency-Key` | `PUT .../answers/:id` | 8–128 characters. A repeat returns the stored result rather than writing twice. |
| `X-Workstation-Code` | Candidate requests | Identifies the workstation. Verified against the device register. |
| `X-Trace-Id` | Optional | Propagated into audit events and echoed as `X-Trace-Id`. |
| `X-Demo-Client-Ip` | Demo mode only | Simulates an off-network workstation. Ignored when demo mode is off. |

---

## Error contract

Every error carries the same shape. `guidance` and `answersSafe` exist so the
candidate interface can always tell someone what to do and whether their work is
affected.

```json
{
  "error": {
    "code": "ANSWER_VERSION_CONFLICT",
    "message": "This answer was updated by another request while you were editing it.",
    "guidance": "Your previously saved answer is safe on the server. The latest saved value has been reloaded — check it and change it if needed.",
    "answersSafe": true,
    "details": { "serverVersion": 3 },
    "traceId": "0f2c…"
  }
}
```

| Code | Status | Meaning |
| --- | --- | --- |
| `UNAUTHENTICATED` | 401 | No session, or it expired |
| `INVALID_CREDENTIALS` | 401 | Sign-in details were wrong |
| `FORBIDDEN` | 403 | The role lacks the permission, or CSRF failed |
| `UNAUTHORIZED_DEVICE` | 403 | Workstation not registered, not approved, or revoked |
| `UNAUTHORIZED_NETWORK` | 403 | Client address outside the approved centre ranges |
| `NOT_FOUND` | 404 | Not found, or not owned by the caller |
| `VALIDATION_FAILED` | 400 | Schema validation failed; `details` carries the field errors |
| `CONFLICT` | 409 | State conflict, for example navigation paused |
| `ANSWER_VERSION_CONFLICT` | 409 | Optimistic concurrency mismatch |
| `ATTEMPT_FINALISED` | 409 | The attempt is submitted and locked |
| `ATTEMPT_NOT_ACTIVE` | 409 | The attempt is restricted or awaiting review |
| `TIME_EXPIRED` | 409 | The examination window has closed |
| `PAPER_INTEGRITY_FAILED` | 409 | The paper failed verification; release is blocked |
| `ACCOUNT_LOCKED` | 423 | Temporary lockout after repeated failures |
| `RATE_LIMITED` | 429 | Too many requests from this address |
| `INTERNAL_ERROR` | 500 | Unexpected failure; `traceId` identifies the log entry |

---

## Authentication

| Method | Path | Permission | Notes |
| --- | --- | --- | --- |
| `POST` | `/auth/login` | — | Staff sign-in. Returns the user and a `csrfToken`. |
| `POST` | `/auth/candidate-login` | — | Candidate sign-in with application ID, password and workstation code. |
| `POST` | `/auth/logout` | session | Destroys the session and clears the cookie. |
| `GET` | `/auth/session` | session | Current user, CSRF token, expiry and observed client address. |
| `GET` | `/auth/demo-accounts` | — | Development only. Refuses with `DEMO_DISABLED` otherwise. |

```http
POST /api/v1/auth/candidate-login
Content-Type: application/json
X-Workstation-Code: WS-CEC-001

{ "applicationId": "NTAE26-000001", "password": "Exam!2026", "workstationCode": "WS-CEC-001" }
```

---

## Examinations

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/exams` | `exams.read` |
| `GET` | `/exams/:examId` | `exams.read` |
| `POST` | `/exams` | `exams.write` |
| `PUT` | `/exams/:examId/security-policy` | `exams.securityPolicy.write` |
| `POST` | `/exams/:examId/assemble-paper` | `exams.write` |
| `POST` | `/exams/:examId/request-publication` | `exams.publish.request` |
| `POST` | `/exams/:examId/approve-publication` | `exams.publish.approve` |
| `GET` | `/exams/:examId/integrity` | `exams.read` |
| `GET` | `/security-profiles` | session |

`approve-publication` enforces separation of duties: the person who assembled the
paper cannot approve it (unless `ALLOW_SELF_APPROVAL` is explicitly enabled), and
one approver cannot record two decisions. Maximum Assurance requires two
different approvers. Integrity is re-verified immediately before publishing, and
a failure blocks it.

`GET /exams/:examId/integrity` re-runs verification on demand and returns the
manifest, the report, the approvals, the key-provider description and whether the
release window is currently open.

---

## Questions

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/questions` | `questions.read` |
| `GET` | `/questions/:questionId` | `questions.read` |
| `POST` | `/questions` | `questions.write` |
| `PUT` | `/questions/:questionId` | `questions.write` |
| `POST` | `/questions/:questionId/submit` | `questions.write` |
| `POST` | `/questions/:questionId/review` | `questions.review` |
| `GET` | `/questions/:questionId/diff` | `questions.read` |

`GET /questions` supports `search`, `subject`, `topic`, `difficulty`, `status`,
`author`, `type`, `page` and `pageSize`.

Rules the API enforces:

- An approved or published question cannot be edited by anyone — `409`.
- Only the author (or a super administrator) can edit or submit a draft.
- An author cannot approve their own question — `403`.
- Approval freezes the version and records its content hash.
- A reviewer holds no write permission, so editing an author's question is `403`.

---

## Candidate examination

All of these derive the candidate from the session. A candidate id, attempt id,
mark or remaining time supplied by the client is never trusted.

| Method | Path | Notes |
| --- | --- | --- |
| `GET` | `/attempts/context` | Everything the workstation needs: candidate, exam, centre, workstation, profile, flags, monitoring policy, network, existing attempt, server time |
| `POST` | `/attempts/preflight` | Runs the seven checks without creating an attempt |
| `POST` | `/attempts/activate` | Creates the attempt and its immutable assignment, or replays an existing one |
| `GET` | `/attempts/:attemptId` | Attempt state, summary, navigator |
| `GET` | `/attempts/:attemptId/question/:sequence` | One question. **Never** contains the answer key. |
| `PUT` | `/attempts/:attemptId/answers/:assignmentQuestionId` | Save an answer. Requires `Idempotency-Key`. |
| `GET` | `/attempts/:attemptId/review` | Answered, unanswered and flagged counts |
| `POST` | `/attempts/:attemptId/submit` | Locks the attempt and issues the receipt |
| `GET` | `/attempts/:attemptId/receipt` | The submission receipt |
| `POST` | `/attempts/:attemptId/reverify` | Records a reverification outcome |

### Saving an answer

```http
PUT /api/v1/attempts/{attemptId}/answers/{assignmentQuestionId}
Content-Type: application/json
X-CSRF-Token: …
Idempotency-Key: 8f0c9a4e-2b31-4c77-9d5a-1e6b0f3a72cd

{
  "selectedOptionIds": ["question-012-opt-3"],
  "textAnswer": null,
  "flagged": false,
  "expectedVersion": 0,
  "clientCapturedAt": "2026-09-08T10:14:02.881Z"
}
```

```json
{
  "answer": { "assignmentQuestionId": "…", "selectedOptionIds": ["…"], "version": 1, "flagged": false },
  "outcome": "COMMITTED",
  "committedAt": "2026-09-08T10:14:02.913Z",
  "summary": { "total": 50, "answered": 1, "unanswered": 49, "flagged": 0, "remainingSeconds": 7180 },
  "navigator": [ … ],
  "serverTime": "2026-09-08T10:14:02.913Z"
}
```

`outcome` is `COMMITTED` or `DUPLICATE_IGNORED`. The acknowledgement is only sent
after the record is committed, which is what lets the interface say "saved to the
server" honestly.

---

## Evidence

| Method | Path | Permission |
| --- | --- | --- |
| `POST` | `/evidence/challenge` | candidate |
| `POST` | `/evidence/upload-authorize` | candidate |
| `GET` | `/evidence/summary` | `invigilation.read` |

The upload response drives the candidate interface:

```json
{
  "acknowledged": true,
  "evidenceHash": "…",
  "result": "NO_FACE_DETECTED",
  "consecutiveFailures": 3,
  "response": "RESTRICT_NAVIGATION",
  "restricted": true,
  "message": "Question navigation is paused while your identity is confirmed. Every answer you have given is saved on the server and will not be lost. An invigilator has been notified.",
  "invigilatorNotified": true,
  "answersSafe": true,
  "simulated": true,
  "simulationNote": "POC simulation — the presence verdict is produced by a mock analyser on the workstation."
}
```

Evidence objects are never reachable through a public URL, carry a scheduled
deletion date from the retention policy, and log every access.

---

## Invigilation

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/invigilator/summary` | `invigilation.read` |
| `GET` | `/invigilator/sessions` | `invigilation.read` |
| `GET` | `/invigilator/sessions/:attemptId` | `invigilation.read` |
| `GET` | `/invigilator/alerts` | `invigilation.read` |
| `GET` | `/incidents/:incidentId` | `invigilation.read` |
| `POST` | `/invigilator/actions` | `invigilation.act` |

Actions: `REQUEST_REVERIFICATION`, `APPROVE_RECOVERY`, `EXTEND_TIME`,
`RESTRICT_SESSION`, `RELEASE_RESTRICTION`, `ESCALATE`, `ADD_NOTE`.

**Every action requires a `reason` of at least five characters** and writes an
audit event. Session detail deliberately excludes question content and candidate
answers; it returns `questionContentVisible: false` and says why.

---

## Administration

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/dashboard` | `exams.read` |
| `GET` | `/centres` | `centres.read` |
| `GET` | `/devices` · `/devices/:id` | `devices.read` |
| `POST` | `/devices` | `devices.write` |
| `POST` | `/devices/:id/actions` | `devices.write` (`devices.revoke` to revoke) |
| `POST` | `/devices/:id/readiness` | `devices.read` |
| `GET` | `/candidates` · `/candidates/:id` | `candidates.read` |
| `POST` | `/candidates` | `candidates.write` |
| `GET` | `/users` · `/roles` | `users.read` |

---

## Operations

| Method | Path | Permission |
| --- | --- | --- |
| `GET` | `/audit-events` | `audit.read` |
| `GET` | `/audit-events/verify` | `audit.read` |
| `GET` | `/system-health` | `system.health.read` |
| `GET` | `/health` | — (public liveness probe) |
| `GET` | `/glossary` | — |
| `GET` | `/poc-disclosure` | — |
| `POST` | `/demo-scenarios` | `system.health.read`, demo mode |
| `GET` | `/demo-scenarios` | demo mode |
| `POST` | `/demo-scenarios/reset` | `system.security.write`, demo mode |

There is **no** `PUT`, `PATCH` or `DELETE` route for `/audit-events` anywhere in
the API. That is the enforcement mechanism, not merely a convention.

Scenarios: `LOGIN_BURST`, `DDOS_TRAFFIC`, `SQL_INJECTION_ATTEMPT`,
`INVALID_EXAM_TOKEN`, `MODIFIED_QUESTION_ENVELOPE`, `REPLAYED_ANSWER_REQUEST`,
`REVOKED_DEVICE`, `DATABASE_SLOWDOWN`, `REDIS_UNAVAILABLE`, `INSTANCE_FAILURE`.

The simulator never executes a real attack. `MODIFIED_QUESTION_ENVELOPE` is the
one scenario that changes real state: it genuinely alters a stored question so
the integrity check genuinely fails and release is genuinely blocked.

---

## Limits

| Limit | Value |
| --- | --- |
| Request body | 1 MB |
| Rate limit | `RATE_LIMIT_MAX` per address per minute (default 600) |
| Login lockout | 5 consecutive failures → 10 minutes |
| Page size | Maximum 200 |
| Idempotency key | 8–128 characters |
| Evidence image | 2 MB declared size |
