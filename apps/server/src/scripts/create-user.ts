import { stdin, stdout } from 'node:process';

import { passwordSchema, usernameSchema } from '@life-book/core';
import { z } from 'zod';

import { connectDatabase } from '../db/client';
import { loadEnv } from '../env';
import { createUser } from '../users/create-user';

// 用法：pnpm --filter @life-book/server create-user <用户名> [显示名称]
// 应用里没有注册入口，账号都用这个脚本创建（见 D-024）。
// 密码在终端里输入两次，不会显示；自动化时可以用环境变量 LIFE_BOOK_PASSWORD 传入。
const [rawUsername = '', displayName] = process.argv.slice(2);
const username = usernameSchema.safeParse(rawUsername);
if (!username.success) {
  console.error('用法：create-user <用户名> [显示名称]');
  console.error(`用户名不合法：${username.error.issues[0]?.message ?? ''}`);
  process.exit(1);
}

/** 从终端读一行，输入的字符不回显。 */
function readHidden(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!stdin.isTTY) {
      reject(new Error('没有终端可以输入密码，请设置 LIFE_BOOK_PASSWORD。'));
      return;
    }
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let value = '';
    const onData = (chunk: string) => {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off('data', onData);
          stdout.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') {
          stdout.write('\n');
          process.exit(130);
        }
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char;
      }
    };
    stdin.on('data', onData);
  });
}

async function readPassword(): Promise<string> {
  const fromEnv = process.env.LIFE_BOOK_PASSWORD;
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv;
  }
  const first = await readHidden('密码：');
  const second = await readHidden('再输入一次：');
  if (first !== second) {
    throw new Error('两次输入的密码不一致。');
  }
  return first;
}

const env = loadEnv();
const { db, close } = connectDatabase(env.DATABASE_URL);
try {
  const password = await readPassword();
  const checked = passwordSchema.safeParse(password);
  if (!checked.success) {
    throw new Error(checked.error.issues[0]?.message ?? '密码不合法');
  }
  const user = await createUser(
    db,
    { username: username.data, password, ...(displayName ? { displayName } : {}) },
    { now: new Date() },
  );
  console.log(`已创建账号 ${user.username}。`);
} catch (error) {
  console.error(
    error instanceof z.ZodError
      ? error.issues.map((issue) => issue.message).join('；')
      : error instanceof Error
        ? error.message
        : String(error),
  );
  process.exitCode = 1;
} finally {
  await close();
}
