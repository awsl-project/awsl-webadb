FROM oven/bun:1 AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS builder

COPY . .
RUN bun run build

FROM oven/bun:1 AS runtime-deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends adb ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=runtime-deps /app/package.json /app/bun.lock ./
COPY --from=runtime-deps /app/node_modules ./node_modules
COPY --from=builder /app/server ./server
COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV ADB_SERVER_HOST=127.0.0.1
ENV ADB_SERVER_PORT=5037

EXPOSE 3000 5037

CMD ["./docker-entrypoint.sh"]
