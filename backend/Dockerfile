FROM oven/bun:1-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
ENV NODE_ENV=production
EXPOSE 4000
CMD ["bun", "run", "src/server.ts"]
