// dsh-github-profile — 页面半边：侧栏「GitHub」+ 档案页（资料卡 / 仓库卡 / 贡献热力图）
// 客户端插件必须是 factory-CJS：唯一合法出口是 window.__ModuleLoader__.load({ id, factory })
window.__ModuleLoader__.load({
  id: 'dsh-github-profile',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useCallback } = React

    const PANEL_ID = 'github-profile'
    const API = '/gh-profile/data'
    const ACT_API = '/gh-profile/activity'
    const LOGIN_KEY = 'ghp.login'

    /* ------------------------------------------------------------ 文案 */

    const LANG_KEY = 'ghp.lang'
    const THEME_KEY = 'ghp.theme'

    function detectLang() {
      try {
        const saved = localStorage.getItem(LANG_KEY)
        if (saved === 'zh' || saved === 'en') return saved
      } catch { /* 忽略 */ }
      return (typeof navigator !== 'undefined' && String(navigator.language || '').toLowerCase().startsWith('zh'))
        ? 'zh' : 'en'
    }

    // 可变：手动开关直接改它，组件重渲染时读到新值
    let LANG = detectLang()

    const STRINGS = {
      zh: {
        title: 'GitHub 档案',
        notSet: '还没设置用户',
        placeholder: '你的 GitHub 用户名',
        start: '开始',
        read: '读取',
        reading: '读取中…',
        reposPublic: '公开仓库',
        stars: '总星标',
        followers: '关注者',
        yearContribs: '一年贡献',
        streakDays: '连续天数',
        getStarted: '开始使用',
        getStartedBody: '在右上角填你的 GitHub 用户名，点「开始」。读的是公开信息，不需要登录，也不会上传任何东西。',
        getStartedToken: '想让私有仓库也显示（可选）：把带 repo 权限的 token 存到 ~/.dsh/gh-token.txt，插件会只读使用它。',
        loadFailed: '读不到数据：',
        heatmap: '贡献热力图',
        heatmapDsh: 'DSH 工作热力图',
        loading: '加载中…',
        loadFailedLocal: '读不到本地记录：',
        counting: '统计中…',
        retry: '重试',
        timeout: '超时（20 秒）',
        timeout30: '超时（30 秒）',
        dshNote: '口径：本地会话的存活区间（创建到最近活动），每天算一次活跃。',
        reposTitle: '仓库',
        noRepos: '没有公开仓库',
        noData: '没有贡献数据',
        less: '少',
        more: '多',
        totalYear: (n) => `一年共 ${n} 次`,
        streak: (n) => `连续 ${n} 天`,
        hasContribution: '有贡献',
        noContribution: '无贡献',
        updated: (d) => `更新 ${d}`,
        noDesc: '（无描述）',
        month: (m) => `${m}月`,
        light: '浅',
        dark: '深',
        partial: '部分数据这次没取到，显示的是上次缓存',
        calFailed: '贡献数据没取到：',
        reposFailed: '仓库列表没取到，显示的是上次缓存',
        contribCount: (n) => `${n} 次贡献`,
      },
      en: {
        title: 'GitHub profile',
        notSet: 'no user set yet',
        placeholder: 'your GitHub username',
        start: 'Start',
        read: 'Load',
        reading: 'Loading…',
        reposPublic: 'public repos',
        stars: 'stars',
        followers: 'followers',
        yearContribs: 'last year',
        streakDays: 'day streak',
        getStarted: 'Getting started',
        getStartedBody: 'Type your GitHub username in the field above and press Start. It reads public data only — no sign-in, nothing uploaded.',
        getStartedToken: 'Optional: to include private repos, put a token with repo scope at ~/.dsh/gh-token.txt; the plugin only reads it.',
        loadFailed: 'Could not load: ',
        heatmap: 'Contribution heatmap',
        heatmapDsh: 'DSH work heatmap',
        loading: 'Loading…',
        loadFailedLocal: 'Could not read local records: ',
        counting: 'Counting…',
        retry: 'Retry',
        timeout: 'timed out (20s)',
        timeout30: 'timed out (30s)',
        dshNote: 'Basis: span of each local session (created → last activity); one active mark per day.',
        reposTitle: 'Repositories',
        noRepos: 'No public repositories',
        noData: 'No contribution data',
        less: 'Less',
        more: 'More',
        totalYear: (n) => `${n} in the last year`,
        streak: (n) => `${n}-day streak`,
        hasContribution: 'contributions',
        noContribution: 'no contributions',
        updated: (d) => `updated ${d}`,
        noDesc: '(no description)',
        light: 'Light',
        dark: 'Dark',
        month: (m) => ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1],
        partial: 'Some data failed to load; showing last cached copy',
        calFailed: 'Contribution data failed: ',
        reposFailed: 'Repository list failed to load; showing last cached copy',
        contribCount: (n) => `${n} contributions`,
      },
    }

    let t = STRINGS[LANG]

    function setLang(next) {
      LANG = next === 'en' ? 'en' : 'zh'
      t = STRINGS[LANG]
      try { localStorage.setItem(LANG_KEY, LANG) } catch { /* 忽略 */ }
    }

    /* ------------------------------------------------------------ 配色（跟随宿主深浅色） */

    // GitHub 官方亮/暗两套绿；蓝色是本地活动用的同构色阶
    const PALETTES = {
      green: {
        light: ['#ebedf0', '#9be9a8', '#40c463', '#30a14e', '#216e39'],
        dark: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353'],
      },
      blue: {
        light: ['#e3edf7', '#a9cbe8', '#6ea8d8', '#3d7fbe', '#1b4f86'],
        dark: ['#12212e', '#12384f', '#1b5d82', '#2f8cc4', '#57b6ea'],
      },
    }

    function parseColor(value) {
      if (!value) return null
      const v = value.trim()
      let m = /^#([0-9a-f]{3})$/i.exec(v)
      if (m) return m[1].split('').map((c) => parseInt(c + c, 16))
      m = /^#([0-9a-f]{6})$/i.exec(v)
      if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16))
      m = /^rgba?\(([^)]+)\)$/i.exec(v)
      if (m) {
        const parts = m[1].split(',').map((s) => parseFloat(s))
        if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) return [parts[0], parts[1], parts[2]]
      }
      return null
    }

    // 看宿主主背景的亮度，而不是只看系统偏好：DSH 的主题是应用内设置
    function isDarkTheme() {
      try {
        const bg = getComputedStyle(document.documentElement).getPropertyValue('--dsw-alias-bg-base')
        const rgb = parseColor(bg)
        if (rgb) {
          const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255
          return lum < 0.5
        }
      } catch { /* 取不到就退回系统偏好 */ }
      try { return window.matchMedia('(prefers-color-scheme: dark)').matches } catch { return false }
    }

    function loadThemeOverride() {
      try {
        const saved = localStorage.getItem(THEME_KEY)
        if (saved === 'light' || saved === 'dark') return saved
      } catch { /* 忽略 */ }
      return null
    }

    function useDarkTheme(override) {
      const [auto, setAuto] = useState(isDarkTheme)
      useEffect(() => {
        let obs = null
        const sync = () => setAuto(isDarkTheme())
        try {
          obs = new MutationObserver(sync)
          obs.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme', 'style'] })
        } catch { /* 不支持就算了 */ }
        let mq = null
        try {
          mq = window.matchMedia('(prefers-color-scheme: dark)')
          mq.addEventListener('change', sync)
        } catch { /* 忽略 */ }
        return () => {
          if (obs) obs.disconnect()
          if (mq) { try { mq.removeEventListener('change', sync) } catch { /* 忽略 */ } }
        }
      }, [])
      if (override === "dark") return true
      if (override === "light") return false
      return auto
    }

    /* ------------------------------------------------------------ 样式 */

    const css = `
.ghp-root { height: 100%; overflow: auto; padding: 20px 24px 64px;
  background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); }
.ghp-wrap { max-width: 1040px; margin: 0 auto; display: flex; flex-direction: column; gap: 18px; }
.ghp-head { display: flex; gap: 18px; align-items: flex-start;
  background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px; padding: 18px 20px; }
.ghp-avatar { width: 86px; height: 86px; border-radius: 50%; object-fit: cover;
  border: 1px solid var(--dsw-alias-border-l1); flex: none; }
.ghp-id { min-width: 0; flex: 1; }
.ghp-name { font-size: 22px; font-weight: 650; line-height: 1.2; }
.ghp-login { font-size: 14px; color: var(--dsw-alias-label-secondary); margin-top: 2px; }
.ghp-bio { font-size: 14px; color: var(--dsw-alias-label-secondary); margin-top: 8px; }
.ghp-stats { display: flex; flex-wrap: wrap; gap: 18px; margin-top: 12px; }
.ghp-stat b { display: block; font-size: 17px; font-weight: 650; }
.ghp-stat span { font-size: 12px; color: var(--dsw-alias-label-secondary); }
.ghp-actions { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; justify-content: flex-end; }
.ghp-input { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; width: 190px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); outline: none; }
.ghp-input:focus { border-color: var(--dsw-alias-brand-primary); }
.ghp-btn { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); }
.ghp-btn:hover { border-color: var(--dsw-alias-border-l2); }
.ghp-btn:disabled { opacity: .6; cursor: default; }
.ghp-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px; padding: 16px 18px; }
.ghp-card h3 { margin: 0 0 12px; font-size: 13px; font-weight: 600; letter-spacing: .02em;
  color: var(--dsw-alias-label-secondary); text-transform: uppercase; }
.ghp-heat { overflow-x: auto; padding-bottom: 4px; }
.ghp-inner { display: inline-block; }
.ghp-months { display: grid; gap: 4px; font-size: 12px; margin-bottom: 4px;
  color: var(--dsw-alias-label-secondary); }
.ghp-month { white-space: nowrap; overflow: visible; }
.ghp-grid { display: grid; grid-auto-flow: column; gap: 3px; }
.ghp-col { display: grid; grid-template-rows: repeat(7, 13px); gap: 4px; }
.ghp-cell { width: 13px; height: 13px; border-radius: 3px; background: var(--ghp-l0, #ebedf0);
  outline: 1px solid transparent; }
.ghp-cell[data-l="1"] { background: var(--ghp-l1, #9be9a8); }
.ghp-cell[data-l="2"] { background: var(--ghp-l2, #40c463); }
.ghp-cell[data-l="3"] { background: var(--ghp-l3, #30a14e); }
.ghp-cell[data-l="4"] { background: var(--ghp-l4, #216e39); }
.ghp-cell:hover { outline-color: var(--dsw-alias-border-l2); }
.ghp-legend { display: flex; align-items: center; gap: 6px; font-size: 11px;
  color: var(--dsw-alias-label-secondary); margin-top: 10px; }
.ghp-legend-right { margin-left: auto; display: flex; gap: 12px; align-items: center; }
.ghp-cardhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
.ghp-cardhead h3 { margin: 0; }
.ghp-seg { display: flex; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; overflow: hidden; }
.ghp-seg button { font: inherit; font-size: 12px; padding: 4px 10px; border: 0; cursor: pointer;
  background: transparent; color: var(--dsw-alias-label-secondary); }
.ghp-seg button[data-on="1"] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.ghp-repos { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
.ghp-repo { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 8px; }
.ghp-repo a { font-size: 15px; font-weight: 600; color: var(--dsw-alias-brand-primary);
  text-decoration: none; word-break: break-all; }
.ghp-repo a:hover { text-decoration: underline; }
.ghp-repo p { margin: 0; font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 39px; }
.ghp-meta { display: flex; gap: 14px; align-items: center; font-size: 12px;
  color: var(--dsw-alias-label-secondary); }
.ghp-dot { width: 9px; height: 9px; border-radius: 50%; display: inline-block; }
.ghp-empty, .ghp-err { font-size: 14px; color: var(--dsw-alias-label-secondary); padding: 24px 0; text-align: center; }
.ghp-err { color: var(--dsw-alias-state-error-primary); }
.ghp-note { font-size: 11px; color: var(--dsw-alias-label-secondary); margin-top: 6px; }
.ghp-partial { font-size: 12px; padding: 8px 12px; border-radius: 8px; margin-top: 0;
  background: var(--dsw-alias-bg-layer-2); border: 1px solid var(--dsw-alias-border-l1); }
`

    function Styles() {
      return h('style', { 'data-ghp': true }, css)
    }

    function Stat({ value, label }) {
      return h('div', { className: 'ghp-stat' },
        h('b', null, value),
        h('span', null, label))
    }

    /* ------------------------------------------------------------ 热力图 */

    function Heatmap({ calendar }) {
      const scroller = React.useRef(null)
      useEffect(() => {
        // 默认停在最近的那几周：内容变宽后滚到最右
        const el = scroller.current
        if (el) el.scrollLeft = el.scrollWidth
      }, [calendar])

      if (!calendar || !calendar.weeks || calendar.weeks.length === 0) {
        return h('div', { className: 'ghp-empty' }, t.noData)
      }
      const weeks = calendar.weeks
      const COLS = weeks.length
      const colW = 13
      const gap = 4
      const innerW = COLS * colW + (COLS - 1) * gap

      // 每个「换月」的那一周单独标一次，按列号定位：月份与格子共用同一套列宽，不会错位
      const monthMarks = []
      let lastMonth = -1
      weeks.forEach((week, i) => {
        const first = week[0]
        if (!first) return
        const m = Number(first.date.slice(5, 7))
        if (m !== lastMonth) { lastMonth = m; monthMarks.push({ col: i + 1, label: t.month(m) }) }
      })

      return h('div', null,
        h('div', { className: 'ghp-heat', ref: scroller },
          h('div', { className: 'ghp-inner', style: { width: innerW } },
            h('div', {
              className: 'ghp-months',
              style: { gridTemplateColumns: `repeat(${COLS}, ${colW}px)`, columnGap: gap },
            },
              monthMarks.map((mk) => h('div', {
                key: mk.col, className: 'ghp-month',
                style: { gridColumnStart: mk.col },
              }, mk.label))),
            h('div', {
              className: 'ghp-grid',
              style: { gridTemplateColumns: `repeat(${COLS}, ${colW}px)`, columnGap: gap },
            },
              weeks.map((week, wi) => h('div', { className: 'ghp-col', key: wi },
                week.map((day) => h('div', {
                  key: day.date,
                  className: 'ghp-cell',
                  'data-l': String(day.level),
                  title: day.count != null
                    ? `${day.date} · ${t.contribCount(day.count)}`
                    : `${day.date} · ${day.level > 0 ? t.hasContribution : t.noContribution}`,
                }))))),
          ),
        ),
        h('div', { className: 'ghp-legend' },
          h('span', null, t.less),
          [0, 1, 2, 3, 4].map((l) => h('span', { key: l, className: 'ghp-cell', 'data-l': String(l) })),
          h('span', null, t.more),
          h('div', { className: 'ghp-legend-right' },
            calendar.total != null ? h('span', null, t.totalYear(calendar.total)) : null,
            calendar.streak ? h('span', null, t.streak(calendar.streak)) : null,
          ),
        ),
      )
    }

    function RepoCard({ repo }) {
      return h('div', { className: 'ghp-repo' },
        h('a', { href: repo.url, target: '_blank', rel: 'noreferrer' }, repo.name),
        h('p', null, repo.description || t.noDesc),
        h('div', { className: 'ghp-meta' },
          repo.language
            ? h('span', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
                h('i', { className: 'ghp-dot', style: { background: 'var(--dsw-alias-brand-primary)' } }),
                repo.language)
            : null,
          h('span', null, `★ ${repo.stars}`),
          repo.fork ? h('span', null, 'fork') : null,
          repo.updatedAt ? h('span', null, t.updated(repo.updatedAt.slice(0, 10))) : null,
        ),
      )
    }

    /* ------------------------------------------------------------ 页面 */

    function GithubPanel() {
      const [lang, setLangState] = useState(LANG)
      const [themeOverride, setThemeOverride] = useState(loadThemeOverride)
      const dark = useDarkTheme(themeOverride)
      const pickLang = (next) => { setLang(next); setLangState(next) }
      const pickTheme = (next) => {
        const value = themeOverride === next ? null : next
        setThemeOverride(value)
        try {
          if (value) localStorage.setItem(THEME_KEY, value)
          else localStorage.removeItem(THEME_KEY)
        } catch { /* 忽略 */ }
      }
      const [login, setLogin] = useState(() => {
        try { return localStorage.getItem(LOGIN_KEY) || '' } catch { return '' }
      })
      const [draft, setDraft] = useState(login)
      const [state, setState] = useState({ loading: false, error: null, data: null })

      const load = useCallback((who) => {
        const user = (who || '').trim()
        if (!user) {
          setState({ loading: false, error: null, data: null })
          return
        }
        setState((s) => ({ ...s, loading: true, error: null }))
        const ctl = new AbortController()
        const timer = setTimeout(() => ctl.abort(), 30000)
        fetch(`${API}?login=${encodeURIComponent(user)}`, { credentials: 'same-origin', signal: ctl.signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
          .then((data) => {
            if (!data || data.ok === false) throw new Error((data && (LANG === 'zh' ? data.errorZh : data.error)) || (data && data.error) || 'request failed')
            setState({ loading: false, error: null, data })
          })
          .catch((err) => {
            const msg = err && err.name === 'AbortError' ? t.timeout30 : String((err && err.message) || err)
            // 保留上一次拿到的数据：网络抖一下不该把画面清空
            setState((s) => ({ ...s, loading: false, error: msg }))
          })
          .then(() => clearTimeout(timer))
      }, [])

      useEffect(() => { if (login) load(login) }, [login, load])

      // 模式：github = 远程贡献；dsh = 本地干活（蓝色）。切过去才拉本地数据。
      const [mode, setMode] = useState('github')
      const [act, setAct] = useState({ loading: false, error: null, data: null })
      const [actTick, setActTick] = useState(0)
      // 用 ref 做「只拉一次」的闸门：不能把 loading/data 放进依赖，
      // 否则 setState → 依赖变化 → cleanup 把在飞的请求 abort 掉，形成死循环。
      const actStarted = React.useRef(false)
      useEffect(() => {
        if (mode !== 'dsh' || actStarted.current) return
        actStarted.current = true
        let timer = null
        setAct({ loading: true, error: null, data: null })
        const ctl = new AbortController()
        timer = setTimeout(() => ctl.abort(), 20000)
        fetch(ACT_API, { credentials: 'same-origin', signal: ctl.signal })
          .then((r) => (r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))))
          .then((j) => {
            if (!j || j.ok === false) throw new Error((j && (LANG === 'zh' ? j.errorZh : j.error)) || (j && j.error) || 'request failed')
            setAct({ loading: false, error: null, data: j })
          })
          .catch((e) => {
            const msg = e && e.name === 'AbortError' ? t.timeout : String((e && e.message) || e)
            setAct({ loading: false, error: msg, data: null })
          })
          .then(() => { if (timer) clearTimeout(timer) })
        return () => { if (timer) clearTimeout(timer) }
      }, [mode, actTick])

      const submit = () => {
        const user = draft.trim().replace(/^@/, '')
        if (!user) return
        try { localStorage.setItem(LOGIN_KEY, user) } catch { /* 隐私模式忽略 */ }
        // 换人时先清空上一个用户的画面，避免旧数据冒充新用户
        if (user !== login) setState({ loading: false, error: null, data: null })
        setLogin(user)
        if (user === login) load(user)
      }

      const { loading, error, data } = state
      const p = data && data.profile
      const repos = data && data.repos ? data.repos : []
      const stars = repos.reduce((a, r) => a + (r.stars || 0), 0)

      // 色阶：跟着模式（绿/蓝）与宿主深浅色走，内联成 CSS 变量给格子用
      const palette = (mode === 'dsh' ? PALETTES.blue : PALETTES.green)[dark ? 'dark' : 'light']
      const paletteVars = {
        '--ghp-l0': palette[0],
        '--ghp-l1': palette[1],
        '--ghp-l2': palette[2],
        '--ghp-l3': palette[3],
        '--ghp-l4': palette[4],
      }

      return h('div', { className: 'ghp-root', style: paletteVars },
        h(Styles),
        h('div', { className: 'ghp-wrap' },
          h('div', { className: 'ghp-head' },
            p && p.avatar ? h('img', { className: 'ghp-avatar', src: p.avatar, alt: p.login }) : null,
            h('div', { className: 'ghp-id' },
              h('div', { className: 'ghp-name' }, p ? p.name : t.title),
              h('div', { className: 'ghp-login' }, p ? `@${p.login}` : (login ? `@${login}` : t.notSet)),
              p && p.bio ? h('div', { className: 'ghp-bio' }, p.bio) : null,
              p ? h('div', { className: 'ghp-stats' },
                h(Stat, { value: p.publicRepos, label: t.reposPublic }),
                h(Stat, { value: stars, label: t.stars }),
                h(Stat, { value: p.followers, label: t.followers }),
                h(Stat, {
                  value: data.calendar && data.calendar.total != null ? data.calendar.total : '—',
                  label: t.yearContribs,
                }),
                h(Stat, { value: data.calendar && data.calendar.streak ? data.calendar.streak : 0, label: t.streakDays }),
              ) : null,
            ),
            h('div', { className: 'ghp-actions' },
              h('div', { className: 'ghp-seg', title: 'Language' },
                h('button', { 'data-on': lang === 'zh' ? '1' : '0', onClick: () => pickLang('zh') }, '中'),
                h('button', { 'data-on': lang === 'en' ? '1' : '0', onClick: () => pickLang('en') }, 'EN'),
              ),
              h('div', { className: 'ghp-seg', title: 'Theme' },
                h('button', { 'data-on': !dark ? '1' : '0', onClick: () => pickTheme('light') }, t.light),
                h('button', { 'data-on': dark ? '1' : '0', onClick: () => pickTheme('dark') }, t.dark),
              ),
              h('input', {
                className: 'ghp-input',
                placeholder: t.placeholder,
                value: draft,
                spellCheck: false,
                onChange: (e) => setDraft(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter') submit() },
              }),
              h('button', { className: 'ghp-btn', onClick: submit, disabled: loading },
                loading ? t.reading : (login ? t.read : t.start)),
            ),
          ),
          !login && !error
            ? h('div', { className: 'ghp-card' },
                h('h3', null, t.getStarted),
                h('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' } },
                  t.getStartedBody,
                  h('br'),
                  t.getStartedToken))
            : null,
          error ? h('div', { className: 'ghp-err' }, t.loadFailed + error) : null,
          data && data.partial
            ? h('div', { className: 'ghp-note ghp-partial' },
                h('span', null, data.stale && data.stale.length
                  ? `${t.partial}（${data.stale.join(' / ')}）`
                  : t.partial),
                h('button', {
                  className: 'ghp-btn',
                  style: { marginLeft: 8, fontSize: 12, padding: '3px 8px' },
                  onClick: () => load(login),
                }, t.retry))
            : null,
          login
            ? h('div', { className: 'ghp-card' },
                h('div', { className: 'ghp-cardhead' },
                  h('h3', null, mode === 'dsh' ? t.heatmapDsh : t.heatmap),
                  h('div', { className: 'ghp-seg' },
                    h('button', { 'data-on': mode === 'github' ? '1' : '0', onClick: () => setMode('github') }, 'GitHub'),
                    h('button', { 'data-on': mode === 'dsh' ? '1' : '0', onClick: () => setMode('dsh') }, 'DSH'),
                  ),
                ),
                mode === 'github'
                  ? (data
                      ? (data.calendar
                          ? h(Heatmap, { calendar: data.calendar })
                          : h('div', { className: 'ghp-empty' },
                              data.errors && data.errors.calendar
                                ? `${t.calFailed}${data.errors.calendar} `
                                : `${t.noData} `,
                              h('button', {
                                className: 'ghp-btn',
                                style: { marginLeft: 8, fontSize: 12, padding: '3px 8px' },
                                onClick: () => load(login),
                              }, t.retry)))
                      : h('div', { className: 'ghp-empty' }, t.loading))
                  : (act.data
                      ? h(Heatmap, { calendar: act.data.calendar })
                      : h('div', { className: 'ghp-empty' },
                          act.error
                            ? h('span', null,
                                t.loadFailedLocal + act.error + ' ',
                                h('button', {
                                  className: 'ghp-btn',
                                  style: { marginLeft: 8, fontSize: 12, padding: '3px 8px' },
                                  onClick: () => {
                                    actStarted.current = false
                                    setAct({ loading: false, error: null, data: null })
                                    setActTick((n) => n + 1)
                                  },
                                }, t.retry))
                            : t.counting)),
                mode === 'dsh' ? h('div', { className: 'ghp-note' }, t.dshNote) : null)
            : null,
          login
            ? h('div', { className: 'ghp-card' },
                h('h3', null, `${t.reposTitle} (${repos.length})`),
                data && data.errors && data.errors.repos
                  ? h('div', { className: 'ghp-note' }, t.reposFailed)
                  : null,
                repos.length === 0
                  ? h('div', { className: 'ghp-empty' }, t.noRepos)
                  : h('div', { className: 'ghp-repos' }, repos.map((r) => h(RepoCard, { key: r.name, repo: r }))))
            : null,
        ),
      )
    }

    /* ------------------------------------------------------------ 图标与注册 */

    function Icon({ size = 20, active = false }) {
      return h('svg', {
        viewBox: '0 0 24 24', width: size, height: size, 'aria-hidden': true,
        style: { display: 'block', opacity: active ? 1 : 0.72 },
        fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
      },
      h('path', { d: 'M5 4.5h9.5a2.5 2.5 0 0 1 2.5 2.5v13H7.5A2.5 2.5 0 0 1 5 17.5z' }),
      h('path', { d: 'M5 17.5A2.5 2.5 0 0 1 7.5 15H17' }),
      h('path', { d: 'M9.5 8.5h5M9.5 11.5h3' }))
    }

    // 0.2.x：slots / layout 仍是必选服务；pluginNavigation 是可选的，本插件没用到，不再强依赖
    const inject = ['slots', 'layout']

    function apply(ctx) {
      ctx.inject(['layout'], (pageCtx) => {
        pageCtx.slots.inject('main', () => {
          const unregister = pageCtx.slots.register(
            { name: 'main', key: PANEL_ID, inject: () => ({}) },
            GithubPanel,
          )
          const stopSidebar = pageCtx.slots.inject('sidebar.panellist', () =>
            pageCtx.slots.register(
              { name: 'sidebar.panellist', id: PANEL_ID, order: 13, label: () => 'GitHub' },
              Icon,
            ),
          )
          return () => {
            stopSidebar()
            unregister()
          }
        })
      })
    }

    return { name: 'github-profile', inject, apply }
  },
})
