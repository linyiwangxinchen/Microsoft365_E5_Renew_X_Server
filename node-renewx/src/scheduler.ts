import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import { catalog, type ActivityEndpoint } from './catalog.js'
import { exchangeClientCredentials, exchangePassword, exchangeRefreshToken, callGraph, type TokenBundle } from './graph.js'
import { Store, type Account } from './db.js'
import { sendBackoffNotification } from './mailer.js'
import { legacyEndpointMatches, nextLegacySchedule, type LegacySchedulerOptions } from './legacy-config.js'

export interface RunOptions {
  maxRequests?: number
  includeWriteActivity?: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function shuffled<T>(items: T[]): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy
}

function nextSchedule(legacyOptions?: LegacySchedulerOptions | null): number {
  if (legacyOptions) return nextLegacySchedule(new Date(), legacyOptions)
  const base = 1_000_000 + Math.floor(Math.random() * 1_000_000)
  return Date.now() + base
}

export class Scheduler {
  private timer: NodeJS.Timeout | undefined
  private readonly running = new Set<string>()

  constructor(private readonly store: Store) {}

  start(): void {
    this.timer = setInterval(() => void this.tick(), config.schedulerPollMs)
    void this.tick()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  async enqueue(accountId: string, options: RunOptions = {}): Promise<string> {
    if (this.running.has(accountId)) throw new Error('This account already has a running job')
    const account = this.store.getAccount(accountId, true)
    if (!account) throw new Error('Account not found')
    const run = this.store.createRun(accountId)
    this.running.add(accountId)
    void this.execute(account, run.id, options).finally(() => this.running.delete(accountId))
    return run.id
  }

  private async tick(): Promise<void> {
    const legacyOptions = this.store.getSetting<LegacySchedulerOptions>('legacy.renew-plus')
    if (legacyOptions && !legacyOptions.autoRun) return
    for (const account of this.store.dueAccounts()) {
      if (this.running.has(account.id)) continue
      try {
        const run = this.store.createRun(account.id)
        this.running.add(account.id)
        void this.execute(account, run.id, {}).finally(() => this.running.delete(account.id))
      } catch (error) {
        console.error('scheduler tick failed', error)
      }
    }
  }

  private selectEndpoints(account: Account, options: RunOptions): ActivityEndpoint[] {
    const legacyOptions = this.store.getSetting<LegacySchedulerOptions>('legacy.renew-plus')
    const eligible = account.mode === 'client_credentials'
      ? catalog.filter((endpoint) => endpoint.noLoginAvailable)
      : catalog
    const allowWrite = options.includeWriteActivity ?? account.allowWriteActivity ?? config.allowWriteActivity
    let filtered = eligible.filter((endpoint) => allowWrite || !endpoint.write)
    if (legacyOptions?.apiLibrary.length) {
      const matched = filtered.filter((endpoint) => legacyOptions.apiLibrary.some((item) => legacyEndpointMatches(endpoint, item)))
      // Older builds may contain endpoints that are not yet in this web catalog.
      // Keep the known subset when there is one, otherwise retain the safe catalog.
      if (matched.length > 0) filtered = matched
    }
    const explicitLimit = options.maxRequests
    const count = Math.min(
      explicitLimit ?? (legacyOptions && !legacyOptions.apiSelectRandom ? filtered.length : config.maxRequestsPerRun),
      filtered.length,
    )
    const ordered = legacyOptions?.apiSequenceRandom === false
      ? [...filtered]
      : shuffled(filtered)
    return ordered.slice(0, count)
  }

  private async tokenFor(account: Account): Promise<TokenBundle> {
    if (account.mode === 'client_credentials') return exchangeClientCredentials(account)
    if (account.mode === 'password') return exchangePassword(account)
    return exchangeRefreshToken(account)
  }

  private async execute(account: Account, runId: string, options: RunOptions): Promise<void> {
    let requestCount = 0
    let successCount = 0
    let failCount = 0
    let status = 'succeeded'
    let errorMessage: string | null = null
    let backoffReason: string | null = null
    try {
      if (account.mode === 'client_credentials' && !account.username) {
        throw new Error('Client credentials mode requires a target user UPN')
      }
      const token = await this.tokenFor(account)
      if (token.refreshToken && token.refreshToken !== account.refreshToken) {
        this.store.updateAccount(account.id, { refreshToken: token.refreshToken })
      }
      const endpoints = this.selectEndpoints(account, options)
      if (endpoints.length === 0) throw new Error('No eligible endpoints are enabled for this account')
      for (const endpoint of endpoints) {
        await sleep(config.minDelayMs + Math.floor(Math.random() * Math.max(1, config.minDelayMs)))
        const legacyOptions = this.store.getSetting<LegacySchedulerOptions>('legacy.renew-plus')
        const result = await callGraph(
          token.accessToken,
          endpoint,
          options.includeWriteActivity ?? account.allowWriteActivity ?? config.allowWriteActivity,
          account.mode === 'client_credentials' ? account.username : undefined,
          legacyOptions?.apiContentRandom ?? true,
        )
        requestCount += 1
        if (result.ok) successCount += 1
        else failCount += 1
        this.store.appendLog({
          runId,
          apiName: endpoint.id,
          method: endpoint.method,
          url: endpoint.path,
          status: result.status,
          ok: result.ok,
          durationMs: result.durationMs,
          message: result.message,
        })
      }
      if (failCount > 0 && successCount === 0) status = 'failed'
      else if (failCount > 0) status = 'partial'
      if (failCount > 0 && (successCount === 0 || (requestCount >= 10 && failCount / requestCount > 0.7))) {
        backoffReason = errorMessage ?? `High failure rate (${failCount}/${requestCount})`
      }
    } catch (error) {
      status = 'failed'
      errorMessage = error instanceof Error ? error.message : String(error)
      backoffReason = errorMessage
    } finally {
      this.store.finishRun(runId, { status, requestCount, successCount, failCount, error: errorMessage })
      const completedRun = this.store.getRun(runId)
      if (backoffReason) {
        const recentRuns = this.store.listRuns(account.id, 8)
        let consecutiveFailures = 0
        for (const item of recentRuns) {
          if (item.status !== 'failed' && item.status !== 'partial') break
          consecutiveFailures += 1
        }
        const backoffMs = Math.min(6 * 60 * 60 * 1000, 15 * 60 * 1000 * 2 ** Math.max(0, consecutiveFailures - 1))
        this.store.setAccountSchedule(account.id, Date.now() + backoffMs, `${status}:backoff`)
        if (completedRun) void sendBackoffNotification(account, completedRun, backoffReason, backoffMs).catch((error) => console.error('SMTP notification failed', error))
      } else {
        this.store.setAccountSchedule(account.id, nextSchedule(this.store.getSetting<LegacySchedulerOptions>('legacy.renew-plus')), status)
      }
    }
  }
}
