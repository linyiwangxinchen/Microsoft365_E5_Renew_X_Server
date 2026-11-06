import path from 'node:path'

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback
  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase())
}

function integer(value: string | undefined, fallback: number, minimum: number): number {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback
}

export const config = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  host: process.env.HOST ?? '0.0.0.0',
  port: integer(process.env.PORT, 3000, 1),
  dataDir: path.resolve(process.env.DATA_DIR ?? './data'),
  adminPassword: process.env.ADMIN_PASSWORD ?? '',
  encryptionKey: process.env.DATA_ENCRYPTION_KEY ?? '',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, ''),
  oauthClientId: process.env.MICROSOFT_OAUTH_CLIENT_ID ?? '',
  oauthClientSecret: process.env.MICROSOFT_OAUTH_CLIENT_SECRET ?? '',
  oauthTenant: process.env.MICROSOFT_OAUTH_TENANT ?? 'common',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: integer(process.env.SMTP_PORT, 587, 1),
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  smtpFrom: process.env.SMTP_FROM ?? '',
  smtpTo: process.env.SMTP_TO ?? '',
  smtpSecure: bool(process.env.SMTP_SECURE, false),
  cookieSecure: bool(process.env.COOKIE_SECURE, false),
  trustProxy: bool(process.env.TRUST_PROXY, false),
  schedulerPollMs: integer(process.env.SCHEDULER_POLL_MS, 15_000, 1_000),
  minDelayMs: integer(process.env.MIN_DELAY_MS, 3_000, 0),
  maxRequestsPerRun: integer(process.env.MAX_REQUESTS_PER_RUN, 6, 1),
  requestTimeoutMs: integer(process.env.REQUEST_TIMEOUT_MS, 30_000, 1_000),
  maxRetries: integer(process.env.MAX_RETRIES, 3, 0),
  allowWriteActivity: bool(process.env.ALLOW_WRITE_ACTIVITY, false),
}

export function assertConfig(): void {
  if (!config.adminPassword) {
    throw new Error('ADMIN_PASSWORD is required')
  }
  if (config.nodeEnv === 'production' && !config.encryptionKey) {
    throw new Error('DATA_ENCRYPTION_KEY is required in production')
  }
}
