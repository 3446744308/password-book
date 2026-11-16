# 密码本

个人单机密码本：Web 端管理账号密码，数据以 **JSON 文件**保存在本地 `data/` 目录，**不依赖任何数据库**。密码与备注字段加密落盘，前后端通过统一的 REST API 交互（为未来手机 App 预留同一套接口）。

- 后端：Node.js ≥ 18 + Express 4（ESM JavaScript）
- 前端：React 18 + Ant Design 5 + Vite 5 + TypeScript
- 加密：Node 内置 `crypto`——PBKDF2-SHA256 派生密钥 + AES-256-GCM 字段加密，无原生编译依赖

> 唯一需要记住的是**主密码**。它不落盘、不可找回，忘了等于数据作废。

## 快速开始

```bash
# 1. 安装依赖（两个子包各自安装）
npm --prefix server install
npm --prefix web install

# 2. 一条命令同时启动前端 + 后端
node scripts/dev.js
```

打开 **http://localhost:5173** 即可。`scripts/dev.js` 会带 `[server]` / `[web]` 前缀转发两端日志；改动任一端代码都会自动重载（后端 `node --watch`、前端 Vite HMR），按 `Ctrl+C` 一起停止。

> 不想用合并启动、或者想分开看日志时，仍然可以两个终端分别跑：
>
> ```bash
> cd server && npm run dev     # 后端 http://127.0.0.1:3100
> cd web && npm run dev        # 前端 http://localhost:5173（/api 已代理到 3100）
> ```
>
> 若控制台里的中文显示成乱码，那是 Windows 控制台代码页问题，执行 `chcp 65001` 或改用 Windows Terminal 即可（脚本本身输出的是 UTF-8）。

首次打开页面会进入 `/setup` 创建**你自己的主密码**（≥10 位，需同时含字母与数字）。创建后会自动解锁并写入 `data/`。

初始化时会预置 **7 个常用分类**（工作、邮箱、银行金融、社交、购物、开发工具、影音娱乐）和
**16 个常用标签**（常用、工作、银行、支付、开发、服务器…）。它们就是普通分类/标签：
可改名、可删除、可调排序，删掉后不会在重启时复活。清单与播种规则见
[设计文档 4.3](docs/01-开发设计文档.md#43-数据字典)。

**生产部署**：`npm --prefix web run build` 产出 `web/dist`，由 Express 直接托管（SPA 回退已内置），单进程即可运行：

```bash
NODE_ENV=production npm --prefix server start
```

## 目录结构

```
密码本/
├─ docs/          三份项目文档（设计 / 规范 / API）
├─ server/        后端：Express + 分层架构
│  ├─ src/
│  │  ├─ routes/       路由层（只做校验与转发）
│  │  ├─ middleware/   鉴权 / 限速 / 错误处理
│  │  ├─ services/     业务规则（认证、条目、分类、系统）
│  │  ├─ storage/      data/ 的唯一读写出口（原子写 + 写队列 + 迁移）
│  │  ├─ crypto/       加解密的唯一入口（KDF / AES-GCM）
│  │  └─ utils/        错误码、校验、JWT、ULID
│  └─ test/            接口与单元测试（Vitest，6 文件 92 用例）
├─ web/           前端：React + Ant Design
│  ├─ src/
│  │  ├─ api/          Axios 封装（拦截器统一带 token、解包信封、静默续期）
│  │  ├─ components/   密码字段、生成器、条目弹窗、历史抽屉、自动锁定
│  │  ├─ pages/        解锁 / 列表 / 分类 / 设置
│  │  ├─ stores/       Zustand（令牌只存内存）
│  │  └─ utils/        剪贴板、格式化、错误文案、密码生成算法
│  ├─ test/            单元 + 组件测试（Vitest + jsdom + Testing Library）
│  ├─ vitest.config.ts
│  └─ tsconfig.test.json   测试文件的类型检查配置
├─ scripts/       backup.js（备份）、scan-plaintext.js（明文扫描）、smoke.js（全链路校验）
├─ data/          运行时数据（git 忽略，首次启动自动创建）
├─ .prettierrc.json / .prettierignore   两端共用的格式化规则
├─ .gitattributes  换行符固定 LF
└─ .gitignore
```

## 数据与备份

`data/` 目录内容：

```
data/
├─ meta.json           库元信息 + schema 版本 + 迁移记录
├─ config.json         系统配置（会话时长、失败次数、历史保留条数等）
├─ master.json         主密码校验器 + KDF 参数 + 失败计数（无明文）
├─ secrets.json        数据密钥封装（见下方安全说明）
├─ categories.json     分类元数据
├─ entries/<分类>.json  每个分类一个文件
├─ history/<条目>.json  密码历史版本
├─ jwt.secret          JWT 签名密钥（0600）
├─ logs/
│  ├─ audit.jsonl      审计日志（追加式，保留最近 1000 条）
│  └─ app-YYYYMMDD.log 结构化运行日志（按天轮转，保留 14 天）
└─ backups/            备份归档
```

**备份**：

```bash
npm --prefix server run backup   # 归档到 data/backups/<YYYYMMDD-HHmmss>/
```

也可以在「系统设置 → 数据备份」里一键触发。

**合规自检**：随时可以扫描整个数据目录，确认没有明文密码字段落盘：

```bash
npm --prefix server run scan          # 人类可读报告；有问题时退出码 1
node scripts/scan-plaintext.js --json # 机器可读
```

它会递归检查所有 JSON/JSONL：出现 `password` / `notes` 这类明文字段、`passwordEnc` 不是
`v1:iv:tag:ct` 形态、或文件本身损坏，都会精确报出文件与 JSON 路径。

**恢复**：停服 → 用备份目录内容整体覆盖 `data/` → 启动。注意 `jwt.secret` 一并恢复，否则旧令牌全失效（需重新解锁）。

> `data/` 里没有明文密码，但**必须和 `master.json` 一起备份**，两者分开保存等于两把钥匙分开放，请自行权衡保管方式。

## 安全说明（重要）

本项目有两种密钥模式，由 `AUTH_MODE`（见 `server/.env.example`）决定：

| 模式 | 字段密钥落盘 | 换主密码 | 适用场景 |
| --- | --- | --- | --- |
| `dev`（默认） | **是**，`data/secrets.json` 里存明文 DEK | 秒级，只重新封装密钥 | 本机单机自用 |
| `strict` | 否，登录后由主密码派生 | 需全量重加密（条目多时较慢） | 对外提供服务、或磁盘不完全可信 |

**`dev` 模式的实际保护边界**：拿到 `data/` 目录的人**可以**解开密码字段（因为 DEK 就在同目录的 `secrets.json` 里）。它能防的是"备份单独泄漏""网络抓包""误传文件"，**不能**防"整盘被拷走"。如果这点不符合你的要求，请改用 `AUTH_MODE=strict`，或把 `data/` 放在全盘加密的卷上。

`dev` 模式绑定到非回环地址时，启动日志会打印 `security.dev_mode.exposed` 警告。

其他安全约定：

- 访问令牌只存前端内存；刷新令牌为 `HttpOnly` Cookie（默认 7 天），**刷新页面会自动静默续期**，不必重输主密码。主动点「锁定」或更换主密码会清除该 Cookie，此后刷新才需要重新解锁。想缩短免密窗口就调小 `REFRESH_TOKEN_TTL`。
- 密码明文只在 `GET /entries/:id/reveal` 返回，且每次调用都写审计日志；前端 30 秒后自动重新掩码，窗口失焦或页面切后台立即掩码。
- 空闲超过「会话时长」（系统设置里的 `lockMinutes`，默认 30 分钟）会自动锁定回登录页。
- 主密码连续错误达阈值会临时锁定；登录与改密端点另有 IP 限速。
- 日志与错误响应中不会出现主密码、明文密码、密钥或令牌。

## 常用命令

| 位置 | 命令 | 说明 |
| --- | --- | --- |
| 仓库根 | `node scripts/dev.js` | **一条命令同时启动前后端** |
| `server/` | `npm run dev` | 只启动后端（`--watch` 热重启） |
| `server/` | `npm test` | 后端 100 个接口/单元用例 |
| `server/` | `npm run lint` | ESLint |
| `server/` | `npm run format` / `format:check` | Prettier 格式化 / 只校验 |
| `server/` | `npm run backup` | 手动备份 `data/` |
| `server/` | `npm run scan` | 明文扫描：断言 `data/` 无明文密码字段 |
| `web/` | `npm run dev` | Vite 开发服务器 |
| `web/` | `npm run build` | 类型检查 + 生产构建 |
| `web/` | `npm test` | 前端 91 个单元/组件/契约/守卫用例 |
| `web/` | `npm run typecheck` | 类型检查（含测试文件） |
| `web/` | `npm run lint` | ESLint |
| `web/` | `npm run format` / `format:check` | Prettier 格式化 / 只校验 |
| 仓库根 | `node scripts/smoke.js` | 对运行中的服务跑全链路冒烟（35 项断言） |

> ⚠️ `scripts/smoke.js` 在目标库**未初始化**时会用测试主密码 `Smoke123456` 调用 `/auth/setup` 把库占下来。
> 为防止误伤真实数据，未初始化时必须显式加 `--allow-setup`；对真实密码本请**不要**加这个参数。
> 推荐做法是对临时数据目录起服务再跑：
>
> ```bash
> $env:DATA_DIR="$env:TEMP\pwbook-smoke"; node server/src/server.js      # PowerShell
> node scripts/smoke.js http://127.0.0.1:3100 --allow-setup
> ```

## 测试

- **后端（100 个用例）**：Vitest + 真实 HTTP 请求。覆盖加解密（含密文篡改、错误密钥）、KDF/verifier、JWT 篡改与过期、ULID；原子写与 50 路并发写队列；登录限速与 5 次失败锁定；30 个端点的正常/参数非法/未认证/不存在四类路径；会话生命周期（登出/刷新/换主密码后旧令牌失效）；日志落盘与脱敏；明文扫描器自身的 10 个用例；内置分类播种（幂等、删除后不复活、老库补写）与 `GET /system/presets`。每个用例自建临时 `data/` 目录并在结束时删除。
- **前端（91 个用例）**：Vitest + jsdom + `@testing-library/react`。
  - 纯逻辑：密码生成（拒绝采样无取模偏差、排除易混淆字符、熵值分级）、已有密码的强度反馈（按实际字符类别算池大小并分级）、时间/体积格式化、错误文案与表单回填。
  - 组件：`SecretField`（默认掩码、点击才 reveal、失焦/切后台立即掩码、30 秒自动掩码、复制路径）、`PasswordGenerator`（默认 20 位、回传、熵值标签）、`AutoLock`（空闲超时锁定、未超时不锁、未登录不动作）、`EntryModal` 分区表单（基本信息 / 密码 / 归类与备注）与内置标签快捷选择（点选/取消、10 个上限、无候选时不渲染）；`EntryDetailDrawer` 条目详情（字段渲染、密码默认掩码、账号复制、编辑/历史/删除跳转、空值与加载失败）；条目列表「详情」入口到编辑弹窗的衔接。
  - **API 契约**：用 axios 自定义 adapter 伪造响应，锁死「信封只解包一次」——辅助函数返回 `{data, pagination}`，取 `.data` 的职责只在 api 模块。曾经多剥一层导致所有接口返回 `undefined`。
  - **App 级路由守卫**：未初始化时在 `/setup` 必须渲染表单（防回环重定向白屏）、`/login` 引导到 `/setup`、已初始化停在 `/setup` 跳 `/login`、后端不可达不白屏。
  - **页面结构**：系统设置拆成五个分区页面（`/settings/master|config|backup|audit|about`），导航在侧边栏子菜单里；用例覆盖分区→内容映射、系统配置两栏分组与保存回填、备份结果展示、审计日志人话化（事件码→中文、detail→中文描述、回环 IP→本机），以及侧边栏子菜单默认展开、点击切路由、直接访问时高亮对应子项。
  - 测试文件也参与类型检查：`web/tsconfig.test.json`，`npm run typecheck` 一并跑。

> 提示：antd 的 `Button` 会给两个汉字之间自动插入空格（「取 消」），组件测试里断言按钮文案时用
> `getByRole('button', { name: /取\s*消/ })` 这类容错匹配，不要用精确文本。

## 文档

| 文档 | 内容 |
| --- | --- |
| [01-开发设计文档](docs/01-开发设计文档.md) | 架构、数据设计、安全模型、里程碑 |
| [02-统一开发规范](docs/02-统一开发规范.md) | 强制条款：API 信封、命名、安全、Git、测试 |
| [03-API接口文档](docs/03-API接口文档.md) | 29 个端点的唯一权威源 |

改任何端点都要同步 `docs/03`。前端与未来 App 只依据它开发，不要靠读后端源码倒推接口。
