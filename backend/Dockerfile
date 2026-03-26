FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock tsconfig.json drizzle.config.ts ./
RUN bun install --frozen-lockfile

COPY src ./src
COPY drizzle ./drizzle

EXPOSE 4000

CMD ["bun", "run", "dev"]
