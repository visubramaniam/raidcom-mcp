# syntax=docker/dockerfile:1

# The build stages run on the build machine's own platform: their output is plain JavaScript, the same for every
# target, so multi-arch builds don't run npm under QEMU emulation. Only the final stage is per platform.
# The base image follows the Node.js LTS line (24); Dependabot updates its digest, major moves are made by hand.

# ---- build: compile TypeScript ----
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc

# ---- production dependencies ----
FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

# ---- runtime ----
FROM node:24-alpine@sha256:06d7adf3e0ef61a13f1d28682726366f97a15aa1888c934d3ecec86c33918b53
LABEL org.opencontainers.image.title="raidcom-mcp" \
      org.opencontainers.image.description="MCP server that builds and validates Hitachi raidcom commands (build-only; community project, not an official Hitachi Vantara product)" \
      org.opencontainers.image.source="https://github.com/visubramaniam/raidcom-mcp" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY spec ./spec
USER node
# Default: MCP over stdio (docker run -i). To host it over HTTP, set RAIDCOM_TRANSPORT=http, RAIDCOM_HTTP_HOST=0.0.0.0,
# RAIDCOM_HTTP_TOKEN and RAIDCOM_HTTP_BEHIND_TLS_PROXY=true (see README.docker.md).
EXPOSE 8361
ENTRYPOINT ["node", "/app/dist/index.js"]
