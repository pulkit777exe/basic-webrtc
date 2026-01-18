re# Contributing to WebRTC Video Conferencing App

First off, thank you for considering contributing to our WebRTC application! It's people like you that make this project such a great tool for the community.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [Getting Started](#getting-started)
- [Development Workflow](#development-workflow)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Commit Guidelines](#commit-guidelines)
- [Testing Guidelines](#testing-guidelines)
- [Documentation](#documentation)

## Code of Conduct

### Our Pledge

We are committed to providing a welcoming and inspiring community for all. Please be respectful and constructive in your interactions.

### Our Standards

**Positive behavior includes:**

- Using welcoming and inclusive language
- Being respectful of differing viewpoints
- Gracefully accepting constructive criticism
- Focusing on what is best for the community

**Unacceptable behavior includes:**

- Trolling, insulting/derogatory comments, and personal attacks
- Public or private harassment
- Publishing others' private information without permission
- Other conduct which could reasonably be considered inappropriate

## Getting Started

### Prerequisites

Before you begin, ensure you have:

- Node.js >= 18.0.0
- pnpm or npm
- PostgreSQL (local or Docker)
- Git
- A code editor (VS Code recommended)

### Fork and Clone

1. **Fork the repository** on GitHub
2. **Clone your fork** locally:

   ```bash
   git clone https://github.com/pulkit777exe/basic-webrtc-app.git
   cd basic-webrtc-app
   ```

3. **Add upstream remote**:
   ```bash
   git remote add upstream https://github.com/pulkit777exe/basic-webrtc-app.git
   ```

### Set Up Development Environment

1. **Install dependencies**:

   ```bash
   # Backend
   cd backend
   npm install

   # Frontend
   cd ../frontend
   pnpm install
   ```

2. **Set up environment variables** (see main README.md)

3. **Run database migrations**:

   ```bash
   cd backend
   npx prisma generate
   npx prisma migrate dev
   ```

4. **Start development servers**:

   ```bash
   # Terminal 1 - Backend
   cd backend && npm run dev

   # Terminal 2 - Frontend
   cd frontend && pnpm dev
   ```

## Development Workflow

### 1. Create a Branch

Always create a new branch for your work:

```bash
git checkout -b feature/your-feature-name
# or
git checkout -b fix/bug-description
```

**Branch naming conventions:**

- `feature/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation updates
- `refactor/` - Code refactoring
- `test/` - Adding tests
- `chore/` - Maintenance tasks

### 2. Make Your Changes

- Write clean, readable code
- Follow the existing code style
- Add comments for complex logic
- Update documentation as needed

### 3. Test Your Changes

```bash
# Run linter
cd frontend && pnpm lint

# Test the application manually
# - Register a new user
# - Join a video room
# - Test recording feature
# - Test profile updates
```

### 4. Commit Your Changes

Follow our [commit guidelines](#commit-guidelines):

```bash
git add .
git commit -m "feat: add user presence indicators"
```

### 5. Keep Your Branch Updated

```bash
git fetch upstream
git rebase upstream/main
```

### 6. Push to Your Fork

```bash
git push origin feature/your-feature-name
```

## Pull Request Process

### Before Submitting

- [ ] Code follows the project's style guidelines
- [ ] Self-review of your code completed
- [ ] Comments added for complex code
- [ ] Documentation updated (if applicable)
- [ ] No new warnings or errors introduced
- [ ] Tested locally and works as expected

### Submitting a Pull Request

1. **Go to the original repository** on GitHub
2. **Click "New Pull Request"**
3. **Select your fork and branch**
4. **Fill out the PR template**:
   - Clear title describing the change
   - Detailed description of what and why
   - Screenshots/GIFs for UI changes
   - Link to related issues

### PR Title Format

Use conventional commits format:

```
<type>(<scope>): <description>

Examples:
feat(auth): add OAuth2 login support
fix(video): resolve audio echo issue
docs(readme): update installation instructions
refactor(api): simplify token generation logic
```

### Review Process

1. **Automated checks** must pass (linting, builds)
2. **At least one maintainer** will review your PR
3. **Address feedback** by pushing new commits
4. **Squash commits** if requested
5. **Maintainer will merge** once approved

## 💻 Coding Standards

### TypeScript

- **Use TypeScript** for all new code
- **No `any` types** - use proper typing
- **Interfaces over types** for object shapes
- **Explicit return types** for functions

```typescript
// Good
interface User {
  id: string;
  username: string;
  name: string;
}

function getUser(id: string): Promise<User> {
  // ...
}

// Bad
function getUser(id: any): any {
  // ...
}
```

### React Components

- **Functional components** with hooks
- **Named exports** for components
- **Props interfaces** defined above component
- **Destructure props** in function signature

```typescript
// Good
interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}

export const Button: React.FC<ButtonProps> = ({
  label,
  onClick,
  disabled = false,
}) => {
  return (
    <button onClick={onClick} disabled={disabled}>
      {label}
    </button>
  );
};
```

### File Organization

```
src/
├── components/       # Reusable UI components
│   ├── Button.tsx
│   └── Input.tsx
├── pages/           # Page components (if using routing)
├── hooks/           # Custom React hooks
├── utils/           # Utility functions
├── types/           # TypeScript type definitions
└── store/           # State management
```

### Naming Conventions

- **Components**: PascalCase (`UserProfile.tsx`)
- **Hooks**: camelCase with `use` prefix (`useAuth.ts`)
- **Utilities**: camelCase (`formatDate.ts`)
- **Constants**: UPPER_SNAKE_CASE (`API_URL`)
- **Types/Interfaces**: PascalCase (`UserData`)

### Code Style

- **Indentation**: 2 spaces
- **Quotes**: Single quotes for strings
- **Semicolons**: Required
- **Line length**: Max 100 characters
- **Trailing commas**: Always

```typescript
// Good
const user = {
  name: "John",
  age: 30,
};

// Bad
const user = {
  name: "John",
  age: 30,
};
```

## Commit Guidelines

We follow [Conventional Commits](https://www.conventionalcommits.org/):

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, etc.)
- `refactor`: Code refactoring
- `perf`: Performance improvements
- `test`: Adding or updating tests
- `chore`: Maintenance tasks
- `ci`: CI/CD changes

### Examples

```bash
feat(auth): implement password reset functionality

Add password reset via email with JWT tokens.
Includes email template and rate limiting.

Closes #123

---

fix(video): resolve audio feedback loop

The issue was caused by improper audio track cleanup.
Now properly disposing tracks on disconnect.

Fixes #456

---

docs(readme): add Docker deployment section

Added comprehensive Docker and docker-compose
instructions for easier deployment.
```

### Rules

- Use present tense ("add feature" not "added feature")
- Use imperative mood ("move cursor to..." not "moves cursor to...")
- First line max 72 characters
- Reference issues and PRs in footer

## Testing Guidelines

### Manual Testing Checklist

Before submitting a PR, test these flows:

#### Authentication

- [ ] User registration works
- [ ] Login with correct credentials
- [ ] Login fails with wrong credentials
- [ ] Session persists on page reload
- [ ] Logout clears session

#### Video Conferencing

- [ ] Can join a room
- [ ] Video and audio work
- [ ] Multiple participants can join
- [ ] Screen sharing works
- [ ] Can leave room cleanly

#### Profile Management

- [ ] Can update display name
- [ ] Can change password
- [ ] Changes persist after logout/login

#### Recording

- [ ] Can start recording
- [ ] Can stop recording
- [ ] Recording downloads successfully
- [ ] Recording includes audio

### Writing Tests (Future)

When we add automated tests:

```typescript
describe("Button Component", () => {
  it("should render with label", () => {
    // Test implementation
  });

  it("should call onClick when clicked", () => {
    // Test implementation
  });

  it("should be disabled when disabled prop is true", () => {
    // Test implementation
  });
});
```

## Documentation

### Code Comments

- **Why, not what**: Explain the reasoning, not the obvious
- **Complex logic**: Add comments for non-trivial code
- **TODOs**: Use `// TODO:` for future improvements
- **FIXMEs**: Use `// FIXME:` for known issues

```typescript
// Good
// Using a Set for O(1) lookup performance with large user lists
const activeUsers = new Set<string>();

// Bad
// Create a set
const activeUsers = new Set<string>();
```

### README Updates

When adding features, update:

- Main README.md
- Frontend/Backend READMEs
- API documentation
- Environment variable examples

### JSDoc for Public APIs

```typescript
/**
 * Generates a LiveKit token for room access
 * @param roomName - The name of the room to join
 * @param participantName - Display name of the participant
 * @returns Promise resolving to token and server URL
 * @throws {Error} If LiveKit credentials are invalid
 */
export async function generateRoomToken(
  roomName: string,
  participantName: string
): Promise<{ token: string; url: string }> {
  // Implementation
}
```

## Areas for Contribution

We especially welcome contributions in these areas:

### High Priority

- [ ] Automated testing (Jest, React Testing Library)
- [ ] E2E tests (Playwright, Cypress)
- [ ] Accessibility improvements (ARIA labels, keyboard navigation)
- [ ] Mobile responsiveness
- [ ] Error boundary implementation

### Features

- [ ] Chat functionality during calls
- [ ] Screen annotation tools
- [ ] Virtual backgrounds
- [ ] Breakout rooms
- [ ] Meeting scheduling
- [ ] Recording playback in-app

### Infrastructure

- [ ] CI/CD pipeline (GitHub Actions)
- [ ] Monitoring and logging
- [ ] Performance optimization
- [ ] Security hardening
- [ ] Database migrations strategy

## Questions?

- **General questions**: Open a [Discussion](https://github.com/pulkit777exe/basic-webrtc-app/discussions)
- **Bug reports**: Open an [Issue](https://github.com/pulkit777exe/basic-webrtc-app/issues)
- **Feature requests**: Open an [Issue](https://github.com/pulkit777exe/basic-webrtc-app/issues) with the `enhancement` label

## Thank You!

Your contributions make this project better for everyone. We appreciate your time and effort!

---
