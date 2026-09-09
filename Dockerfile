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
RUN npm ci --legacy-peer-deps --no-audit --no-fund
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN npm run build

# Same-origin entrypoint for the SPA, platform API, and managed model gateway.
FROM nginx:1.27-alpine AS web

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/web/dist /usr/share/nginx/html

EXPOSE 3000
