# The relay as one container. No port is published: deploy/compose.yaml exposes it only through the tunnel.
FROM node:24.22.1-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src ./src
# The account registry is written here by the non-root process; a fresh volume inherits this owner.
RUN mkdir -p /data && chown node:node /data
USER node
CMD ["node", "src/main.ts"]
