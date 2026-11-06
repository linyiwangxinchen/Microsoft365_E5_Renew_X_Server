import { createDecipheriv } from 'node:crypto'

/**
 * The desktop Renew Plus build stores Config.cfg as a base64 encoded AES-256-ECB
 * payload.  This is the application's compatibility key, not an installation
 * secret.  It is kept here only so an administrator can import their own file
 * through the authenticated web console; imported account values are never
 * returned to the browser.
 */
const legacyConfigKey = [';:0_aRMshKc}UvT8gt.f.1Q5S?{C', '\\g.Q'].join('')

export interface LegacyAccount {
  uuid: string
  userName: string
  clientId: string
  secret: string
  isLogin: boolean
}

export interface LegacySchedulerOptions {
  presetConfigMode: number
  apiLibrary: string[]
  apiSelectRandom: boolean
  apiSequenceRandom: boolean
  apiContentRandom: boolean
  periodStartTime: number
  periodEndTime: number
  workStartTime: number
  workEndTime: number
  workDays: number[]
  smartPause: boolean
  autoRun: boolean
}

export interface ParsedLegacyConfig {
  format: 'plaintext-json' | 'renew-plus-aes-ecb'
  accounts: LegacyAccount[]
  rejectedAccounts: number
  options: LegacySchedulerOptions
}

type JsonObject = Record<string, unknown>

function objectValue(value: unknown): JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : {}
}

function stringValue(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (['true', '1', 'yes', 'on'].includes(normalized)) return true
    if (['false', '0', 'no', 'off'].includes(normalized)) return false
  }
  return fallback
}

function integerValue(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

function parseJson(text: string): JsonObject | null {
  try {
    const parsed: unknown = JSON.parse(text.replace(/^\uFEFF/, ''))
    const object = objectValue(parsed)
    return Object.keys(object).length > 0 ? object : null
  } catch {
    return null
  }
}

function decryptRenewPlusConfig(encoded: string): string {
  let encrypted: Buffer
  try {
    // Convert.FromBase64String, used by the desktop app, ignores whitespace.
    encrypted = Buffer.from(encoded.replace(/\s+/g, ''), 'base64')
  } catch {
    throw new Error('invalid legacy configuration encoding')
  }
  if (encrypted.length === 0 || encrypted.length % 16 !== 0) {
    throw new Error('invalid legacy configuration encoding')
  }
  try {
    const decipher = createDecipheriv('aes-256-ecb', Buffer.from(legacyConfigKey, 'utf8'), null)
    decipher.setAutoPadding(true)
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('unable to decrypt legacy configuration')
  }
}

const dayNames: Record<string, number> = {
  '一': 1, '周一': 1, '星期一': 1, monday: 1,
  '二': 2, '周二': 2, '星期二': 2, tuesday: 2,
  '三': 3, '周三': 3, '星期三': 3, wednesday: 3,
  '四': 4, '周四': 4, '星期四': 4, thursday: 4,
  '五': 5, '周五': 5, '星期五': 5, friday: 5,
  '六': 6, '周六': 6, '星期六': 6, saturday: 6,
  '日': 0, '天': 0, '周日': 0, '星期日': 0, sunday: 0,
}

function parseWorkDays(value: unknown): number[] {
  const raw = Array.isArray(value)
    ? value.map((item) => String(item))
    : stringValue(value).split(';').map((item) => item.trim()).filter(Boolean)
  const days = new Set<number>()
  for (const item of raw) {
    const normalized = item.toLowerCase()
    if (Object.prototype.hasOwnProperty.call(dayNames, normalized)) {
      days.add(dayNames[normalized])
      continue
    }
    const numeric = Number.parseInt(item, 10)
    if (Number.isInteger(numeric) && numeric >= 0 && numeric <= 6) days.add(numeric)
  }
  return days.size > 0 ? [...days].sort((a, b) => a - b) : [0, 1, 2, 3, 4, 5, 6]
}

function parseOptions(root: JsonObject): LegacySchedulerOptions {
  const custom = objectValue(root.CustomOption)
  let periodStartTime = clamp(integerValue(custom.PeriodStartTime, 500), 500, 86_400)
  let periodEndTime = clamp(integerValue(custom.PeriodEndTime, 1_000), 500, 86_400)
  if (periodStartTime > periodEndTime) [periodStartTime, periodEndTime] = [periodEndTime, periodStartTime]

  let workStartTime = clamp(integerValue(custom.WorkStartTime, 0), 0, 24)
  let workEndTime = clamp(integerValue(custom.WorkEndTime, 24), 0, 24)
  // Renew Plus normalizes equal/zero work windows to the full day.
  if (workEndTime === 0 || workStartTime >= workEndTime) {
    workStartTime = 0
    workEndTime = 24
  }

  const apiLibrary = stringValue(custom.APILibrary)
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 500)
  return {
    presetConfigMode: clamp(integerValue(root.PresetConfigMode, 0), 0, 2),
    apiLibrary,
    apiSelectRandom: booleanValue(custom.APISelectRandom, true),
    apiSequenceRandom: booleanValue(custom.APISequenceRandom, true),
    apiContentRandom: booleanValue(custom.APIContentRandom, true),
    periodStartTime,
    periodEndTime,
    workStartTime,
    workEndTime,
    workDays: parseWorkDays(custom.WorkDay),
    smartPause: booleanValue(custom.SmartPause, true),
    autoRun: booleanValue(root.AutoRun, false),
  }
}

function parseAccounts(root: JsonObject): { accounts: LegacyAccount[]; rejectedAccounts: number } {
  const rawAccounts = Array.isArray(root.Account) ? root.Account : []
  const accounts: LegacyAccount[] = []
  let rejectedAccounts = 0
  for (const raw of rawAccounts) {
    const account = objectValue(raw)
    const userName = stringValue(account.UserName)
    const clientId = stringValue(account.ClientID)
    // Both the desktop validator and the web API require a GUID application id.
    const validClientId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientId)
    const secret = stringValue(account.PwdOrSecret ?? account.PwdOrSecert)
    if (!userName || !validClientId || !secret) {
      rejectedAccounts += 1
      continue
    }
    accounts.push({
      uuid: stringValue(account.UUID),
      userName,
      clientId,
      secret,
      isLogin: booleanValue(account.IsLogin, true),
    })
  }
  return { accounts, rejectedAccounts }
}

export function parseLegacyConfig(input: string): ParsedLegacyConfig {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error('legacy configuration is empty')
  }
  const source = input.trim()
  const plain = parseJson(source)
  if (plain) {
    const parsed = parseAccounts(plain)
    return { format: 'plaintext-json', ...parsed, options: parseOptions(plain) }
  }
  const decrypted = decryptRenewPlusConfig(source)
  const root = parseJson(decrypted)
  if (!root) throw new Error('legacy configuration JSON is invalid')
  const parsed = parseAccounts(root)
  return { format: 'renew-plus-aes-ecb', ...parsed, options: parseOptions(root) }
}

export function optionsSummary(options: LegacySchedulerOptions): Record<string, unknown> {
  return {
    presetConfigMode: options.presetConfigMode,
    apiCount: options.apiLibrary.length,
    apiSelectRandom: options.apiSelectRandom,
    apiSequenceRandom: options.apiSequenceRandom,
    apiContentRandom: options.apiContentRandom,
    periodStartTime: options.periodStartTime,
    periodEndTime: options.periodEndTime,
    workStartTime: options.workStartTime,
    workEndTime: options.workEndTime,
    workDayCount: options.workDays.length,
    smartPause: options.smartPause,
    autoRun: options.autoRun,
  }
}

export function nextLegacySchedule(now = new Date(), options: LegacySchedulerOptions): number {
  const minSeconds = Math.max(500, options.periodStartTime)
  const maxSeconds = Math.max(minSeconds, options.periodEndTime)
  const delaySeconds = minSeconds + Math.floor(Math.random() * (maxSeconds - minSeconds + 1))
  let candidate = new Date(now.getTime() + delaySeconds * 1000)
  const allowedDays = new Set(options.workDays)
  const windowLengthSeconds = Math.max(1, (options.workEndTime - options.workStartTime) * 3600)
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const day = candidate.getDay()
    const seconds = candidate.getHours() * 3600 + candidate.getMinutes() * 60 + candidate.getSeconds()
    const start = options.workStartTime * 3600
    const end = options.workEndTime * 3600
    if (allowedDays.has(day) && seconds >= start && seconds < end) return candidate.getTime()
    if (allowedDays.has(day) && seconds < start) {
      const jitter = Math.floor(Math.random() * Math.min(500, windowLengthSeconds))
      candidate.setHours(options.workStartTime, 0, jitter, 0)
      return candidate.getTime()
    }
    candidate.setDate(candidate.getDate() + 1)
    candidate.setHours(options.workStartTime, 0, Math.floor(Math.random() * Math.min(500, windowLengthSeconds)), 0)
    if (allowedDays.has(candidate.getDay())) return candidate.getTime()
  }
  return now.getTime() + delaySeconds * 1000
}

export function legacyEndpointMatches(endpoint: { id: string; name: string; path: string }, requested: string): boolean {
  const normalize = (value: string): string => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
  const target = normalize(requested)
  if (!target) return false
  const legacyNames: Record<string, string[]> = {
    'users.list': ['用户.用户.列出用户'],
    'insights.shared': ['用户.见解.共享的列表', '人员和工作场所智能.见解.共享的列表'],
    'insights.trending': ['用户.见解.列出趋势', '人员和工作场所智能.见解.列出趋势'],
    'insights.used': ['用户.见解.使用的列表', '人员和工作场所智能.见解.使用的列表'],
    'direct-reports.list': ['用户.组织层次架构.列出直接下属'],
    'regional-settings.get': ['用户.预览版的首选(和区域).获取'],
    'settings.get': ['用户.用户设置.获取设置'],
    'groups.list': ['组.组.列出组'],
    'member-of.list': ['组.组.列出隶属于'],
    'calendars.list': ['日历.日历.列出日历'],
    'calendar-events.list': ['日历.日历.列出事件'],
    'calendar-groups.list': ['日历.日历组.列出日历组'],
    'presence.get': ['云通信.状态(预览版).获取状态'],
    'booking-businesses.list': ['客户预订(预览版).预订业务.列出'],
    'booking-currencies.list': ['客户预订(预览版).预订货币.列表'],
    'drives.list': ['文件.驱动器.列出可用的驱动器'],
    'drive-children.list': ['文件.驱动器.列出子项'],
    'drive-recent.list': ['文件.驱动器.最近使用的文件'],
    'drive-shared.list': ['文件.驱动器.共享文件'],
    'drive-following.list': ['文件.驱动器.列出关注的项'],
    'drive-upload.test': ['文件.驱动器项目.上载'],
    'messages.list': ['邮件.邮件.列出邮件'],
    'mail-folders.list': ['邮件.邮件文件夹.列出邮件文件夹'],
    'message-rules.list': ['邮件.规则.列出规则'],
    'mail-categories.list': ['邮件.类别.列出类别'],
    'onenote-notebooks.list': ['注释.笔记本.列出笔记本'],
    'onenote-sections.list': ['注释.部分.列出分区'],
    'onenote-section-groups.list': ['注释.分区组.列出分区组'],
    'onenote-pages.list': ['注释.页面.列出页面'],
    'people.list': ['人员和工作场所智能.人员.列出人员'],
    'people-trending.list': ['人员和工作场所智能.见解.列出趋势'],
    'people-used.list': ['人员和工作场所智能.见解.使用的列表'],
    'people-shared.list': ['人员和工作场所智能.见解.共享的列表'],
    'contacts.list': ['个人联系人.联系人.列出联系人'],
    'contact-folders.list': ['个人联系人.联系人文件夹.列出联系人文件夹'],
    'contact-categories.list': ['个人联系人.类别.列出类别'],
    'followed-sites.list': ['网站和列表.网站.关注网站列表'],
    'planner.list': ['任务和计划.计划.列出用户的计划'],
    'planner-favorites.list': ['任务和计划.计划.列出用户收藏的计划'],
    'planner-recent.list': ['任务和计划.计划.列出用户最近使用的计划'],
    'planner-tasks.list': ['任务和计划.任务.列出用户的任务'],
    'joined-teams.list': ['团队合作.团队.列出你的团队'],
    'todo-lists.list': ['预览版上(办事).任务列表.列出任务列表'],
  }
  const candidates = [endpoint.id, endpoint.name, endpoint.path, endpoint.path.split('/').filter(Boolean).pop() ?? '']
    .concat(legacyNames[endpoint.id] ?? [])
    .map(normalize)
    .filter(Boolean)
  return candidates.some((candidate) => candidate === target || candidate.includes(target) || target.includes(candidate))
}
