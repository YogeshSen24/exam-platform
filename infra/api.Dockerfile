# Examination API — development container.
FROM node:20-alpine

WORKDIR /app

# Install workspace dependencies first so they cache across source changes.
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/activation/package.json ./packages/activation/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN npm install --omit=optional --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/activation ./packages/activation
COPY apps/api ./apps/api

ENV NODE_ENV=development
EXPOSE 4000

# Runs through tsx so the workspace TypeScript sources are used directly.
CMD ["npm", "run", "start", "--workspace", "@sep/api"]
