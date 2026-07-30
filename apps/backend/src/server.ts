import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import app from './app.js';
import { runtimeConfig, validateRuntimeConfig } from './config.js';
import { db } from './db/index.js';
import { profiles, users } from './db/schema.js';

async function seedDemoUser() {
  if (process.env.SEED_DEMO_USER !== 'true') return;
  if (runtimeConfig.nodeEnv === 'production') {
    throw new Error('SEED_DEMO_USER cannot be enabled in production.');
  }

  const email = process.env.DEMO_USER_EMAIL?.trim().toLowerCase();
  const password = process.env.DEMO_USER_PASSWORD;
  if (!email || !password || password.length < 10) {
    throw new Error('SEED_DEMO_USER requires DEMO_USER_EMAIL and a DEMO_USER_PASSWORD of at least 10 characters.');
  }

  const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing.length > 0) return;

  const [createdUser] = await db.insert(users).values({
    email,
    passwordHash: await bcrypt.hash(password, 10),
    authProvider: 'local',
  }).returning();

  if (createdUser) {
    await db.insert(profiles).values({
      userId: createdUser.id,
      fullName: 'RoleMatch Demo',
    });
    console.log(`Local demo account created for ${email}.`);
  }
}

validateRuntimeConfig();

app.listen(runtimeConfig.port, async () => {
  await seedDemoUser();
  console.log(`RoleMatch API listening on ${runtimeConfig.backendPublicUrl}`);
});
