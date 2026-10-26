// Google sign-in, sessions and "view as".
//
// Sign-in: a Google ID token (verified for GOOGLE_SIGNIN_CLIENT_ID, email_verified, and an hd that one tenant's
// allowed_domains lists) -> the person, re-derived the way main.gs verifyCallerToken_ does: an allowlist row wins;
// otherwise, behind the staff_auto_signin switch, an Active person's department -> role (role_rules).
//
// Session token: '<tenantId>.<base64url of 32 random bytes>'. The tenant is read from the prefix; the lookup runs under
// that tenant (RLS). Only sha256(whole token) is stored. 30 days, sliding: a request moves expires_at to now + 30 days,
// at most once an hour. The caller is re-resolved on every request (like Apps Script, minus its 5-minute cache), so an
// allowlist removal or a deactivation takes effect at once.
//
// View as (pdrResolveViewAsCaller_): the session carries the viewed employee's code; the caller keeps the viewer's own
// email but the employee's campus and code, as a Teacher, never a decider. Every write is refused while it is on.
import { createHash, randomBytes } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { OAuth2Client } from 'google-auth-library';
import { withTenant, type Sql, type Tx } from './db.ts';
import { viewAsScope } from './permissions.ts';

export type Caller = {
  tenantId: string; email: string; name: string; roles: string[]; campusId: string;
  canApprove: boolean; employeeCode: string | null; viewAs: boolean;
};
export type GooglePayload = { aud?: string; email?: string; email_verified?: boolean | string; hd?: string };
export type VerifyIdToken = (idToken: string, audience: string) => Promise<GooglePayload | null>;
export type SessionInfo = { tenantId: string; tokenHash: string; email: string };

declare module 'fastify' {
  interface FastifyRequest { caller: Caller; session: SessionInfo }
  interface FastifyContextConfig { viewAsAllowed?: boolean } // session routes that must work while viewing as someone
}

// Roles verifyCallerToken_ admits from an allowlist row; a row with none of them is refused (no fallback).
const ALLOWLIST_ROLES = ['Principal', 'Coordinator', 'Owner', 'Teacher', 'FeeClerk'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READS = ['GET', 'HEAD', 'OPTIONS'];

const google = new OAuth2Client();
export const googleVerifyIdToken: VerifyIdToken = async (idToken, audience) => {
  try { return (await google.verifyIdToken({ idToken, audience })).getPayload() ?? null; } catch { return null; }
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const fail = (reply: FastifyReply, code: number, error: string) => reply.code(code).send({ ok: false, error });

// The person behind a verified email, in the current tenant (tx from withTenant). No domain check: see resolveCaller.
export async function resolvePerson(tx: Tx, verifiedEmail: string): Promise<Caller | null> {
  const email = verifiedEmail.trim().toLowerCase();
  if (!email) return null;
  const [{ tenant }] = await tx`select current_setting('app.tenant_id') as tenant`;
  const [a] = await tx`select name, campus_code, roles, can_approve from allowlist where lower(email) = ${email} order by email limit 1`;
  const [p] = await tx`select employee_code, name, campus_code, department from people
                       where lower(auth_email) = ${email} and active order by employee_code limit 1`;
  if (a) {
    const roles = (a.roles as string[]).map((r) => r.trim()).filter(Boolean);
    if (!roles.some((r) => ALLOWLIST_ROLES.includes(r))) return null;
    return { tenantId: tenant, email, name: a.name ?? '', roles, campusId: String(a.campus_code ?? '').trim().toUpperCase(),
      canApprove: a.can_approve, employeeCode: p?.employee_code ?? null, viewAs: false };
  }
  // pdrStaffFromEmployeeMaster_: Active, has a campus (head-office staff have none: allowlist only), switch on, mapped department
  if (!p || !p.campus_code) return null;
  const [rule] = await tx`
    select r.role from role_rules r
    where lower(r.department) = lower(trim(${p.department ?? ''}))
      and exists (select 1 from switches s where s.feature = 'staff_auto_signin' and s."on"
                  and (s.scope_kind = 'tenant' or (s.scope_kind = 'campus' and s.scope_id = ${p.campus_code})))`;
  if (!rule?.role) return null;
  return { tenantId: tenant, email, name: p.name, roles: [rule.role], campusId: p.campus_code, canApprove: false,
    employeeCode: p.employee_code, viewAs: false };
}

// resolvePerson, only for an hd (Google's verified Workspace domain) the current tenant allows.
export async function resolveCaller(tx: Tx, verifiedEmail: string, hd: string): Promise<Caller | null> {
  const domain = String(hd ?? '').trim().toLowerCase();
  if (!domain) return null;
  const [ok] = await tx`select 1 from tenants where id = current_setting('app.tenant_id')::uuid and ${domain} = any(allowed_domains)`;
  return ok ? resolvePerson(tx, verifiedEmail) : null;
}

async function viewAsCaller(tx: Tx, real: Caller, employeeCode: string): Promise<Caller | null> {
  const [p] = await tx`select name, campus_code from people where employee_code = ${employeeCode} and active`;
  if (!p || !p.campus_code) return null;
  return { ...real, name: p.name, campusId: p.campus_code, roles: ['Teacher'], employeeCode, canApprove: false, viewAs: true };
}

export function assertWritable(caller: Caller): void {
  if (caller.viewAs) throw Object.assign(new Error('VIEW_AS_READ_ONLY'), { code: 'VIEW_AS_READ_ONLY', statusCode: 403 });
}

// preHandler: Bearer token -> req.caller, req.session; 401 when missing/expired/revoked, 403 on a write while viewing as.
export function requireSession(sql: Sql) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const token = /^Bearer (\S+)$/.exec(req.headers.authorization ?? '')?.[1] ?? '';
    const tenantId = token.split('.')[0];
    if (!UUID.test(tenantId)) return fail(reply, 401, 'NOT_SIGNED_IN');
    const tokenHash = sha256(token);
    const found = await withTenant(tenantId, async (tx) => {
      const [s] = await tx`select person_email, view_as, last_seen_at < now() - interval '1 hour' as stale
                           from sessions where token_hash = ${tokenHash} and revoked_at is null and expires_at > now()`;
      if (!s) return null;
      if (s.stale) await tx`update sessions set last_seen_at = now(), expires_at = now() + interval '30 days' where token_hash = ${tokenHash}`;
      const real = await resolvePerson(tx, s.person_email);
      if (!real) return null;
      // a viewed employee who has since left: stay read-only as yourself rather than silently allowing writes
      const caller = s.view_as ? ((await viewAsCaller(tx, real, s.view_as)) ?? { ...real, viewAs: true }) : real;
      return { caller, email: s.person_email as string };
    }, sql);
    if (!found) return fail(reply, 401, 'NOT_SIGNED_IN');
    req.caller = found.caller;
    req.session = { tenantId, tokenHash, email: found.email };
    if (found.caller.viewAs && !READS.includes(req.method) && !req.routeOptions.config.viewAsAllowed) return fail(reply, 403, 'VIEW_AS_READ_ONLY');
  };
}

async function personOf(tx: Tx, c: Caller) {
  const [campus] = await tx`select name from campuses where code = ${c.campusId}`;
  return { email: c.email, name: c.name, campusId: c.campusId, campusName: campus?.name ?? c.campusId,
    role: c.roles.join(','), roles: c.roles, employeeCode: c.employeeCode }; // role: the allowlist cell as auth.js keeps it
}

export function registerAuth(app: FastifyInstance, { sql, clientId, verifyIdToken }: { sql: Sql; clientId?: string; verifyIdToken: VerifyIdToken }) {
  const session = requireSession(sql);

  app.post('/api/session', async (req, reply) => {
    const idToken = (req.body as { idToken?: unknown } | undefined)?.idToken;
    if (typeof idToken !== 'string' || !idToken) return fail(reply, 400, 'ID_TOKEN_REQUIRED');
    if (!clientId) return fail(reply, 503, 'SIGNIN_NOT_CONFIGURED');
    const p = await verifyIdToken(idToken, clientId);
    const email = String(p?.email ?? '').trim().toLowerCase();
    const hd = String(p?.hd ?? '').trim().toLowerCase();
    if (!p || p.aud !== clientId || (p.email_verified !== true && p.email_verified !== 'true') || !email || !hd) return fail(reply, 401, 'NOT_AUTHORIZED');
    const [t] = await sql`select id from tenants where ${hd} = any(allowed_domains) order by name limit 1`; // tenants: readable before a tenant is set
    if (!t) return fail(reply, 401, 'NOT_AUTHORIZED');
    const out = await withTenant(t.id, async (tx) => {
      const c = await resolveCaller(tx, email, hd);
      if (!c) return null;
      const token = `${t.id}.${randomBytes(32).toString('base64url')}`;
      const [s] = await tx`insert into sessions (tenant_id, token_hash, person_email, roles, campus_code, expires_at)
                           values (${t.id}, ${sha256(token)}, ${email}, ${c.roles}, ${c.campusId}, now() + interval '30 days')
                           returning expires_at`;
      return { token, expiresAt: (s.expires_at as Date).toISOString(), person: await personOf(tx, c) };
    }, sql);
    return out ?? fail(reply, 401, 'NOT_AUTHORIZED');
  });

  app.get('/api/session', { preHandler: session }, async (req) =>
    withTenant(req.session.tenantId, async (tx) => ({ person: await personOf(tx, req.caller), viewAs: req.caller.viewAs }), sql));

  app.delete('/api/session', { preHandler: session, config: { viewAsAllowed: true } }, async (req) => {
    await withTenant(req.session.tenantId, (tx) => tx`update sessions set revoked_at = now() where token_hash = ${req.session.tokenHash}`, sql);
    return { ok: true };
  });

  app.post('/api/session/view-as', { preHandler: session, config: { viewAsAllowed: true } }, async (req, reply) => {
    const code = String((req.body as { employeeCode?: unknown } | undefined)?.employeeCode ?? '').trim();
    if (!code) return fail(reply, 400, 'EMPLOYEE_CODE_REQUIRED');
    const r = await withTenant(req.session.tenantId, async (tx) => {
      const real = await resolvePerson(tx, req.session.email); // the viewer, not whoever they are viewing as now
      const scope = real && viewAsScope(real);
      if (!real || !scope) return 403;
      const viewed = await viewAsCaller(tx, real, code);
      if (!viewed) return 404;
      if (scope === 'school' && viewed.campusId !== real.campusId) return 403;
      await tx`update sessions set view_as = ${code} where token_hash = ${req.session.tokenHash}`;
      return { ok: true, person: await personOf(tx, viewed), viewAs: true };
    }, sql);
    return typeof r === 'number' ? fail(reply, r, r === 404 ? 'EMPLOYEE_NOT_FOUND' : 'NOT_AUTHORIZED') : r;
  });

  app.delete('/api/session/view-as', { preHandler: session, config: { viewAsAllowed: true } }, async (req) => {
    await withTenant(req.session.tenantId, (tx) => tx`update sessions set view_as = null where token_hash = ${req.session.tokenHash}`, sql);
    return { ok: true };
  });
}
