// Test database: per call, a throwaway non-superuser LOGIN role (no CREATEROLE, no BYPASSRLS) owning a
// fresh schema on TEST_DATABASE_URL. Migrations and every query run as that role, as the app does on Render.
import { randomBytes } from 'node:crypto';
import { connect } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

export const LMCS_TENANT_ID = '6f1c2a3e-0b7d-4c55-9a1e-1c0d5e4a7b01'; // seeded by 001_core.sql

export async function testDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL is not set (e.g. postgres://postgres@localhost:54329/lmcs_test)');
  const name = `t_${randomBytes(6).toString('hex')}`; // role and schema share the name
  const admin = connect(url, { max: 1 });
  await admin.unsafe(`create role ${name} login nosuperuser nocreaterole nobypassrls`);
  await admin.unsafe(`create schema ${name} authorization ${name}`);
  const sql = connect(url, { max: 4, username: name, connection: { search_path: name } });
  return {
    sql,
    role: name,
    schema: name,
    migrate: () => migrate(sql),
    async close() {
      await sql.end();
      await admin.unsafe(`drop schema ${name} cascade`);
      await admin.unsafe(`drop role ${name}`);
      await admin.end();
    },
  };
}
