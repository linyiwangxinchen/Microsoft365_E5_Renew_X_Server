import { randomUUID } from 'node:crypto'
import { config } from './config.js'
import type { Account } from './db.js'
import type { ActivityEndpoint } from './catalog.js'
import { expandPath } from './catalog.js'

export interface TokenBundle {
  accessToken: string
  refreshToken?: string
  expiresIn: number
}

export interface GraphResult {
  ok: boolean
  status: number | null
  message: string
  durationMs: number
}

function tokenEndpoint(tenant: string): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenant || 'common')}/oauth2/v2.0/token`
}

async function postForm(url: string, form: URLSearchParams): Promise<Record<string, unknown>> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form,
      signal: controller.signal,
    })
    const text = await response.text()
    let body: Record<string, unknown>
    try { body = JSON.parse(text) as Record<string, unknown> } catch { body = { raw: text } }
    if (!response.ok) {
      const error = String(body.error_description ?? body.error ?? `HTTP ${response.status}`)
      throw new Error(`${error} (HTTP ${response.status})`)
    }
    return body
  } finally {
    clearTimeout(timer)
  }
}

export async function exchangeRefreshToken(account: Account): Promise<TokenBundle> {
  if (!account.refreshToken) throw new Error('Refresh token is missing')
  const form = new URLSearchParams({
    client_id: account.clientId,
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
    scope: 'https://graph.microsoft.com/.default offline_access',
  })
  if (account.clientSecret) form.set('client_secret', account.clientSecret)
  const body = await postForm(tokenEndpoint(account.tenant ?? 'common'), form)
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
    expiresIn: Number(body.expires_in ?? 3600),
  }
}

export async function exchangePassword(account: Account): Promise<TokenBundle> {
  if (!account.username || !account.password) throw new Error('Username and password are missing')
  const form = new URLSearchParams({
    client_id: account.clientId,
    grant_type: 'password',
    username: account.username,
    password: account.password,
    scope: 'https://graph.microsoft.com/.default offline_access',
  })
  if (account.clientSecret) form.set('client_secret', account.clientSecret)
  const body = await postForm(tokenEndpoint(account.tenant ?? 'organizations'), form)
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
    expiresIn: Number(body.expires_in ?? 3600),
  }
}

export async function exchangeClientCredentials(account: Account): Promise<TokenBundle> {
  if (!account.clientSecret) throw new Error('Client secret is missing')
  const body = await postForm(tokenEndpoint(account.tenant ?? 'common'), new URLSearchParams({
    client_id: account.clientId,
    client_secret: account.clientSecret,
    grant_type: 'client_credentials',
    scope: 'https://graph.microsoft.com/.default',
  }))
  return { accessToken: String(body.access_token), expiresIn: Number(body.expires_in ?? 3600) }
}

export async function exchangeAuthorizationCode(input: {
  code: string
  tenant: string
  clientId: string
  clientSecret: string
  redirectUri: string
}): Promise<TokenBundle> {
  const body = await postForm(tokenEndpoint(input.tenant), new URLSearchParams({
    client_id: input.clientId,
    client_secret: input.clientSecret,
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
  }))
  return {
    accessToken: String(body.access_token),
    refreshToken: body.refresh_token ? String(body.refresh_token) : undefined,
    expiresIn: Number(body.expires_in ?? 3600),
  }
}

function parseBody(text: string): string {
  if (!text) return 'empty response'
  try {
    const body = JSON.parse(text) as { error?: { code?: string; message?: string }; message?: string }
    return body.error?.code && body.error.message
      ? `${body.error.code}: ${body.error.message}`
      : String(body.message ?? text).slice(0, 500)
  } catch {
    return text.slice(0, 500)
  }
}

function retryDelayMs(response: Response | null, attempt: number): number {
  const retryAfter = response?.headers.get('retry-after')
  const seconds = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 120_000)
  return Math.min(1000 * 2 ** attempt, 30_000)
}

export async function callGraph(accessToken: string, endpoint: ActivityEndpoint, allowWrite: boolean, operateUserName?: string, randomizeContent = true): Promise<GraphResult> {
  const url = expandPath(endpoint, operateUserName, randomizeContent)
  const content = endpoint.write && allowWrite
    ? randomizeContent
      ? `RenewX development validation ${new Date().toISOString()}\n${randomUUID()}`
      : 'RenewX development validation'
    : undefined
  const started = Date.now()
  let response: Response | null = null
  let lastMessage = 'request failed'
  for (let attempt = 0; attempt <= config.maxRetries; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), config.requestTimeoutMs)
    try {
      const headers: Record<string, string> = {
        authorization: `Bearer ${accessToken}`,
        accept: 'application/json',
      }
      if (content !== undefined) headers['content-type'] = endpoint.contentType ?? 'text/plain'
      response = await fetch(url, {
        method: endpoint.method,
        headers,
        body: content,
        signal: controller.signal,
      })
      const text = await response.text()
      lastMessage = response.ok ? `HTTP ${response.status}` : parseBody(text)
      if (response.status === 429 || response.status >= 500) {
        if (attempt < config.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)))
          continue
        }
      }
      return { ok: response.ok, status: response.status, message: lastMessage, durationMs: Date.now() - started }
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error)
      if (attempt < config.maxRetries) {
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)))
        continue
      }
    } finally {
      clearTimeout(timer)
    }
  }
  return { ok: false, status: response?.status ?? null, message: lastMessage, durationMs: Date.now() - started }
}
