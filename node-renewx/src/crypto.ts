import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { scrypt as scryptCallback } from 'node:crypto'

const scrypt = promisify(scryptCallback)

function keyBytes(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest()
}

export function encryptSecret(value: string | undefined, secret: string): string | null {
  if (!value) return null
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', keyBytes(secret), iv)
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [iv.toString('base64url'), tag.toString('base64url'), encrypted.toString('base64url')].join('.')
}

export function decryptSecret(value: string | null | undefined, secret: string): string | null {
  if (!value) return null
  const [ivText, tagText, dataText] = value.split('.')
  if (!ivText || !tagText || !dataText) throw new Error('Invalid encrypted secret')
  const decipher = createDecipheriv('aes-256-gcm', keyBytes(secret), Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(dataText, 'base64url')), decipher.final()]).toString('utf8')
}

export function hashOpaque(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

export async function hashPassword(value: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = (await scrypt(value, salt, 64)) as Buffer
  return `${salt.toString('base64url')}.${derived.toString('base64url')}`
}

export async function verifyPassword(value: string, encoded: string): Promise<boolean> {
  const [saltText, hashText] = encoded.split('.')
  if (!saltText || !hashText) return false
  const expected = Buffer.from(hashText, 'base64url')
  const actual = (await scrypt(value, Buffer.from(saltText, 'base64url'), expected.length)) as Buffer
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}
