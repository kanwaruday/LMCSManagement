-- Staff/allowlist sync (src/sync.ts).
-- campuses.code_prefix: Employee Code prefix -> campus, as data (PDR_CAMPUS_BY_PREFIX in apps-script/main.gs). A prefix with no
-- campus row (HES head office) leaves people.campus_code null: those staff sign in through the allowlist only.
-- tenants.sync_secret_env: the NAME of the environment variable holding that tenant's sync secret (never the secret). A push is
-- credited to the tenant whose secret verifies its signature; a second tenant later = a second env var + its row here.
alter table campuses add column code_prefix text;
alter table campuses add constraint campuses_code_prefix unique (tenant_id, code_prefix);
alter table tenants add column sync_secret_env text;

select set_config('app.tenant_id', '6f1c2a3e-0b7d-4c55-9a1e-1c0d5e4a7b01', true);

update tenants set sync_secret_env = 'SYNC_SECRET' where id = '6f1c2a3e-0b7d-4c55-9a1e-1c0d5e4a7b01';

update campuses c set code_prefix = v.prefix
from (values ('KUL', 'LMS1'), ('KEL', 'LMS2'), ('DUN', 'LMS3'), ('NCM', 'LMS4'), ('SAY', 'LMS5'), ('JOG', 'LMS6')) v(prefix, code)
where c.tenant_id = '6f1c2a3e-0b7d-4c55-9a1e-1c0d5e4a7b01' and c.code = v.code;
