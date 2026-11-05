/**
 * dsh-github-profile — 宿主半边：抓 GitHub 档案数据并开一个同源路由。
 *
 *   GET /gh-profile/data?login=<可选>  →  { ok, profile, repos, calendar, fetchedAt }
 *
 * 数据源（都不需要 token，公开信息即可）：
 *   - api.github.com/users/<login>                 用户资料
 *   - api.github.com/users/<login>/repos           仓库列表（按最近推送排序）
 *   - github.com/users/<login>/contributions       贡献日历（HTML，解析 data-date/data-level）
 * 若 ~/.dsh/gh-token.txt 存在则带上 Authorization，纯为抬高速率上限。
 */
import { readFile } from 'node:fs/promises'

export const inject = ['webServer']

const UA = 'dsh-github-profile/0.1.0'
const TTL_MS = 10 * 60 * 1000
const DEFAULT_TOKEN_FILE = 'C:/Users/37/.dsh/gh-token.txt'

let cache = { at: 0, login: '', data: null }

async function readToken(file) {
  try {
    const t = (await readFile(file, 'utf8')).trim()
    return t || null
  } catch {
    return null
  }
}

function headers(token, accept = 'application/json') {
  const h = { 'User-Agent': UA, Accept: accept }
  if (token) h.Authorization = `Bearer ${token}`
  return h
}

async function getJson(url, token) {
  const r = await fetch(url, { headers: headers(token) })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return r.json()
}

async function getText(url, token) {
  const r = await fetch(url, { headers: headers(token, 'text/html') })
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`)
  return r.text()
}

/** 从贡献日历 HTML 里解析出 date → level(0..4)，以及总数/连续天数 */
function parseCalendar(html) {
  const byDate = new Map()
  for (const chunk of html.split('<td')) {
    const d = /data-date="(\d{4}-\d{2}-\d{2})"/.exec(chunk)
    const l = /data-level="(\d)"/.exec(chunk)
    if (d && l) byDate.set(d[1], Number(l[1]))
  }
  const totalMatch = /([\d,]+)\s+contributions?\s+in\s+the\s+last\s+year/i.exec(html)

  // 以今天为终点，往前排 53 周 × 7 天（周日起），缺失日按 0
  const days = []
  const end = new Date()
  end.setHours(0, 0, 0, 0)
  const start = new Date(end)
  start.setDate(start.getDate() - 364)
  start.setDate(start.getDate() - start.getDay()) // 回到那周的周日
  for (const cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const key = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`
    days.push({ date: key, level: byDate.get(key) ?? 0 })
  }

  const weeks = []
  for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))

  // 连续天数：从今天往回数 level > 0
  let streak = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].level > 0) streak++
    else break
  }

  return {
    total: totalMatch ? Number(totalMatch[1].replace(/,/g, '')) : null,
    weeks,
    streak,
    days: days.length,
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

async function buildPayload(login, token) {
  const [user, repos, html] = await Promise.all([
    getJson(`https://api.github.com/users/${encodeURIComponent(login)}`, token),
    getJson(`https://api.github.com/users/${encodeURIComponent(login)}/repos?per_page=100&sort=pushed`, token),
    getText(`https://github.com/users/${encodeURIComponent(login)}/contributions`, token),
  ])
  return {
    ok: true,
    fetchedAt: new Date().toISOString(),
    profile: {
      login: user.login,
      name: user.name || user.login,
      bio: user.bio || '',
      avatar: user.avatar_url,
      htmlUrl: user.html_url,
      followers: user.followers ?? 0,
      following: user.following ?? 0,
      publicRepos: user.public_repos ?? 0,
      createdAt: user.created_at || null,
    },
    repos: (Array.isArray(repos) ? repos : []).map(pickRepo),
    calendar: parseCalendar(html),
  }
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
          error: '还没有填写 GitHub 用户名',
          hint: '在页面顶部填写你的 GitHub 用户名（只读公开信息，不需要登录）。',
        })
      }
      if (!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(login)) {
        return sendJson(res, 400, { ok: false, error: `用户名格式不对：${login}` })
      }

      const now = Date.now()
      if (cache.data && cache.login === login && now - cache.at < TTL_MS) {
        return sendJson(res, 200, { ...cache.data, cached: true })
      }

      try {
        const token = await readToken(tokenFile)
        const payload = await buildPayload(login, token)
        cache = { at: Date.now(), login, data: payload }
        sendJson(res, 200, payload)
      } catch (err) {
        sendJson(res, 502, { ok: false, login, error: String(err && err.message ? err.message : err) })
      }
    },
  }), 'dsh-github-profile: /gh-profile/data')
}
