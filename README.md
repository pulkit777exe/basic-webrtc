# WebRTC Video Conferencing Application

A modern, full-stack WebRTC video conferencing application built with React, TypeScript, Node.js, and LiveKit. Features include real-time video/audio communication, user authentication, profile management, and meeting recording capabilities.

![License](https://img.shields.io/badge/license-ISC-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)

## Features

- **Real-time Video Conferencing** - High-quality video and audio powered by LiveKit
- **Secure Authentication** - JWT-based auth with HTTP-only cookies
- **User Profiles** - Manage display names and passwords
- **Meeting Recording** - Record entire meetings with screen capture
- **Modern UI** - Clean, responsive interface with dark mode
- **Toast Notifications** - User-friendly feedback with Sonner
- 🗄️ **PostgreSQL Database** - Robust data persistence with Prisma ORM

## Architecture

```
basic-webrtc-app/
├── frontend/          # React + TypeScript + Vite
│   ├── src/
│   │   ├── components/    # React components
│   │   ├── store/         # Jotai state management
│   │   └── icons/         # Custom icon components
│   └── package.json
├── backend/           # Node.js + Express + TypeScript
│   ├── src/
│   │   ├── controllers/   # Business logic
│   │   ├── routes/        # API routes
│   │   ├── schemas/       # Zod validation schemas
│   │   └── server.ts      # Entry point
│   ├── prisma/
│   │   └── schema.prisma  # Database schema
│   └── package.json
├── docker-compose.yml
└── README.md
```

## Quick Start

### Prerequisites

- **Node.js** >= 18.0.0
- **PostgreSQL** (or use Docker)
- **LiveKit Server** (cloud or self-hosted)
- **pnpm** (recommended) or npm

### 1. Clone the Repository

```bash
git clone https://github.com/pulkit777exe/basic-webrtc-app.git
cd basic-webrtc-app
```

### 2. Set Up Environment Variables

**Backend** (`backend/.env`):

```env
# Database
DATABASE_URL="postgresql://user:password@localhost:5432/webrtc_db"

# LiveKit
LIVEKIT_URL="wss://your-livekit-server.com"
LIVEKIT_API_KEY="your-api-key"
LIVEKIT_API_SECRET="your-api-secret"

# JWT
JWT_SECRET="your-super-secret-jwt-key"

# CORS
FRONTEND_URL="http://localhost:5173"
```

**Frontend** (`frontend/.env`):

```env
VITE_APP_BACKEND_URL="http://localhost:3000"
VITE_LIVEKIT_URL="wss://your-livekit-server.com"  # Optional override
```

### 3. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
pnpm install  # or npm install
```

### 4. Set Up Database

```bash
cd backend
npx prisma generate
npx prisma migrate dev --name init
```

### 5. Start Development Servers

**Terminal 1 - Backend:**

```bash
cd backend
npm run dev
```

**Terminal 2 - Frontend:**

```bash
cd frontend
pnpm dev
```

The application will be available at:

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3000

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

- **Frontend**: http://localhost:5173
- **Backend**: http://localhost:3000
- **PostgreSQL**: localhost:5432

### Individual Docker Commands

**Backend:**

```bash
cd backend
docker build -t webrtc-backend .
docker run -p 3000:3000 --env-file .env webrtc-backend
```

**Frontend:**

```bash
cd frontend
docker build -t webrtc-frontend .
docker run -p 5173:5173 webrtc-frontend
```

## Documentation

- [Frontend README](./frontend/README.md) - Frontend architecture and development
- [Backend README](./backend/README.md) - API documentation and backend details
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
- [Developer Guide](#developer-guide) - Detailed development workflow

## Tech Stack

### Frontend

- **React 19** - UI library
- **TypeScript** - Type safety
- **Vite** - Build tool
- **TailwindCSS** - Styling
- **LiveKit Components** - WebRTC UI components
- **Jotai** - State management
- **Sonner** - Toast notifications
- **Zod** - Schema validation

### Backend

- **Node.js** - Runtime
- **Express** - Web framework
- **TypeScript** - Type safety
- **Prisma** - ORM
- **PostgreSQL** - Database
- **LiveKit Server SDK** - WebRTC signaling
- **JWT** - Authentication
- **bcryptjs** - Password hashing

## Key Features Explained

### Authentication Flow

1. User registers with username, password, and display name
2. Backend hashes password with bcrypt and stores in PostgreSQL
3. On login, JWT token is issued and stored in HTTP-only cookie
4. All subsequent requests include the cookie for authentication

### Video Conferencing

1. User joins a room by entering a room name
2. Backend generates a LiveKit token with room permissions
3. Frontend connects to LiveKit server with the token
4. Real-time video/audio streams are established via WebRTC

### Recording

1. User clicks "Start Recording" in the meeting
2. Browser prompts to select screen/tab to record
3. MediaRecorder API captures video and audio
4. On stop, recording is downloaded as `.webm` file

## Testing

```bash
# Backend tests (when implemented)
cd backend
npm test

# Frontend tests (when implemented)
cd frontend
pnpm test

# Linting
cd frontend
pnpm lint
```

## API Endpoints

### Authentication

- `POST /auth/register` - Register new user
- `POST /auth/login` - Login user
- `GET /auth/me` - Get current user
- `POST /auth/logout` - Logout user
- `PUT /auth/profile` - Update user profile

### LiveKit

- `POST /getToken` - Generate LiveKit room token

See [Backend README](./backend/README.md) for detailed API documentation.

## Contributing

We welcome contributions! Please see our [Contributing Guide](./CONTRIBUTING.md) for details on:

- Code of Conduct
- Development workflow
- Pull request process
- Coding standards

## License

This project is licensed under the ISC License.

## Acknowledgments

- [LiveKit](https://livekit.io/) - WebRTC infrastructure
- [Prisma](https://www.prisma.io/) - Database ORM
- [Vite](https://vitejs.dev/) - Frontend tooling
- [TailwindCSS](https://tailwindcss.com/) - CSS framework

## Support

For issues and questions:

- Open an [Issue](https://github.com/pulkit777exe/basic-webrtc-app/issues)
- Check [Discussions](https://github.com/pulkit777exe/basic-webrtc-app/discussions)

---
