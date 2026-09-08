# Local setup

## Requirements

- **Node.js 20.10 or later** (`node -v`)
- npm 10 or later
- Docker Desktop — optional, only for the full infrastructure stack

Nothing else. The API runs with in-process adapters by default, so no database,
cache or object store is required to demonstrate the platform.

---

## Option A — run it directly (recommended)

```bash
npm install
npm run dev
```

That starts both applications:

| Surface | URL |
| --- | --- |
| Administration and invigilation | http://localhost:5173 |
| Candidate workstation | http://localhost:5173/exam |
| API | http://localhost:4000/api/v1 |
| API documentation | http://localhost:4000/docs |

The web dev server proxies `/api` to the API on port 4000, so the browser only
ever talks to one origin and the session cookie stays first-party.

To run one side alone:

```bash
npm run dev:api    # API only, port 4000
npm run dev:web    # Web only, port 5173 (needs the API running)
```

### Environment configuration

Optional — every value has a working development default.

```bash
cp .env.example apps/api/.env
```

The API validates its configuration at startup with Zod and **refuses to start**
on an invalid one, printing exactly which variable is wrong. It also refuses to
start when `NODE_ENV=production` while either the development session secret or
`KEY_PROVIDER=local` is still in place.

See [`.env.example`](../.env.example) for every variable, its meaning and its
default.

---

## Option B — Docker Compose

Brings up PostgreSQL, Redis, MinIO, the API and the web client behind nginx.

```bash
docker compose up --build
```

| Service | URL | Credentials |
| --- | --- | --- |
| Web client | http://localhost:5173 | see demo accounts |
| API | http://localhost:4000/api/v1 | — |
| PostgreSQL | `localhost:5432` | `sep` / `development-only-password` |
| Redis | `localhost:6379` | — |
| MinIO console | http://localhost:9001 | `sep-development` / `development-only-secret` |

The `minio-init` service creates the private `exam-evidence` bucket and
explicitly removes anonymous access.

The API container still defaults to the in-memory drivers. To exercise the real
services, change these in `docker-compose.yml` once the corresponding adapters
are implemented:

```yaml
PERSISTENCE_DRIVER: postgres
CACHE_DRIVER: redis
OBJECT_STORE_DRIVER: s3
```

Useful commands:

```bash
docker compose logs -f api     # follow API logs
docker compose down            # stop
docker compose down -v         # stop and delete volumes
```

---

## Database migrations

The POC runs in memory, so migrations are not required to demonstrate it. The
Prisma schema is the production data model and is ready to migrate.

```bash
# Generate the Prisma client
npm run prisma:generate

# Create and apply a migration in development
npm run prisma:migrate

# Apply existing migrations (CI / deployment)
npm run prisma:deploy --workspace @sep/api
```

`DATABASE_URL` must be set. With Docker Compose running:

```bash
export DATABASE_URL="postgresql://sep:development-only-password@localhost:5432/secure_exam"
```

Inspect the data with Prisma Studio:

```bash
npx prisma studio --schema apps/api/prisma/schema.prisma
```

---

## Seeding the demonstration data

The dataset is rebuilt automatically on every API start. To rebuild it manually
and print a summary with the demo credentials:

```bash
npm run seed
```

```
Demonstration data seeded in 83 ms

  Examination      National Technical Aptitude Examination 2026 (NTAE-2026-01)
  Exams            3
  Questions        60
  Candidates       500
  Workstations     25
  Live attempts    478
  Audit events     46
```

### What is seeded

| Entity | Detail |
| --- | --- |
| Examinations | One **in progress** (NTAE-2026-01, 500 candidates, Maximum Assurance), one **published and upcoming** (RASP-2026-03, High Assurance), one **draft** (NSCA-2026-02, Enhanced) |
| Questions | 60 across six subjects — 50 approved and published into the live paper, plus 4 in review, 3 draft, 2 changes-requested and 1 retired. Six carry a second version so the difference view is real. |
| Candidates | 500 synthetic candidates, ~10 with approved accommodations, some provisional eligibility, some without fingerprint enrolment |
| Workstations | 25, including one revoked, one awaiting approval, one with a camera fault, two with degraded scanners and two with expiring certificates |
| Live sessions | 22 not started · 18 verifying · 380 active · 9 restricted · 12 requiring review · 28 disconnected · 31 submitted — **exactly 500** |
| Incidents | 7 spanning presence failures, multiple faces, camera blocked, device health, network change, unapproved workstation and rate limiting |
| Audit | A full history from examination creation through authoring, approval, policy change, assembly and publication to live activations |

Resetting from the interface: **Demo mode → Reset demo data** (super
administrator or security administrator). This clears all sessions, so everyone
must sign in again.

---

## Running the tests

```bash
npm test              # backend and frontend
npm run test:api      # 24 backend security and integrity tests
npm run test:web      # 27 frontend tests
```

See [testing.md](testing.md) for what each test protects.

---

## Building

```bash
npm run build       # type-checks the workspace, then builds both apps
npm run typecheck   # type-check only
```

The web build outputs to `apps/web/dist`. The API runs through `tsx`, so it needs
no build step for the POC — `npm start` runs it directly.

---

## Troubleshooting

**Port 4000 or 5173 already in use**

```bash
# Windows
netstat -ano | findstr :4000
taskkill /F /PID <pid>

# macOS / Linux
lsof -ti:4000 | xargs kill -9
```

**The web client shows "The examination service could not be reached"**

The API is not running or is on a different port. Confirm with:

```bash
curl http://localhost:4000/api/v1/health
```

**Sign-in returns 403 on a mutation**

The CSRF token is missing. The client attaches it automatically from the session;
if you are calling the API directly, send the `csrfToken` from the sign-in
response as an `X-CSRF-Token` header.

**"Demonstration controls are disabled in this environment"**

`ENABLE_DEMO_MODE` is false, or `NODE_ENV=production`. Demo mode is disabled in
production builds by design.

**The camera does not start**

Browsers only allow camera access on `localhost` or over HTTPS, and the user must
grant permission. If it is unavailable the candidate application falls back to a
clearly-labelled simulation mode — this is expected behaviour, not a failure.

**Everything reset unexpectedly**

With `PERSISTENCE_DRIVER=memory` the dataset is rebuilt on every API restart, and
the development signing key is regenerated with it. This is intended for a
demonstration; use the PostgreSQL driver for anything that must persist.
