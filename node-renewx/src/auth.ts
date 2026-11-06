import { randomBytes } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'
import { parse, serialize } from 'cookie'
import { config } from './config.js'
import { Store } from './db.js'

const COOKIE_NAME = 'renewx_session'
const SESSION_TTL_MS = 24 * 60 * 60 * 1000

export function setSession(res: Response, token: string): void {
  res.setHeader('Set-Cookie', serialize(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  }))
}

export function clearSession(res: Response): void {
  res.setHeader('Set-Cookie', serialize(COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    path: '/',
    maxAge: 0,
  }))
}

export function sessionToken(req: Request): string | null {
  const cookies = parse(req.headers.cookie ?? '')
  return cookies[COOKIE_NAME] ?? null
}

export function requireAuth(store: Store) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const token = sessionToken(req)
    if (!token || !store.isSessionValid(token)) {
      res.status(401).json({ error: 'authentication_required' })
      return
    }
    next()
  }
}

export async function login(store: Store, password: string): Promise<string> {
  if (password !== config.adminPassword) throw new Error('Invalid password')
  const token = randomBytes(32).toString('base64url')
  store.createSession(token, Date.now() + SESSION_TTL_MS)
  return token
}
