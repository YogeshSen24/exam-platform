# Cloudflare Hosting

This repository is a Vite frontend plus a Node/Fastify API. Cloudflare can host
the frontend with Workers Static Assets, and the included Worker forwards
`/api/*` and `/docs/*` to the existing API origin.

Pages-only hosting is not enough for the full application, because the browser
client calls `/api/v1` and the Fastify service is a Node server. Keep the API on
a reachable Node host, or port the API to a Worker-native fetch handler later.

## Files Added

- `wrangler.toml` configures the Cloudflare Worker and static asset directory.
- `apps/web/cloudflare-worker.js` serves the Vite build and proxies API/docs
  requests to `API_ORIGIN`.
- `package.json` includes `build:cloudflare` and `deploy:cloudflare`.

## API Requirements

Set the API host environment so browser requests from Cloudflare are accepted:

```bash
WEB_ORIGIN=https://secure-exam-platform.<your-account>.workers.dev
CENTRAL_PUBLIC_URL=https://<your-api-origin>
SESSION_SECRET=<32+ character secret>
DEPLOYMENT_SECRET=<32+ character secret>
ENABLE_DEMO_MODE=true
```

For this proof of concept, keep `NODE_ENV=development` unless a production key
provider is implemented. The current API intentionally refuses to start in
production with the local development key provider.

## Deploy

Install dependencies and build the frontend:

```bash
npm install
npm run build:cloudflare
```

Configure the Worker variable that points to the running API:

```bash
npx wrangler secret put API_ORIGIN
```

Use a value like:

```text
https://api.example.com
```

Deploy to Cloudflare:

```bash
npm run deploy:cloudflare
```

The deployed Worker URL will serve the app. Requests under `/api/` and `/docs`
will be forwarded to the configured API origin.
