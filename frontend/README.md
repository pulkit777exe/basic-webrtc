# Frontend - WebRTC Video Conferencing UI

The frontend application for the WebRTC video conferencing platform, built with React, TypeScript, Vite, and TailwindCSS.

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- pnpm (recommended) or npm
- Backend server running

### Installation

```bash
# Install dependencies
pnpm install
# or
npm install
```

### Environment Variables

Create a `.env` file in the `frontend/` directory:

```env
# Backend API URL
VITE_APP_BACKEND_URL="http://localhost:3000"

# LiveKit Server (optional override)
VITE_LIVEKIT_URL="wss://your-livekit-server.com"
```

### Development

```bash
# Start development server
pnpm dev

# Build for production
pnpm build

# Preview production build
pnpm preview

# Run linter
pnpm lint
```

The application will be available at `http://localhost:5173`

## Features

### Authentication

- **Login/Register**: Unified form with toggle
- **Session Persistence**: Automatic session check on load
- **Profile Management**: Update name and password
- **Secure Logout**: Clears session cookies

### Video Conferencing

- **Room Creation**: Join rooms by name
- **Real-time Video/Audio**: Powered by LiveKit
- **Grid Layout**: Responsive participant grid
- **Screen Sharing**: Built-in LiveKit support
- **Audio Controls**: Mute/unmute via control bar

### Recording

- **Screen Capture**: Record entire meeting
- **Current Tab Preference**: Browser hints to select current tab
- **Download**: Automatic .webm file download
- **Audio Included**: Captures system audio if enabled

### UI/UX

- **Dark Mode**: Modern dark theme
- **Toast Notifications**: User feedback with Sonner
- **Responsive Design**: Works on desktop and tablet
- **Loading States**: Visual feedback for async operations

## Technology Stack

### Core

- **React 19** - UI library with latest features
- **TypeScript 5.9** - Type safety
- **Vite 7** - Fast build tool and dev server

### Styling

- **TailwindCSS 4** - Utility-first CSS framework
- **Custom Components** - Reusable UI primitives

### State Management

- **Jotai** - Atomic state management
  - `userAtom` - Current user data
  - `tokenAtom` - LiveKit room token
  - `serverUrlAtom` - LiveKit server URL
  - `roomAtom` - Current room name

### WebRTC

- **LiveKit Components React** - Pre-built video components
- **LiveKit Client** - WebRTC client SDK
- **MediaRecorder API** - Browser recording

### Utilities

- **Zod** - Schema validation
- **Sonner** - Toast notifications
- **Lucide React** - Icon library

## Component Documentation

### App.tsx

Main application component handling routing logic.

```typescript
// State flow
User not authenticated → LoginForm
User authenticated, no token → LandingPage
User authenticated, has token → VideoRoom
```

### LoginForm.tsx

Unified authentication form.

**Features:**

- Toggle between login/register
- Form validation
- Toast notifications
- Session cookie handling

**Props:** None (uses global state)

### LandingPage.tsx

Room joining interface.

**Props:**

```typescript
interface LandingPageProps {
  onJoin: (roomName: string) => void;
}
```

**Features:**

- Room name input
- User greeting
- Profile modal trigger

### VideoRoom.tsx

Main video conferencing interface.

**Props:**

```typescript
interface VideoRoomProps {
  token: string;
  serverUrl: string;
  onDisconnected: () => void;
}
```

**Features:**

- LiveKit room connection
- Participant grid
- Recording controls
- Audio renderer
- Control bar

### ProfileModal.tsx

User profile management modal.

**Props:**

```typescript
interface ProfileModalProps {
  onClose: () => void;
}
```

**Features:**

- Display name update
- Password change
- Logout functionality
- Form validation

### Button.tsx

Reusable button component.

**Props:**

```typescript
interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
  className?: string;
}
```

### Input.tsx

Reusable input component.

**Props:**

```typescript
interface InputProps {
  label: string;
  type?: string;
  placeholder?: string;
  value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  required?: boolean;
}
```

## 🎨 Styling Guide

### TailwindCSS Configuration

```typescript
// tailwind.config.ts
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Custom colors if needed
      },
    },
  },
  plugins: [],
};
```

### Design System

**Colors:**

- Background: `bg-black`, `bg-neutral-900`
- Text: `text-white`, `text-neutral-400`
- Borders: `border-neutral-800`
- Accents: `bg-white/10`, `hover:bg-white/20`

**Spacing:**

- Consistent use of Tailwind spacing scale
- Padding: `p-4`, `p-6`, `p-8`
- Gaps: `gap-2`, `gap-3`, `gap-4`

**Typography:**

- Headings: `text-3xl font-bold`
- Body: Default size with `text-neutral-400` for secondary text
- Labels: `text-sm text-neutral-400`

**Components:**

- Rounded corners: `rounded-xl`, `rounded-2xl`
- Shadows: Minimal, focus on borders
- Transitions: `transition-colors`

## Configuration

### Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
});
```

### TypeScript Configuration

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

## Build and Deployment

### Production Build

```bash
# Build optimized bundle
pnpm build

# Output directory: dist/
```

### Preview Production Build

```bash
pnpm preview
```

### Environment Variables for Production

```env
VITE_APP_BACKEND_URL="https://api.your-domain.com"
VITE_LIVEKIT_URL="wss://livekit.your-domain.com"
```

### Static Hosting

The built files in `dist/` can be deployed to:

- **Vercel**: `vercel deploy`
- **Netlify**: Drag & drop `dist/` folder
- **AWS S3 + CloudFront**: Upload to S3 bucket
- **GitHub Pages**: Use `gh-pages` package

### Docker Deployment

See `Dockerfile` in the frontend directory:

```bash
# Build image
docker build -t webrtc-frontend .

# Run container
docker run -p 5173:5173 webrtc-frontend
```

## Testing

### Manual Testing Checklist

- [ ] Login with valid credentials
- [ ] Register new user
- [ ] Session persists on reload
- [ ] Join a video room
- [ ] Video and audio work
- [ ] Recording starts and stops
- [ ] Recording downloads
- [ ] Profile updates work
- [ ] Logout clears session

### Future: Automated Testing

```bash
# Unit tests (to be implemented)
pnpm test

# E2E tests (to be implemented)
pnpm test:e2e
```

## State Management

### Jotai Atoms

```typescript
// store/atoms.ts
export interface User {
  username: string;
  name: string;
}

export const userAtom = atom<User | null>(null);
export const roomAtom = atom<string | null>(null);
export const tokenAtom = atom<string | null>(null);
export const serverUrlAtom = atom<string | null>(null);
```

### Usage Example

```typescript
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { userAtom } from "./store/atoms";

// Read and write
const [user, setUser] = useAtom(userAtom);

// Read only
const user = useAtomValue(userAtom);

// Write only
const setUser = useSetAtom(userAtom);
```

## 🔐 Security Considerations

### XSS Prevention

- React automatically escapes content
- No `dangerouslySetInnerHTML` used
- HTTP-only cookies for tokens

### CSRF Protection

- SameSite cookie attribute
- CORS configured on backend

### Input Validation

- Zod schemas for form data
- Required fields enforced
- Type checking with TypeScript

## Performance Optimization

### Code Splitting

- Vite automatically splits chunks
- Dynamic imports for large components (future)

### Asset Optimization

- Vite optimizes images and assets
- Tree-shaking removes unused code
- Minification in production build

### Lazy Loading

```typescript
// Future enhancement
const VideoRoom = lazy(() => import("./components/VideoRoom"));
```

## Debugging

### Development Tools

```bash
# Enable React DevTools
# Install browser extension

# Vite debug mode
DEBUG=vite:* pnpm dev

# Network inspection
# Use browser DevTools Network tab
```

### Common Issues

**Issue**: `VITE_APP_BACKEND_URL is undefined`

- **Solution**: Create `.env` file with the variable

**Issue**: `Failed to fetch` errors

- **Solution**: Ensure backend is running and CORS is configured

**Issue**: Video/audio not working

- **Solution**: Check browser permissions and HTTPS requirement

## Customization

### Changing Theme

Edit `index.css`:

```css
:root {
  --color-primary: #your-color;
  --color-background: #your-bg;
}
```

### Adding New Components

```typescript
// components/NewComponent.tsx
import * as React from "react";

interface NewComponentProps {
  // Define props
}

export const NewComponent: React.FC<NewComponentProps> = (props) => {
  return <div>{/* Component JSX */}</div>;
};
```

## Browser Support

- Chrome/Edge >= 90
- Firefox >= 88
- Safari >= 14
- Opera >= 76

**Note**: WebRTC requires HTTPS in production (except localhost)

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for frontend-specific guidelines.

### Code Style

- Use functional components with hooks
- Prefer `const` over `let`
- Use TypeScript interfaces for props
- Follow existing naming conventions

## License

ISC

---

**Need help?** Open an issue or check the main [README](../README.md)
