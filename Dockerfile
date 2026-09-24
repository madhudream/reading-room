# The Reading Room: one Bun process serves the API and bundles the app at startup.
FROM oven/bun:1.4-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8080
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY tsconfig.json ./
COPY src ./src
RUN mkdir -p .data && chown -R bun:bun /app
USER bun
EXPOSE 8080
CMD ["bun", "src/server.ts"]
