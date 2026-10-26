import { Database } from '@nozbe/watermelondb';
import SQLiteAdapter from '@nozbe/watermelondb/adapters/sqlite';
import { databaseMigrations } from './migrations';
import { modelClasses } from './models';
import { databaseSchema } from './schema';

let databaseInstance: Database | null = null;

export const getDatabase = (): Database => {
  if (databaseInstance !== null) {
    return databaseInstance;
  }

  const adapter = new SQLiteAdapter({
    dbName: 'network_diagnostics_db',
    schema: databaseSchema,
    migrations: databaseMigrations,
    jsi: true,
    onSetUpError: (error: Error) => {
      // eslint-disable-next-line no-console
      console.error('[LocalStore] Failed to initialize WatermelonDB SQLite adapter:', error.message);
    },
  });

  databaseInstance = new Database({
    adapter,
    modelClasses,
  });

  return databaseInstance;
};
