# dsh-github-profile

一个 DeepSeek Harness 插件：在侧栏加一个 **GitHub 档案页**——资料卡、仓库卡、一年贡献热力图，以及 **DeepSeek 平台用量**（余额 / 消费 / 请求 / Tokens）。
GitHub 部分只读公开信息，填上用户名就能看；用量部分读平台网页登录态，见下文配置。

> 非官方插件，个人开发维护，与 DeepSeek 官方无关。

## 效果

- 顶部：头像、昵称、@账号、简介，以及一排数字（公开仓库 / 总星标 / 关注者 / 一年贡献 / 连续天数）
- 中间：**贡献热力图**，53 周 × 7 天，GitHub 原生五档绿；默认停在最近几周，鼠标悬停显示日期
- 中间的三段切换 **GitHub / DSH / 用量**：
  - **DSH**：本地「干活」热力图（蓝色，口径：本地会话的存活区间，每天算一次活跃）
  - **用量**：DeepSeek 平台账户数据——充值余额、累计消费、近 30 天消费 / API 请求次数 / Tokens、每日柱状图、按 API Key 分组
- 下面：**仓库卡**，带描述、语言、星标、最近推送时间，点名字跳转 GitHub

## 安装

需要 DeepSeek Harness（桌面端或 Web 端）以及它的插件管理器。

```bash
git clone https://github.com/wqx11235/dsh-github-profile.git
```

然后在 DSH 里：**插件管理 → 从本地目录安装**，选中刚克隆的目录。安装后侧栏会出现 **GitHub** 图标（在 AstBot 下面）。

命令行等价做法（在能跑 `dsh` 的地方）：

```bash
dsh plugin --profile <你的 profile> add /absolute/path/to/dsh-github-profile
```

## 用法

1. 点侧栏 **GitHub**
2. 右上角填你的 GitHub 用户名，点「开始」
3. 用户名会记在浏览器 localStorage，下次自动加载

公开信息不需要任何配置。**想让私有仓库也出现（可选）**：把你的 GitHub token 存到 `~/.dsh/gh-token.txt`（一行纯 token），插件只读使用，不做任何写操作。token 只需要 `repo` 权限即可。

## 数据从哪来

| 内容 | 来源 |
| --- | --- |
| 用户资料 | `api.github.com/users/<login>` |
| 仓库列表 | `api.github.com/users/<login>/repos?per_page=100&sort=pushed` |
| 贡献日历 | 依次降级：GraphQL（有 token 时）/ [jogruber 公开 API](https://github-contributions-api.jogruber.de/) / `github.com/users/<login>/contributions`（HTML） |

- 宿主侧有 **10 分钟缓存**，三块数据分开缓存，避免反复打 GitHub。
- 热力图只有 GitHub 的色阶，**没有每日精确次数**；一年总数是从贡献页标题里读的。
- 插件不上传任何数据，也不写 GitHub；`gh-token.txt` 只用于提高速率上限和读私有仓库。

## 读取稳定性（v0.1.2）

之前的版本只用 `github.com/users/<login>/contributions` 抓热力图。本机直连 github.com 主站时常 TCP 超时（`api.github.com` 却正常），所以会出现「资料和仓库都在、热力图空着、一年贡献显示 —」的时好时坏。

现在：

- **三路降级**：有 token 走 `api.github.com/graphql`（还顺带拿到每日精确次数），无 token 走 jogruber 公开 API，两者都挂才回 github.com 贡献页。**正常情况完全不碰 github.com 主站**。
- **分块容错**：资料卡、仓库、热力图各自缓存、各自失败，一块挂了不会让整页空白。
- **失败不丢数据**：24 小时内的上次结果会继续显示，顶部提示「部分数据没取到」并给一键重试。
- **token 过期自愈**：401/403 时自动去掉 token 以匿名身份重试。
- **快速超时**：每请求 8 秒，网络抖动重试一次，不再等满 15 秒。

## 配置

插件行支持两个配置项（在插件管理的该行配置里改）：

```yaml
login: your-github-login      # 默认用户名，留空则每次在页面上填
tokenFile: ~/.dsh/gh-token.txt   # 可选 token 文件（默认就是它）
```

## 实现要点

- 宿主半边：`index.js`，注册一个同源路由 `GET /gh-profile/data?login=<user>`，聚合上面三个数据源。
- 页面半边：`client.js`，`window.__ModuleLoader__.load({ id, factory })` 注册到 `main`（keyed）与 `sidebar.panellist`（list，order 13）。
- 颜色跟随宿主主题：容器和文字用 `--dsw-*` token；热力图用 GitHub 自己的绿色阶。
- 无构建步骤，纯 JS，改完刷新页面即可。

## 适配 DSH 0.2.x（v0.1.3）

针对 `@deepseek-ai/dsh-desktop 0.2.2-rc.1`（内核 0.2.2-rc.1，hostProtocolVersion 4）逐项核对过：

- 宿主侧 `inject: ['webServer']`、`ctx.effect`、`webServer.register({ kind: 'exact', path, handler })` 契约不变，`/gh-profile/data` 正常返回。
- 客户端 `window.__ModuleLoader__.load({ id, factory })`、`ctx.slots.inject/register`、`sidebar.panellist`（list）、`main`（keyed）、`pluginNavigation` 均保留，`register` 签名与 `label`/`order`/`locale` 选项一致。
- 主题 token `--dsw-alias-*` 未改名，配色继续生效。
- **清理旧包名**：`dsh.client.inject` 里原来声明的 `@deepseek-ai/dsh-client-runtime` 在 0.2.2 已不存在（0.1.x 遗留），`dsh-client-ui-slots` 也改为由 shell 提供。本插件只 `require('react')`（seed 模块），因此 `inject` 收敛为 `[]`。

## DeepSeek 用量（v0.1.4）

页面中间的 **GitHub / DSH / 用量** 三段切换里，第三段是 DeepSeek 平台账户用量：

- 充值余额、累计消费金额
- 近 30 天消费金额、API 请求次数、Tokens
- 每日消费柱状图（悬停看当天明细）
- 按 API Key 分组的用量明细

数据来自 `platform.deepseek.com` 的网页登录态接口，需要平台 token（不是 API Key）：

1. 浏览器登录 https://platform.deepseek.com
2. F12 → Network → 任意 `/api/v0/...` 请求
3. 复制 `Authorization` 里 `Bearer ` 后面那串
4. 存成一行到 `~/.dsh/deepseek-platform-token.txt`（或插件目录 `platform-token.txt`）

token 过期时页面会提示，重新获取覆盖即可。数据有 3 分钟缓存。

## 许可

MIT，见 [LICENSE](LICENSE)。
