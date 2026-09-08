# Secure Examination Management and Delivery Platform

A client-presentable **proof of concept** for delivering high-stakes examinations
in an organisation-controlled examination centre, where the network, the
workstations, the cameras, the biometric devices and the operating-system
configuration are all managed by the organisation.

> **This is a proof of concept, not a production-certified security system.**
> Fingerprint matching, facial recognition, device attestation, KMS/HSM
> operations, mutual TLS, kiosk enforcement and DDoS protection are **simulated**
> and are labelled as such everywhere they appear in the interface.
> See [POC simulation versus production implementation](#poc-simulation-versus-production-implementation).

---

## What it demonstrates

The complete examination lifecycle, end to end:

1. An administrator creates an examination through a seven-step wizard.
2. Questions are authored and approved by a **different** person.
3. A named security profile is applied — administrators never choose algorithms.
4. The approved paper is frozen, fingerprinted, signed and encrypted.
5. Candidates are registered and assigned.
6. A candidate signs in from an authorised workstation.
7. Optional fingerprint and facial verification run.
8. The candidate receives their **own paper**, drawn from a sealed pool: the
   same number of questions from each category as everyone else, at the same
   spread of difficulty, but not the same questions.
9. Answers save continuously, with idempotent, version-controlled writes.
10. Optional camera-presence monitoring runs during the examination.
11. Suspicious events reach an invigilator dashboard.
12. Final answers are submitted and locked.
13. A tamper-evident submission receipt and audit report are produced.

It also puts the examination onto the machines in the room:

14. An administrator issues an **examination key** for a room and a sitting.
15. An invigilator pastes it into each machine, which then knows which of the
    board's examinations it is running and refuses to show a sign-in until it
    does.
16. The setup **lapses after four hours**, so a machine is never left armed
    overnight.
17. Every result carries the centre, room, sitting and machine it came from,
    signed into the receipt.

It exists to make four promises legible to technical and non-technical
stakeholders alike:

| Promise | How the platform keeps it |
| --- | --- |
| **The right student takes the examination** | Application ID and password at a registered workstation on an approved network, with optional fingerprint and face verification — and a human, never software alone, resolving any failure. |
| **The right question paper is delivered** | Every approved question is fingerprinted with SHA-256, assembled into a manifest signed with Ed25519, and encrypted with AES-256-GCM. Integrity is re-verified before every single release. |
| **Answers belong to the correct student and attempt** | Every write is checked for session ownership, assignment membership, option membership, attempt state and expected version, then acknowledged only after commit. |
| **The examination remains available** | Continuous saving, local queueing while offline, reconnection to the *same* stored paper, and an operations console that shows how failures and attacks are absorbed. |

---

## Quick start

Requires **Node.js 20.10+**. No database, cache or object store is needed — the
API runs with in-process adapters by default.

```bash
npm install
npm run dev
```

| Surface | URL |
| --- | --- |
| Administration and invigilation | http://localhost:5173 |
| Candidate workstation | http://localhost:5173/exam |
| API | http://localhost:4000/api/v1 |
| API documentation (Swagger UI) | http://localhost:4000/docs |

The demonstration dataset is rebuilt on every API start: 3 examinations, a bank
of 160 questions sealed into a pool of 150 from which each candidate draws 50,
500 candidates, 25 workstations and a full audit history.

### Before a real deployment

```bash
DEPLOYMENT_ID=your-board DEPLOYMENT_SECRET=<a long random secret> npm run dev
```

Every examination key is signed and encrypted under `DEPLOYMENT_SECRET`. The
development default is in this repository, so a key issued under it can be
forged by anyone holding a copy. See
[docs/examination-keys.md](docs/examination-keys.md).

### Demo accounts

Development-only credentials, surfaced on the sign-in screen and at
`GET /api/v1/auth/demo-accounts`. **They must not exist in a production
deployment.**

| Role | Email | Password |
| --- | --- | --- |
| Super administrator | `super.admin@examboard.demo` | `Demo!Pass2026` |
| Examination administrator | `exam.admin@examboard.demo` | `Demo!Pass2026` |
| Question author | `author@examboard.demo` | `Demo!Pass2026` |
| Question reviewer | `reviewer@examboard.demo` | `Demo!Pass2026` |
| Security administrator | `security.admin@examboard.demo` | `Demo!Pass2026` |
| Invigilator | `invigilator@examboard.demo` | `Demo!Pass2026` |

| Candidate | Application ID | Password |
| --- | --- | --- |
| Aarav Sharma | `NTAE26-000001` | `Exam!2026` |

Any seeded application ID from `NTAE26-000001` to `NTAE26-000500` works with the
same demonstration password. Candidates `NTAE26-000001` to `NTAE26-000022` have
not yet started, so they are the ones to use for a live sign-in demonstration.

---

## Documentation

| Document | Contents |
| --- | --- |
| [docs/examination-keys.md](docs/examination-keys.md) | Examination keys: what they carry, setting a machine up, where a result comes from |
| [docs/architecture.md](docs/architecture.md) | System design, request flow, integrity pipeline, adapters |
| [docs/setup.md](docs/setup.md) | Local setup, Docker, migrations, seeding, troubleshooting |
| [docs/api.md](docs/api.md) | Endpoint reference, headers, error contract |
| [docs/security.md](docs/security.md) | Controls implemented, threat coverage, hardening checklist |
| [docs/cloudflare.md](docs/cloudflare.md) | Cloudflare Workers Static Assets hosting notes |
| [docs/testing.md](docs/testing.md) | What is tested and why each test exists |
| [docs/demo-script.md](docs/demo-script.md) | The 10–15 minute presentation walkthrough |
| [docs/limitations.md](docs/limitations.md) | Everything this POC does not do |

---

## Repository layout

```
.
├── apps/
│   ├── api/                  Fastify + TypeScript examination service
│   │   ├── prisma/schema.prisma   Full production data model
│   │   └── src/
│   │       ├── config/       Environment validation
│   │       ├── data/         Demonstration seed (synthetic only)
│   │       ├── lib/          Crypto, audit chain, sessions, storage adapters
│   │       ├── routes/       REST API under /api/v1
│   │       ├── services/     Attempt, answer, monitoring, operations logic
│   │       └── tests/        Security and integrity test suite
│   └── web/                  React + Vite client (three connected experiences)
│       └── src/
│           ├── components/   Design system and domain components
│           ├── hooks/        Answer-saving state machine
│           ├── lib/          API client, session, device security, demo store
│           └── pages/        admin · candidate · invigilator · shared
├── packages/
│   ├── activation/           Examination keys: format, sealing, per-candidate draw
│   └── shared/               Types, Zod schemas, roles, security profiles, glossary
├── infra/                    Dockerfiles and nginx configuration
├── docs/                     Documentation
└── docker-compose.yml        PostgreSQL · Redis · MinIO · API · web
```

---

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Run the API and the web client together |
| `npm run dev:api` / `npm run dev:web` | Run one side only |
| `npm run build` | Type-check the workspace and build both applications |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run the backend and frontend suites |
| `npm run test:api` / `npm run test:web` | Run one suite |
| `npm run seed` | Rebuild and print the demonstration dataset |
| `npm run prisma:generate` | Generate the Prisma client |
| `npm run prisma:migrate` | Create and apply a migration |

---

## Technology

**Frontend** — React 18, TypeScript, Vite, Tailwind CSS, React Router, TanStack
Query, Zustand, React Hook Form, Zod, Lucide, Recharts.

**Backend** — Node.js 20, TypeScript, Fastify, Zod, Prisma schema for
PostgreSQL, Redis-compatible cache interface, S3/MinIO-compatible object store,
structured Pino logging, OpenAPI/Swagger.

**Infrastructure** — Docker Compose for PostgreSQL, Redis, MinIO, the API and
the web client. Every infrastructure dependency sits behind an adapter with an
in-memory implementation, so the POC runs anywhere Node runs.

---

## POC simulation versus production implementation

This table is also served live at `GET /api/v1/poc-disclosure` and rendered in
the interface under **Security profiles → POC versus production**.

| Capability | POC implementation | Production requirement |
| --- | --- | --- |
| Fingerprint | Simulated scanner adapter with scripted outcomes | Certified scanner and an accredited biometric matching service |
| Facial recognition | Real camera capture, simulated/local comparison | Validated liveness detection and a matching provider with published accuracy |
| KMS / HSM | `LocalDevelopmentKeyProvider`, keys in process memory | Cloud KMS or a dedicated HSM with policy-controlled key release |
| mTLS | Simulated device status with real certificate records | Managed certificate authority with TPM-bound keys and real mTLS termination |
| Kiosk mode | Full-screen browser simulation | OS-level Assigned Access / WDAC or equivalent managed lockdown |
| DDoS protection | Synthetic event simulation in the operations console | Managed upstream DDoS protection at the network edge |
| Immutable audit | Append-only hash-chained application model | Independent immutable / WORM storage outside the application's control |
| Device attestation | Values reported by a simulated device agent | TPM-backed attestation verified by an attestation service |

### What *is* genuinely implemented

Not everything here is a mock. The following are real, working code paths, and
the test suite proves it:

- SHA-256 fingerprinting over a canonical question representation
- Ed25519 signing and verification of the exam manifest
- AES-256-GCM encryption with a random per-exam data key and a unique nonce per
  operation, with the manifest hash bound as additional authenticated data
- Pre-release integrity verification that genuinely blocks a tampered paper
- Deterministic per-attempt randomisation over a sealed pool, so two candidates
  sit different questions of identical shape, generated once and replayed on
  reconnection
- Ed25519-signed, AES-256-GCM examination keys, recorded by fingerprint and
  never stored
- Machine setup that expires on its own, and results stamped with the centre,
  room, sitting and machine they came from
- Server-side ownership, assignment-membership and option-membership checks
- Idempotent answer writes and optimistic concurrency control
- A hash-chained audit trail with no update or delete path anywhere in the API
- Role-based access control enforced on every request
- scrypt password hashing, HTTP-only signed session cookies, CSRF protection,
  exact-origin CORS, CSP, rate limiting and temporary account lockout

---

## Accessibility

The interface is built to be usable without a mouse and without relying on
colour:

- Full keyboard navigation, including the examination itself (`1`–`9` to answer,
  `N`/`P` to move, `F` to flag, `C` to clear, `?` for help)
- Visible focus indicators everywhere; the focus ring is never removed
- Real `<label>` elements, `aria-describedby` validation and `role="alert"`
- Status is always carried by an icon and a text label as well as a colour
- `prefers-reduced-motion` respected
- Skip links on every shell

---

## Licence and data

All content in this repository is synthetic. No real candidate, biometric or
examination material is used anywhere. Candidate photographs are neutral
generated avatars; biometric references are simulated identifiers, and no raw
fingerprint or face template is stored at any point.
