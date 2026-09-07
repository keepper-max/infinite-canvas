# 构建 Vite 前端产物。
FROM oven/bun:1.3.13 AS web-build

WORKDIR /app/web
COPY web/package.json web/bun.lock ./
RUN --mount=type=cache,target=/root/.bun/install/cache bun install --cache-dir=/root/.bun/install/cache
COPY VERSION /app/VERSION
COPY CHANGELOG.md /app/CHANGELOG.md
COPY web ./
RUN bun run build

# 运行镜像：Bun 同时提供静态页面与同源模型代理，真实 API Key 只存在于服务端环境变量。
FROM oven/bun:1.3.13

WORKDIR /app
COPY --from=web-build /app/web/dist /usr/share/infinite-canvas/html
COPY token360-proxy.mjs /app/server.mjs

EXPOSE 3000

CMD ["bun", "run", "/app/server.mjs"]
