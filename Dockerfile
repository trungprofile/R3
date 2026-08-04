# Multi-stage: one image serving the API, the React build, and the job scheduler
# (architecture.md §4.5 — no reverse proxy, no worker, no second container).
#
# The same image is used three ways, differing only in the command:
#   1. the app          -> the CMD below
#   2. the migration    -> npm run migrate:up --workspace @r3/server   (a SEPARATE
#                          deploy step, never on container start: a crash loop must
#                          not turn into a half-migrated database, §5.2)
#   3. seeding the box  -> node dist/scripts/qa-world.js
#
# Workspace caveat (§ npm), which the TODO previously here correctly warned about: npm
# hoists to a ROOT node_modules, so the runtime stage cannot simply copy `server/`.
# It is solved below by re-installing from the lockfile with --omit=dev scoped to the
# server workspace, so neither React nor any devDependency reaches the final image.

# ---------------------------------------------------------------- build
FROM node:22-slim AS build
WORKDIR /app

# Manifests first, so a source-only change reuses the cached install layer.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci

COPY . .

# Both halves. The client is Vite (-> client/dist); the server is tsc via
# tsconfig.build.json (-> dist/server/src, dist/shared/src, dist/scripts), which keeps
# shared/ and server/ siblings because server imports shared by relative path.
RUN npm run build --workspace @r3/client \
 && npm run build --workspace @r3/server

# ---------------------------------------------------------------- runtime
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Production dependencies only, and only the ones the server actually needs.
# --workspace @r3/server keeps react/react-dom out; --omit=dev keeps typescript, tsx,
# vitest and kysely-codegen out. Installing from the lockfile rather than copying the
# build stage's node_modules is what makes that scoping possible at all.
COPY package.json package-lock.json ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci --omit=dev --workspace @r3/server --include-workspace-root \
 && npm cache clean --force

# Compiled JavaScript. dist/package.json declares `type: module` — the emitted code is
# ESM, and without it Node reads the nearest package.json and guesses wrong.
COPY --from=build /app/dist ./dist

# The React build, served by Express. CLIENT_DIST overrides the source-tree-relative
# default in server/src/index.ts, which does not hold once the code is compiled.
COPY --from=build /app/client/dist ./client-dist
ENV CLIENT_DIST=/app/client-dist

# SQL migrations, for use 2 above. Forward-only and versioned in the repo (§5.2).
COPY server/migrations ./server/migrations

# Drop privileges. The `node` user ships with the base image; nothing here is written
# at runtime — Postgres holds all state, and D20 put store photos in the database
# precisely so there is no upload volume to own.
USER node

EXPOSE 3000

# Static assets are public (§4.3), so the SPA root is reachable without a session and
# makes an honest liveness probe. Node 22 has fetch built in — no curl in the image.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/src/index.js"]
