import { sql } from 'drizzle-orm';
import { db } from './index.js';

async function resetDatabase() {
    console.log('🔄 Resetting database tables...');
    try {
        // Drop tables with CASCADE to automatically bypass foreign key blocks
        await db.execute(sql`DROP TABLE IF EXISTS "applications" CASCADE;`);
        await db.execute(sql`DROP TABLE IF EXISTS "profiles" CASCADE;`);
        await db.execute(sql`DROP TABLE IF EXISTS "job_postings" CASCADE;`);
        await db.execute(sql`DROP TABLE IF EXISTS "users" CASCADE;`);
        await db.execute(sql`DROP TABLE IF EXISTS "__drizzle_migrations";`);

        console.log('✅ Database completely cleared! Ready for migrations.');
        process.exit(0);
    } catch (error) {
        console.error('❌ Error resetting database:', error);
        process.exit(1);
    }
}

resetDatabase();