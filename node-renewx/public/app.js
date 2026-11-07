const $ = (id) => document.getElementById(id)
const state = { accounts: [], settings: null, selectedAccount: null, subscriptionRefreshStarted: false }

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

function formatSubscription(subscription) {
  if (!subscription?.checkedAt) return { text: '订阅状态：未读取', expired: false, error: false }
  if (subscription.error) return { text: `订阅读取失败：${subscription.error}`, expired: false, error: true }
  if (!subscription.expiresAt) return { text: '订阅状态：未找到 E5 生命周期记录', expired: false, error: true }
  const remaining = subscription.expiresAt - Date.now()
  if (remaining <= 0) return { text: `订阅剩余：已到期 · ${new Date(subscription.expiresAt).toLocaleString()}`, expired: true, error: true }
  const days = Math.floor(remaining / 86400000)
  const hours = Math.floor((remaining % 86400000) / 3600000)
  const minutes = Math.floor((remaining % 3600000) / 60000)
  const sku = subscription.sku ? ` · ${subscription.sku}` : ''
  const status = subscription.status ? ` · 状态 ${subscription.status}` : ''
  return { text: `E5 订阅剩余：${days}天 ${hours}小时 ${minutes}分钟 · ${new Date(subscription.expiresAt).toLocaleString()}${sku}${status}`, expired: false, error: false }
}

function formatRate(value) {
  return `${Number(value || 0).toFixed(1)}%`
}

function accountCard(account) {
  const card = document.createElement('article')
  card.className = 'account-card'
  const mode = account.mode === 'delegated' ? 'Delegated' : (account.mode === 'password' ? 'ROPC' : 'Client credentials')
  const stats = account.stats || {}
  const subscription = formatSubscription(account.subscription)
  card.innerHTML = `<div class="row"><strong>${escapeHtml(account.name)}</strong><span class="badge ${account.paused ? 'warn' : 'ok'}">${account.paused ? 'paused' : (account.enabled ? 'enabled' : 'disabled')}</span></div>
    <div class="meta">${mode} · ${escapeHtml(account.clientId)} · next ${new Date(account.nextRunAt).toLocaleString()}</div>
    <div class="subscription-expiry ${subscription.expired || subscription.error ? 'expired' : ''}" data-subscription-label="${account.id}">${escapeHtml(subscription.text)}</div>
    <div class="account-stats"><span>运行 <b>${stats.runCount || 0}</b></span><span>运行中 <b>${stats.runningCount || 0}</b></span><span>成功 <b>${stats.succeededCount || 0}</b></span><span>失败 <b>${stats.failedCount || 0}</b></span><span>请求 <b>${stats.requestCount || 0}</b></span><span>失败率 <b>${formatRate(stats.failureRate)}</b></span></div>
    <div class="actions"><button data-run="${account.id}">立即运行</button><button class="secondary" data-subscription="${account.id}">刷新订阅</button><button class="secondary" data-pause="${account.id}">${account.paused ? '恢复' : '暂停'}</button><button class="danger" data-delete="${account.id}">删除</button></div>`
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
  void refreshStaleSubscriptions()
}

function renderAccountSummary() {
  const totalRuns = state.accounts.reduce((sum, account) => sum + Number(account.stats?.runCount || 0), 0)
  const totalFailures = state.accounts.reduce((sum, account) => sum + Number(account.stats?.failCount || 0), 0)
  const totalRequests = state.accounts.reduce((sum, account) => sum + Number(account.stats?.requestCount || 0), 0)
  const running = state.accounts.reduce((sum, account) => sum + Number(account.stats?.runningCount || 0), 0)
  $('stat-running').textContent = String(running)
  $('stat-status').textContent = totalRequests > 0 ? `${totalRuns} 次运行 · 失败率 ${formatRate(totalFailures / totalRequests * 100)}` : '—'
}

async function refreshStaleSubscriptions() {
  if (state.subscriptionRefreshStarted) return
  state.subscriptionRefreshStarted = true
  const stale = state.accounts.filter((account) => !account.subscription?.checkedAt || Date.now() - account.subscription.checkedAt > 6 * 60 * 60 * 1000)
  if (!stale.length) return
  await Promise.allSettled(stale.map((account) => api(`/accounts/${account.id}/subscription-status`, { method: 'POST', body: '{}' })))
  await load()
}

function refreshSubscriptionLabels() {
  state.accounts.forEach((account) => {
    const label = document.querySelector(`[data-subscription-label="${account.id}"]`)
    if (!label) return
    const subscription = formatSubscription(account.subscription)
    label.textContent = subscription.text
    label.classList.toggle('expired', subscription.expired || subscription.error)
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
  document.querySelectorAll('[data-subscription]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation()
    button.disabled = true
    try { await api(`/accounts/${button.dataset.subscription}/subscription-status`, { method: 'POST', body: '{}' }); await load() } catch (error) { alert(error.message) } finally { button.disabled = false }
  }))
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  $('login-error').textContent = ''
  try { await api('/auth/login', { method: 'POST', body: JSON.stringify({ password: $('login-password').value }) }); showApp(true); await load() } catch { $('login-error').textContent = '密码错误或服务不可用' }
})

$('logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); state.subscriptionRefreshStarted = false; showApp(false) })
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
    allowWriteActivity: $('account-write').checked,
  }
  try { await api('/accounts', { method: 'POST', body: JSON.stringify(body) }); event.target.reset(); $('account-tenant').value = 'common'; state.subscriptionRefreshStarted = false; await load() } catch (error) { $('account-error').textContent = error.message }
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
    state.subscriptionRefreshStarted = false
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

$('refresh-subscriptions').addEventListener('click', async () => {
  const button = $('refresh-subscriptions')
  button.disabled = true
  try {
    const results = await Promise.allSettled(state.accounts.map((account) => api(`/accounts/${account.id}/subscription-status`, { method: 'POST', body: '{}' })))
    const failures = results.filter((result) => result.status === 'rejected').length
    await load()
    if (failures > 0) alert(`${failures} 个账号读取失败，请检查 Graph 权限和账号授权状态。`)
  } finally {
    button.disabled = false
  }
})

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])) }

api('/auth/me').then(async () => { showApp(true); await load() }).catch(() => showApp(false))
setInterval(refreshSubscriptionLabels, 60 * 1000)
