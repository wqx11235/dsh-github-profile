# dsh-github-profile

一个 DeepSeek Harness 插件：在侧栏加一个 **GitHub 档案页**——资料卡、仓库卡和一年贡献热力图。
数据只读公开信息，任何人填上自己的用户名就能看自己的，不需要登录。

> 非官方插件，个人开发维护，与 DeepSeek 官方无关。

## 效果

- 顶部：头像、昵称、@账号、简介，以及一排数字（公开仓库 / 总星标 / 关注者 / 一年贡献 / 连续天数）
- 中间：**贡献热力图**，53 周 × 7 天，GitHub 原生五档绿；默认停在最近几周，鼠标悬停显示日期
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
| 贡献日历 | `github.com/users/<login>/contributions`（解析 `data-date` / `data-level`） |

- 宿主侧有 **10 分钟缓存**，避免反复打 GitHub。
- 热力图只有 GitHub 的色阶，**没有每日精确次数**；一年总数是从贡献页标题里读的。
- 插件不上传任何数据，也不写 GitHub；`gh-token.txt` 只用于提高速率上限和读私有仓库。

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

## 许可

MIT，见 [LICENSE](LICENSE)。
