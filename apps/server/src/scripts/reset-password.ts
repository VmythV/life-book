import { randomBytes } from 'node:crypto';

import { usernameSchema } from '@life-book/core';
import { eq } from 'drizzle-orm';

import { hashPassword } from '../auth/password';
import { deleteAllSessions } from '../auth/sessions';
import { connectDatabase } from '../db/client';
import { users } from '../db/schema';
import { loadEnv } from '../env';

// 用法：pnpm --filter @life-book/server reset-password <username>
// 生成一个临时密码并让该用户的所有会话失效；登录后请在设置中修改密码。
const parsed = usernameSchema.safeParse(process.argv[2] ?? '');
if (!parsed.success) {
  console.error('Usage: reset-password <username>');
  process.exit(1);
}

const env = loadEnv();
const { db, close } = connectDatabase(env.DATABASE_URL);
try {
  const temporaryPassword = randomBytes(9).toString('base64url');
  const [user] = await db
    .update(users)
    .set({ passwordHash: await hashPassword(temporaryPassword), updatedAt: new Date() })
    .where(eq(users.username, parsed.data))
    .returning({ id: users.id });
  if (user === undefined) {
    console.error(`User "${parsed.data}" not found.`);
    process.exitCode = 1;
  } else {
    await deleteAllSessions(db, user.id);
    console.log(`Temporary password for ${parsed.data}: ${temporaryPassword}`);
  }
} finally {
  await close();
}
