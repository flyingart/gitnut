# gitnut website (R-SITE-2). Build context: repository root.
#   docker build -f packages/site/Dockerfile -t gitnut-site .
FROM oven/bun:1-alpine AS build
WORKDIR /repo
COPY packages/commons packages/commons
COPY packages/site packages/site
COPY docs/screenshots packages/site/public/screenshots
# @gitnut/commons has no dependencies; link it instead of installing the whole workspace.
RUN mkdir -p node_modules/@gitnut && ln -s ../../packages/commons node_modules/@gitnut/commons \
 && bun build packages/site/src/server.ts --target bun --outfile /out/src/server.js \
 && cp -r packages/site/public /out/public

FROM oven/bun:1-alpine
WORKDIR /app
COPY --from=build /out /app
ENV PORT=7431 HOST=0.0.0.0 NODE_ENV=production
EXPOSE 7431
USER bun
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:${PORT}/healthz || exit 1
CMD ["bun", "src/server.js"]
