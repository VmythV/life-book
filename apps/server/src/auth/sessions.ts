import { createHash, randomBytes } from 'node:crypto';

import { and, eq, ne } from 'drizzle-orm';

import { type Database } from '../db/client';
import { sessions } from '../db/schema';

const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_TTL_MS = 30 * DAY_MS;
/** 会话使用中每隔一天顺延一次有效期，避免每个请求都写库。 */
const RENEW_INTERVAL_MS = DAY_MS;

export interface ActiveSession {
  id: string;
  userId: string;
  expiresAt: Date;
  /** 本次请求顺延了有效期，Cookie 也需要随之更新。 */
  renewed: boolean;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  db: Database,
  input: { userId: string; userAgent: string | null; now: Date },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(input.now.getTime() + SESSION_TTL_MS);
  await db.insert(sessions).values({
    userId: input.userId,
    tokenHash: hashToken(token),
    userAgent: input.userAgent,
    expiresAt,
    lastUsedAt: input.now,
    createdAt: input.now,
  });
  return { token, expiresAt };
}

export async function findActiveSession(
  db: Database,
  token: string,
  now: Date,
): Promise<ActiveSession | null> {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashToken(token)));
  if (session === undefined) {
    return null;
  }
  if (session.expiresAt <= now) {
    await db.delete(sessions).where(eq(sessions.id, session.id));
    return null;
  }
  if (now.getTime() - session.lastUsedAt.getTime() < RENEW_INTERVAL_MS) {
    return { ...session, renewed: false };
  }
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await db
    .update(sessions)
    .set({ lastUsedAt: now, expiresAt })
    .where(eq(sessions.id, session.id));
  return { id: session.id, userId: session.userId, expiresAt, renewed: true };
}

export async function deleteSession(db: Database, sessionId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function deleteOtherSessions(
  db: Database,
  userId: string,
  keepSessionId: string,
): Promise<void> {
  await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), ne(sessions.id, keepSessionId)));
}

export async function deleteAllSessions(db: Database, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}
