const $ = (id) => document.getElementById(id)
const state = { accounts: [], settings: null, selectedAccount: null, subscriptionRefreshStarted: false, loading: false, oauthEnabled: false }

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

function showToast(message, tone = 'success') {
  const region = $('toast-region')
  if (!region) return
  const toast = document.createElement('div')
  toast.className = `toast toast-${tone}`
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${tone === 'success' ? '✓' : '!'}</span><span>${escapeHtml(message)}</span>`
  region.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('is-visible'))
  setTimeout(() => {
    toast.classList.remove('is-visible')
    setTimeout(() => toast.remove(), 220)
  }, 3600)
}

function setBusy(button, busy, label = '处理中…') {
  if (!button) return
  if (busy) {
    button.dataset.previousLabel = button.textContent
    button.textContent = label
    button.classList.add('is-busy')
    button.disabled = true
  } else {
    button.textContent = button.dataset.previousLabel || button.textContent
    button.classList.remove('is-busy')
    button.disabled = false
  }
}

function accountCard(account, index = 0, previousSubscriptionText = '') {
  const card = document.createElement('article')
  card.className = 'account-card reveal'
  card.style.setProperty('--reveal-delay', `${Math.min(index, 7) * 45}ms`)
  const mode = account.mode === 'delegated' ? 'Delegated' : (account.mode === 'password' ? 'ROPC' : 'Client credentials')
  const stats = account.stats || {}
  const subscription = formatSubscription(account.subscription)
  const subscriptionClass = previousSubscriptionText && previousSubscriptionText !== subscription.text ? ' subscription-update' : ''
  card.innerHTML = `<div class="card-header"><div><strong class="account-name">${escapeHtml(account.name)}</strong><span class="account-mode">${mode}</span></div><span class="badge ${account.paused ? 'warn' : 'ok'}"><span class="badge-dot"></span>${account.paused ? '已暂停' : (account.enabled ? '运行中' : '已停用')}</span></div>
    <div class="meta"><span class="meta-label">Client ID</span> ${escapeHtml(account.clientId)} <span class="meta-separator">·</span> 下次运行 ${new Date(account.nextRunAt).toLocaleString()}</div>
    <div class="subscription-expiry${subscription.expired || subscription.error ? ' expired' : ''}${subscriptionClass}" data-subscription-label="${account.id}">${escapeHtml(subscription.text)}</div>
    <div class="account-stats"><span>运行 <b>${stats.runCount || 0}</b></span><span>运行中 <b>${stats.runningCount || 0}</b></span><span>成功 <b>${stats.succeededCount || 0}</b></span><span>失败 <b>${stats.failedCount || 0}</b></span><span>请求 <b>${stats.requestCount || 0}</b></span><span>失败率 <b>${formatRate(stats.failureRate)}</b></span></div>
    <div class="actions"><button data-run="${account.id}">立即运行</button><button class="secondary" data-subscription="${account.id}">刷新订阅</button><button class="secondary" data-pause="${account.id}">${account.paused ? '恢复运行' : '暂停'}</button><button class="danger" data-delete="${account.id}">删除</button></div>`
  return card
}

async function load() {
  if (state.loading) return
  state.loading = true
  const accountsElement = $('accounts')
  accountsElement?.classList.add('is-loading')
  accountsElement?.setAttribute('aria-busy', 'true')
  try {
    const [accounts, settings, runtimeConfig] = await Promise.all([api('/accounts'), api('/settings/renew-plus'), api('/config')])
    const previousSubscriptionTexts = new Map(state.accounts.map((account) => [account.id, formatSubscription(account.subscription).text]))
    state.accounts = accounts
    state.settings = settings
    state.oauthEnabled = Boolean(runtimeConfig.oauthEnabled)
    renderSettings()
    renderAccountSummary()
    accountsElement.innerHTML = ''
    accountsElement.classList.toggle('empty', state.accounts.length === 0)
    if (!state.accounts.length) accountsElement.textContent = '还没有账号'
    state.accounts.forEach((account, index) => accountsElement.appendChild(accountCard(account, index, previousSubscriptionTexts.get(account.id) || '')))
    animateStat($('stat-accounts'), String(state.accounts.length))
    bindAccountActions()
    updateAccountModeFields()
  } finally {
    state.loading = false
    accountsElement?.classList.remove('is-loading')
    accountsElement?.setAttribute('aria-busy', 'false')
  }
  void refreshStaleSubscriptions()
}

function renderAccountSummary() {
  const totalRuns = state.accounts.reduce((sum, account) => sum + Number(account.stats?.runCount || 0), 0)
  const totalFailures = state.accounts.reduce((sum, account) => sum + Number(account.stats?.failCount || 0), 0)
  const totalRequests = state.accounts.reduce((sum, account) => sum + Number(account.stats?.requestCount || 0), 0)
  const running = state.accounts.reduce((sum, account) => sum + Number(account.stats?.runningCount || 0), 0)
  animateStat($('stat-running'), String(running))
  animateStat($('stat-status'), totalRequests > 0 ? `${totalRuns} 次运行 · 失败率 ${formatRate(totalFailures / totalRequests * 100)}` : '—')
}

function animateStat(element, value) {
  if (!element) return
  element.textContent = value
  element.classList.remove('value-pop')
  requestAnimationFrame(() => element.classList.add('value-pop'))
}

async function refreshStaleSubscriptions() {
  if (state.subscriptionRefreshStarted) return
  state.subscriptionRefreshStarted = true
  const stale = state.accounts.filter((account) => !account.subscription?.checkedAt || Date.now() - account.subscription.checkedAt > 6 * 60 * 60 * 1000)
  try {
    if (!stale.length) return
    await Promise.allSettled(stale.map((account) => api(`/accounts/${account.id}/subscription-status`, { method: 'POST', body: '{}' })))
    await load()
  } finally {
    state.subscriptionRefreshStarted = false
  }
}

function updateAccountModeFields() {
  const mode = $('account-mode').value
  const username = $('account-username')
  const tenant = $('account-tenant')
  const clientSecret = $('account-client-secret')
  const refreshToken = $('account-refresh-token')
  const password = $('account-password')
  const isPassword = mode === 'password'
  const isClientCredentials = mode === 'client_credentials'
  username.required = isPassword || isClientCredentials
  tenant.required = isClientCredentials
  clientSecret.required = isClientCredentials
  password.required = isPassword
  refreshToken.required = mode === 'delegated' && !state.oauthEnabled
  username.closest('label').classList.toggle('optional', !username.required)
  tenant.closest('label').classList.toggle('optional', !tenant.required)
  clientSecret.closest('label').classList.toggle('optional', !clientSecret.required)
  refreshToken.closest('label').classList.toggle('optional', !refreshToken.required)
  password.closest('label').classList.toggle('optional', !password.required)
}

function refreshSubscriptionLabels() {
  state.accounts.forEach((account) => {
    const label = document.querySelector(`[data-subscription-label="${account.id}"]`)
    if (!label) return
    const subscription = formatSubscription(account.subscription)
    const nextText = subscription.text
    if (label.textContent !== nextText) {
      label.textContent = nextText
      label.classList.remove('subscription-update')
      requestAnimationFrame(() => label.classList.add('subscription-update'))
    }
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
    setBusy(button, true, '启动中…')
    try { await api(`/accounts/${button.dataset.run}/run`, { method: 'POST', body: '{}' }); showToast('运行任务已加入队列'); await load() } catch (error) { showToast(error.message, 'error') } finally { setBusy(button, false) }
  }))
  document.querySelectorAll('[data-pause]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation()
    const account = state.accounts.find((item) => item.id === button.dataset.pause)
    setBusy(button, true, account.paused ? '恢复中…' : '暂停中…')
    try { await api(`/accounts/${account.id}`, { method: 'PATCH', body: JSON.stringify({ paused: !account.paused }) }); showToast(account.paused ? '账号已恢复运行' : '账号已暂停'); await load() } catch (error) { showToast(error.message, 'error') } finally { setBusy(button, false) }
  }))
  document.querySelectorAll('[data-delete]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation()
    if (!confirm('确定删除该账号及其运行记录吗？')) return
    setBusy(button, true, '删除中…')
    try { await api(`/accounts/${button.dataset.delete}`, { method: 'DELETE' }); showToast('账号已删除'); await load() } catch (error) { showToast(error.message, 'error') } finally { setBusy(button, false) }
  }))
  document.querySelectorAll('[data-subscription]').forEach((button) => button.addEventListener('click', async (event) => {
    event.stopPropagation()
    setBusy(button, true, '读取中…')
    try { await api(`/accounts/${button.dataset.subscription}/subscription-status`, { method: 'POST', body: '{}' }); showToast('订阅状态已更新'); await load() } catch (error) { showToast(error.message, 'error') } finally { setBusy(button, false) }
  }))
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  $('login-error').textContent = ''
  const loginButton = $('login-form button')
  setBusy(loginButton, true, '验证中…')
  try { await api('/auth/login', { method: 'POST', body: JSON.stringify({ password: $('login-password').value }) }); showApp(true); await load(); showToast('登录成功') } catch { $('login-error').textContent = '密码错误或服务不可用' } finally { setBusy(loginButton, false) }
})

$('logout').addEventListener('click', async () => { await api('/auth/logout', { method: 'POST' }); state.subscriptionRefreshStarted = false; showApp(false) })
$('refresh').addEventListener('click', async (event) => { const button = event.currentTarget; setBusy(button, true, '刷新中…'); try { await load(); showToast('页面数据已刷新') } catch (error) { showToast(`刷新失败：${error.message}`, 'error') } finally { setBusy(button, false) } })

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
  const submitButton = event.target.querySelector('button[type="submit"]') || event.target.querySelector('button:not([type="button"])')
  setBusy(submitButton, true, '保存中…')
  try { await api('/accounts', { method: 'POST', body: JSON.stringify(body) }); event.target.reset(); $('account-tenant').value = 'common'; state.subscriptionRefreshStarted = false; await load(); showToast('账号已添加') } catch (error) { $('account-error').textContent = error.message } finally { setBusy(submitButton, false) }
})

$('account-mode').addEventListener('change', updateAccountModeFields)

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
  const importButton = $('legacy-import')
  setBusy(importButton, true, '导入中…')
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
  } finally { setBusy(importButton, false) }
})

$('renew-settings-form').addEventListener('submit', async (event) => {
  event.preventDefault()
  $('settings-result').textContent = ''
  const workDays = [...document.querySelectorAll('[data-day]:checked')].map((input) => Number(input.dataset.day))
  const saveButton = $('renew-settings-form button[type="submit"]') || $('renew-settings-form button')
  setBusy(saveButton, true, '保存中…')
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
  } finally { setBusy(saveButton, false) }
})

$('refresh-subscriptions').addEventListener('click', async () => {
  const button = $('refresh-subscriptions')
  setBusy(button, true, '读取中…')
  try {
    const results = await Promise.allSettled(state.accounts.map((account) => api(`/accounts/${account.id}/subscription-status`, { method: 'POST', body: '{}' })))
    const failures = results.filter((result) => result.status === 'rejected').length
    await load()
    if (failures > 0) showToast(`${failures} 个账号读取失败，请检查 Graph 权限和账号授权状态。`, 'error')
    else showToast('所有订阅状态已更新')
  } finally {
    setBusy(button, false)
  }
})

function escapeHtml(value) { return String(value).replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char])) }

api('/auth/me').then(async () => { showApp(true); await load() }).catch((error) => {
  showApp(false)
  if (!['HTTP 401', 'authentication_required', 'invalid_credentials'].includes(error.message)) $('login-error').textContent = `服务加载失败：${error.message}`
})
updateAccountModeFields()
setInterval(refreshSubscriptionLabels, 60 * 1000)
