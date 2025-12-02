# WebRTC Video Conferencing App

A modern, responsive video conferencing application built with React, TypeScript, Tailwind CSS, and LiveKit.

## Features

- Create or join rooms by name
- Video grid layout for multiple participants
- Audio/Video mute controls
- Screen sharing
- Responsive design

## Prerequisites

- Node.js (v16+)
- LiveKit Project (Cloud or Local) - Get credentials from [livekit.io](https://livekit.io)

## Setup

### 1. Backend Setup

The backend generates access tokens for LiveKit.

1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file based on the template:
   ```bash
   cp .env.example .env
   ```
   (Or just edit `.env` directly)
4. Add your LiveKit credentials to `.env`:
   ```env
   LIVEKIT_API_KEY=your_api_key
   LIVEKIT_API_SECRET=your_api_secret
   LIVEKIT_URL=your_livekit_url
   ```
5. Start the server:
   ```bash
   npm run dev
   ```
   The server will run on `http://localhost:3000`.

### 2. Frontend Setup

The frontend is the React application.

1. Navigate to the `frontend` directory:
   ```bash
   cd frontend
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. (Optional) Create a `.env` file if you need to override the LiveKit URL, though the token handles the connection URL usually, the `LiveKitRoom` component also takes a `serverUrl`.
   ```env
   VITE_LIVEKIT_URL=your_livekit_url
   ```
4. Start the development server:
   ```bash
   npm run dev
   ```
   The app will run on `http://localhost:5173`.

## Usage

1. Open the frontend URL.
2. Enter a Room Name (e.g., "Daily") and your Name.
3. Click "Join Room".
4. Open a second tab to join as another user to test video conferencing.
