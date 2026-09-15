FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci --ignore-scripts && npm run db:generate
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl tini && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY --from=build --chown=node:node /service/node_modules ./node_modules
COPY --from=build /service/dist ./dist
COPY --from=build /service/prisma ./prisma
COPY --from=build /service/prisma.config.ts /service/package.json /service/package-lock.json ./
RUN mkdir -p /service/data && chown node:node /service/data
USER node
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3650 ODDS_RUNTIME=server \
    COLLECTION_ENABLED=false BROWSER_RUNTIME=disabled RAW_CAPTURE_ENABLED=false \
    PERSISTENCE_MODE=postgres DATA_DIR=/service/data
STOPSIGNAL SIGTERM
EXPOSE 3650
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/main.js"]
