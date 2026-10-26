-- Replay ordering for signed sync calls (src/sync.ts): every accepted push or poll records its sentAt; a later call of the
-- same tenant and kind must be strictly newer, so a captured request can't be replayed inside its 5-minute window.
alter table sync_runs add column sent_at timestamptz;
create index sync_runs_kind_sent_at on sync_runs (tenant_id, kind, sent_at);

-- Public /api/health reads aggregates across tenants (ok + minutes since the last good run, no names, no counts). It sets
-- app.health = 'on' for its own transaction only; this extra read-only policy then admits every tenant's sync_runs rows.
-- sync_runs holds no personal data (kinds, timestamps, counts, codes).
create policy health_read on sync_runs for select using (current_setting('app.health', true) = 'on');
