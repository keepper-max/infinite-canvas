# Independent platform API.
FROM node:22-bookworm-slim AS api-build

WORKDIR /app
COPY server/api/package.json server/api/package-lock.json ./
RUN npm ci
COPY server/api/tsconfig.json ./
COPY server/api/src ./src
COPY server/api/db ./db
RUN npm run build

FROM api-build AS api-test

COPY server/api/tests ./tests
CMD ["npm", "test"]

FROM node:22-bookworm-slim AS api-prod-deps

WORKDIR /app
COPY server/api/package.json server/api/package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim AS api

ENV NODE_ENV=production
WORKDIR /app
RUN sed -i \
      -e 's|deb.debian.org/debian|mirrors.aliyun.com/debian|g' \
      -e 's|security.debian.org/debian-security|mirrors.aliyun.com/debian-security|g' \
      /etc/apt/sources.list.d/debian.sources \
    && apt-get -o Acquire::Retries=5 update \
    && apt-get -o Acquire::Retries=5 install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN node -e "fetch('http://mirrors.aliyun.com/debian/pool/main/f/fonts-wqy-zenhei/fonts-wqy-zenhei_0.9.45-8_all.deb').then((response) => { if (!response.ok) throw new Error(String(response.status)); return response.arrayBuffer(); }).then((body) => require('node:fs').writeFileSync('/tmp/fonts-wqy-zenhei.deb', Buffer.from(body)))" \
    && echo "cfed2c29164ff2f133e40ed2046610b172b8618d174840936ac4ec9b6fd668e7  /tmp/fonts-wqy-zenhei.deb" | sha256sum --check --strict \
    && dpkg --install /tmp/fonts-wqy-zenhei.deb \
    && rm /tmp/fonts-wqy-zenhei.deb
COPY --from=api-build /app/package.json /app/package-lock.json ./
COPY --from=api-prod-deps /app/node_modules ./node_modules
COPY --from=api-build /app/dist ./dist
COPY --from=api-build /app/db ./db

EXPOSE 3002
CMD ["node", "dist/index.js"]

# Existing global model proxy remains isolated from account and project APIs.
FROM oven/bun:1.3.13 AS model-proxy

WORKDIR /app
COPY token360-proxy.mjs /app/server.mjs

EXPOSE 3001
CMD ["bun", "run", "/app/server.mjs"]

# Build the existing Vite frontend. Keeping this after API targets avoids making
# legacy Docker builders compile the frontend when only API tests are requested.
FROM node:22-bookworm-slim AS web-build

WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci --legacy-peer-deps --no-audit --no-fund --registry=https://registry.npmmirror.com
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN npm run build

# Same-origin entrypoint for the SPA, platform API, and managed model gateway.
FROM nginx:1.27-alpine AS web

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/web/dist /usr/share/nginx/html
RUN chmod -R a+rX /usr/share/nginx/html

EXPOSE 3000
