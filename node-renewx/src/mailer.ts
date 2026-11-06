import nodemailer from 'nodemailer'
import { config } from './config.js'
import type { Account, RunSummary } from './db.js'

export async function sendBackoffNotification(account: Account, run: RunSummary, reason: string, backoffMs: number): Promise<void> {
  const recipient = config.smtpTo || account.username
  if (!config.smtpHost || !config.smtpFrom || !recipient) return
  const transporter = nodemailer.createTransport({
    host: config.smtpHost,
    port: config.smtpPort,
    secure: config.smtpSecure,
    auth: config.smtpUser ? { user: config.smtpUser, pass: config.smtpPassword } : undefined,
  })
  await transporter.sendMail({
    from: config.smtpFrom,
    to: recipient,
    subject: `RenewX temporary backoff: ${account.name}`,
    text: [
      `Account: ${account.name}`,
      `Run: ${run.id}`,
      `Status: ${run.status}`,
      `Requests: ${run.requestCount}`,
      `Success: ${run.successCount}`,
      `Fail: ${run.failCount}`,
      `Reason: ${reason}`,
      `Next retry after: ${new Date(Date.now() + backoffMs).toISOString()}`,
      '',
      'No access token, client secret, refresh token, or password is included in this notification.',
    ].join('\n'),
  })
}
