const $ = (id) => document.getElementById(id)
const state = { accounts: [], runs: [], settings: null, selectedAccount: null }

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

function accountCard(account) {
  const card = document.createElement('article')
  card.className = 'account-card'
  const mode = account.mode === 'delegated' ? 'Delegated' : (account.mode === 'password' ? 'ROPC' : 'Client credentials')
  card.innerHTML = `<div class="row"><strong>${escapeHtml(account.name)}</strong><span class="badge ${account.paused ? 'warn' : 'ok'}">${account.paused ? 'paused' : (account.enabled ? 'enabled' : 'disabled')}</span></div>
    <div class="meta">${mode} · ${escapeHtml(account.clientId)} · next ${new Date(account.nextRunAt).toLocaleString()}</div>
    <div class="actions"><button data-run="${account.id}">立即运行</button><button class="secondary" data-pause="${account.id}">${account.paused ? '恢复' : '暂停'}</button><button class="danger" data-delete="${account.id}">删除</button></div>`
  return card
}

function runCard(run) {
  const card = document.createElement('article')
  card.className = 'run-card'
  card.innerHTML = `<div class="row"><strong>${new Date(run.startedAt).toLocaleString()}</strong><span class="badge ${run.status === 'succeeded' ? 'ok' : (run.status === 'running' ? 'info' : 'warn')}" >${escapeHtml(run.status)}</span></div>
    <div class="meta">${run.requestCount} requests · ${run.successCount} success · ${run.failCount} fail · ${escapeHtml(run.error || '')}</div>`
  card.onclick = async () => {
    const detail = await api(`/runs/${run.id}`)
    const lines = (detail.logs || []).map((log) => `${log.ok ? '✓' : '✗'} ${log.apiName} ${log.status ?? '-'} ${log.durationMs}ms — ${log.message}`)
    alert(lines.join('\n') || '没有请求日志')
  }
  return card
}

async function load() {
  state.accounts = await api('/accounts')
  state.runs = await api('/runs')
  state.settings = await api('/settings/renew-plus')
  renderSettings()
  const accounts = $('accounts')
  accounts.innerHTML = ''
  accounts.classList.toggle('empty', state.accounts.length === 0)
  if (!state.accounts.length) accounts.textContent = '还没有账号'
  state.accounts.forEach((account) => accounts.appendChild(accountCard(account)))
  const runs = $('runs')
  runs.innerHTML = ''
  runs.classList.toggle('empty', state.runs.length === 0)
  if (!state.runs.length) runs.textContent = '还没有运行记录'
  state.runs.forEach((run) => runs.appendChild(runCard(run)))
  $('stat-accounts').textContent = String(state.accounts.length)
  $('stat-running').textContent = String(state.runs.filter((run) => run.status === 'running').length)
  $('stat-status').textContent = state.runs[0]?.status || '—'
  bindAccountActions()
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
