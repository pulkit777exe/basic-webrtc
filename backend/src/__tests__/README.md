# Backend Tests

This directory contains all backend API tests using Jest and Supertest.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

## Test Structure

```
__tests__/
├── setup.ts           # Test setup and database cleanup
├── auth.test.ts       # Authentication API tests
└── room.test.ts       # Room/LiveKit API tests
```

## Test Coverage

### Authentication Tests (`auth.test.ts`)

- **POST /auth/register**

  - ✅ Successful user registration
  - ✅ Validation for missing fields
  - ✅ Duplicate username handling
  - ✅ Password hashing verification

- **POST /auth/login**

  - ✅ Successful login with correct credentials
  - ✅ Failed login with incorrect password
  - ✅ Failed login for non-existent user
  - ✅ HTTP-only cookie setting

- **GET /auth/me**

  - ✅ Return current user with valid token
  - ✅ 401 without token
  - ✅ 401 with invalid token

- **POST /auth/logout**

  - ✅ Cookie clearing

- **PUT /auth/profile**
  - ✅ Update user name
  - ✅ Update password
  - ✅ Authentication required

### Room Tests (`room.test.ts`)

- **POST /getToken**
  - ✅ Successful token generation
  - ✅ Validation for missing roomName
  - ✅ Validation for missing participantName
  - ✅ Handle different room names
  - ✅ Handle different participant names
  - ✅ Error handling for missing LiveKit credentials

## Environment Variables

Tests use the following environment variables (set in `setup.ts`):

```env
DATABASE_URL=postgresql://test_user:test_password@localhost:5432/test_db
JWT_SECRET=test-secret-key
NODE_ENV=test
LIVEKIT_API_KEY=test-api-key
LIVEKIT_API_SECRET=test-api-secret
LIVEKIT_URL=wss://test-livekit.com
```

## Database Setup

Tests automatically:

1. Connect to the test database before all tests
2. Clean up all data after each test
3. Disconnect after all tests complete

Make sure you have a PostgreSQL test database running before running tests.

## Mocking

- **LiveKit SDK**: Mocked in `room.test.ts` to avoid actual LiveKit API calls
- **Database**: Uses real Prisma client with test database

## Writing New Tests

1. Create a new test file in `__tests__/` directory
2. Import required dependencies:
   ```typescript
   import request from "supertest";
   import express from "express";
   ```
3. Follow the existing test structure
4. Use `beforeEach` for test data setup
5. Use descriptive test names

## CI/CD Integration

These tests run automatically in GitHub Actions:

- On every push to main/develop
- On every pull request
- With PostgreSQL service container

See `.github/workflows/ci.yml` for CI configuration.
