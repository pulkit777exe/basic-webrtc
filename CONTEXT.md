# WebRTC Video Conferencing Application - Deep Dive

## Overview

This is a modern, full-stack WebRTC video conferencing application built from scratch with React, TypeScript, Node.js, and PostgreSQL. The application enables real-time video/audio communication, chat, screen sharing, and meeting management with a clean, responsive interface.

## Architecture

### High-Level Architecture

```
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (React)                                 │
├───────────────────────────────────────────────────────────────────────────────┤
│ • Video Grid & UI Components          • WebRTC (RTCManager)                   │
│ • Chat & Participants Panels          • WebSocket (WSManager)                 │
│ • Media Management (MediaManager)     • State Management (Jotai)              │
└───────────────────────────────────────────────────────────────────────────────┘
                                    ↕️ HTTP & WebSocket
┌───────────────────────────────────────────────────────────────────────────────┐
│                              Backend (Express)                                │
├───────────────────────────────────────────────────────────────────────────────┤
│ • RESTful API Routes                  • WebSocket Handler                     │
│ • Authentication & Authorization      • Room Management                       │
│ • Redis Pub/Sub for Signaling         • PostgreSQL Database (Drizzle ORM)     │
└───────────────────────────────────────────────────────────────────────────────┘
                                    ↕️ Redis & PostgreSQL
┌───────────────────────────────────────────────────────────────────────────────┐
│                          Infrastructure & Storage                             │
├───────────────────────────────────────────────────────────────────────────────┤
│ • PostgreSQL (Room/Users/Messages)    • Redis (In-Memory State)               │
└───────────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### Frontend Architecture

#### 1. **Main Entry Point** (`frontend/src/App.tsx`)
- Sets up React Router with authentication guards
- Defines protected routes for dashboard and rooms
- Initializes Jotai state management
- Handles cookie consent and page transitions

#### 2. **Room Page** (`frontend/src/pages/RoomPage.tsx`)
- **Video Grid**: Displays local and remote participant streams in a responsive grid
- **Control Bar**: Manages media controls (audio, video, screen share, leave)
- **Chat Sidebar**: Real-time chat functionality with message history
- **Participants Panel**: Shows all room participants with roles and media states

#### 3. **WebRTC Management** (`frontend/src/lib/rtc-manager.ts`)
- **RTCPeerConnection**: Creates and manages peer connections
- **ICE Candidates**: Handles NAT traversal
- **Media Tracks**: Manages video/audio tracks and replacements for screen sharing
- **Signal Handling**: Processes WebRTC signals from WebSocket

#### 4. **WebSocket Management** (`frontend/src/lib/ws-manager.ts`)
- **Connection Establishment**: Connects to backend WebSocket server
- **Message Handling**: Processes join/leave, chat, media state, and admin messages
- **Signal Forwarding**: Routes WebRTC signals to RTCManager
- **Reconnection Logic**: Auto-reconnects with exponential backoff

#### 5. **Media Management** (`frontend/src/lib/media-manager.ts`)
- **Stream Acquisition**: Gets user media (camera/microphone)
- **Media Control**: Toggles audio/video, manages screen sharing
- **Stream Management**: Handles stream cleanup and track manipulation

#### 6. **State Management** (`frontend/src/store/`)
- **Atoms**: Jotai atoms for managing:
  - Room state
  - User information
  - Peers and participants
  - Local media state
  - UI state (chat/participants panels open/closed)

### Backend Architecture

#### 1. **Server Entry Point** (`backend/src/server.ts`)
- **Express App**: Initializes Express with CORS, body parser, and security middleware
- **WebSocket Server**: Handles WebSocket connections and authentication
- **Rate Limiting**: API rate limiting using Redis store
- **Error Handling**: Centralized error handling and logging

#### 2. **WebSocket Handler** (`backend/src/websocket/handler.ts`)
- **Connection Setup**: Validates room token and user, retrieves user profile
- **Message Routing**: Handles different message types:
  - WebRTC signals (offer/answer/ice)
  - Chat messages
  - Media state updates
  - Admin actions (kick, lock, promote)
  - Waiting room management
- **Redis Pub/Sub**: Forwards messages between server instances for scalability
- **Connection Monitoring**: Heartbeat and connection timeout handling

#### 3. **Room Management** (`backend/src/routes/rooms.ts`)
- **Room Creation**: Creates new rooms with host information
- **Room Join**: Handles join requests with passcode verification and waiting room
- **Room Info**: Returns room details and participant count
- **Room End**: Closes rooms and notifies participants
- **Messages**: Fetches chat history for rooms

#### 4. **Authentication** (`backend/src/routes/auth.ts`, `backend/src/services/auth.ts`)
- **User Registration**: Creates new users with password hashing (bcrypt)
- **User Login**: Authenticates users and issues JWT tokens
- **Profile Management**: Updates user profiles and passwords
- **Social Login**: Google OAuth integration

#### 5. **Redis Rooms** (`backend/src/lib/redis-rooms.ts`)
- **Room State**: Stores room metadata, participants, and media states in Redis
- **Participant Management**: Adds/removes peers, manages roles
- **Room Settings**: Handles room locking, waiting room, and max participants
- **Redis Pub/Sub**: Inter-server communication for room events

#### 6. **Database Schema** (`backend/src/db/schema.ts`)
- **Users**: Stores user information (email, name, avatar, googleId)
- **Rooms**: Stores room details (host, title, passcode, max participants)
- **Room Participants**: Tracks user participation in rooms with roles
- **Messages**: Stores chat messages with timestamps
- **Room Settings**: Configures room behavior (waiting room, chat, screen share)
- **OTP Codes**: For email verification

## Authentication Flow

### User Registration
1. User fills registration form (email, name, password)
2. Backend validates input and checks for existing user
3. Password is hashed with bcrypt and stored in PostgreSQL
4. Verification email is sent with OTP code
5. User verifies email with OTP code
6. User is registered and can login

### User Login
1. User provides email and password
2. Backend verifies credentials and checks password hash
3. JWT token is generated with user ID and expires in 24 hours
4. Token is stored in HTTP-only cookie
5. Frontend includes cookie in subsequent requests

### Google OAuth
1. User clicks Google login button
2. Redirected to Google OAuth consent screen
3. After approval, Google redirects back with code
4. Backend exchanges code for user information
5. User is authenticated and JWT token is issued

## Room Flow

### Room Creation
1. Authenticated user clicks "Create Room"
2. Backend generates unique room ID
3. Room is stored in PostgreSQL with host information
4. Room settings (waiting room, screen share, chat) are configured
5. Host is added as participant with host role

### Room Join
1. User enters room ID on join page
2. Backend verifies room exists and is not ended
3. If room has waiting room enabled, user is added to waiting room
4. If room is locked, passcode is required
5. If all checks pass, room token is generated and returned
6. Frontend connects to WebSocket server with room token

### Room Experience
1. **WebRTC Connection**:
   - Local media stream is acquired
   - WebSocket connection is established
   - ICE servers are retrieved from backend
   - When user joins, peers are created and offers are sent

2. **Media Controls**:
   - Toggle audio/video
   - Start/stop screen share
   - Replace video track for screen sharing

3. **Chat & Participants**:
   - Real-time chat with message history
   - Participants panel with media states
   - Admin actions (kick, promote, lock room)

### Room End
1. Host clicks "End Meeting"
2. Backend updates room status to ended
3. Redis publishes room ended event
4. All participants are notified and disconnected

## WebRTC Signal Flow

### 1. Offer/Answer Exchange
```
User A (Offer) → WebSocket → Redis → WebSocket → User B (Handle Offer)
User B (Answer) → WebSocket → Redis → WebSocket → User A (Handle Answer)
```

### 2. ICE Candidates
```
User A (ICE Candidate) → WebSocket → Redis → WebSocket → User B (Add ICE Candidate)
User B (ICE Candidate) → WebSocket → Redis → WebSocket → User A (Add ICE Candidate)
```

### 3. Media Stream Establishment
```
1. getUserMedia() - Local stream acquisition
2. addTrack() - Add tracks to peer connection
3. ontrack event - Receive remote tracks
4. MediaStream in video element - Display video
```

## Key Technologies

### Frontend
- **React 19**: UI library with hooks
- **TypeScript**: Type safety
- **Vite**: Fast build tool
- **TailwindCSS**: Utility-first CSS framework
- **Jotai**: Atomic state management
- **Sonner**: Toast notifications
- **React Router**: Client-side routing

### Backend
- **Node.js**: JavaScript runtime
- **Express**: Web framework
- **TypeScript**: Type safety
- **Drizzle ORM**: Database query builder
- **PostgreSQL**: Relational database
- **Redis**: In-memory data store and pub/sub
- **bcryptjs**: Password hashing
- **JWT**: Token-based authentication
- **Passport**: OAuth integration

### WebRTC
- **WebRTC API**: Real-time communication
- **RTCManager**: WebRTC abstraction layer
- **STUN/TURN**: ICE servers for NAT traversal

## Security Considerations

### Authentication
- JWT tokens with short expiration time (24h)
- HTTP-only cookies to prevent XSS attacks
- bcrypt password hashing
- Email verification with OTP codes

### Authorization
- Role-based access control (host/co-host/participant)
- Protected API routes with JWT validation
- WebSocket authentication via room tokens

### Input Validation
- Zod schema validation
- Sanitization of user input
- Rate limiting to prevent brute force attacks

### Data Protection
- Redis for session state
- PostgreSQL for persistent storage
- Environment variables for sensitive data

## Scalability

### 1. Load Balancing
- Redis pub/sub for inter-server communication
- WebSocket connections managed by Redis
- Horizontal scaling of backend instances

### 2. Media Scaling
- WebRTC peer-to-peer for small rooms
- For large rooms, media servers (LiveKit or Mediasoup) would be needed

### 3. Caching
- Redis for frequent room/participant state
- Browser caching for static assets

## Future Enhancements

### 1. Media Server Integration
- LiveKit or Mediasoup for SFU (Selective Forwarding Unit)
- Simulcast for adaptive bitrate
- SFU reduces peer-to-peer bandwidth usage

### 2. Advanced Features
- Recording and playback
- Virtual background
- Noise cancellation
- Live captions
- Reaction emojis

### 3. Performance Optimizations
- WebRTC simulcast
- Network quality monitoring
- Adaptive bitrate streaming

### 4. Security Improvements
- E2EE (End-to-End Encryption)
- Secure rooms with encryption keys
- Enhanced input validation

## Running the Application

### Development
```bash
# Backend
cd backend
npm install
npm run dev

# Frontend
cd frontend
npm install
npm run dev
```

### Docker Deployment
```bash
docker-compose up -d
```

## Conclusion

This WebRTC video conferencing application demonstrates a complete real-time communication system with modern web technologies. The architecture is designed for scalability, security, and a smooth user experience. The application supports essential features like video/audio communication, chat, screen sharing, and meeting management, with a foundation that can be extended with additional capabilities.
