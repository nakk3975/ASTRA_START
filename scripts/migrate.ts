import {Repository} from '../apps/server/src/repository.ts';
process.loadEnvFile?.('.env');if(!process.env.DATABASE_URL)throw Error('DATABASE_URL required');const r=new Repository(process.env.DATABASE_URL);await r.migrate();await r.pool.end();console.log('Migration complete');
