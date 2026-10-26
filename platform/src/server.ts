// HTTP API. Run: node src/server.ts (Render), after node src/migrate.ts.
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { fileURLToPath } from 'node:url';
import type { Config, SyncSecrets } from './config.ts';
import type { Sql } from './db.ts';
import { registerAuth, googleVerifyIdToken, type VerifyIdToken } from './auth.ts';
import { registerSync, publicSyncHealth } from './sync.ts';

export type Deps = {
  sql: Sql; config: Pick<Config, 'APP_ORIGIN' | 'GOOGLE_SIGNIN_CLIENT_ID' | 'SYNC_SECRET'> & SyncSecrets; logger?: boolean;
  verifyIdToken?: VerifyIdToken; // tests inject a fake; Google's verifier otherwise
};

export function buildServer({ sql, config, logger = false, verifyIdToken = googleVerifyIdToken }: Deps): FastifyInstance {
  const app = Fastify({ logger });
  // Errors as { ok:false, error:CODE }; a 500 is logged, never echoed.
  app.setErrorHandler((err: Error & { statusCode?: number; code?: string }, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status === 500) req.log.error(err);
    reply.code(status).send({ ok: false, error: status === 500 ? 'SERVER_ERROR' : err.code ?? 'BAD_REQUEST' });
  });
  // Array form: the header is sent only when the request Origin matches APP_ORIGIN.
  app.register(cors, { origin: [config.APP_ORIGIN], credentials: false });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
  });

  app.get('/api/health', async () => {
    const timeout = new Promise<boolean>((resolve) => setTimeout(resolve, 2000, false).unref());
    const db = await Promise.race([sql`select 1`.then(() => true, () => false), timeout]);
    const lastSync = db ? await publicSyncHealth(sql).catch(() => null) : null;
    // ponytail: google/hooks/lastBackup/lastRestoreTest are filled in by Tasks 6, 10, 11.
    return { ok: db, db, google: false, hooks: { pdr: false, coord: false }, lastSync, lastBackup: null, lastRestoreTest: null };
  });
  registerAuth(app, { sql, clientId: config.GOOGLE_SIGNIN_CLIENT_ID, verifyIdToken });
  registerSync(app, { sql, config }); // a tenant's sync secret is looked up by env var name (tenants.sync_secret_env)
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { loadConfig } = await import('./config.ts');
  const { connect } = await import('./db.ts');
  const config = loadConfig(process.env);
  const sql = connect(config.DATABASE_URL);
  await buildServer({ sql, config, logger: true }).listen({ host: '0.0.0.0', port: config.PORT });
}
