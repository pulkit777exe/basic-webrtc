# WebRTC Video Conferencing Application

A WebRTC video chat app with a React frontend and an Express backend. Signaling runs over WebSocket; room state lives in Redis; persistent data is stored in Postgres via Drizzle.

![License](https://img.shields.io/badge/license-ISC-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)

## Features

- Real-time audio/video using plain WebRTC (mesh)
- Auth with access/refresh tokens (stored in HTTP-only cookies)
- Waiting-room controls (admit/reject), room lock/passcodes, basic moderation
- Meeting recording (client-side capture + backend merge pipeline)
- Redis-backed real-time state and signaling fanout
- Postgres persistence via Drizzle ORM

## Architecture

```
basic-webrtc-app/
├── frontend/          # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── store/         # Jotai state management
│   │   └── icons/         # Custom icon components
│   └── package.json
├── backend/           # Bun + Express + TypeScript
│   ├── src/
│   │   ├── routes/        # REST API routes
│   │   ├── websocket/     # Signaling / realtime handler
│   │   ├── db/            # Drizzle + schema
│   │   └── server.ts      # Entry point
│   ├── drizzle/           # SQL migrations
│   └── package.json
├── docker-compose.yml
└── README.md
```

## Quick start

### Prerequisites

- Bun (backend scripts run via Bun)
- Node.js 18+ (frontend dev/build)
- PostgreSQL
- Redis

### 1. Clone the repo

```bash
git clone https://github.com/pulkit777exe/basic-webrtc-app.git
cd basic-webrtc-app
```

### 2. Set up environment variables

**Backend** (`backend/.env`):

```env
# Required
DATABASE_URL="postgresql://user:password@localhost:5432/webrtc_db"
JWT_SECRET="change-me"
JWT_REFRESH_SECRET="change-me-too"

# Usually needed in dev
ALLOWED_ORIGINS="http://localhost:5173"
REDIS_URL="redis://localhost:6379"
```

**Frontend** (`frontend/.env`):

```env
VITE_API_URL="http://localhost:4000"
# Optional (defaults to VITE_API_URL + /ws)
VITE_WS_URL="ws://localhost:4000/ws"
```

### 3. Install dependencies

```bash
# Backend
cd backend
bun install

# Frontend
cd ../frontend
pnpm install  # or npm install
```

### 4. Set up the database

```bash
cd backend
bun run db:migrate
```

### 5. Start dev servers

**Terminal 1 (backend):**

```bash
cd backend
bun run dev
```

**Terminal 2 (frontend):**

```bash
cd frontend
pnpm dev
```

The application will be available at:

- Frontend: http://localhost:5173
- Backend: http://localhost:4000

## Docker Deployment

### Using Docker Compose

```bash
# Build and start all services
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

Services:

- Frontend: http://localhost:3000
- Backend: http://localhost:4000
- PostgreSQL: localhost:5432
- Redis: localhost:6379

## Documentation

- Frontend notes: `frontend/README.md`
- Backend notes: `backend/README.md`
- Repo map: `CONTEXT.md`

## License

This project is licensed under the ISC License.

## Acknowledgments

- [Vite](https://vitejs.dev/) - Frontend tooling
- [TailwindCSS](https://tailwindcss.com/) - CSS framework

## Support

For issues and questions:

- Open an [Issue](https://github.com/pulkit777exe/basic-webrtc-app/issues)
- Check [Discussions](https://github.com/pulkit777exe/basic-webrtc-app/discussions)

---
