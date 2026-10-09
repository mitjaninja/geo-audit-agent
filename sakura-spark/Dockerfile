# Образ сервера Sakura Spark: API, бот и собранный клиент на одном порту.

# --- сборка клиента ---
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/sim/package.json packages/sim/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
RUN npm ci
COPY packages ./packages
COPY apps ./apps
COPY levels ./levels
RUN npm run build

# --- рантайм: только сервер, ядро и их зависимости ---
FROM node:22-slim
ENV NODE_ENV=production PORT=8787 DB_PATH=/data/sakura.db
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/sim/package.json packages/sim/
COPY apps/client/package.json apps/client/
COPY apps/server/package.json apps/server/
RUN npm ci --omit=dev -w @sakura/server -w @sakura/core && npm cache clean --force
COPY packages/core/src ./packages/core/src
COPY apps/server/src ./apps/server/src
COPY levels ./levels
COPY --from=build /app/apps/client/dist ./apps/client/dist
EXPOSE 8787
CMD ["node", "--disable-warning=ExperimentalWarning", "--import", "tsx", "apps/server/src/main.ts"]
