FROM oven/bun:1-alpine

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY index.html vite.config.ts tsconfig*.json components.json ./
COPY public ./public
COPY src ./src

EXPOSE 3000

CMD ["bun", "run", "dev", "--", "--host", "0.0.0.0", "--port", "3000"]
