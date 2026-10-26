// Staff and allowlist sync: the Roster Apps Script project (apps-script/platform-push.gs) pushes the Employee Master and the
// allowlist here; Sheets stay the source of both until they move.
//
// Signed push: header X-Sync-Signature = hex(HMAC-SHA256(secret, sentAt + '.' + rawBody)), sentAt within 5 minutes either side.
// GET /api/sync/pending signs sentAt (query) + '.' (no body). The tenant is the one whose secret verifies: tenants.sync_secret_env
// names the env var holding it (LMCS: SYNC_SECRET), so nothing tenant-identifying travels in the payload.
//
// Staff rows: employeeCode, authEmail, name, department, designation, reportsTo, subjects[], active. Campus comes from the
// Employee Code prefix (campuses.code_prefix); any campusId sent is ignored, an unmapped prefix (HES) stays null. People missing
// from a push are marked inactive, never deleted. A push that would deactivate more than 10% of the active people is refused
// whole (a half-filtered Sheet must not lock out a campus): nothing changes, a health_event and a refused sync_runs row are kept.
// Allowlist rows: email, name, campusId, roles (comma list), canApprove. A removed row's sessions are revoked; resolveCaller
// (auth.ts) re-reads the allowlist every request too. An empty allowlist push is refused (it would lock everyone out).
// Every text cell is cleaned like main.gs (zero-width characters stripped, trimmed); emails lowercased.
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { withTenant, type Sql, type Tx } from './db.ts';
import { requireSession } from './auth.ts';

declare module 'fastify' {
  interface FastifyRequest { rawBody?: string }
}

const MAX_AGE_MS = 5 * 60_000;
const MAX_DEACTIVATE_SHARE = 0.1;
type Row = Record<string, unknown>;
type Result = { received: number; changed: number; deactivated: number; refused?: string; detail?: Row };

export const clean = (v: unknown) => String(v ?? '').replace(/[​-‏﻿⁠]/g, '').trim();
const badRequest = (code: string) => Object.assign(new Error(code), { code, statusCode: 400 });
const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ ok: false, error });

// -> the tenant id whose secret signed it, 'BAD_SIGNATURE' or 'STALE'. secrets: env var name -> value (the loaded config).
async function signedBy(sql: Sql, secrets: Record<string, unknown>, sentAt: unknown, raw: string, signature: unknown) {
  const given = Buffer.from(String(signature ?? ''), 'hex');
  let tenant: string | null = null;
  for (const t of await sql`select id, sync_secret_env from tenants where sync_secret_env is not null`) {
    const secret = secrets[t.sync_secret_env];
    if (typeof secret !== 'string' || !secret) continue;
    const want = createHmac('sha256', secret).update(`${sentAt}.${raw}`).digest();
    if (given.length === want.length && timingSafeEqual(given, want)) tenant = t.id;
  }
  if (!tenant) return { error: 'BAD_SIGNATURE' };
  const age = Date.now() - Date.parse(String(sentAt));
  return Math.abs(age) <= MAX_AGE_MS ? { tenant } : { error: 'STALE' };
}

async function syncStaff(tx: Tx, rows: Row[]): Promise<Result> {
  const byCode = new Map<string, Row>();
  for (const r of rows) {
    const code = clean(r?.employeeCode);
    if (!code) throw badRequest('ROW_WITHOUT_EMPLOYEE_CODE');
    const email = clean(r.authEmail).toLowerCase();
    byCode.set(code, { employee_code: code, auth_email: email.includes('@') ? email : null, name: clean(r.name),
      department: clean(r.department) || null, designation: clean(r.designation) || null, reports_to: clean(r.reportsTo) || null,
      subjects: Array.isArray(r.subjects) ? r.subjects.map(clean).filter(Boolean) : [], active: r.active === true });
  }
  const activeNow = (await tx`select employee_code from people where active`).map((p) => p.employee_code as string);
  const leaving = activeNow.filter((c) => byCode.get(c)?.active !== true).length;
  if (leaving > activeNow.length * MAX_DEACTIVATE_SHARE) {
    return { received: rows.length, changed: 0, deactivated: 0, refused: 'MASS_DEACTIVATION', detail: { active: activeNow.length, wouldDeactivate: leaving } };
  }
  const upserted = await tx`
    insert into people (tenant_id, employee_code, auth_email, name, campus_code, department, designation, reports_to, subjects, active, synced_at)
    select current_setting('app.tenant_id')::uuid, r.employee_code, r.auth_email, r.name, c.code, r.department, r.designation,
           r.reports_to, r.subjects, r.active, now()
    from jsonb_to_recordset(${tx.json([...byCode.values()] as never)}::jsonb) as r(employee_code text, auth_email text, name text,
         department text, designation text, reports_to text, subjects text[], active boolean)
    left join campuses c on c.code_prefix = upper(split_part(r.employee_code, '/', 1))
    where true
    on conflict (tenant_id, employee_code) do update set auth_email = excluded.auth_email, name = excluded.name,
      campus_code = excluded.campus_code, department = excluded.department, designation = excluded.designation,
      reports_to = excluded.reports_to, subjects = excluded.subjects, active = excluded.active
    where (people.auth_email, people.name, people.campus_code, people.department, people.designation, people.reports_to, people.subjects, people.active)
      is distinct from (excluded.auth_email, excluded.name, excluded.campus_code, excluded.department, excluded.designation,
                        excluded.reports_to, excluded.subjects, excluded.active)
    returning 1`;
  const codes = [...byCode.keys()];
  const missing = await tx`update people set active = false where active and employee_code <> all(${codes}::text[]) returning 1`;
  await tx`update people set synced_at = now() where employee_code = any(${codes}::text[])`;
  return { received: rows.length, changed: upserted.length + missing.length, deactivated: leaving };
}

async function syncAllowlist(tx: Tx, rows: Row[]): Promise<Result> {
  const byEmail = new Map<string, Row>();
  for (const r of rows) {
    const email = clean(r?.email).toLowerCase();
    if (!email) throw badRequest('ROW_WITHOUT_EMAIL');
    byEmail.set(email, { email, name: clean(r.name) || null, campus_code: clean(r.campusId).toUpperCase() || null,
      roles: clean(r.roles).split(',').map(clean).filter(Boolean),
      can_approve: r.canApprove === true || clean(r.canApprove).toUpperCase() === 'TRUE' });
  }
  if (!byEmail.size && (await tx`select 1 from allowlist limit 1`).length) {
    return { received: 0, changed: 0, deactivated: 0, refused: 'EMPTY_ALLOWLIST', detail: {} };
  }
  const upserted = await tx`
    insert into allowlist (tenant_id, email, name, campus_code, roles, can_approve)
    select current_setting('app.tenant_id')::uuid, r.email, r.name, r.campus_code, r.roles, r.can_approve
    from jsonb_to_recordset(${tx.json([...byEmail.values()] as never)}::jsonb) as r(email text, name text, campus_code text, roles text[], can_approve boolean)
    on conflict (tenant_id, email) do update set name = excluded.name, campus_code = excluded.campus_code, roles = excluded.roles,
      can_approve = excluded.can_approve
    where (allowlist.name, allowlist.campus_code, allowlist.roles, allowlist.can_approve)
      is distinct from (excluded.name, excluded.campus_code, excluded.roles, excluded.can_approve)
    returning 1`;
  const removed = (await tx`delete from allowlist where lower(email) <> all(${[...byEmail.keys()]}::text[]) returning lower(email) as email`)
    .map((r) => r.email as string);
  if (removed.length) await tx`update sessions set revoked_at = now() where revoked_at is null and lower(person_email) = any(${removed}::text[])`;
  return { received: rows.length, changed: upserted.length + removed.length, deactivated: removed.length };
}

// Health: the last run of each kind per syncing tenant (counts only).
export async function lastSyncs(sql: Sql) {
  const out: Record<string, Record<string, Row>> = {};
  for (const t of await sql`select id, name from tenants where sync_secret_env is not null order by name`) {
    const runs = await withTenant(t.id, (tx) => tx`select distinct on (kind) kind, finished_at as at, ok, received, changed, deactivated,
      refused, error from sync_runs order by kind, id desc`, sql);
    out[t.name] = Object.fromEntries(runs.map(({ kind, ...r }) => [kind, r]));
  }
  return out;
}

export function registerSync(app: FastifyInstance, { sql, secrets }: { sql: Sql; secrets: Record<string, unknown> }) {
  app.register(async (sub) => {
    // Raw body kept for the signature (this plugin's routes only).
    sub.removeContentTypeParser('application/json');
    sub.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      req.rawBody = String(body);
      try { done(null, body === '' ? {} : JSON.parse(String(body))); } catch { done(badRequest('BAD_JSON'), undefined); }
    });

    for (const [kind, run] of [['staff', syncStaff], ['allowlist', syncAllowlist]] as const) {
      sub.post(`/api/sync/${kind}`, async (req: FastifyRequest, reply) => {
        const body = req.body as { sentAt?: unknown; rows?: unknown } | null;
        const who = await signedBy(sql, secrets, body?.sentAt, req.rawBody ?? '', req.headers['x-sync-signature']);
        if (!('tenant' in who)) return fail(reply, 401, who.error!);
        const tenant = who.tenant!;
        const startedAt = new Date();
        try {
          if (!Array.isArray(body?.rows)) throw badRequest('ROWS_REQUIRED');
          const rows = body.rows as Row[];
          const r = await withTenant(tenant, async (tx) => {
            const result = await run(tx, rows);
            if (result.refused) {
              await tx`insert into health_events (tenant_id, kind, detail)
                       values (${tenant}, 'sync_refused', ${tx.json({ sync: kind, refused: result.refused, ...result.detail } as never)})`;
            }
            await tx`insert into sync_runs (tenant_id, kind, started_at, finished_at, ok, received, changed, deactivated, refused)
                     values (${tenant}, ${kind}, ${startedAt}, now(), ${!result.refused}, ${result.received}, ${result.changed},
                             ${result.deactivated}, ${result.refused ?? null})`;
            return result;
          }, sql);
          const { detail: _detail, ...out } = r;
          return r.refused ? reply.code(409).send({ ok: false, ...out }) : { ok: true, ...out };
        } catch (err) {
          // the run's transaction rolled back; still record that it failed (the code only, never row data)
          const code = (err as { code?: string }).code ?? 'SERVER_ERROR';
          await withTenant(tenant, (tx) => tx`insert into sync_runs (tenant_id, kind, started_at, finished_at, ok, error)
            values (${tenant}, ${kind}, ${startedAt}, now(), false, ${code})`, sql).catch(() => {});
          throw err;
        }
      });
    }

    // The 5-minute poll from platform-push.gs: true once per Owner request.
    sub.get('/api/sync/pending', async (req, reply) => {
      const sentAt = (req.query as { sentAt?: string }).sentAt;
      const who = await signedBy(sql, secrets, sentAt, '', req.headers['x-sync-signature']);
      if (!('tenant' in who)) return fail(reply, 401, who.error!);
      const taken = await withTenant(who.tenant!, (tx) =>
        tx`update jobs set done_at = now() where kind = 'sync_request' and done_at is null returning 1`, sql);
      return { ok: true, pending: taken.length > 0 };
    });

    sub.post('/api/sync/request', { preHandler: requireSession(sql) }, async (req, reply) => {
      if (!req.caller.roles.includes('Owner')) return fail(reply, 403, 'NOT_AUTHORIZED');
      await withTenant(req.caller.tenantId, async (tx) => {
        await tx`insert into jobs (tenant_id, kind) values (${req.caller.tenantId}, 'sync_request')`;
        await tx`insert into audit_log (tenant_id, who, action, entity) values (${req.caller.tenantId}, ${req.caller.email}, 'sync_request', 'sync')`;
      }, sql);
      return { ok: true };
    });
  });
}
