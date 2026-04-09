FROM oven/bun:1 AS deps

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM deps AS builder

COPY . .
RUN bun run build
RUN bun build --compile --minify ./server/index.ts --outfile ./awsl-webadb

FROM debian:bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends adb ca-certificates libstdc++6 \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/awsl-webadb ./awsl-webadb
COPY --from=builder /app/dist ./dist
COPY docker-entrypoint.sh ./docker-entrypoint.sh

RUN chmod +x ./docker-entrypoint.sh ./awsl-webadb

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
ENV HOME=/var/lib/awsl-webadb
ENV ADB_SERVER_HOST=127.0.0.1
ENV ADB_SERVER_PORT=5037
ENV STATIC_DIR=/app/dist

VOLUME ["/var/lib/awsl-webadb"]

EXPOSE 3000 5037

CMD ["./docker-entrypoint.sh"]
