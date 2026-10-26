// Test database: a fresh schema on TEST_DATABASE_URL per call, migrated, dropped by close().
import { randomBytes } from 'node:crypto';
import postgres from 'postgres';
import { migrate } from '../src/migrate.ts';

export async function testDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (e.g. postgres://postgres@localhost:54329/lmcs_test)');
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const admin = postgres(url, { max: 1, onnotice: () => {} });
  await admin.unsafe(`create schema ${schema}`);
  await admin.end();
  const sql = postgres(url, { max: 4, onnotice: () => {}, connection: { search_path: schema } });
  return {
    sql,
    schema,
    migrate: () => migrate(sql),
    async close() {
      await sql.unsafe(`drop schema ${schema} cascade`);
      await sql.end();
    },
  };
}
