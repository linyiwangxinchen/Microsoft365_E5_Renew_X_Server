const $ = (id) => document.getElementById(id)
const state = { accounts: [], settings: null, selectedAccount: null }

async function api(path, options = {}) {
  const response = await fetch(`/api${path}`, { credentials: 'same-origin', headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options })
  if (response.status === 204) return null
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`)
  return body
}

function showApp(authenticated) {
  $('login-panel').classList.toggle('hidden', authenticated)
  $('app-panel').classList.toggle('hidden', !authenticated)
  $('logout').classList.toggle('hidden', !authenticated)
}

function formatRemaining(expiresAt) {
  if (!expiresAt) return '到期时间：未设置'
  const remaining = expiresAt - Date.now()
  if (remaining <= 0) return '剩余时间：已到期'
  const days = Math.floor(remaining / 86400000)
  const hours = Math.floor((remaining % 86400000) / 3600000)
  const minutes = Math.floor((remaining % 3600000) / 60000)
  return `剩余时间：${days}天 ${hours}小时 ${minutes}分钟 · ${new Date(expiresAt).toLocaleString()}`
}

function formatRate(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function accountCard(account) {
  const card = document.createElement('article')
  card.className = 'account-card'
  const mode = account.mode === 'delegated' ? 'Delegated' : (account.mode === 'password' ? 'ROPC' : 'Client credentials')
  const stats = account.stats || {}
  card.innerHTML = `<div class="row"><strong>${escapeHtml(account.name)}</strong><span class="badge ${account.paused ? 'warn' : 'ok'}">${account.paused ? 'paused' : (account.enabled ? 'enabled' : 'disabled')}</span></div>
    <div class="meta">${mode} · ${escapeHtml(account.clientId)} · next ${new Date(account.nextRunAt).toLocaleString()}</div>
    <div class="account-expiry ${account.expiresAt && account.expiresAt < Date.now() ? 'expired' : ''}" data-expiry-label="${account.id}">${formatRemaining(account.expiresAt)}</div>
    <div class="expiry-editor"><input data-expiry-input="${account.id}" type="datetime-local" value="${toLocalInputValue(account.expiresAt)}"><button class="secondary" data-expire="${account.id}">保存到期时间</button></div>
    <div class="account-stats"><span>运行 <b>${stats.runCount || 0}</b></span><span>运行中 <b>${stats.runningCount || 0}</b></span><span>成功 <b>${stats.succeededCount || 0}</b></span><span>失败 <b>${stats.failedCount || 0}</b></span><span>请求 <b>${stats.requestCount || 0}</b></span><span>失败率 <b>${formatRate(stats.failureRate)}</b></span></div>
    <div class="actions"><button data-run="${account.id}">立即运行</button><button class="secondary" data-pause="${account.id}">${account.paused ? '恢复' : '暂停'}</button><button class="danger" data-delete="${account.id}">删除</button></div>`
  return card
}

async function load() {
  state.accounts = await api('/accounts')
  state.settings = await api('/settings/renew-plus')
  renderSettings()
  renderAccountSummary()
  const accounts = $('accounts')
  accounts.innerHTML = ''
  accounts.classList.toggle('empty', state.accounts.length === 0)
  if (!state.accounts.length) accounts.textContent = '还没有账号'
  state.accounts.forEach((account) => accounts.appendChild(accountCard(account)))
  $('stat-accounts').textContent = String(state.accounts.length)
  bindAccountActions()
  refreshExpiryLabels()
}

function renderAccountSummary() {
  const totalRuns = state.accounts.reduce((sum, account) => sum + Number(account.stats?.runCount || 0), 0)
  const totalFailures = state.accounts.reduce((sum, account) => sum + Number(account.stats?.failCount || 0), 0)
  const totalRequests = state.accounts.reduce((sum, account) => sum + Number(account.stats?.requestCount || 0), 0)
  const running = state.accounts.reduce((sum, account) => sum + Number(account.stats?.runningCount || 0), 0)
  $('stat-running').textContent = String(running)
  $('stat-status').textContent = totalRequests > 0 ? `${totalRuns} 次运行 · 失败率 ${formatRate(totalFailures / totalRequests * 100)}` : '—'
}

function toLocalInputValue(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const pad = (value) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function refreshExpiryLabels() {
  state.accounts.forEach((account) => {
    const label = document.querySelector(`[data-expiry-label="${account.id}"]`)
    if (!label) return
    label.textContent = formatRemaining(account.expiresAt)
    label.classList.toggle('expired', Boolean(account.expiresAt && account.expiresAt < Date.now()))
  })
}

function renderSettings() {
  if (!state.settings) return
  $('setting-auto-run').checked = Boolean(state.settings.autoRun)
  $('setting-api-select-random').checked = Boolean(state.settings.apiSelectRandom)
  $('setting-api-sequence-random').checked = Boolean(state.settings.apiSequenceRandom)
  $('setting-api-content-random').checked = Boolean(state.settings.apiContentRandom)
  $('setting-period-start').value = String(state.settings.periodStartTime)
  $('setting-period-end').value = String(state.settings.periodEndTime)
  $('setting-work-start').value = String(state.settings.workStartTime)
  $('setting-work-end').value = String(state.settings.workEndTime)
  const workDays = new Set((state.settings.workDays || []).map(Number))
  document.querySelectorAll('[data-day]').forEach((input) => { input.checked = workDays.has(Number(input.dataset.day)) })
}

function bindAccountActions() {
  document.querySelectorAll('[data-run]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation()
    try { await api(`/accounts/${button.dataset.run}/run`, { method: 'POST', body: '{}' }); await load() } catch (error) { alert(error.message) }
  }))
  document.querySelectorAll('[data-pause]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation()
    const account = state.accounts.find((item) => item.id === button.dataset.pause)
    try { await api(`/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify({ paused: !account.paused }) }); await load() } catch (error) { alert(error.message) }
  }))
  document.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation()
    if (!confirm('确定删除该账号及其运行记录吗？')) return
    try { await api(`/accounts/${button.dataset.delete}`, { method: 'DELETE' }); await load() } catch (error) { alert(error.message) }
  }))
  document.querySelectorAll('[data-expire]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation()
    const input = document.querySelector(`[data-expiry-input="${button.dataset.expire}"]`)
    const expiresAt = input?.value ? new Date(input.value).getTime() : null
    try {
      await api(`/accounts/${button.dataset.expire}`, { method: 'PATCH', body: JSON.stringify({ expiresAt }) })
      await load()
    } catch (error) { alert(error.message) }
  }))
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  $('login-error').textContent = ''
  try { await api('/auth/login', { method: 'POST', body: JSON.stringify({ password: $('login-password').value }) }); showApp(true); await load() } catch { $('login-error').textContent = '密码错误或服务不可用' }
})

$('logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); showApp(false) })
$('refresh').addEventListener('click', () => load().catch((error) => alert(error.message)))

$('account-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  $('account-error').textContent = ''
  const body = {
    name: $('account-name').value,
    mode: $('account-mode').value,
    username: $('account-username').value,
    tenant: $('account-tenant').value,
    clientId: $('account-client-id').value,
    clientSecret: $('account-client-secret').value,
    refreshToken: $('account-refresh-token').value,
    password: $('account-password').value,
    expiresAt: $('account-expires').value ? new Date($('account-expires').value).getTime() : null,
    allowWriteActivity: $('account-write').checked,
  }
  try { await api('/accounts', { method: 'POST', body: JSON.stringify(body) }); event.target.reset(); $('account-tenant').value = 'common'; await load() } catch (error) { $('account-error').textContent = error.message }
})

$('oauth-button').addEventListener('click', () => {
  const name = $('account-name').value
  const account = state.accounts.find((item) => item.name === name)
  if (!account) { alert('先保存一个账号，再点击 OAuth 授权') ; return }
  window.location.href = `/api/oauth/start?accountId=${encodeURIComponent(account.id)}`
})

$('legacy-import').addEventListener('click', async () => {
  const input = $('legacy-config-file')
  const file = input.files?.[0]
  $('import-result').textContent = ''
  if (!file) { $('import-result').textContent = '请选择 Config.cfg 文件'; return }
  if (file.size > 1024 * 1024) { $('import-result').textContent = '配置文件超过 1 MB'; return }
  try {
    const result = await api('/import/legacy-config', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: await file.text(),
    })
    const format = result.format === 'renew-plus-aes-ecb' ? '加密格式' : 'JSON 格式'
    $('import-result').className = 'success'
    $('import-result').textContent = `${format}：导入 ${result.imported} 个账号，跳过 ${result.skipped} 个；API ${result.options.apiCount} 个，间隔 ${result.options.periodStartTime}-${result.options.periodEndTime} 秒。`
    input.value = ''
    await load()
  } catch (error) {
    $('import-result').className = 'error'
    $('import-result').textContent = error.message
  }
})

$('renew-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  $('settings-result').textContent = ''
  const workDays = [...document.querySelectorAll('[data-day]:checked')].map((input) => Number(input.dataset.day))
  try {
    state.settings = await api('/settings/renew-plus', {
      method: 'PATCH',
      body: JSON.stringify({
        autoRun: $('setting-auto-run').checked,
        apiSelectRandom: $('setting-api-select-random').checked,
        apiSequenceRandom: $('setting-api-sequence-random').checked,
        apiContentRandom: $('setting-api-content-random').checked,
        periodStartTime: Number($('setting-period-start').value),
        periodEndTime: Number($('setting-period-end').value),
        workStartTime: Number($('setting-work-start').value),
        workEndTime: Number($('setting-work-end').value),
        workDays,
      }),
    })
    renderSettings()
    $('settings-result').className = 'success'
    $('settings-result').textContent = '调度选项已保存'
  } catch (error) {
    $('settings-result').className = 'error'
    $('settings-result').textContent = error.message
  }
})

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])) }

api('/auth/me').then(async () => { showApp(true); await load() }).catch(() => showApp(false))
setInterval(refreshExpiryLabels, 60 * 1000)
