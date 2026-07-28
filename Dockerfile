# Multi-stage: one image serving the API, the React build, and the job scheduler.
#
# TODO: build/start commands land here once the workspaces have real dependencies
# and tooling. The staging below is the shape, not a working build.
#
# Workspace caveat (§ npm): npm hoists to a root node_modules, so the runtime stage
# cannot simply copy `server/`. Use `npm ci --workspace` or prune, otherwise client
# dependencies ride along into the production image.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
COPY shared/package.json ./shared/
COPY server/package.json ./server/
COPY client/package.json ./client/
RUN npm ci
COPY . .
# RUN npm run build --workspace @r3/client
# RUN npm run build --workspace @r3/server

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app .
EXPOSE 3000
# CMD ["node", "server/dist/index.js"]
