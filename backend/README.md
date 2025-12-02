# Backend - WebRTC Video Conferencing API

The backend service for the WebRTC video conferencing application, built with Node.js, Express, TypeScript, and Prisma.

## 🚀 Getting Started

### Prerequisites

- Node.js >= 18.0.0
- PostgreSQL database
- LiveKit server (cloud or self-hosted)

### Installation

```bash
# Install dependencies
npm install

# Generate Prisma Client
npx prisma generate

# Run database migrations
npx prisma migrate dev --name init
```

### Environment Variables

Create a `.env` file in the `backend/` directory:

```env
# Database Connection
DATABASE_URL="postgresql://user:password@localhost:5432/webrtc_db"

# LiveKit Configuration
LIVEKIT_URL="wss://your-livekit-server.com"
LIVEKIT_API_KEY="your-api-key"
LIVEKIT_API_SECRET="your-api-secret"

# JWT Secret (use a strong random string)
JWT_SECRET="your-super-secret-jwt-key-change-this-in-production"

# CORS Configuration
FRONTEND_URL="http://localhost:5173"

# Node Environment
NODE_ENV="development"
```

### Development

```bash
# Start development server with hot reload
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

The API will be available at `http://localhost:3000`

## 📡 API Documentation

### Authentication Endpoints

#### Register User

```http
POST /auth/register
Content-Type: application/json

{
  "username": "johndoe",
  "password": "securepassword123",
  "name": "John Doe"
}

Response: 200 OK
{
  "user": {
    "id": "uuid",
    "username": "johndoe",
    "name": "John Doe"
  }
}
```

#### Login

```http
POST /auth/login
Content-Type: application/json

{
  "username": "johndoe",
  "password": "securepassword123"
}

Response: 200 OK
Set-Cookie: token=<jwt-token>; HttpOnly; SameSite=Lax

{
  "user": {
    "id": "uuid",
    "username": "johndoe",
    "name": "John Doe"
  }
}
```

#### Get Current User

```http
GET /auth/me
Cookie: token=<jwt-token>

Response: 200 OK
{
  "user": {
    "id": "uuid",
    "username": "johndoe",
    "name": "John Doe"
  }
}
```

#### Update Profile

```http
PUT /auth/profile
Cookie: token=<jwt-token>
Content-Type: application/json

{
  "name": "John Smith",
  "password": "newpassword123"  // Optional
}

Response: 200 OK
{
  "success": true,
  "user": {
    "id": "uuid",
    "username": "johndoe",
    "name": "John Smith"
  }
}
```

#### Logout

```http
POST /auth/logout
Cookie: token=<jwt-token>

Response: 200 OK
Set-Cookie: token=; HttpOnly; Max-Age=0

{
  "success": true
}
```

### LiveKit Endpoints

#### Generate Room Token

```http
POST /getToken
Content-Type: application/json

{
  "roomName": "daily-standup",
  "participantName": "John Doe"
}

Response: 200 OK
{
  "token": "<livekit-jwt-token>",
  "url": "wss://your-livekit-server.com"
}
```

## 🗄️ Database Schema

### User Model

```prisma
model User {
  id        String   @id @default(uuid())
  username  String   @unique
  password  String   // Hashed with bcrypt
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

### Room Model

```prisma
model Room {
  id        String   @id @default(uuid())
  joined    String[] @default([])
  name      String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

## 🔐 Security

### Authentication Flow

1. **Registration**: Password is hashed using bcrypt (10 salt rounds)
2. **Login**: Credentials validated, JWT token generated
3. **Token Storage**: JWT stored in HTTP-only cookie
4. **Authorization**: Token verified on protected routes
5. **Logout**: Cookie cleared

### JWT Payload

```typescript
interface JwtPayload {
  userId: string;
}
```

### Cookie Configuration

```typescript
{
  httpOnly: true,              // Prevents XSS attacks
  secure: NODE_ENV === 'production',  // HTTPS only in production
  sameSite: 'lax',            // CSRF protection
  maxAge: 7 * 24 * 60 * 60 * 1000  // 7 days
}
```

## 🛠️ Technology Stack

- **Runtime**: Node.js 18+
- **Framework**: Express.js
- **Language**: TypeScript 5.9
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT + bcryptjs
- **Validation**: Zod
- **WebRTC**: LiveKit Server SDK
- **Dev Tools**: Nodemon, ts-node

## 📦 Dependencies

### Core Dependencies

```json
{
  "@prisma/client": "^7.0.1",
  "@prisma/adapter-pg": "^7.0.1",
  "express": "^4.21.2",
  "bcryptjs": "^3.0.3",
  "jsonwebtoken": "^9.0.2",
  "cookie-parser": "^1.4.7",
  "cors": "^2.8.5",
  "dotenv": "^17.2.3",
  "livekit-server-sdk": "^2.9.0",
  "zod": "^4.1.13",
  "pg": "^8.15.6"
}
```

### Dev Dependencies

```json
{
  "typescript": "^5.9.3",
  "nodemon": "^3.1.11",
  "ts-node": "^10.9.2",
  "prisma": "^7.0.1",
  "@types/node": "^24.10.1",
  "@types/express": "^5.0.0",
  "@types/bcryptjs": "^3.0.3",
  "@types/jsonwebtoken": "^9.0.7",
  "@types/cookie-parser": "^1.4.7",
  "@types/cors": "^2.8.17"
}
```

## 🔧 Configuration

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

### Prisma Configuration

The project uses Prisma v7 with a `prisma.config.ts` file:

```typescript
import "dotenv/config";
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
```

## 🚀 Deployment

### Production Build

```bash
# Build TypeScript
npm run build

# Start production server
npm start
```

### Environment Variables for Production

```env
DATABASE_URL="postgresql://user:password@prod-db-host:5432/webrtc_db"
LIVEKIT_URL="wss://prod-livekit-server.com"
LIVEKIT_API_KEY="prod-api-key"
LIVEKIT_API_SECRET="prod-api-secret"
JWT_SECRET="strong-random-production-secret"
FRONTEND_URL="https://your-frontend-domain.com"
NODE_ENV="production"
```

### Docker Deployment

See `Dockerfile` in the backend directory:

```bash
# Build image
docker build -t webrtc-backend .

# Run container
docker run -p 3000:3000 --env-file .env webrtc-backend
```

## 🧪 Testing

```bash
# Run tests (when implemented)
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

## 📊 Database Migrations

### Create a New Migration

```bash
npx prisma migrate dev --name add_new_feature
```

### Apply Migrations in Production

```bash
npx prisma migrate deploy
```

### Reset Database (Development Only)

```bash
npx prisma migrate reset
```

### View Database in Prisma Studio

```bash
npx prisma studio
```

## 🐛 Debugging

### Enable Debug Logging

```bash
# Set environment variable
DEBUG=* npm run dev

# Or in .env
DEBUG=express:*,prisma:*
```

### Common Issues

**Issue**: `PrismaClientKnownRequestError: Authentication failed`

- **Solution**: Check DATABASE_URL format and credentials

**Issue**: `CORS error from frontend`

- **Solution**: Verify FRONTEND_URL in .env matches frontend origin

**Issue**: `JWT verification failed`

- **Solution**: Ensure JWT_SECRET is the same across restarts

## 📈 Performance

### Optimization Tips

1. **Database Connection Pooling**: Configured via Prisma
2. **JWT Token Expiry**: Set appropriate maxAge for cookies
3. **Rate Limiting**: Consider adding express-rate-limit
4. **Caching**: Implement Redis for session storage (future enhancement)

## 🔒 Security Best Practices

- ✅ Passwords hashed with bcrypt
- ✅ HTTP-only cookies prevent XSS
- ✅ CORS configured for specific origins
- ✅ Environment variables for secrets
- ✅ Input validation with Zod
- ⚠️ Add rate limiting for production
- ⚠️ Implement request logging
- ⚠️ Add helmet.js for security headers

## 📝 Logging

Currently using console.log. For production, consider:

```typescript
import winston from "winston";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});
```

## 🤝 Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for backend-specific guidelines.

## 📄 License

ISC

---

**Need help?** Open an issue or check the main [README](../README.md)
