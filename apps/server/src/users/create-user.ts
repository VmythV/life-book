import {
  type CreateUserInput,
  createUserInputSchema,
  DEFAULT_TIME_ZONE,
} from '@life-book/core';

import { hashPassword, type ScryptParams } from '../auth/password';
import { type Executor, isUniqueViolation } from '../db/client';
import { userSettings, users } from '../db/schema';

export class UsernameTakenError extends Error {
  constructor(username: string) {
    super(`用户名 ${username} 已被使用`);
    this.name = 'UsernameTakenError';
  }
}

/**
 * 新建账号和默认设置。应用里没有注册入口，账号由 `create-user` 脚本创建（见 D-024）。
 * 输入不合法时抛出 zod 的校验错误，用户名重复（不分大小写）时抛出 `UsernameTakenError`。
 */
export async function createUser(
  db: Executor,
  input: CreateUserInput,
  options: { now: Date; passwordParams?: ScryptParams },
): Promise<typeof users.$inferSelect> {
  const data = createUserInputSchema.parse(input);
  const passwordHash = await hashPassword(data.password, options.passwordParams);
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          username: data.username,
          displayName: data.displayName ?? null,
          passwordHash,
          createdAt: options.now,
          updatedAt: options.now,
        })
        .returning();
      if (created === undefined) {
        throw new Error('Insert into users returned no row.');
      }
      await tx.insert(userSettings).values({
        userId: created.id,
        timezone: data.timezone ?? DEFAULT_TIME_ZONE,
        updatedAt: options.now,
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new UsernameTakenError(data.username);
    }
    throw error;
  }
}
