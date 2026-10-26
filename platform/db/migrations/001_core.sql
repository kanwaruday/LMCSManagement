-- Core platform schema. Every table carries tenant_id and is ENABLE + FORCE row level security,
-- filtered on current_setting('app.tenant_id') (set per transaction by withTenant in src/db.ts).
-- The app queries as role lmcs_app (no BYPASSRLS); the migrating user owns the tables.

do $$ begin
  create role lmcs_app nologin;
exception when duplicate_object or unique_violation then null;
end $$;
do $$ begin
  execute format('grant lmcs_app to %I', current_user);          -- lets the server SET ROLE lmcs_app
  execute format('grant usage on schema %I to lmcs_app', current_schema());
end $$;

create table tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  allowed_domains text[] not null default '{}'
);

create table campuses (
  tenant_id uuid not null references tenants(id),
  code text not null,
  name text not null,
  primary key (tenant_id, code)
);

create table people (
  tenant_id uuid not null references tenants(id),
  id uuid not null default gen_random_uuid(),
  employee_code text not null,
  auth_email text,
  name text not null,
  campus_code text,
  department text,
  designation text,
  reports_to text,
  subjects text[] not null default '{}',
  active boolean not null default true,
  synced_at timestamptz,
  primary key (tenant_id, id),
  unique (tenant_id, employee_code)
);
create index people_auth_email on people (tenant_id, lower(auth_email));

create table allowlist (
  tenant_id uuid not null references tenants(id),
  email text not null,
  name text,
  campus_code text,
  roles text[] not null default '{}',
  can_approve boolean not null default false,
  primary key (tenant_id, email)
);

-- role null = the department gets no automatic role (e.g. AdminTM)
create table role_rules (
  tenant_id uuid not null references tenants(id),
  department text not null,
  role text,
  primary key (tenant_id, department)
);

create table sessions (
  tenant_id uuid not null references tenants(id),
  token_hash text primary key,
  person_email text not null,
  roles text[] not null default '{}',
  campus_code text,
  view_as text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table switches (
  tenant_id uuid not null references tenants(id),
  feature text not null,
  scope_kind text not null default 'tenant',
  scope_id text not null default '',
  "on" boolean not null default false,
  primary key (tenant_id, feature, scope_kind, scope_id)
);

create table audit_log (
  tenant_id uuid not null references tenants(id),
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  who text not null,
  action text not null,
  entity text not null,
  entity_id text,
  before jsonb,
  after jsonb
);

create table idempotency (
  tenant_id uuid not null references tenants(id),
  key text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, key)
);

create table jobs (
  tenant_id uuid not null references tenants(id),
  id bigint generated always as identity primary key,
  kind text not null,
  run_at timestamptz not null default now(),
  payload jsonb not null default '{}',
  locked_at timestamptz,
  done_at timestamptz,
  error text
);

create table sync_runs (
  tenant_id uuid not null references tenants(id),
  id bigint generated always as identity primary key,
  kind text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  ok boolean,
  received int,
  changed int,
  deactivated int,
  refused text,
  error text
);

create table health_events (
  tenant_id uuid not null references tenants(id),
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  kind text not null,
  detail jsonb not null default '{}',
  resolved_at timestamptz
);

-- Row level security: one policy per table on the transaction's tenant.
do $$
declare t text;
begin
  execute 'alter table tenants enable row level security';
  execute 'alter table tenants force row level security';
  execute $p$create policy tenant_isolation on tenants
    using (id = nullif(current_setting('app.tenant_id', true), '')::uuid)
    with check (id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$;
  foreach t in array array['campuses','people','allowlist','role_rules','sessions','switches',
                           'audit_log','idempotency','jobs','sync_runs','health_events'] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
    execute format($p$create policy tenant_isolation on %I
      using (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)
      with check (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid)$p$, t);
  end loop;
end $$;

-- App role grants. audit_log is append-only; tenants are read-only to the app.
grant select on tenants to lmcs_app;
grant select, insert, update, delete on campuses, people, allowlist, role_rules, sessions, switches,
  idempotency, jobs, sync_runs, health_events to lmcs_app;
grant select, insert on audit_log to lmcs_app;
do $$ begin
  execute format('grant usage on all sequences in schema %I to lmcs_app', current_schema());
end $$;

-- Seed: LMCS is the only tenant. FORCE RLS applies to the (non-superuser) owner on Render,
-- so the seed sets the tenant for this migration's transaction.
select set_config('app.tenant_id', '6f1c2a3e-0b7d-4c55-9a1e-1c0d5e4a7b01', true);

insert into tenants (id, name, allowed_domains)
values ('6f1c2a3e-0b7d-4c55-9a1e-1c0d5e4a7b01', 'LMCS', '{lms.org.in}');

insert into campuses (tenant_id, code, name)
select '6f1c2a3e-0b7d-4c55-9a1e-1c0d5e4a7b01', code, name from (values
  ('LMS1', 'LMS 1'), ('LMS2', 'LMS 2'), ('LMS3', 'LMS 3'), ('LMS4', 'LMS 4'),
  ('LMS5', 'LMS 5'), ('LMS6', 'LMS 6'), ('HES', 'HES')) v(code, name);

insert into role_rules (tenant_id, department, role)
select '6f1c2a3e-0b7d-4c55-9a1e-1c0d5e4a7b01', department, role from (values
  ('Teaching', 'Teacher'), ('AdminPTI', 'Teacher'), ('AdminIT', 'Teacher'),
  ('AdminClerk', 'Staff'), ('Non-Teaching', 'Staff'), ('Transport', 'Staff'),
  ('AdminTM', null)) v(department, role);

insert into switches (tenant_id, feature, "on")
values ('6f1c2a3e-0b7d-4c55-9a1e-1c0d5e4a7b01', 'staff_auto_signin', false);
