/**
 * dsh-github-profile — 宿主半边：抓 GitHub 档案数据并开一个同源路由。
 *
 *   GET /gh-profile/data?login=<可选>  →  { ok, profile, repos, calendar, fetchedAt, partial, stale }
 *   GET /gh-profile/activity          →  { ok, calendar }（DSH 本地工作热力图）
 *   GET /gh-profile/usage?days=N      →  { ok, balance, totalCost, totals, series, keys }（DeepSeek 平台用量）
 *
 * 稳定性设计（v0.1.2，针对「读取不稳定」）：
 *   - profile / repos / calendar 三块各自独立缓存、独立失败，一块挂不拖垮整页。
 *   - 失败不丢旧数据：24 小时内的上次结果作为 stale 兜底，并在返回值里标出来。
 *   - 贡献日历多源降级：GraphQL（有 token）/ jogruber 第三方 API（不碰 github.com 主站）
 *     / github.com 贡献页 HTML（最后兜底）。本机 github.com 直连时常 TCP 超时，
 *     原来只用 HTML 抓取，所以热力图时有时无。
 *   - token 过期（401/403）时自动去掉 token 重试一次，不整页失败。
 *   - 每个请求 8 秒超时 + 网络类错误重试一次。
 */
import { readFile } from 'node:fs/promises'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import { homedir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const inject = ['webServer']

const UA = 'dsh-github-profile/0.1.4'
const TTL_MS = 10 * 60 * 1000
const STALE_MS = 24 * 60 * 60 * 1000
const DEFAULT_TOKEN_FILE = join(homedir(), '.dsh', 'gh-token.txt')

/* DeepSeek 平台用量（数据来自 platform.deepseek.com 网页登录态接口） */
const PLATFORM = 'https://platform.deepseek.com'
const USAGE_TOKEN_FILE = join(homedir(), '.dsh', 'deepseek-platform-token.txt')
const USAGE_LOCAL_TOKEN_FILE = join(dirname(fileURLToPath(import.meta.url)), 'platform-token.txt')
const USAGE_TTL_MS = 3 * 60 * 1000
let usageCache = { at: 0, days: 0, data: null }

// 每个 login 一段缓存：字段分开存，互不牵连
const store = new Map()

function slotOf(login) {
  let s = store.get(login)
  if (!s) {
    s = {
      profile: null, profileAt: 0,
      repos: null, reposAt: 0,
      calendar: null, calendarAt: 0, calendarSource: null,
    }
    store.set(login, s)
  }
  return s
}

async function readToken(file) {
  try {
    const t = (await readFile(file, 'utf8')).trim()
    return t || null
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------- HTTP */

function headers(token, accept = 'application/json') {
  const h = { 'User-Agent': UA, Accept: accept }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

class HttpError extends Error {
  constructor(url, status, body) {
    super(`${url} → HTTP ${status}`)
    this.name = 'HttpError'
    this.status = status
    this.body = body
  }
}

async function request(url, { token, accept, timeout = 8000, method = 'GET', body } = {}) {
  const h = headers(token, accept)
  if (body) h['content-type'] = 'application/json'
  const r = await fetch(url, { method, headers: h, body, signal: AbortSignal.timeout(timeout) })
  const text = await r.text()
  if (!r.ok) throw new HttpError(url, r.status, text.slice(0, 200))
  return text
}

async function requestJson(url, opts) {
  return JSON.parse(await request(url, opts))
}

const isAuthError = (e) => e instanceof HttpError && (e.status === 401 || e.status === 403)

async function withRetry(fn, retries = 1) {
  let last
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      // 4xx 是确定性的，重试没意义；网络抖动（超时 / ECONNRESET）才重试
      if (e instanceof HttpError && e.status < 500) break
      if (i < retries) await new Promise((r) => setTimeout(r, 300))
    }
  }
  throw last
}

/** GitHub 开放 API：token 失效时自动匿名重试，别让一个过期 token 把整页读挂 */
async function githubJson(url, token) {
  try {
    return await withRetry(() => requestJson(url, { token }))
  } catch (e) {
    if (token && isAuthError(e)) return await withRetry(() => requestJson(url, { token: null }))
    throw e
  }
}

/* ---------------------------------------------------------------- 贡献日历 */

const LEVELS = {
  NONE: 0,
  FIRST_QUARTILE: 1,
  SECOND_QUARTILE: 2,
  THIRD_QUARTILE: 3,
  FOURTH_QUARTILE: 4,
}

function dayKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 53 周窗口：从 364 天前所在周的周日到今天 */
function calendarDates() {
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - 364)
  start.setDate(start.getDate() - start.getDay())
  const dates = []
  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) dates.push(dayKey(cur))
  return dates
}

/**
 * 把「日期 → 级别/次数」拼成统一结构。
 * 三种数据源都走这里，热力图列位与月份标签不会因为数据源不同而错位。
 */
function assemble(dates, byDate, total, source) {
  const days = dates.map((date) => {
    const hit = byDate.get(date)
    const raw = hit == null ? 0 : typeof hit === 'number' ? hit : Number(hit.level) || 0
    const level = raw > 4 ? 4 : raw < 0 ? 0 : raw
    const count = hit && typeof hit === 'object' && hit.count != null ? hit.count : null
    return { date, level, count }
  })
  const weeks = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
  // 连续天数：今天还没贡献就从昨天算起（与 GitHub 口径一致）
  let streak = 0
  let i = days.length - 1
  if (i >= 0 && days[i].level === 0) i--
  for (; i >= 0; i--) {
    if (days[i].level > 0) streak++
    else break
  }
  return { total: total == null ? null : total, weeks, streak, days: days.length, source }
}

const GRAPHQL_QUERY = `query($login: String!) {
  user(login: $login) {
    contributionsCollection {
      contributionCalendar {
        totalContributions
        weeks { contributionDays { date contributionCount contributionLevel } }
      }
    }
  }
}`

/** 源 A：api.github.com GraphQL（需要 token；最稳，且带每日精确次数） */
async function graphqlCalendar(login, token) {
  const res = await withRetry(() => requestJson('https://api.github.com/graphql', {
    token,
    method: 'POST',
    body: JSON.stringify({ query: GRAPHQL_QUERY, variables: { login } }),
  }))
  const cal = res && res.data && res.data.user && res.data.user.contributionsCollection
    && res.data.user.contributionsCollection.contributionCalendar
  if (!cal || !Array.isArray(cal.weeks)) throw new Error('graphql: 没有贡献日历')
  const byDate = new Map()
  for (const week of cal.weeks) {
    for (const d of week.contributionDays || []) {
      byDate.set(d.date, { level: LEVELS[d.contributionLevel] ?? 0, count: d.contributionCount ?? 0 })
    }
  }
  return assemble(calendarDates(), byDate, cal.totalContributions, 'graphql')
}

/** 源 B：github-contributions-api.jogruber.de（免 key，不依赖 github.com 主站） */
async function jogruberCalendar(login) {
  const res = await withRetry(() => requestJson(
    `https://github-contributions-api.jogruber.de/v4/${encodeURIComponent(login)}?y=last`,
  ))
  const list = res && res.contributions
  if (!Array.isArray(list) || list.length === 0) throw new Error('jogruber: 没有贡献日历')
  const byDate = new Map()
  for (const d of list) {
    if (!d || !d.date) continue
    byDate.set(d.date, { level: Number(d.level) || 0, count: d.count ?? null })
  }
  const total = typeof res.total === 'number' ? res.total : res.total && res.total.lastYear
  return assemble(calendarDates(), byDate, total, 'jogruber')
}

/** 源 C：github.com 贡献页 HTML（兜底；主站直连时常 TCP 超时） */
async function htmlCalendar(login, token) {
  const html = await withRetry(() => request(
    `https://github.com/users/${encodeURIComponent(login)}/contributions`,
    { token, accept: 'text/html' },
  ))
  const byDate = new Map()
  for (const chunk of html.split('<td')) {
    const d = /data-date="(\d{4}-\d{2}-\d{2})"/.exec(chunk)
    const l = /data-level="(\d)"/.exec(chunk)
    if (d && l) byDate.set(d[1], { level: Number(l[1]), count: null })
  }
  if (byDate.size === 0) throw new Error('github.com: 贡献页里没有日历格子')
  const totalMatch = /([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/i.exec(html)
  return assemble(calendarDates(), byDate, totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null, 'html')
}

/**
 * 贡献日历降级链：
 *   有 token → GraphQL 与 jogruber 竞速（谁先成功用谁）；
 *   无 token → jogruber 优先；
 *   两者都挂才走 github.com HTML（唯一会碰主站的路径）。
 */
async function fetchCalendar(login, token) {
  const racers = []
  if (token) racers.push(() => graphqlCalendar(login, token))
  racers.push(() => jogruberCalendar(login))
  try {
    return await Promise.any(racers.map((fn) => fn()))
  } catch { /* 全挂，走 HTML 兜底 */ }
  return await htmlCalendar(login, token)
}

/* ---------------------------------------------------------------- 组装 */

const userUrl = (login) => `https://api.github.com/users/${encodeURIComponent(login)}`
const reposUrl = (login) => `https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed`

function pickProfile(u) {
  return {
    login: u.login,
    name: u.name || u.login,
    bio: u.bio || '',
    avatar: u.avatar_url,
    htmlUrl: u.html_url,
    followers: u.followers ?? 0,
    following: u.following ?? 0,
    publicRepos: u.public_repos ?? 0,
    createdAt: u.created_at || null,
  }
}

function pickRepo(r) {
  return {
    name: r.name,
    description: r.description || '',
    url: r.html_url,
    stars: r.stargazers_count ?? 0,
    forks: r.forks_count ?? 0,
    language: r.language || null,
    updatedAt: r.pushed_at || r.updated_at || null,
    fork: Boolean(r.fork),
    archived: Boolean(r.archived),
  }
}

function errText(e) {
  return String((e && e.message) || e)
}

function payloadOf(s, { stale = [], errors = {}, cached = false } = {}) {
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    cached,
    profile: pickProfile(s.profile),
    repos: (s.repos || []).map(pickRepo),
    calendar: s.calendar,
    calendarSource: s.calendarSource,
    partial: stale.length > 0 || Object.keys(errors).length > 0,
    stale,
    errors,
  }
}

export async function buildPayload(login, token) {
  const s = slotOf(login)
  const now = Date.now()

  // 三块都在 TTL 内：直接回缓存，连请求都不发
  if (s.profile && s.repos && s.calendar
    && now - s.profileAt < TTL_MS && now - s.reposAt < TTL_MS && now - s.calendarAt < TTL_MS) {
    return payloadOf(s, { cached: true })
  }

  const [userR, reposR, calR] = await Promise.allSettled([
    githubJson(userUrl(login), token),
    githubJson(reposUrl(login), token),
    fetchCalendar(login, token),
  ])

  const stale = []
  const errors = {}

  // 资料卡是必需项；失败时用 24 小时内的缓存兜底
  if (userR.status === 'fulfilled') {
    s.profile = userR.value
    s.profileAt = now
  } else if (s.profile && now - s.profileAt < STALE_MS) {
    stale.push('profile')
    errors.profile = errText(userR.reason)
  } else {
    throw userR.reason
  }

  if (reposR.status === 'fulfilled') {
    s.repos = Array.isArray(reposR.value) ? reposR.value : []
    s.reposAt = now
  } else {
    errors.repos = errText(reposR.reason)
    if (s.repos && now - s.reposAt < STALE_MS) stale.push('repos')
  }

  if (calR.status === 'fulfilled' && calR.value) {
    s.calendar = calR.value
    s.calendarAt = now
    s.calendarSource = calR.value.source || null
  } else {
    errors.calendar = errText(calR.reason)
    if (s.calendar && now - s.calendarAt < STALE_MS) stale.push('calendar')
  }

  return payloadOf(s, { stale, errors })
}

/* ---------------------------------------------------- DeepSeek 平台用量 */

async function readUsageToken() {
  for (const file of [USAGE_TOKEN_FILE, USAGE_LOCAL_TOKEN_FILE]) {
    try {
      const t = (await readFile(file, 'utf8')).trim()
      if (t) return t
    } catch { /* 试下一个 */ }
  }
  return null
}

class PlatformError extends Error {
  constructor(code, msg) {
    super(msg || `平台接口错误 ${code}`)
    this.name = 'PlatformError'
    this.code = code
  }
}

/** 平台接口统一外层：{ code, msg, data: { biz_code, biz_data } } */
async function platformGet(path, token, timeout = 12000) {
  const r = await fetch(PLATFORM + path, {
    headers: { 'User-Agent': UA, Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(timeout),
  })
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`)
  const j = await r.json()
  if (j.code !== 0) throw new PlatformError(j.code, j.msg)
  const inner = j.data || {}
  if (inner.biz_code !== 0) throw new PlatformError(inner.biz_code, inner.biz_msg)
  return inner.biz_data
}

function usageDayKey(ts) {
  const d = new Date((ts + 8 * 3600) * 1000) // 平台固定 GMT+8
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function summarizeUsage(amount, cost) {
  const byDay = new Map()
  const byKey = new Map()
  const models = new Set()

  const day = (ts) => {
    const k = usageDayKey(ts)
    let row = byDay.get(k)
    if (!row) { row = { date: k, cost: 0, requests: 0, tokens: 0 }; byDay.set(k, row) }
    return row
  }
  const keyRow = (apiKey) => {
    const id = (apiKey && (apiKey.tracking_id || apiKey.name)) || 'unknown'
    let row = byKey.get(id)
    if (!row) {
      row = { id, name: (apiKey && apiKey.name) || id, cost: 0, requests: 0, tokens: 0 }
      byKey.set(id, row)
    }
    return row
  }

  for (const series of (amount.series || [])) {
    for (const bucket of series.buckets || []) {
      const u = bucket.usage || {}
      const tokens = (u.RESPONSE_TOKEN || 0) + (u.PROMPT_CACHE_HIT_TOKEN || 0) + (u.PROMPT_CACHE_MISS_TOKEN || 0)
      const requests = u.REQUEST || 0
      const row = day(bucket.time)
      row.requests += requests
      row.tokens += tokens
      const k = keyRow(series.api_key)
      k.requests += requests
      k.tokens += tokens
      if (series.model) models.add(series.model)
    }
  }
  for (const group of (cost.data || [])) {
    for (const series of (group.series || [])) {
      for (const bucket of series.buckets || []) {
        const c = Number(bucket.cost) || 0
        day(bucket.time).cost += c
        keyRow(series.api_key).cost += c
        if (series.model) models.add(series.model)
      }
    }
  }

  const series = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
  return {
    series,
    totals: {
      cost: series.reduce((a, d) => a + d.cost, 0),
      requests: series.reduce((a, d) => a + d.requests, 0),
      tokens: series.reduce((a, d) => a + d.tokens, 0),
    },
    keys: [...byKey.values()].sort((a, b) => b.cost - a.cost),
    models: [...models],
  }
}

export async function buildUsage(days, token) {
  const end = Math.floor(new Date(new Date().setHours(0, 0, 0, 0)).getTime() / 1000)
  const start = end - Math.max(1, Math.min(365, days)) * 86400
  const [summary, amount, cost] = await Promise.all([
    platformGet('/api/v0/users/get_user_summary', token),
    platformGet(`/api/v0/usage/by_api_key/amount?start=${start}&end=${end}&tz=28800`, token),
    platformGet(`/api/v0/usage/by_api_key/cost?start=${start}&end=${end}&tz=28800`, token),
  ])
  const agg = summarizeUsage(amount, cost)
  const wallet = (summary.normal_wallets || []).find((w) => w.currency === 'CNY') || (summary.normal_wallets || [])[0] || {}
  const total = (summary.total_costs || []).find((c) => c.currency === 'CNY') || (summary.total_costs || [])[0] || {}
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    days: Number(days),
    balance: Number(wallet.balance) || 0,
    totalCost: Number(total.amount) || 0,
    currency: wallet.currency || 'CNY',
    ...agg,
  }
}

/* ---------------------------------------------------- 本地活动（DSH 上干活） */

/**
 * 口径：以会话文件为颗粒。每个会话有「创建时间」（日志首帧里的 createdAt）
 * 和「最后活动时间」（文件 mtime），二者之间的每一天都记一次活跃。
 * 不解析压缩帧内容（会话日志是 7 千多段 zstd 拼接，逐帧解不划算）。
 */
export async function buildActivity() {
  const root = join(homedir(), '.dsh', 'sessions')
  const files = []
  const walk = (dir, depth) => {
    if (depth > 4) return
    let entries = []
    try { entries = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p, depth + 1)
      else if (e.name.endsWith('.jsonl.zstd')) files.push(p)
    }
  }
  walk(root, 0)

  const counts = new Map()

  for (const file of files) {
    let start = null
    let end = null
    try {
      const st = statSync(file)
      end = new Date(st.mtime)
      const head = zstdDecompressSync(readFileSync(file)).toString('utf8').split('\n')[0]
      const obj = JSON.parse(head)
      const ms = Number(obj.createdAt)
      start = Number.isFinite(ms) ? new Date(ms) : new Date(end)
    } catch {
      try { start = new Date(statSync(file).mtime) } catch { continue }
    }
    if (!start || !end) continue
    if (start > end) { const t = start; start = end; end = t }
    // 上限 60 天，避免异常时间戳把区间拉爆
    const guard = new Date(start)
    for (let i = 0; i < 61; i++) {
      const d = new Date(guard)
      d.setDate(d.getDate() + i)
      if (d > end) break
      const k = dayKey(d)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
  }

  // 组装 53 周 × 7 天
  const end = new Date(); end.setHours(0, 0, 0, 0)
  const startD = new Date(end)
  startD.setDate(startD.getDate() - 364)
  startD.setDate(startD.getDate() - startD.getDay())
  const days = []
  for (const cur = new Date(startD); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const k = dayKey(cur)
    days.push({ date: k, n: counts.get(k) ?? 0 })
  }
  const max = Math.max(1, ...days.map((d) => d.n))
  // 分四档（按活跃会话数）
  const level = (n) => (n === 0 ? 0 : n <= max * 0.25 ? 1 : n <= max * 0.5 ? 2 : n <= max * 0.75 ? 3 : 4)
  const weeks = []
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7).map((d) => ({ date: d.date, level: level(d.n), count: d.n })))
  }
  const total = days.reduce((a, d) => a + d.n, 0)
  // 连续天数：今天还没活动就从昨天算起（与 GitHub 口径一致）
  let streak = 0
  let i = days.length - 1
  if (i >= 0 && days[i].n === 0) i--
  for (; i >= 0; i--) {
    if (days[i].n > 0) streak++
    else break
  }
  return { total, streak, weeks, days: days.length, sessions: files.length }
}

function sendJson(res, code, body) {
  const buf = Buffer.from(JSON.stringify(body), 'utf8')
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
  })
  res.end(buf)
}

export function apply(ctx, config) {
  const configuredLogin = (config && config.login) || ''
  const tokenFile = (config && config.tokenFile) || DEFAULT_TOKEN_FILE
  const webServer = ctx.webServer
  if (!webServer) return

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/gh-profile/data',
    handler: async (req, res) => {
      let login = configuredLogin
      try {
        const u = new URL(req.url, 'http://127.0.0.1')
        login = (u.searchParams.get('login') || configuredLogin || '').trim()
      } catch { /* 用配置值 */ }

      if (!login) {
        return sendJson(res, 400, {
          ok: false,
          error: 'No GitHub username yet',
          errorZh: '还没有填写 GitHub 用户名',
          hint: '在页面顶部填写你的 GitHub 用户名（只读公开信息，不需要登录）。',
        })
      }
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) {
        return sendJson(res, 400, { ok: false, error: `Invalid username: ${login}`, errorZh: `用户名格式不对：${login}` })
      }

      try {
        const token = await readToken(tokenFile)
        const payload = await buildPayload(login, token)
        sendJson(res, 200, payload)
      } catch (err) {
        sendJson(res, 502, {
          ok: false,
          login,
          error: errText(err),
          errorZh: `读 GitHub 数据失败：${errText(err)}`,
        })
      }
    },
  }), 'dsh-github-profile: /gh-profile/data')

  // 本地活动热力图：口径是「会话存活区间」，见 buildActivity 注释
  let actCache = { at: 0, data: null }
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/gh-profile/activity',
    handler: async (req, res) => {
      const now = Date.now()
      if (actCache.data && now - actCache.at < TTL_MS) {
        return sendJson(res, 200, { ...actCache.data, cached: true })
      }
      try {
        const calendar = await buildActivity()
        const payload = { ok: true, fetchedAt: new Date().toISOString(), calendar }
        actCache = { at: now, data: payload }
        sendJson(res, 200, payload)
      } catch (err) {
        sendJson(res, 500, { ok: false, error: errText(err) })
      }
    },
  }), 'dsh-github-profile: /gh-profile/activity')

  // DeepSeek 平台用量：余额 + 近 N 天消费/请求/tokens（网页登录态接口）
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/gh-profile/usage',
    handler: async (req, res) => {
      let days = 30
      try {
        const u = new URL(req.url, 'http://127.0.0.1')
        days = Number(u.searchParams.get('days')) || 30
      } catch { /* 默认 30 天 */ }

      const now = Date.now()
      if (usageCache.data && usageCache.days === days && now - usageCache.at < USAGE_TTL_MS) {
        return sendJson(res, 200, { ...usageCache.data, cached: true })
      }

      const token = await readUsageToken()
      if (!token) {
        return sendJson(res, 400, {
          ok: false,
          error: 'No platform token',
          errorZh: '还没有平台登录凭证',
          hint: '打开 platform.deepseek.com 登录后，把请求头里的 Authorization token 存到 ~/.dsh/deepseek-platform-token.txt（一行）。',
        })
      }

      try {
        const data = await buildUsage(days, token)
        usageCache = { at: now, days, data }
        sendJson(res, 200, data)
      } catch (err) {
        if (err && (err.code === 40003 || /invalid token/i.test(String(err.message || '')))) {
          return sendJson(res, 502, {
            ok: false,
            error: 'Platform token expired or invalid',
            errorZh: '平台登录凭证已失效，请重新获取 token 后更新 ~/.dsh/deepseek-platform-token.txt',
          })
        }
        sendJson(res, 502, { ok: false, error: errText(err) })
      }
    },
  }), 'dsh-github-profile: /gh-profile/usage')
}
