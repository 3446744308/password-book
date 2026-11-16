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

# 2. 启动后端（默认 http://127.0.0.1:3100）
cd server && npm run dev

# 3. 另开一个终端启动前端（http://localhost:5173，/api 已代理到 3100）
cd web && npm run dev
```

首次打开页面会进入 `/setup` 创建主密码（≥10 位，需同时含字母与数字）。创建后会自动解锁并写入 `data/`。

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
│  └─ test/            接口与单元测试（Vitest）
├─ web/           前端：React + Ant Design
│  ├─ src/
│  │  ├─ api/          Axios 封装（拦截器统一带 token、解包信封、静默续期）
│  │  ├─ components/   密码字段、生成器、条目弹窗、历史抽屉、自动锁定
│  │  ├─ pages/        解锁 / 列表 / 分类 / 设置
│  │  ├─ stores/       Zustand（令牌只存内存）
│  │  └─ utils/        剪贴板、格式化、错误文案、密码生成算法
│  └─ test/            纯逻辑单元测试（Node 内置 test runner）
├─ scripts/       backup.js（手动备份）、smoke.js（对运行中的服务做全链路校验）
├─ data/          运行时数据（git 忽略，首次启动自动创建）
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

- 访问令牌只存前端内存，刷新页面即需重新解锁；刷新令牌为 `HttpOnly` Cookie。
- 密码明文只在 `GET /entries/:id/reveal` 返回，且每次调用都写审计日志；前端 30 秒后自动重新掩码，窗口失焦或页面切后台立即掩码。
- 空闲超过「会话时长」（系统设置里的 `lockMinutes`，默认 30 分钟）会自动锁定回登录页。
- 主密码连续错误达阈值会临时锁定；登录与改密端点另有 IP 限速。
- 日志与错误响应中不会出现主密码、明文密码、密钥或令牌。

## 常用命令

| 位置 | 命令 | 说明 |
| --- | --- | --- |
| `server/` | `npm run dev` | 启动后端（`--watch` 热重启） |
| `server/` | `npm test` | 后端 82 个接口/单元用例 |
| `server/` | `npm run lint` | ESLint |
| `server/` | `npm run backup` | 手动备份 `data/` |
| `web/` | `npm run dev` | Vite 开发服务器 |
| `web/` | `npm run build` | 类型检查 + 生产构建 |
| `web/` | `npm test` | 前端纯逻辑单元测试（16 个用例） |
| `web/` | `npm run lint` | ESLint |
| 仓库根 | `node scripts/smoke.js` | 对运行中的服务跑全链路冒烟（40+ 断言） |

## 测试

- **后端**：Vitest + SuperTest 风格的真实 HTTP 请求，每个用例自建临时 `data/` 目录，覆盖加解密（含篡改/错误密钥）、原子写与并发写队列、登录限速与锁定、29 个端点的正常/参数非法/未认证/不存在四类路径，并抽查落盘形态不含明文。
- **前端**：目前是**纯逻辑单元测试**，用 Node 内置 test runner + 类型剥离直接导入 `.ts` 源文件，零额外依赖，覆盖密码生成算法（含拒绝采样、熵值分级）、时间/体积格式化、错误文案与表单回填。

> 组件级测试（`SecretField`、`PasswordGenerator`）需要 `jsdom` + `@testing-library/react`，当前开发环境无法访问 npm registry 故未安装。能联网后执行：
>
> ```bash
> npm --prefix web install -D vitest jsdom @testing-library/react @testing-library/jest-dom
> ```
>
> 再把 `web/test/*.test.mjs` 迁移到 Vitest 即可（`web/package.json` 的 `test` 脚本改成 `vitest run`）。

## 文档

| 文档 | 内容 |
| --- | --- |
| [01-开发设计文档](docs/01-开发设计文档.md) | 架构、数据设计、安全模型、里程碑 |
| [02-统一开发规范](docs/02-统一开发规范.md) | 强制条款：API 信封、命名、安全、Git、测试 |
| [03-API接口文档](docs/03-API接口文档.md) | 29 个端点的唯一权威源 |

改任何端点都要同步 `docs/03`。前端与未来 App 只依据它开发，不要靠读后端源码倒推接口。
