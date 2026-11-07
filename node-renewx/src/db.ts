import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import { config } from './config.js'
import { decryptSecret, encryptSecret, hashOpaque } from './crypto.js'

export type AccountMode = 'delegated' | 'password' | 'client_credentials'

export interface AccountInput {
  name: string
  mode: AccountMode
  username?: string
  tenant?: string
  clientId: string
  clientSecret?: string
  refreshToken?: string
  password?: string
  scopes?: string[]
  allowWriteActivity?: boolean
}

export interface Account extends AccountInput {
  id: string
  enabled: boolean
  paused: boolean
  nextRunAt: number
  lastRunAt: number | null
  lastStatus: string | null
  createdAt: number
  updatedAt: number
}

export interface AccountStats {
  runCount: number
  runningCount: number
  succeededCount: number
  partialCount: number
  failedCount: number
  requestCount: number
  successCount: number
  failCount: number
  lastRunAt: number | null
  lastSuccessAt: number | null
  lastFailureAt: number | null
  failureRate: number
}

export interface AccountSubscription {
  expiresAt: number | null
  status: string | null
  sku: string | null
  isTrial: boolean | null
  checkedAt: number | null
  source: string | null
  error: string | null
}

export interface RunSummary {
  id: string
  accountId: string
  startedAt: number
  finishedAt: number | null
  status: string
  requestCount: number
  successCount: number
  failCount: number
  error: string | null
}

export interface RunLog {
  id: number
  runId: string
  apiName: string
  method: string
  url: string
  status: number | null
  ok: boolean
  durationMs: number
  message: string
  createdAt: number
}

type AccountRow = {
  id: string
  name: string
  mode: AccountMode
  username: string | null
  tenant: string
  client_id: string
  expires_at: number | null
  client_secret_enc: string | null
  refresh_token_enc: string | null
  password_enc: string | null
  scopes_json: string
  allow_write_activity: number
  enabled: number
  paused: number
  next_run_at: number
  last_run_at: number | null
  last_status: string | null
  created_at: number
  updated_at: number
}

export class Store {
  readonly db: Database.Database

  constructor() {
    fs.mkdirSync(config.dataDir, { recursive: true })
    this.db = new Database(path.join(config.dataDir, 'renewx.sqlite'))
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    this.migrate()
  }

  private migrate(): void {
    const existingAccount = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get() as { sql: string } | undefined
    if (existingAccount?.sql.includes("CHECK (mode IN ('delegated', 'client_credentials'))")) {
      this.rebuildLegacyAccountSchema()
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('delegated', 'password', 'client_credentials')),
        username TEXT,
        tenant TEXT NOT NULL DEFAULT 'common',
        client_id TEXT NOT NULL,
        expires_at INTEGER,
        client_secret_enc TEXT,
        refresh_token_enc TEXT,
        password_enc TEXT,
        scopes_json TEXT NOT NULL DEFAULT '[]',
        allow_write_activity INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        paused INTEGER NOT NULL DEFAULT 0,
        next_run_at INTEGER NOT NULL,
        last_run_at INTEGER,
        last_status TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        started_at INTEGER NOT NULL,
        finished_at INTEGER,
        status TEXT NOT NULL,
        request_count INTEGER NOT NULL DEFAULT 0,
        success_count INTEGER NOT NULL DEFAULT 0,
        fail_count INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS run_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        api_name TEXT NOT NULL,
        method TEXT NOT NULL,
        url TEXT NOT NULL,
        status INTEGER,
        ok INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        message TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS oauth_states (
        state TEXT PRIMARY KEY,
        account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS account_subscriptions (
        account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
        expires_at INTEGER,
        status TEXT,
        sku TEXT,
        is_trial INTEGER,
        checked_at INTEGER,
        source TEXT,
        error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_accounts_due ON accounts(enabled, paused, next_run_at);
      CREATE INDEX IF NOT EXISTS idx_runs_account ON runs(account_id, started_at DESC);
      CREATE INDEX IF NOT EXISTS idx_logs_run ON run_logs(run_id, id);
    `)
    const accountColumns = this.db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>
    if (!accountColumns.some((column) => column.name === 'password_enc')) {
      this.db.exec('ALTER TABLE accounts ADD COLUMN password_enc TEXT')
    }
    if (!accountColumns.some((column) => column.name === 'expires_at')) {
      this.db.exec('ALTER TABLE accounts ADD COLUMN expires_at INTEGER')
    }
  }

  private rebuildLegacyAccountSchema(): void {
    const tableExists = (name: string): boolean => Boolean(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name))
    const accountColumns = this.db.prepare('PRAGMA table_info(accounts)').all() as Array<{ name: string }>
    const passwordExpression = accountColumns.some((column) => column.name === 'password_enc') ? 'password_enc' : 'NULL'
    const expiresExpression = accountColumns.some((column) => column.name === 'expires_at') ? 'expires_at' : 'NULL'
    this.db.pragma('foreign_keys = OFF')
    try {
      const migrate = this.db.transaction(() => {
        this.db.exec('DROP INDEX IF EXISTS idx_accounts_due; DROP INDEX IF EXISTS idx_runs_account; DROP INDEX IF EXISTS idx_logs_run;')
        if (tableExists('run_logs')) this.db.exec('ALTER TABLE run_logs RENAME TO run_logs_legacy')
        if (tableExists('runs')) this.db.exec('ALTER TABLE runs RENAME TO runs_legacy')
        if (tableExists('oauth_states')) this.db.exec('ALTER TABLE oauth_states RENAME TO oauth_states_legacy')
        this.db.exec('ALTER TABLE accounts RENAME TO accounts_legacy')
        this.db.exec(`
          CREATE TABLE accounts (
            id TEXT PRIMARY KEY, name TEXT NOT NULL,
            mode TEXT NOT NULL CHECK (mode IN ('delegated', 'password', 'client_credentials')),
            username TEXT, tenant TEXT NOT NULL DEFAULT 'common', client_id TEXT NOT NULL,
            expires_at INTEGER,
            client_secret_enc TEXT, refresh_token_enc TEXT, password_enc TEXT,
            scopes_json TEXT NOT NULL DEFAULT '[]', allow_write_activity INTEGER NOT NULL DEFAULT 0,
            enabled INTEGER NOT NULL DEFAULT 1, paused INTEGER NOT NULL DEFAULT 0,
            next_run_at INTEGER NOT NULL, last_run_at INTEGER, last_status TEXT,
            created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
          );
          CREATE TABLE runs (
            id TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            started_at INTEGER NOT NULL, finished_at INTEGER, status TEXT NOT NULL,
            request_count INTEGER NOT NULL DEFAULT 0, success_count INTEGER NOT NULL DEFAULT 0,
            fail_count INTEGER NOT NULL DEFAULT 0, error TEXT
          );
          CREATE TABLE run_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
            api_name TEXT NOT NULL, method TEXT NOT NULL, url TEXT NOT NULL, status INTEGER,
            ok INTEGER NOT NULL, duration_ms INTEGER NOT NULL, message TEXT NOT NULL, created_at INTEGER NOT NULL
          );
          CREATE TABLE oauth_states (
            state TEXT PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
          );
        `)
        this.db.exec(`INSERT INTO accounts (id,name,mode,username,tenant,client_id,expires_at,client_secret_enc,refresh_token_enc,password_enc,scopes_json,allow_write_activity,enabled,paused,next_run_at,last_run_at,last_status,created_at,updated_at)
          SELECT id,name,mode,username,tenant,client_id,${expiresExpression},client_secret_enc,refresh_token_enc,${passwordExpression},scopes_json,allow_write_activity,enabled,paused,next_run_at,last_run_at,last_status,created_at,updated_at FROM accounts_legacy`)
        if (tableExists('runs_legacy')) this.db.exec('INSERT INTO runs SELECT * FROM runs_legacy')
        if (tableExists('run_logs_legacy')) this.db.exec('INSERT INTO run_logs SELECT * FROM run_logs_legacy')
        if (tableExists('oauth_states_legacy')) this.db.exec('INSERT INTO oauth_states SELECT * FROM oauth_states_legacy')
        if (tableExists('run_logs_legacy')) this.db.exec('DROP TABLE run_logs_legacy')
        if (tableExists('runs_legacy')) this.db.exec('DROP TABLE runs_legacy')
        if (tableExists('oauth_states_legacy')) this.db.exec('DROP TABLE oauth_states_legacy')
        this.db.exec('DROP TABLE accounts_legacy')
      })
      migrate()
    } finally {
      this.db.pragma('foreign_keys = ON')
    }
  }

  private mapAccount(row: AccountRow, includeSecrets = false): Account {
    const result: Account = {
      id: row.id,
      name: row.name,
      mode: row.mode,
      username: row.username ?? undefined,
      tenant: row.tenant,
      clientId: row.client_id,
      scopes: JSON.parse(row.scopes_json) as string[],
      allowWriteActivity: Boolean(row.allow_write_activity),
      enabled: Boolean(row.enabled),
      paused: Boolean(row.paused),
      nextRunAt: row.next_run_at,
      lastRunAt: row.last_run_at,
      lastStatus: row.last_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
    if (includeSecrets) {
      result.clientSecret = decryptSecret(row.client_secret_enc, config.encryptionKey) ?? undefined
      result.refreshToken = decryptSecret(row.refresh_token_enc, config.encryptionKey) ?? undefined
      result.password = decryptSecret(row.password_enc, config.encryptionKey) ?? undefined
    }
    return result
  }

  listAccounts(): Account[] {
    const rows = this.db.prepare('SELECT * FROM accounts ORDER BY created_at DESC').all() as AccountRow[]
    return rows.map((row) => this.mapAccount(row))
  }

  getAccountStats(accountId: string): AccountStats {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS run_count,
        COALESCE(SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END), 0) AS running_count,
        COALESCE(SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END), 0) AS succeeded_count,
        COALESCE(SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END), 0) AS partial_count,
        COALESCE(SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END), 0) AS failed_count,
        COALESCE(SUM(request_count), 0) AS request_count,
        COALESCE(SUM(success_count), 0) AS success_count,
        COALESCE(SUM(fail_count), 0) AS fail_count,
        MAX(started_at) AS last_run_at,
        MAX(CASE WHEN status = 'succeeded' THEN COALESCE(finished_at, started_at) END) AS last_success_at,
        MAX(CASE WHEN status IN ('failed', 'partial') THEN COALESCE(finished_at, started_at) END) AS last_failure_at
      FROM runs WHERE account_id = ?
    `).get(accountId) as Record<string, unknown>
    const requestCount = Number(row.request_count ?? 0)
    const failCount = Number(row.fail_count ?? 0)
    return {
      runCount: Number(row.run_count ?? 0),
      runningCount: Number(row.running_count ?? 0),
      succeededCount: Number(row.succeeded_count ?? 0),
      partialCount: Number(row.partial_count ?? 0),
      failedCount: Number(row.failed_count ?? 0),
      requestCount,
      successCount: Number(row.success_count ?? 0),
      failCount,
      lastRunAt: row.last_run_at === null ? null : Number(row.last_run_at),
      lastSuccessAt: row.last_success_at === null ? null : Number(row.last_success_at),
      lastFailureAt: row.last_failure_at === null ? null : Number(row.last_failure_at),
      failureRate: requestCount > 0 ? Number((failCount / requestCount * 100).toFixed(1)) : 0,
    }
  }

  getSubscriptionStatus(accountId: string): AccountSubscription {
    const row = this.db.prepare('SELECT * FROM account_subscriptions WHERE account_id = ?').get(accountId) as Record<string, unknown> | undefined
    if (!row) return { expiresAt: null, status: null, sku: null, isTrial: null, checkedAt: null, source: null, error: null }
    return {
      expiresAt: row.expires_at === null ? null : Number(row.expires_at),
      status: row.status === null ? null : String(row.status),
      sku: row.sku === null ? null : String(row.sku),
      isTrial: row.is_trial === null ? null : Boolean(row.is_trial),
      checkedAt: row.checked_at === null ? null : Number(row.checked_at),
      source: row.source === null ? null : String(row.source),
      error: row.error === null ? null : String(row.error),
    }
  }

  setSubscriptionStatus(accountId: string, status: AccountSubscription): void {
    this.db.prepare(`
      INSERT INTO account_subscriptions (account_id, expires_at, status, sku, is_trial, checked_at, source, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id) DO UPDATE SET
        expires_at = excluded.expires_at,
        status = excluded.status,
        sku = excluded.sku,
        is_trial = excluded.is_trial,
        checked_at = excluded.checked_at,
        source = excluded.source,
        error = excluded.error
    `).run(
      accountId,
      status.expiresAt,
      status.status,
      status.sku,
      status.isTrial === null ? null : (status.isTrial ? 1 : 0),
      status.checkedAt,
      status.source,
      status.error,
    )
  }

  getAccount(id: string, includeSecrets = false): Account | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as AccountRow | undefined
    return row ? this.mapAccount(row, includeSecrets) : null
  }

  findAccountByIdentity(mode: AccountMode, username: string, clientId: string): Account | null {
    const row = this.db.prepare(
      'SELECT * FROM accounts WHERE mode = ? AND lower(COALESCE(username, \'\')) = lower(?) AND client_id = ? LIMIT 1',
    ).get(mode, username, clientId) as AccountRow | undefined
    return row ? this.mapAccount(row) : null
  }

  createAccount(input: AccountInput): Account {
    const now = Date.now()
    const id = randomUUID()
    this.db.prepare(`
      INSERT INTO accounts
      (id, name, mode, username, tenant, client_id, client_secret_enc, refresh_token_enc, password_enc,
       scopes_json, allow_write_activity, enabled, paused, next_run_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)
    `).run(
      id,
      input.name.trim(),
      input.mode,
      input.username?.trim() || null,
      input.tenant?.trim() || 'common',
      input.clientId.trim(),
      encryptSecret(input.clientSecret, config.encryptionKey),
      encryptSecret(input.refreshToken, config.encryptionKey),
      encryptSecret(input.password, config.encryptionKey),
      JSON.stringify(input.scopes ?? []),
      input.allowWriteActivity ? 1 : 0,
      now,
      now,
      now,
    )
    return this.getAccount(id) as Account
  }

  updateAccount(id: string, input: Partial<AccountInput> & { enabled?: boolean; paused?: boolean }): Account | null {
    const current = this.getAccount(id, true)
    if (!current) return null
    const next = { ...current, ...input }
    const now = Date.now()
    this.db.prepare(`
      UPDATE accounts SET name = ?, mode = ?, username = ?, tenant = ?, client_id = ?,
        client_secret_enc = ?, refresh_token_enc = ?, password_enc = ?, scopes_json = ?, allow_write_activity = ?,
        enabled = ?, paused = ?, updated_at = ? WHERE id = ?
    `).run(
      next.name.trim(),
      next.mode,
      next.username?.trim() || null,
      next.tenant?.trim() || 'common',
      next.clientId.trim(),
      encryptSecret(input.clientSecret ?? current.clientSecret, config.encryptionKey),
      encryptSecret(input.refreshToken ?? current.refreshToken, config.encryptionKey),
      encryptSecret(input.password ?? current.password, config.encryptionKey),
      JSON.stringify(next.scopes ?? []),
      next.allowWriteActivity ? 1 : 0,
      next.enabled ? 1 : 0,
      next.paused ? 1 : 0,
      now,
      id,
    )
    return this.getAccount(id)
  }

  deleteAccount(id: string): boolean {
    return this.db.prepare('DELETE FROM accounts WHERE id = ?').run(id).changes > 0
  }

  setAccountSchedule(id: string, nextRunAt: number, status?: string): void {
    this.db.prepare('UPDATE accounts SET next_run_at = ?, last_status = ?, updated_at = ? WHERE id = ?')
      .run(nextRunAt, status ?? null, Date.now(), id)
  }

  dueAccounts(now = Date.now()): Account[] {
    const rows = this.db.prepare('SELECT * FROM accounts WHERE enabled = 1 AND paused = 0 AND next_run_at <= ? ORDER BY next_run_at').all(now) as AccountRow[]
    return rows.map((row) => this.mapAccount(row, true))
  }

  createRun(accountId: string): RunSummary {
    const run: RunSummary = {
      id: randomUUID(), accountId, startedAt: Date.now(), finishedAt: null,
      status: 'running', requestCount: 0, successCount: 0, failCount: 0, error: null,
    }
    this.db.prepare('INSERT INTO runs (id, account_id, started_at, status) VALUES (?, ?, ?, ?)')
      .run(run.id, run.accountId, run.startedAt, run.status)
    return run
  }

  finishRun(id: string, data: Pick<RunSummary, 'status' | 'requestCount' | 'successCount' | 'failCount' | 'error'>): void {
    this.db.prepare(`UPDATE runs SET finished_at = ?, status = ?, request_count = ?, success_count = ?, fail_count = ?, error = ? WHERE id = ?`)
      .run(Date.now(), data.status, data.requestCount, data.successCount, data.failCount, data.error, id)
  }

  listRuns(accountId?: string, limit = 50): RunSummary[] {
    const rows = accountId
      ? this.db.prepare('SELECT * FROM runs WHERE account_id = ? ORDER BY started_at DESC LIMIT ?').all(accountId, limit)
      : this.db.prepare('SELECT * FROM runs ORDER BY started_at DESC LIMIT ?').all(limit)
    return (rows as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id), accountId: String(row.account_id), startedAt: Number(row.started_at),
      finishedAt: row.finished_at === null ? null : Number(row.finished_at), status: String(row.status),
      requestCount: Number(row.request_count), successCount: Number(row.success_count),
      failCount: Number(row.fail_count), error: row.error === null ? null : String(row.error),
    }))
  }

  getRun(id: string): RunSummary | null {
    return this.listRuns(undefined, 1000).find((run) => run.id === id) ?? null
  }

  appendLog(log: Omit<RunLog, 'id' | 'createdAt'>): void {
    this.db.prepare(`INSERT INTO run_logs (run_id, api_name, method, url, status, ok, duration_ms, message, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(log.runId, log.apiName, log.method, log.url, log.status, log.ok ? 1 : 0, log.durationMs, log.message, Date.now())
  }

  listLogs(runId: string): RunLog[] {
    const rows = this.db.prepare('SELECT * FROM run_logs WHERE run_id = ? ORDER BY id').all(runId) as Array<Record<string, unknown>>
    return rows.map((row) => ({
      id: Number(row.id), runId: String(row.run_id), apiName: String(row.api_name), method: String(row.method),
      url: String(row.url), status: row.status === null ? null : Number(row.status), ok: Boolean(row.ok),
      durationMs: Number(row.duration_ms), message: String(row.message), createdAt: Number(row.created_at),
    }))
  }

  createSession(token: string, expiresAt: number): void {
    this.db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').run(hashOpaque(token), expiresAt)
  }

  isSessionValid(token: string): boolean {
    const row = this.db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(hashOpaque(token)) as { expires_at: number } | undefined
    return Boolean(row && row.expires_at > Date.now())
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashOpaque(token))
  }

  createOAuthState(state: string, accountId: string, expiresAt: number): void {
    this.db.prepare('INSERT INTO oauth_states (state, account_id, expires_at) VALUES (?, ?, ?)').run(state, accountId, expiresAt)
  }

  consumeOAuthState(state: string): string | null {
    const row = this.db.prepare('SELECT account_id, expires_at FROM oauth_states WHERE state = ?').get(state) as { account_id: string; expires_at: number } | undefined
    this.db.prepare('DELETE FROM oauth_states WHERE state = ?').run(state)
    return row && row.expires_at > Date.now() ? row.account_id : null
  }

  setSetting(key: string, value: unknown): void {
    this.db.prepare(`
      INSERT INTO settings (key, value_json, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
    `).run(key, JSON.stringify(value), Date.now())
  }

  getSetting<T>(key: string): T | null {
    const row = this.db.prepare('SELECT value_json FROM settings WHERE key = ?').get(key) as { value_json: string } | undefined
    if (!row) return null
    try {
      return JSON.parse(row.value_json) as T
    } catch {
      return null
    }
  }

  close(): void {
    this.db.close()
  }
}
