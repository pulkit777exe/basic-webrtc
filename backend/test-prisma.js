const { PrismaClient } = require('./prisma/generated/client/client');
const prisma = new PrismaClient();
console.log('Available models on prisma instance:');
const models = ['user', 'room', 'message', 'analytics'];
models.forEach(model => {
  console.log(`  prisma.${model}:`, typeof prisma[model] !== 'undefined' ? '✓ EXISTS' : '✗ MISSING');
});
