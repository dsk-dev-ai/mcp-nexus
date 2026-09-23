# ── MCP Nexus image ─────────────────────────────────────────────────────
# Node 22 type-stripping means the TS sources run directly — there is no
# build step. Runtime deps only; devDependencies are excluded.
FROM node:22-slim

# Run as a non-root user (hardened image — the process can never write as
# root). The stock `node` user (uid 1000) keeps bind-mounted data host-owned.
USER node

WORKDIR /app

# Keep the data dir node-owned: fresh named volumes inherit this ownership.
RUN mkdir -p /app/nexus-data && chown -R node:node /app

COPY --chown=node:node package.json package-lock.json* ./
RUN npm ci --omit=dev

COPY --chown=node:node . .

ENV MCP_NEXUS_HOME=/app/nexus-data
ENV MCP_NEXUS_PORT=3000
ENV MCP_NEXUS_HOST=0.0.0.0

EXPOSE 3000

VOLUME ["/app/nexus-data"]

ENTRYPOINT ["node", "src/index.ts"]
# Default: dashboard + REST API. Override with `compose ... command start`
# or `docker run ... start` for the stdio MCP gateway.
CMD ["dashboard"]