# syntax=docker/dockerfile:1.7

FROM node:22-alpine AS base
RUN apk add --no-cache tini curl
WORKDIR /opt/sales-bot

# ─── Deps ────────────────────────────────────────────────
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# ─── Build ───────────────────────────────────────────────
FROM base AS build
COPY --from=deps /opt/sales-bot/node_modules ./node_modules
COPY package.json tsconfig.json drizzle.config.ts ./
COPY src ./src
RUN npm run build

# ─── Prod deps ───────────────────────────────────────────
FROM base AS prod-deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# ─── Runtime ─────────────────────────────────────────────
FROM base AS runtime
ENV NODE_ENV=production
COPY --from=prod-deps /opt/sales-bot/node_modules ./node_modules
COPY --from=build    /opt/sales-bot/dist          ./dist
COPY package.json ./
COPY drizzle ./drizzle

RUN mkdir -p /opt/sales-bot/credentials /opt/sales-bot/uploads /opt/sales-bot/logs && \
    chown -R node:node /opt/sales-bot

USER node
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD curl -fsS http://localhost:3001/health || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "dist/index.js"]
