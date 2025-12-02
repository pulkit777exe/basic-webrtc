// Set test environment variables BEFORE importing Prisma
process.env.DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgresql://test_user:test_password@localhost:5432/test_db";
process.env.JWT_SECRET = "test-secret-key";
process.env.NODE_ENV = "test";

// Note: Database cleanup is commented out for tests to run without a test database
// Uncomment when you have a test database available

// import { PrismaClient } from '@prisma/client';
// import { PrismaPg } from '@prisma/adapter-pg';
// import { Pool } from 'pg';

// const pool = new Pool({
//   connectionString: process.env.DATABASE_URL,
// });

// const adapter = new PrismaPg(pool);
// const prisma = new PrismaClient({ adapter });

// beforeAll(async () => {
//   await prisma.$connect();
// });

// afterEach(async () => {
//   await prisma.user.deleteMany();
// });

// afterAll(async () => {
//   await prisma.$disconnect();
//   await pool.end();
// });
