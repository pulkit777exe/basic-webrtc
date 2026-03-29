import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';
import { getDatabasePoolMax } from '../config/scaling';

const connectionString = process.env.DATABASE_URL!;

const client = postgres(connectionString, { max: getDatabasePoolMax() });

export const db = drizzle(client, { schema });

export async function closeDatabase(): Promise<void> {
  await client.end({ timeout: 10 });
}