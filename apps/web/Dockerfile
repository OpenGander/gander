# Multi-stage build for Next.js application

# Stage 1: Dependencies
FROM node:20-alpine AS deps
WORKDIR /app

# Toolchain for native addons (e.g. better-sqlite3, a dev-only adapter pulled in
# by npm ci). node:20-alpine ships no python3/make/g++, so node-gyp fails without
# these. This stage is intermediate — the toolchain is NOT in the final runner
# image (see Stage 3, which copies only the Next.js standalone output).
RUN apk add --no-cache python3 make g++

# Copy package files
COPY package.json package-lock.json* ./

# Install dependencies (npm ci if lockfile exists, npm install otherwise)
RUN if [ -f package-lock.json ]; then npm ci; else npm install; fi

# Stage 2: Builder
FROM node:20-alpine AS builder
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy source code
COPY . .

# Set environment variables for production build
ENV NEXT_TELEMETRY_DISABLED=1
# Limit Node.js memory to prevent OOM during cross-platform builds
ENV NODE_OPTIONS="--max-old-space-size=2048"

# Build Next.js application
# Run next build directly — prebuild SDK copy only works in monorepo context
RUN npx next build

# Stage 3: Runner (Production)
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Create non-root user
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built application
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["node", "server.js"]
