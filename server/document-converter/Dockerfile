FROM node:22-bookworm-slim
WORKDIR /converter
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && chmod -R a+rX /converter
COPY convert.mjs ./
USER node
ENTRYPOINT ["node", "--max-old-space-size=384", "/converter/convert.mjs"]
