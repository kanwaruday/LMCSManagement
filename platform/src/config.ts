// Environment config. Values are set by Uday on Render; errors name missing variables, never values.
const REQUIRED = ['DATABASE_URL', 'APP_ORIGIN'] as const;
// Set later by the setup quests (Q2-Q7); absent until then.
const OPTIONAL = [
  'GOOGLE_SIGNIN_CLIENT_ID', 'GOOGLE_BOT_CLIENT_ID', 'GOOGLE_BOT_CLIENT_SECRET', 'GOOGLE_BOT_REFRESH_TOKEN',
  'APPROVALS_SHEET_ID', 'TEACHING_APPLICANTS_SHEET_ID', 'SYNC_SECRET', 'PDR_HOOK_URL', 'PDR_HOOK_SECRET',
  'COORD_HOOK_SECRET', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'BACKUP_AGE_RECIPIENT',
] as const;

// Per-tenant sync secrets beyond SYNC_SECRET (tenants.sync_secret_env names one), passed through as set.
export type SyncSecrets = { [K in `SYNC_SECRET_${string}`]?: string };
export type Config = { [K in (typeof REQUIRED)[number]]: string }
  & { [K in (typeof OPTIONAL)[number]]?: string }
  & SyncSecrets & { PORT: number };

export function loadConfig(env: Record<string, string | undefined>): Config {
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new Error(`Missing environment variables: ${missing.join(', ')}`);
  const config: Record<string, unknown> = { PORT: Number(env.PORT) || 10000 };
  for (const k of [...REQUIRED, ...OPTIONAL]) if (env[k]) config[k] = env[k];
  for (const k of Object.keys(env)) if (/^SYNC_SECRET_/.test(k) && env[k]) config[k] = env[k];
  return config as Config;
}
