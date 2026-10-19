import { runMigrations } from '../db/migrate';
import { loadEnv } from '../env';

const env = loadEnv();
await runMigrations(env.DATABASE_URL);
console.log('Migrations applied.');
