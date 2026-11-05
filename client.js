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
.ghp-actions { display: flex; gap: 8px; align-items: center; }
.ghp-input { font: inherit; font-size: 13px; padding: 6px 10px; border-radius: 8px; width: 190px;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); outline: none; }
.ghp-input:focus { border-color: var(--dsw-alias-brand-primary); }
.ghp-btn { font: inherit; font-size: 13px; padding: 6px 12px; border-radius: 8px; cursor: pointer;
  color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2);
  border: 1px solid var(--dsw-alias-border-l1); }
.ghp-btn:hover { border-color: var(--dsw-alias-border-l2); }
.ghp-card { background: var(--dsw-alias-bg-layer-1); border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 14px; padding: 16px 18px; }
.ghp-card h3 { margin: 0 0 12px; font-size: 13px; font-weight: 600; letter-spacing: .02em;
  color: var(--dsw-alias-label-secondary); text-transform: uppercase; }
.ghp-heat { overflow-x: auto; padding-bottom: 4px; }
.ghp-inner { display: inline-block; }
.ghp-months { display: grid; gap: 3px; font-size: 11px; margin-bottom: 3px;
  color: var(--dsw-alias-label-secondary); }
.ghp-month { white-space: nowrap; overflow: visible; }
.ghp-grid { display: grid; grid-auto-flow: column; gap: 3px; }
.ghp-col { display: grid; grid-template-rows: repeat(7, 11px); gap: 3px; }
.ghp-cell { width: 11px; height: 11px; border-radius: 2.5px; background: #ebedf0;
  outline: 1px solid transparent; }
.ghp-cell[data-l="1"] { background: #9be9a8; }
.ghp-cell[data-l="2"] { background: #40c463; }
.ghp-cell[data-l="3"] { background: #30a14e; }
.ghp-cell[data-l="4"] { background: #216e39; }
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
.ghp-root.blue .ghp-cell { background: #e3edf7; }
.ghp-root.blue .ghp-cell[data-l="1"] { background: #a9cbe8; }
.ghp-root.blue .ghp-cell[data-l="2"] { background: #6ea8d8; }
.ghp-root.blue .ghp-cell[data-l="3"] { background: #3d7fbe; }
.ghp-root.blue .ghp-cell[data-l="4"] { background: #1b4f86; }
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
`

    function Styles() {
      return h('style', { 'data-ghp': true }, css)
    }

    function Stat({ value, label }) {
      return h('div', { className: 'ghp-stat' },
        h('b', null, value),
        h('span', null, label))
    }

    function Heatmap({ calendar }) {
      const scroller = React.useRef(null)
      useEffect(() => {
        // 默认停在最近的那几周：内容变宽后滚到最右
        const el = scroller.current
        if (el) el.scrollLeft = el.scrollWidth
      }, [calendar])

      if (!calendar || !calendar.weeks || calendar.weeks.length === 0) {
        return h('div', { className: 'ghp-empty' }, '没有贡献数据')
      }
      const weeks = calendar.weeks
      const COLS = weeks.length
      const colW = 11
      const gap = 3
      const innerW = COLS * colW + (COLS - 1) * gap

      // 每个「换月」的那一周单独标一次，按列号定位：月份与格子共用同一套列宽，不会错位
      const monthMarks = []
      let lastMonth = -1
      weeks.forEach((week, i) => {
        const first = week[0]
        if (!first) return
        const m = Number(first.date.slice(5, 7))
        if (m !== lastMonth) { lastMonth = m; monthMarks.push({ col: i + 1, label: `${m}月` }) }
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
                  title: `${day.date} · ${day.level > 0 ? '有贡献' : '无贡献'}`,
                }))))),
          ),
        ),
        h('div', { className: 'ghp-legend' },
          h('span', null, '少'),
          [0, 1, 2, 3, 4].map((l) => h('span', { key: l, className: 'ghp-cell', 'data-l': String(l) })),
          h('span', null, '多'),
          h('div', { className: 'ghp-legend-right' },
            calendar.total != null ? h('span', null, `一年共 ${calendar.total} 次`) : null,
            calendar.streak ? h('span', null, `连续 ${calendar.streak} 天`) : null,
          ),
        ),
      )
    }

    function RepoCard({ repo }) {
      return h('div', { className: 'ghp-repo' },
        h('a', { href: repo.url, target: '_blank', rel: 'noreferrer' }, repo.name),
        h('p', null, repo.description || '（无描述）'),
        h('div', { className: 'ghp-meta' },
          repo.language
            ? h('span', { style: { display: 'flex', alignItems: 'center', gap: 5 } },
                h('i', { className: 'ghp-dot', style: { background: 'var(--dsw-alias-brand-primary)' } }),
                repo.language)
            : null,
          h('span', null, `★ ${repo.stars}`),
          repo.fork ? h('span', null, 'fork') : null,
          repo.updatedAt ? h('span', null, `更新 ${repo.updatedAt.slice(0, 10)}`) : null,
        ),
      )
    }

    const LOGIN_KEY = 'ghp.login'

    function GithubPanel() {
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
        fetch(`${API}?login=${encodeURIComponent(user)}`, { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((data) => {
            if (!data || data.ok === false) throw new Error((data && data.error) || '取数失败')
            setState({ loading: false, error: null, data })
          })
          .catch((err) => setState({ loading: false, error: String(err.message || err), data: null }))
      }, [])

      useEffect(() => { if (login) load(login) }, [login, load])

      // 模式：github = 远程贡献；dsh = 本地干活（蓝色）。切过去才拉本地数据。
      const [mode, setMode] = useState('github')
      const [act, setAct] = useState({ loading: false, error: null, data: null })
      useEffect(() => {
        if (mode !== 'dsh' || act.data || act.loading) return
        setAct({ loading: true, error: null, data: null })
        fetch(ACT_API, { credentials: 'same-origin' })
          .then((r) => r.json())
          .then((j) => {
            if (!j || j.ok === false) throw new Error((j && j.error) || '取数失败')
            setAct({ loading: false, error: null, data: j })
          })
          .catch((e) => setAct({ loading: false, error: String(e.message || e), data: null }))
      }, [mode, act.data, act.loading])

      const submit = () => {
        const user = draft.trim().replace(/^@/, '')
        if (!user) return
        try { localStorage.setItem(LOGIN_KEY, user) } catch { /* 隐私模式忽略 */ }
        setLogin(user)
        if (user === login) load(user)
      }

      const { loading, error, data } = state
      const p = data && data.profile
      const repos = data && data.repos ? data.repos : []
      const stars = repos.reduce((a, r) => a + (r.stars || 0), 0)

      return h('div', { className: 'ghp-root' + (mode === 'dsh' ? ' blue' : '') },
        h(Styles),
        h('div', { className: 'ghp-wrap' },
          h('div', { className: 'ghp-head' },
            p && p.avatar ? h('img', { className: 'ghp-avatar', src: p.avatar, alt: p.login }) : null,
            h('div', { className: 'ghp-id' },
              h('div', { className: 'ghp-name' }, p ? p.name : 'GitHub 档案'),
              h('div', { className: 'ghp-login' }, p ? `@${p.login}` : (login ? `@${login}` : '还没设置用户')),
              p && p.bio ? h('div', { className: 'ghp-bio' }, p.bio) : null,
              p ? h('div', { className: 'ghp-stats' },
                h(Stat, { value: p.publicRepos, label: '公开仓库' }),
                h(Stat, { value: stars, label: '总星标' }),
                h(Stat, { value: p.followers, label: '关注者' }),
                h(Stat, { value: data.calendar && data.calendar.total != null ? data.calendar.total : '—', label: '一年贡献' }),
                h(Stat, { value: data.calendar && data.calendar.streak ? data.calendar.streak : 0, label: '连续天数' }),
              ) : null,
            ),
            h('div', { className: 'ghp-actions' },
              h('input', {
                className: 'ghp-input',
                placeholder: '你的 GitHub 用户名',
                value: draft,
                spellCheck: false,
                onChange: (e) => setDraft(e.target.value),
                onKeyDown: (e) => { if (e.key === 'Enter') submit() },
              }),
              h('button', { className: 'ghp-btn', onClick: submit, disabled: loading },
                loading ? '读取中…' : (login ? '读取' : '开始')),
            ),
          ),
          !login && !error
            ? h('div', { className: 'ghp-card' },
                h('h3', null, '开始使用'),
                h('p', { style: { margin: 0, fontSize: 13, lineHeight: 1.7, color: 'var(--dsw-alias-label-secondary)' } },
                  '在右上角填你的 GitHub 用户名，点「开始」。读的是公开信息，不需要登录，也不会上传任何东西。',
                  h('br'),
                  '想让私有仓库也显示（可选）：把带 repo 权限的 token 存到 ~/.dsh/gh-token.txt，插件会只读使用它。'))
            : null,
          error ? h('div', { className: 'ghp-err' }, `读不到数据：${error}`) : null,
          login
            ? h('div', { className: 'ghp-card' },
                h('div', { className: 'ghp-cardhead' },
                  h('h3', null, mode === 'dsh' ? 'DSH 工作热力图' : '贡献热力图'),
                  h('div', { className: 'ghp-seg' },
                    h('button', { 'data-on': mode === 'github' ? '1' : '0', onClick: () => setMode('github') }, 'GitHub'),
                    h('button', { 'data-on': mode === 'dsh' ? '1' : '0', onClick: () => setMode('dsh') }, 'DSH'),
                  ),
                ),
                mode === 'github'
                  ? (data ? h(Heatmap, { calendar: data.calendar }) : h('div', { className: 'ghp-empty' }, '加载中…'))
                  : (act.data
                      ? h(Heatmap, { calendar: act.data.calendar })
                      : h('div', { className: 'ghp-empty' }, act.error ? `读不到本地记录：${act.error}` : '统计中…')),
                mode === 'dsh'
                  ? h('div', { style: { fontSize: 11, color: 'var(--dsw-alias-label-secondary)', marginTop: 6 } },
                      '口径：本地会话的存活区间（创建到最近活动），每天算一次活跃。')
                  : null)
            : null,
          login
            ? h('div', { className: 'ghp-card' },
                h('h3', null, `仓库（${repos.length}）`),
                repos.length === 0
                  ? h('div', { className: 'ghp-empty' }, '没有公开仓库')
                  : h('div', { className: 'ghp-repos' }, repos.map((r) => h(RepoCard, { key: r.name, repo: r }))))
            : null,
        ),
      )
    }

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

    const inject = ['slots', 'layout', 'pluginNavigation']

    function apply(ctx) {
      ctx.inject(['layout', 'pluginNavigation'], (pageCtx) => {
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
