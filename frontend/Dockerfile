# ── Next.js frontend ──────────────────────────────────────────────────────────
# Multi-stage. Only the standalone output reaches the final image, so the build
# toolchain and dev dependencies are never shipped.
# Node 22 matches the version this project is developed against; Next 16 and
# React 19 both require a modern Node.

# ---- deps: install once, cache across source edits --------------------------
FROM node:22-alpine AS deps
WORKDIR /app
# .npmrc carries `legacy-peer-deps=true`, which this project needs: React 19 is
# newer than the peer range react-day-picker@8 declares. Without copying it the
# container build fails with ERESOLVE even though the same install succeeds on a
# developer machine, where npm reads .npmrc from the working directory.
COPY package.json package-lock.json .npmrc ./
# `npm ci` installs exactly the lockfile, which is what a reproducible build
# needs — `npm install` may quietly resolve different versions.
RUN npm ci

# ---- builder ----------------------------------------------------------------
FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# NEXT_PUBLIC_* values are inlined at BUILD time, not read at runtime, so the
# API URL has to be supplied here. Change it and you must rebuild the image —
# setting it in docker-compose `environment:` alone will not take effect.
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ---- runner -----------------------------------------------------------------
FROM node:22-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

# server.js does not copy `public` or `.next/static` itself — the docs are
# explicit that these must be placed alongside it, after which it serves them.
COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
