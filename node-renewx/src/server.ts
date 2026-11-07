import path from 'node:path'
import { randomBytes } from 'node:crypto'
import express, { type Request, type Response } from 'express'
import { z } from 'zod'
import { config, assertConfig } from './config.js'
import { Store, type Account } from './db.js'
import { clearSession, login, requireAuth, sessionToken, setSession } from './auth.js'
import { exchangeAuthorizationCode, exchangeClientCredentials, exchangePassword, exchangeRefreshToken, fetchDirectorySubscriptionStatus, type TokenBundle } from './graph.js'
import { Scheduler } from './scheduler.js'
import { catalog } from './catalog.js'
import { optionsSummary, parseLegacyConfig, type LegacySchedulerOptions } from './legacy-config.js'

assertConfig()
const store = new Store()
const scheduler = new Scheduler(store)
const app = express()

app.set('trust proxy', config.trustProxy)
app.use(express.json({ limit: '1mb' }))
app.use(express.text({ type: ['text/plain', 'application/octet-stream'], limit: '1mb' }))
app.use(express.static(path.resolve(process.cwd(), 'public')))

app.get('/api/health', (_req, res) => res.json({ ok: true, service: 'renewx-node', time: Date.now() }))

app.post('/api/auth/login', async (req, res) => {
  try {
    const password = z.object({ password: z.string().min(1) }).parse(req.body).password
    const token = await login(store, password)
    setSession(res, token)
    res.json({ ok: true })
  } catch {
    res.status(401).json({ error: 'invalid_credentials' })
  }
})

app.post('/api/auth/logout', (req, res) => {
  const token = sessionToken(req)
  if (token) store.deleteSession(token)
  clearSession(res)
  res.json({ ok: true })
})

app.get('/api/auth/me', requireAuth(store), (_req, res) => res.json({ ok: true, role: 'admin' }))

const authed = requireAuth(store)

app.get('/api/config', authed, (_req, res) => res.json({
  publicBaseUrl: config.publicBaseUrl,
  oauthEnabled: Boolean(config.oauthClientId && config.oauthClientSecret),
  allowWriteActivity: config.allowWriteActivity,
  maxRequestsPerRun: config.maxRequestsPerRun,
  minDelayMs: config.minDelayMs,
}))

const defaultRenewPlusSettings: LegacySchedulerOptions = {
  presetConfigMode: 0,
  apiLibrary: catalog.map((endpoint) => endpoint.id),
  apiSelectRandom: true,
  apiSequenceRandom: true,
  apiContentRandom: true,
  periodStartTime: 500,
  periodEndTime: 1000,
  workStartTime: 0,
  workEndTime: 24,
  workDays: [0, 1, 2, 3, 4, 5, 6],
  smartPause: true,
  autoRun: true,
}

const renewPlusSettingsSchema = z.object({
  presetConfigMode: z.number().int().min(0).max(2).optional(),
  apiLibrary: z.array(z.string().min(1).max(400)).max(500).optional(),
  apiSelectRandom: z.boolean().optional(),
  apiSequenceRandom: z.boolean().optional(),
  apiContentRandom: z.boolean().optional(),
  periodStartTime: z.number().int().min(500).max(86400).optional(),
  periodEndTime: z.number().int().min(500).max(86400).optional(),
  workStartTime: z.number().int().min(0).max(24).optional(),
  workEndTime: z.number().int().min(0).max(24).optional(),
  workDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  smartPause: z.boolean().optional(),
  autoRun: z.boolean().optional(),
})

app.get('/api/settings/renew-plus', authed, (_req, res) => {
  const stored = store.getSetting<LegacySchedulerOptions>('legacy.renew-plus')
  res.json(stored ? { ...stored, apiLibrary: [...stored.apiLibrary], workDays: [...stored.workDays] } : defaultRenewPlusSettings)
})

app.patch('/api/settings/renew-plus', authed, (req, res) => {
  try {
    const patch = renewPlusSettingsSchema.parse(req.body)
    const current = store.getSetting<LegacySchedulerOptions>('legacy.renew-plus') ?? defaultRenewPlusSettings
    const next = { ...current, ...patch }
    if (next.periodStartTime > next.periodEndTime) throw new Error('period_start_must_not_exceed_end')
    if (next.workStartTime >= next.workEndTime) throw new Error('work_start_must_be_before_end')
    if (next.workDays.length === 0) throw new Error('at_least_one_work_day_required')
    next.apiLibrary = [...new Set(next.apiLibrary)].slice(0, 500)
    next.workDays = [...new Set(next.workDays)].sort((a, b) => a - b)
    store.setSetting('legacy.renew-plus', next)
    res.json(next)
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'invalid_renew_plus_settings' })
  }
})

app.get('/api/catalog', authed, (_req, res) => {
  res.json(catalog)
})

const accountSchema = z.object({
  name: z.string().min(1).max(120),
  mode: z.enum(['delegated', 'password', 'client_credentials']),
  username: z.string().email().optional().or(z.literal('')),
  tenant: z.string().min(1).max(160).optional(),
  clientId: z.string().uuid(),
  clientSecret: z.string().max(4000).optional().or(z.literal('')),
  refreshToken: z.string().max(10000).optional().or(z.literal('')),
  password: z.string().max(4000).optional().or(z.literal('')),
  scopes: z.array(z.string().min(1).max(200)).max(100).optional(),
  allowWriteActivity: z.boolean().optional(),
})

function accountView(account: ReturnType<Store['listAccounts']>[number]) {
  return { ...account, stats: store.getAccountStats(account.id), subscription: store.getSubscriptionStatus(account.id) }
}

app.get('/api/accounts', authed, (_req, res) => res.json(store.listAccounts().map(accountView)))

app.post('/api/import/legacy-config', authed, (req, res) => {
  try {
    if (typeof req.body !== 'string' || req.body.trim().length === 0) {
      res.status(400).json({ error: 'legacy_config_body_required' })
      return
    }
    const parsed = parseLegacyConfig(req.body)
    const importedIds: string[] = []
    let duplicateAccounts = 0
    for (const [index, legacyAccount] of parsed.accounts.entries()) {
      const mode = legacyAccount.isLogin ? 'password' : 'client_credentials'
      if (store.findAccountByIdentity(mode, legacyAccount.userName, legacyAccount.clientId)) {
        duplicateAccounts += 1
        continue
      }
      const tenant = legacyAccount.isLogin
        ? 'organizations'
        : (legacyAccount.userName.split('@')[1] || 'organizations')
      const created = store.createAccount({
        name: `Renew Plus ${index + 1} · ${legacyAccount.userName}`,
        mode,
        username: legacyAccount.userName,
        tenant,
        clientId: legacyAccount.clientId,
        password: legacyAccount.isLogin ? legacyAccount.secret : undefined,
        clientSecret: legacyAccount.isLogin ? undefined : legacyAccount.secret,
        allowWriteActivity: false,
      })
      importedIds.push(created.id)
    }
    store.setSetting('legacy.renew-plus', parsed.options)
    res.status(201).json({
      ok: true,
      format: parsed.format,
      imported: importedIds.length,
      skipped: parsed.rejectedAccounts + duplicateAccounts,
      accountIds: importedIds,
      options: optionsSummary(parsed.options),
    })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'invalid_legacy_config' })
  }
})

app.post('/api/accounts', authed, (req, res) => {
  try {
    const input = accountSchema.parse(req.body)
    if (input.mode === 'delegated' && !input.refreshToken && !config.oauthClientId) {
      res.status(400).json({ error: 'refresh_token_or_oauth_configuration_required' })
      return
    }
    if (input.mode === 'password' && (!input.username || !input.password)) {
      res.status(400).json({ error: 'username_and_password_required' })
      return
    }
    if (input.mode === 'client_credentials' && !input.clientSecret) {
      res.status(400).json({ error: 'client_secret_required' })
      return
    }
    if (input.mode === 'client_credentials' && (!input.username || !input.tenant || input.tenant === 'common')) {
      res.status(400).json({ error: 'client_credentials_requires_target_user_and_tenant' })
      return
    }
    res.status(201).json(accountView(store.createAccount(input)))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'invalid_account' })
  }
})

app.patch('/api/accounts/:id', authed, (req, res) => {
  try {
    const input = accountSchema.partial().extend({ enabled: z.boolean().optional(), paused: z.boolean().optional() }).parse(req.body)
    const account = store.updateAccount(String(req.params.id), input)
    if (!account) { res.status(404).json({ error: 'account_not_found' }); return }
    res.json(accountView(account))
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'invalid_account' })
  }
})

async function tokenForAccount(account: Account): Promise<TokenBundle> {
  if (account.mode === 'client_credentials') return exchangeClientCredentials(account)
  if (account.mode === 'password') return exchangePassword(account)
  return exchangeRefreshToken(account)
}

app.post('/api/accounts/:id/subscription-status', authed, async (req, res) => {
  try {
    const account = store.getAccount(String(req.params.id), true)
    if (!account) { res.status(404).json({ error: 'account_not_found' }); return }
    const token = await tokenForAccount(account)
    if (token.refreshToken && token.refreshToken !== account.refreshToken) {
      store.updateAccount(account.id, { refreshToken: token.refreshToken })
    }
    const subscription = await fetchDirectorySubscriptionStatus(token.accessToken)
    store.setSubscriptionStatus(account.id, { ...subscription, error: subscription.error ?? null })
    res.json({ accountId: account.id, subscription: store.getSubscriptionStatus(account.id) })
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500)
    store.setSubscriptionStatus(String(req.params.id), {
      expiresAt: null,
      status: null,
      sku: null,
      isTrial: null,
      checkedAt: Date.now(),
      source: 'graph-directory-subscriptions',
      error: message,
    })
    res.status(502).json({ error: 'subscription_status_unavailable', message })
  }
})

app.delete('/api/accounts/:id', authed, (req, res) => {
  if (!store.deleteAccount(String(req.params.id))) { res.status(404).json({ error: 'account_not_found' }); return }
  res.status(204).end()
})

app.post('/api/accounts/:id/run', authed, async (req, res) => {
  try {
    const options = z.object({ maxRequests: z.number().int().min(1).max(50).optional(), includeWriteActivity: z.boolean().optional() }).parse(req.body ?? {})
    const runId = await scheduler.enqueue(String(req.params.id), options)
    res.status(202).json({ runId })
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : 'unable_to_start_run' })
  }
})

app.get('/api/runs', authed, (req, res) => {
  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : undefined
  res.json(store.listRuns(accountId))
})

app.get('/api/runs/:id', authed, (req, res) => {
  const run = store.getRun(String(req.params.id))
  if (!run) { res.status(404).json({ error: 'run_not_found' }); return }
  res.json({ ...run, logs: store.listLogs(run.id) })
})

app.get('/api/oauth/start', authed, (req, res) => {
  const accountId = typeof req.query.accountId === 'string' ? req.query.accountId : ''
  const account = store.getAccount(accountId, true)
  if (!account) { res.status(404).send('Account not found'); return }
  if (!config.oauthClientId || !config.oauthClientSecret) { res.status(400).send('OAuth is not configured'); return }
  const state = randomBytes(24).toString('base64url')
  store.createOAuthState(state, account.id, Date.now() + 10 * 60 * 1000)
  const redirectUri = `${config.publicBaseUrl}/api/oauth/callback`
  const params = new URLSearchParams({
    client_id: config.oauthClientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: 'openid profile offline_access https://graph.microsoft.com/.default',
    state,
    prompt: 'select_account',
  })
  res.redirect(`https://login.microsoftonline.com/${encodeURIComponent(account.tenant ?? config.oauthTenant)}/oauth2/v2.0/authorize?${params}`)
})

app.get('/api/oauth/callback', async (req, res) => {
  try {
    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const accountId = state ? store.consumeOAuthState(state) : null
    if (!accountId || !code) throw new Error('Invalid OAuth callback')
    const account = store.getAccount(accountId, true)
    if (!account) throw new Error('Account not found')
    const bundle = await exchangeAuthorizationCode({
      code,
      tenant: account.tenant ?? config.oauthTenant,
      clientId: config.oauthClientId,
      clientSecret: config.oauthClientSecret,
      redirectUri: `${config.publicBaseUrl}/api/oauth/callback`,
    })
    store.updateAccount(account.id, { refreshToken: bundle.refreshToken, clientId: config.oauthClientId })
    res.redirect('/?oauth=success')
  } catch (error) {
    res.status(400).send(`OAuth failed: ${error instanceof Error ? error.message : String(error)}`)
  }
})

app.use('/api', (_req, res) => res.status(404).json({ error: 'not_found' }))

const server = app.listen(config.port, config.host, () => {
  console.log(`RenewX Node listening on http://${config.host}:${config.port}`)
})
scheduler.start()

function shutdown(signal: string): void {
  console.log(`received ${signal}, shutting down`)
  scheduler.stop()
  server.close(() => { store.close(); process.exit(0) })
}
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGINT', () => shutdown('SIGINT'))
