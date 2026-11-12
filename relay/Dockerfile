# The relay as one container. No port is published: deploy/compose.yaml exposes it only through the tunnel.
FROM node:24.22.1-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
USER node
CMD ["node", "src/main.ts"]
