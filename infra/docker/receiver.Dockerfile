FROM node:22.16.0-bookworm-slim AS build
WORKDIR /workspace
COPY package.json package-lock.json tsconfig.json ./
COPY types ./types
COPY canary/zep-core-canary/vendor/zep-core ./canary/zep-core-canary/vendor/zep-core
COPY packages ./packages
COPY services ./services
COPY apps ./apps
COPY docs ./docs
COPY tools/build ./tools/build
RUN npm ci --ignore-scripts --no-audit --no-fund && npm run build

FROM node:22.16.0-bookworm-slim
ENV NODE_ENV=production RECEIVER_HOST=0.0.0.0 RECEIVER_PORT=8788 RECEIVER_DB=/data/receiver.sqlite ZUNGUN_DATA_DIR=/data
WORKDIR /app
RUN useradd --system --uid 10001 --create-home zungun && mkdir -p /data && chown zungun:zungun /data
COPY --from=build --chown=zungun:zungun /workspace/dist ./dist
COPY --from=build --chown=zungun:zungun /workspace/services/receiver/openapi ./services/receiver/openapi
USER zungun
EXPOSE 8788
VOLUME ["/data"]
HEALTHCHECK --interval=10s --timeout=3s --retries=5 CMD ["node","-e","fetch('http://127.0.0.1:8788/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node","dist/services/receiver/src/server.js"]
