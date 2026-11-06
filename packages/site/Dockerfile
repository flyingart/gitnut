# gitnut website (R-SITE-2). Build context: repository root.
#   docker build -f packages/site/Dockerfile -t gitnut-site .
FROM oven/bun:1-alpine AS build
WORKDIR /repo
# Install only the site's dependencies (Astro); the other manifests are there for the lockfile.
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/client/package.json packages/client/
COPY packages/commons/package.json packages/commons/
COPY packages/daemon/package.json packages/daemon/
COPY packages/desktop/package.json packages/desktop/
COPY packages/web/package.json packages/web/
COPY packages/site/package.json packages/site/
RUN bun install --frozen-lockfile --filter @gitnut/site
COPY packages/commons packages/commons
COPY packages/site packages/site
# The README screenshots double as the gallery: public/ is copied into dist/ by the build.
COPY docs/screenshots packages/site/public/screenshots
RUN cd packages/site && bun run build \
 && bun build server/server.ts --target bun --outfile /out/server/server.js \
 && cp -r dist /out/dist

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=build /out /app
ENV PORT=7431 HOST=0.0.0.0 NODE_ENV=production
EXPOSE 7431
USER bun
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["bun", "server/server.js"]
