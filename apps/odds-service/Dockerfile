# Google Chrome Stable Linux is amd64. Build with --platform linux/amd64 on ARM hosts.
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /service
COPY package.json package-lock.json prisma.config.ts ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
RUN test "$(dpkg --print-architecture)" = amd64 \
 && apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl fonts-liberation xvfb x11-utils tini gosu procps \
 && curl -fsSL https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb -o /tmp/chrome.deb \
 && apt-get install -y --no-install-recommends /tmp/chrome.deb \
 && rm /tmp/chrome.deb && rm -rf /var/lib/apt/lists/*
WORKDIR /service
# Keep Prisma CLI for the Railway pre-deploy migration; no network install at startup.
COPY --from=build --chown=node:node /service/node_modules ./node_modules
COPY --from=build /service/dist ./dist
COPY --from=build /service/prisma ./prisma
COPY --from=build /service/prisma.config.ts /service/package.json /service/package-lock.json ./
COPY runtime ./runtime
RUN mkdir -p /service/data && chown node:node /service/data
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3650 \
    BROWSER_RUNTIME=disabled BET365_ENABLED=false BETANO_ENABLED=false \
    BROWSER_MODE=headed DISPLAY=:99 CHROME_CHANNEL=chrome BROWSER_PERSISTENT=true \
    BROWSER_LOCALE=pt-BR BROWSER_TIMEZONE=America/Sao_Paulo \
    BROWSER_VIEWPORT_WIDTH=1440 BROWSER_VIEWPORT_HEIGHT=900 \
    DATA_DIR=/service/data BROWSER_PROFILE_DIR=/service/data/chrome-profile \
    BROWSER_SHARED_INSTANCE=true BROWSER_SHARED_CONTEXT=true PROVIDER_MAIN_TAB=true PROVIDER_DETAIL_TAB_MAX=1 \
    BROWSER_EVIDENCE_DIR=/service/data/evidence \
    INBOX_DIR=/service/data/inbox DETAIL_INBOX_DIR=/service/data/detail-inbox \
    BETANO_INBOX_DIR=/service/data/betano-inbox SUPERBET_INBOX_DIR=/service/data/superbet-inbox \
    CAPTURE_DIR=/service/data/captures BETANO_CAPTURE_DIR=/service/data/captures/betano
STOPSIGNAL SIGTERM
EXPOSE 3650
ENTRYPOINT ["/usr/bin/tini", "--", "/service/runtime/entrypoint.sh"]
CMD ["node", "dist/main.js"]
