import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Configuration-shape checks only. Never connects to a database or provider.
export function checkReleaseReadiness(env = process.env, { artifactExists = existsSync } = {}) {
  const checks = [];
  const add = (name, pass, detail) => checks.push({ name, status: pass ? 'PASS' : 'BLOCKED', detail });
  const strong = value => typeof value === 'string' && value.trim().length >= 32 && !/example|change.?me|synthetic|disposable/i.test(value);
  add('session-secret', strong(env.NEXTAUTH_SECRET), 'Use a unique randomly generated secret of at least 32 characters.');
  add('scheduler-secret', strong(env.CRON_SECRET), 'Use a separate randomly generated scheduler secret.');
  add('separate-secrets', !!env.CRON_SECRET && env.CRON_SECRET !== env.NEXTAUTH_SECRET, 'Session and scheduler secrets must differ.');
  let url;
  try { url = new URL(env.NEXTAUTH_URL || ''); } catch {}
  add('public-origin', !!url && url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.pathname === '/' && !['localhost','127.0.0.1','[::1]'].includes(url.hostname), 'Set the intended HTTPS application origin.');
  let database;
  try { database = new URL(env.DATABASE_URL || ''); } catch {}
  const insecureDatabase = database && ['disable','allow','prefer','no-verify'].includes(database.searchParams.get('sslmode'));
  add('database-shape', !!database && ['postgres:','postgresql:'].includes(database.protocol) && !!database.hostname && database.pathname.length > 1 && !insecureDatabase, 'Use the intended PostgreSQL database; TLS and network access need infrastructure verification.');
  add('tls-verification', env.NODE_TLS_REJECT_UNAUTHORIZED !== '0', 'TLS certificate verification must remain enabled.');
  add('platform-administrators', !!env.STRENGTHSYNC_PLATFORM_ADMIN_USER_IDS?.split(',').filter(x=>x.trim()).length, 'Explicitly select existing immutable operator user IDs.');
  add('email-delivery', !!env.RESEND_API_KEY?.trim() && !!env.RESEND_FROM_EMAIL?.trim(), 'Account setup and recovery require a verified email sender and delivery credential.');
  for (const [name, keys] of [
    ['teams-bot', ['MICROSOFT_APP_ID','MICROSOFT_APP_PASSWORD','MICROSOFT_APP_TENANT_ID']],
    ['teams-webhook-fallback', ['TEAMS_WEBHOOK_URL','TEAMS_WEBHOOK_ORGANIZATION_ID']],
    ['avatar-storage', ['AWS_REGION','AWS_S3_BUCKET','AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY']],
  ]) {
    const configured = keys.filter(key => env[key]?.trim());
    add(name, configured.length === 0 || configured.length === keys.length, 'Optional integration must be completely configured or disabled; provider ownership and permissions require separate verification.');
  }
  const header = env.STRENGTHSYNC_TRUSTED_CLIENT_IP_HEADER?.toLowerCase();
  add('trusted-proxy-header', !header || (/^[a-z0-9-]+$/.test(header) && !['forwarded','x-forwarded-for'].includes(header)), 'Only configure a single client-IP header overwritten by the trusted proxy. Unset uses account/global protection.');
  add('document-worker', artifactExists(resolve('.document-worker/parser.cjs')), 'Build the bounded document worker before startup.');
  add('standalone-output', artifactExists(resolve('.next/standalone/server.js')), 'Build the standalone application and verify its packaged parser on the deployment platform.');
  return { ready: checks.every(check=>check.status === 'PASS'), checks, unverified: ['Actual target database and applied migrations', 'Provider credentials, sender and tenant ownership', 'HTTPS, proxy trust, IAM, database networking, backups and host resource limits', 'Historical credential rotation and data retention cleanup', 'Production logs, incident evidence and end-to-end delivery'] };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = checkReleaseReadiness();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.ready ? 0 : 1;
}
