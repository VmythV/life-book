import { deleteDatabaseAsync, openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import {
  CapabilityProbeError,
  type CapabilityFailureCode,
  type CapabilityProbeResult,
} from '../domain/capability-probe';

const databaseName = 'life-book-capability-spike.db';
const correctKey = 'life-book-capability-spike-correct-synthetic-key';
const wrongKey = 'life-book-capability-spike-wrong-synthetic-key';

interface CountRow {
  readonly count: number;
}

async function applySyntheticKey(
  database: SQLiteDatabase,
  kind: 'correct' | 'wrong',
): Promise<void> {
  const key = kind === 'correct' ? correctKey : wrongKey;
  await database.execAsync(`PRAGMA key = '${key}'`);
}

async function closeQuietly(database: SQLiteDatabase | undefined): Promise<void> {
  if (database === undefined) {
    return;
  }
  try {
    await database.closeAsync();
  } catch {
    // The caller reports the primary controlled failure and cleanup is retried below.
  }
}

export async function runSqlcipherCapabilityProbe(): Promise<CapabilityProbeResult> {
  let database: SQLiteDatabase | undefined;
  let cleanupSucceeded = false;
  let stageFailureCode: CapabilityFailureCode = 'sqlcipher_unavailable';

  try {
    await deleteDatabaseAsync(databaseName).catch(() => undefined);
    database = await openDatabaseAsync(databaseName, { useNewConnection: true });
    await applySyntheticKey(database, 'correct');

    let cipherVersion: string | undefined;
    try {
      const cipher = await database.getFirstAsync<Record<string, unknown>>(
        'PRAGMA cipher_version',
      );
      cipherVersion = Object.values(cipher ?? {}).find(
        (value): value is string => typeof value === 'string' && value.length > 0,
      );
    } catch {
      throw new CapabilityProbeError('sqlcipher_unavailable');
    }
    if (cipherVersion === undefined) {
      throw new CapabilityProbeError('sqlcipher_unavailable');
    }

    stageFailureCode = 'database_transaction_failed';
    await database.execAsync(`
      PRAGMA journal_mode = WAL;
      PRAGMA user_version = 1;
      CREATE TABLE synthetic_item (
        id INTEGER PRIMARY KEY NOT NULL,
        value TEXT NOT NULL
      );
    `);

    const transactionDatabase = database;
    await transactionDatabase.withTransactionAsync(async () => {
      await transactionDatabase.runAsync(
        'INSERT INTO synthetic_item (id, value) VALUES (?, ?)',
        1,
        'synthetic-value',
      );
    });

    try {
      await transactionDatabase.withTransactionAsync(async () => {
        await transactionDatabase.runAsync(
          'INSERT INTO synthetic_item (id, value) VALUES (?, ?)',
          2,
          'must-rollback',
        );
        throw new CapabilityProbeError('database_transaction_failed');
      });
    } catch (error) {
      if (
        !(error instanceof CapabilityProbeError) ||
        error.code !== 'database_transaction_failed'
      ) {
        throw error;
      }
    }

    const afterRollback = await database.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM synthetic_item',
    );
    if (afterRollback?.count !== 1) {
      throw new CapabilityProbeError('database_transaction_failed');
    }

    stageFailureCode = 'database_migration_failed';
    await transactionDatabase.withTransactionAsync(async () => {
      await transactionDatabase.execAsync(`
        CREATE TABLE synthetic_item_candidate (
          id INTEGER PRIMARY KEY NOT NULL,
          value TEXT NOT NULL,
          generation INTEGER NOT NULL DEFAULT 1 CHECK (generation = 1)
        );
        INSERT INTO synthetic_item_candidate (id, value)
          SELECT id, value FROM synthetic_item;
        DROP TABLE synthetic_item;
        ALTER TABLE synthetic_item_candidate RENAME TO synthetic_item;
        PRAGMA user_version = 2;
      `);
    });

    const migrated = await database.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM synthetic_item WHERE generation = 1',
    );
    if (migrated?.count !== 1) {
      throw new CapabilityProbeError('database_migration_failed');
    }

    await database.closeAsync();
    database = undefined;

    stageFailureCode = 'database_reopen_failed';
    database = await openDatabaseAsync(databaseName, { useNewConnection: true });
    await applySyntheticKey(database, 'correct');
    const reopened = await database.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM synthetic_item WHERE value = ?',
      'synthetic-value',
    );
    if (reopened?.count !== 1) {
      throw new CapabilityProbeError('database_reopen_failed');
    }
    await database.closeAsync();
    database = undefined;

    stageFailureCode = 'database_wrong_key_accepted';
    database = await openDatabaseAsync(databaseName, { useNewConnection: true });
    await applySyntheticKey(database, 'wrong');
    let wrongKeyRejected = false;
    try {
      await database.getFirstAsync('SELECT COUNT(*) FROM synthetic_item');
    } catch {
      wrongKeyRejected = true;
    }
    await database.closeAsync();
    database = undefined;
    if (!wrongKeyRejected) {
      throw new CapabilityProbeError('database_wrong_key_accepted');
    }

    stageFailureCode = 'database_reopen_failed';
    database = await openDatabaseAsync(databaseName, { useNewConnection: true });
    await applySyntheticKey(database, 'correct');
    const recovered = await database.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM synthetic_item',
    );
    if (recovered?.count !== 1) {
      throw new CapabilityProbeError('database_reopen_failed');
    }
    await database.closeAsync();
    database = undefined;

    stageFailureCode = 'database_cleanup_failed';
    await deleteDatabaseAsync(databaseName);
    cleanupSucceeded = true;

    return {
      detail: `SQLCipher ${cipherVersion}; transaction, candidate migration, reopen, and wrong-key rejection`,
    };
  } catch (error) {
    if (error instanceof CapabilityProbeError) {
      throw error;
    }
    throw new CapabilityProbeError(stageFailureCode);
  } finally {
    await closeQuietly(database);
    if (!cleanupSucceeded) {
      try {
        await deleteDatabaseAsync(databaseName);
      } catch {
        throw new CapabilityProbeError('database_cleanup_failed');
      }
    }
  }
}
