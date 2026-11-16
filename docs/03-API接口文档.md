# 密码本系统 · API 接口文档

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v2.0 |
| 编写日期 | 2026-11-16 |
| API 版本 | `v1`（Base URL：`/api/v1`） |
| 端点数量 | 30 |
| 面向对象 | Web 前端（Ant Design）、未来手机 App、其他任何客户端 |
| 权威性 | **唯一权威接口源**。任何端点变更必须在同一个 PR 内同步本文档 |

> 本文档描述的字段、约束、错误码均与 `server/src/` 的现行实现逐条核对过；
> 发生冲突时以本文档为准并修代码，或先改本文档再改代码，禁止长期不一致。

---

## 1. 通用约定

### 1.1 协议与地址

| 项 | 约定 |
| --- | --- |
| 协议 | HTTP/1.1；远程访问必须 HTTPS（本地开发例外） |
| 基础路径 | `http://<host>:<port>/api/v1` |
| 开发期地址 | 后端 `http://127.0.0.1:3100`；前端 `http://localhost:5173`（`/api` 已由 Vite 代理到 3100） |
| 编码 | UTF-8 |
| 请求头 | `Content-Type: application/json; charset=utf-8`（GET/DELETE 无 body） |
| 认证头 | `Authorization: Bearer <accessToken>` |
| 请求体上限 | 1 MB（超出返回 `400 VALIDATION_ERROR`） |
| WebSocket | 不涉及 |

### 1.2 统一响应信封

**成功（2xx）**——单资源：

```json
{ "data": { "id": "01JD8Z8G9QK3M2N7P5R6T8WXYZ" } }
```

**成功（2xx）**——集合，额外带分页对象：

```json
{
  "data": [],
  "pagination": { "page": 1, "size": 20, "total": 135 }
}
```

**`204`**（无响应体）：`POST /auth/logout`、`DELETE /entries/:id`。

**失败（4xx/5xx）**——结构固定，永不包含堆栈：

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "参数校验失败",
    "details": [{ "field": "title", "message": "标题不能为空" }]
  }
}
```

> `details` **仅** `VALIDATION_ERROR` 与部分 `LOCKED_OUT` / `NOT_FOUND` 会带，
> 形态固定为 `[{ field, message }]`；`field` 为 `"_"` 表示整体性问题（不绑定具体字段）。
> 客户端逻辑只应依据 `code` 与 HTTP 状态码，**不要解析 `message`**（可本地化）。

### 1.3 鉴权与会话模型

1. `POST /auth/setup` 初始化主密码（仅当系统未初始化；成功后同时写入内置分类）。
2. `POST /auth/login` 提交主密码，返回 `accessToken`（JWT HS256，默认 30 分钟）
   并通过 `Set-Cookie` 下发 `refreshToken`（HttpOnly，默认 7 天）。
3. 后续请求携带 `Authorization: Bearer <accessToken>`。
4. 令牌过期 → `401 TOKEN_EXPIRED` → 调 `POST /auth/refresh` 静默换新。
   **页面刷新/冷启动同样用它**：访问令牌只存客户端内存，刷新后内存清空，
   客户端应先用 Cookie 调一次 `/auth/refresh` 换回令牌，成功即可免去重输主密码。
5. 会话时长由 `config.json` 的 **`lockMinutes`** 决定，它**就是访问令牌的实际 TTL**
   （`expiresIn = lockMinutes × 60`，登录与刷新共用同一取值）。修改 `lockMinutes`
   只影响**之后新签发**的令牌，已签发的按原 TTL 自然过期。
6. 登录失败累计达 `failedAttempts`（默认 5）→ `423 LOCKED_OUT`，冷却
   `lockMinutesAfterBan`（默认 15 分钟）。
7. `POST /auth/logout` 与 `POST /auth/change-master` 会吊销当前访问令牌的 `jti`
   并**清除刷新令牌 Cookie**；更换主密码还会使所有已签发令牌失效（持久化吊销线）。

**Cookie 属性**：`HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800`，
仅在 HTTPS 连接上附加 `Secure`（开发期 `http://localhost` 下不带，否则浏览器会丢弃）。

**无需鉴权的端点**：`POST /auth/setup`、`POST /auth/login`、`POST /auth/refresh`、
`GET /system/health`、`GET /system/status`。其余全部需要 Bearer。

### 1.4 分页、排序、筛选

| 参数 | 类型 | 默认 | 取值范围 | 说明 |
| --- | --- | --- | --- | --- |
| `page` | int | `1` | ≥ 1 | 页码 |
| `size` | int | 见各端点 | 见各端点 | 每页条数 |
| `sort` | enum | `updatedAt` | `updatedAt` \| `createdAt` \| `title` | 排序字段（仅条目列表） |
| `order` | enum | `desc` | `asc` \| `desc` | 排序方向（仅条目列表） |
| `keyword` | string | — | ≤ 100 | 关键词，匹配标题/账号/URL/标签（仅条目列表） |
| `categoryId` | string | — | ≤ 50 | 按分类过滤（仅条目列表） |
| `favorite` | string | — | `"true"` \| `"false"` | 只看收藏；传 `"false"` 等同不过滤 |
| `tag` | string | — | ≤ 20 | 按标签过滤（仅条目列表） |
| `event` | string | — | ≤ 50 | 审计事件码过滤（仅审计日志） |

各集合端点的 `size` 上限：

| 端点 | 默认 `size` | `size` 上限 |
| --- | --- | --- |
| `GET /entries` | 20 | 100 |
| `GET /entries/:id/history` | 20 | 100 |
| `GET /system/audit` | 50 | 200 |

### 1.5 数据类型约定

| 类型 | 约定 |
| --- | --- |
| 时间 | 一律 **ISO 8601 UTC** 字符串，如 `2026-11-16T09:00:00.000Z` |
| ID | 一律字符串。分类/条目为 **ULID**（26 位 Crockford Base32，字典序即时间序）；默认分类固定为 `_default` |
| 布尔 | `true` / `false`，禁止 `0/1`、`"yes"` |
| 字段命名 | 全小驼峰 |
| 可选字段 | 无值时**省略**；语义需要"显式清空"时用 `null`（仅 `password`、`notes` 等例外，见端点说明） |
| 密文 | `passwordEnc` / `notesEnc` 形如 `v1:<iv_b64>:<tag_b64>:<ct_b64>`，**任何响应都不返回** |
| 金额/数量 | 不涉及 |
| URL 长度 | 整个请求 URL 上限 2 KB |

**任何响应都不会包含**：主密码、KEK、DEK、JWT 签名密钥、`password` 明文
（唯一例外是 `GET /entries/:id/reveal` 与 `GET /entries/:id/history/:version`，且两者都写审计日志）。

### 1.6 限速与锁定

| 范围 | 桶 | 默认额度 | 触发后 |
| --- | --- | --- | --- |
| `POST /auth/setup`、`POST /auth/login` | `login`（按 IP） | 5 次 / 5 分钟，**两者共用同一计数桶** | `429 RATE_LIMITED` + `Retry-After` |
| `POST /auth/change-master` | `master`（按 IP） | 5 次 / 5 分钟（独立桶） | 同上 |

- 可通过 `RATE_LOGIN_WINDOW_MS` / `RATE_LOGIN_MAX` 调整；计数为**进程内内存**，重启即清零。
- 限速（429）与账户锁定（423）是两套机制：前者按 IP 频次，后者按主密码错误次数。
  默认配置下「5 次失败」会先于限速触发 423。

### 1.7 CORS

- 允许来源：白名单（`CORS_ORIGINS`，开发期默认 `http://localhost:5173`），**禁止 `*`**。
- 允许头：`Content-Type, Authorization`；允许方法：`GET, POST, PUT, PATCH, DELETE, OPTIONS`。
- 允许携带凭证（`Access-Control-Allow-Credentials: true`，刷新令牌依赖它）。
- 预检缓存：`Access-Control-Max-Age: 600`。

下列响应头在所有响应上附带（无第三方依赖）：

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
```

---

## 2. 认证与会话 `/auth`

### 2.1 `POST /auth/setup` — 初始化主密码

> **鉴权**：无。**限速**：与登录共用桶（默认 5 次 / 5 分钟 / IP）。
> 仅当系统未初始化时可用；成功后**同时写入 7 个内置分类**（见 [设计文档 4.3](./01-开发设计文档.md#43-数据字典)）。

**请求体**

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `masterPassword` | string | ✓ | 不 trim；≤ 512 字符；长度 ≥ `minPasswordLength`（默认 10）；**须同时包含字母与数字** |

**响应** `201`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `initialized` | boolean | 恒为 `true` |
| `defaultCategoryId` | string | 恒为 `_default` |

```json
{ "data": { "initialized": true, "defaultCategoryId": "_default" } }
```

**错误**：`400 VALIDATION_ERROR`（长度不足/缺字母数字/为空）、`409 ALREADY_INITIALIZED`、`429 RATE_LIMITED`

---

### 2.2 `POST /auth/login` — 主密码登录/解锁

> **鉴权**：无。**限速**：与 setup 共用桶（默认 5 次 / 5 分钟 / IP）。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `masterPassword` | string | ✓ | 主密码明文，**必须 HTTPS 传输** |

**响应** `200`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `accessToken` | string | JWT（HS256），后续请求放 `Authorization: Bearer` |
| `tokenType` | string | 恒为 `"Bearer"` |
| `expiresIn` | number | 有效期（**秒**）= `lockMinutes × 60`，默认 1800 |
| `serverTime` | string | 服务端当前时间，供客户端校正时钟 |

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "tokenType": "Bearer",
    "expiresIn": 1800,
    "serverTime": "2026-11-16T09:00:00.000Z"
  }
}
```

同时下发 Cookie（响应体里**不含** `refreshToken`）：

```
Set-Cookie: refreshToken=<...>; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800; Secure
```

**错误**

| 状态 | code | 说明 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 主密码为空，或系统尚未初始化（`message` 为"系统尚未初始化"） |
| 401 | `AUTH_INVALID_CREDENTIALS` | 主密码错误 |
| 423 | `LOCKED_OUT` | 失败次数超限锁定中（`details[0].field = "lockedUntil"`） |
| 429 | `RATE_LIMITED` | 触发限速，带 `Retry-After` |

---

### 2.3 `POST /auth/refresh` — 刷新访问令牌

> **鉴权**：无（凭 `refreshToken` Cookie）。请求体可为空 `{}`。
> 页面刷新/冷启动恢复会话也走这个端点。

**响应** `200`：结构同 2.2，但**不重新下发 Cookie**

```json
{
  "data": {
    "accessToken": "eyJhbGciOiJIUzI1NiIs...",
    "tokenType": "Bearer",
    "expiresIn": 1800,
    "serverTime": "2026-11-16T09:30:00.000Z"
  }
}
```

**错误**：`401 TOKEN_MISSING`（无 Cookie）、`401 TOKEN_INVALID`（令牌类型/签名/已吊销）、
`401 TOKEN_EXPIRED`（刷新令牌也过期 → 必须重新登录）

---

### 2.4 `GET /auth/session` — 会话校验

> **鉴权**：Bearer。用于 App 冷启动判断"当前令牌是否仍然有效"。

**响应** `200`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `authenticated` | boolean | 恒为 `true`（能进来就说明令牌有效） |
| `expiresAt` | string | 当前访问令牌的过期时间（ISO 8601） |
| `lockMinutes` | number | 服务端配置的会话时长（分钟） |

**错误**：`401 TOKEN_MISSING`、`401 TOKEN_EXPIRED`、`401 TOKEN_INVALID`

---

### 2.5 `POST /auth/logout` — 退出/锁定

> **鉴权**：Bearer。立即吊销当前令牌的 `jti`，并清除刷新令牌 Cookie。

**响应** `204`（无响应体）

**错误**：`401 TOKEN_MISSING` / `TOKEN_EXPIRED` / `TOKEN_INVALID`

> 锁定语义：清除 Cookie 后再刷新页面，客户端无法静默续期，必须重新输入主密码。

---

### 2.6 `POST /auth/change-master` — 更换主密码

> **鉴权**：Bearer。**限速**：独立桶（默认 5 次 / 5 分钟 / IP）。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `currentPassword` | string | ✓ | 旧主密码（再次校验） |
| `newPassword` | string | ✓ | 长度 ≥ `minPasswordLength`，须含字母与数字，≤ 512 |

**响应** `200`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `changed` | boolean | 恒为 `true` |
| `reencryptedEntries` | number | `dev` 模式恒为 `0`（仅重封装 DEK）；`strict` 模式为实际重加密的字段数 |
| `reloginRequired` | boolean | 恒为 `true`——所有已签发令牌失效 |

**错误**：`400 VALIDATION_ERROR`、`401 AUTH_INVALID_CREDENTIALS`（旧密码错）、
`401 TOKEN_*`、`429 RATE_LIMITED`

> 成功后服务端会清除刷新令牌 Cookie；客户端应丢弃本地令牌并跳转登录页。

---

## 3. 分类 `/categories`

> 分类对象的数据字典见 §9.1。

### 3.1 `GET /categories` — 获取全部分类

> **鉴权**：Bearer。数量少，**不分页**。

**响应** `200`：`data` 为分类数组，按 `sortOrder` 升序、再按 `createdAt` 升序。

```json
{
  "data": [
    {
      "id": "_default",
      "name": "默认分类",
      "icon": "folder",
      "sortOrder": 0,
      "protected": true,
      "entryCount": 42,
      "createdAt": "2026-11-16T08:00:00.000Z",
      "updatedAt": "2026-11-16T08:00:00.000Z"
    },
    {
      "id": "01JD8Z8G9QK3M2N7P5R6T8WXYZ",
      "name": "工作",
      "icon": "project",
      "sortOrder": 10,
      "protected": false,
      "entryCount": 17,
      "createdAt": "2026-11-16T08:00:00.000Z",
      "updatedAt": "2026-11-16T08:00:00.000Z"
    }
  ]
}
```

> `entryCount` 由服务端聚合（每分类一个文件，逐个统计条目数）。
> `protected: true` 的分类禁止删除、禁止改名。

**错误**：`401 TOKEN_*`

---

### 3.2 `POST /categories` — 创建分类

> **鉴权**：Bearer。

**请求体**

| 字段 | 类型 | 必填 | 约束 | 默认 |
| --- | --- | --- | --- | --- |
| `name` | string | ✓ | trim 后 1-50 字符 | — |
| `icon` | string | ✗ | ≤ 50 字符 | `"folder"` |
| `sortOrder` | int | ✗ | 0-99999 | `999` |

**响应** `201`：新建分类对象（同 3.1 结构，`entryCount` 为 `0`，`protected` 为 `false`）。

**错误**：`400 VALIDATION_ERROR`、`401`、`409 CONFLICT`（同名分类已存在）

---

### 3.3 `GET /categories/:id` — 分类详情

> **鉴权**：Bearer。`:id` 须是 ULID 或 `_default`，否则按不存在处理。

**响应** `200`：分类对象（含 `entryCount`）。

**错误**：`401`、`404 NOT_FOUND`

---

### 3.4 `PUT /categories/:id` — 更新分类

> **鉴权**：Bearer。请求体至少包含一项待更新字段。
> `_default` 分类只允许改 `icon`、`sortOrder`，改 `name` 返回 `403`。

**请求体**（全部可选，至少一项）

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `name` | string | trim 后 1-50 字符 |
| `icon` | string | ≤ 50 字符 |
| `sortOrder` | int | 0-99999 |

**响应** `200`：更新后的分类对象。

**错误**：`400`（含"至少提交一个待更新字段"）、`401`、`403 PROTECTED_RESOURCE`、
`404 NOT_FOUND`、`409 CONFLICT`（重名）

---

### 3.5 `DELETE /categories/:id` — 删除分类

> **鉴权**：Bearer。`_default` 不可删除。
> **条目不会级联删除**：先把该分类下所有条目迁移到 `_default`，再删除分类与其条目文件。

**响应** `200`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `deleted` | boolean | 恒为 `true` |
| `movedEntries` | number | 被迁移到默认分类的条目数 |

```json
{ "data": { "deleted": true, "movedEntries": 17 } }
```

**错误**：`401`、`403 PROTECTED_RESOURCE`（删默认分类）、`404 NOT_FOUND`

---

### 3.6 `POST /categories/:id/transfer` — 批量转移条目

> **鉴权**：Bearer。把若干条目从当前分类移动到目标分类（App 的"多选移动"用）。

**请求体**

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `targetCategoryId` | string | ✓ | 匹配 `^[A-Za-z0-9_][A-Za-z0-9_-]{0,49}$`，且须存在 |
| `entryIds` | string[] | ✓ | 1-500 项，每项非空 |

**响应** `200`

```json
{ "data": { "transferred": 5, "targetCategoryId": "01JD8Z8G9QK3M2N7P5R6T8WXYZ" } }
```

**错误**

| 状态 | code | 说明 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 目标分类与当前分类相同 / ID 非法 / 数组越界 |
| 401 | `TOKEN_*` | — |
| 404 | `NOT_FOUND` | 目标分类不存在；或某些条目不属于该分类（`details[0].field = "entryIds"`） |

---

## 4. 条目 `/entries`

> **列表接口不返回** `passwordEnc` 密文、`password` 明文，也不返回 `notes`；
> 查看密码必须走 reveal 端点，查看备注走详情端点。

### 4.1 `GET /entries` — 条目列表（搜索 / 筛选 / 分页 / 排序）

> **鉴权**：Bearer。

**查询参数**：见 §1.4。跨分类检索，默认按 `updatedAt` 倒序。

**响应** `200`

```json
{
  "data": [
    {
      "id": "01JD8Z8G9QK3M2N7P5R6T8WXYZ",
      "categoryId": "_default",
      "title": "公司邮箱",
      "username": "me@company.com",
      "url": "https://mail.company.com",
      "hasPassword": true,
      "favorite": true,
      "tags": ["工作", "邮箱"],
      "createdAt": "2026-11-16T08:00:00.000Z",
      "updatedAt": "2026-11-16T09:00:00.000Z"
    }
  ],
  "pagination": { "page": 1, "size": 20, "total": 135 }
}
```

> 列表项字段见 §9.2。`hasPassword` 供客户端决定是否显示"眼睛"，
> **不泄漏密文**。`keyword` 同时匹配 `title` / `username` / `url` / `tags`（不区分大小写）。

**错误**：`400 VALIDATION_ERROR`（`size` 越界、`sort`/`order` 取值非法、`favorite` 非 `"true"/"false"`）、`401`

---

### 4.2 `POST /entries` — 创建条目

> **鉴权**：Bearer。

**请求体**

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `title` | string | ✓ | trim 后 1-100 字符 | 标题（明文存储） |
| `username` | string | ✗ | ≤ 200 | 账号（明文存储，需可列表展示与检索） |
| `password` | string \| null | ✗ | ≤ 500 | 明文密码，服务端加密落盘，**不回显** |
| `notes` | string | ✗ | ≤ 2000 | 备注，服务端加密落盘；传空串视为清空 |
| `categoryId` | string | ✗ | ≤ 50，须存在 | 默认 `_default` |
| `url` | string | ✗ | ≤ 500，须匹配 `^https?://.+` | 登录地址 |
| `tags` | string[] | ✗ | ≤ 10 项，每项 1-20 字符 | 标签 |
| `favorite` | boolean | ✗ | — | 默认 `false` |

> `changeNote` 仅为更新接口使用；创建时传入会被忽略。

**响应** `201`：完整详情对象（同 4.3），**不含密码明文**。
带密码创建时 `passwordVersion = 1`，否则为 `0`。

**错误**：`400 VALIDATION_ERROR`、`401`、`404 NOT_FOUND`（`categoryId` 不存在）

---

### 4.3 `GET /entries/:id` — 条目详情

> **鉴权**：Bearer。返回全部非敏感字段 + **解密后的 `notes`** + `hasPassword`，
> 仍然**不含密码明文**。

**响应** `200`

```json
{
  "data": {
    "id": "01JD8Z8G9QK3M2N7P5R6T8WXYZ",
    "categoryId": "_default",
    "title": "公司邮箱",
    "username": "me@company.com",
    "url": "https://mail.company.com",
    "notes": "备用邮箱：backup@company.com",
    "favorite": true,
    "tags": ["工作", "邮箱"],
    "hasPassword": true,
    "passwordVersion": 3,
    "createdAt": "2026-11-16T08:00:00.000Z",
    "updatedAt": "2026-11-16T09:00:00.000Z"
  }
}
```

字段说明见 §9.3。`notes` 无内容时为 `null`。

**错误**：`401`、`404 NOT_FOUND`（不存在或 `:id` 不是 ULID）

---

### 4.4 `GET /entries/:id/reveal` — 读取密码明文（敏感）

> **鉴权**：Bearer。**每次调用都写审计日志**（`ENTRY_REVEAL`，记录 IP 与条目 ID）。
> 客户端展示后应 30 秒自动掩码，并在窗口失焦/切后台时立即掩码。

**响应** `200`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 条目 ID |
| `password` | string | 密码明文 |
| `notes` | string \| null | 备注明文（顺带返回，便于展示） |
| `fetchedAt` | string | 本次读取时间 |

```json
{
  "data": {
    "id": "01JD8Z8G9QK3M2N7P5R6T8WXYZ",
    "password": "Str0ng!Pass",
    "notes": "备用邮箱",
    "fetchedAt": "2026-11-16T09:05:00.000Z"
  }
}
```

**错误**：`401 TOKEN_*`、`404 NOT_FOUND`、`409 NO_PASSWORD`（该条目没有密码）

---

### 4.5 `PUT /entries/:id` — 全量更新

> **鉴权**：Bearer。必须带 `title`；`password` 的三态语义见下。

**请求体**：字段与约束同 4.2（`title` 必填）。

**`password` 三态**

| 取值 | 语义 |
| --- | --- |
| 省略该字段 | **保持原密码不变** |
| `null` | 清空密码（原密码入历史，`passwordVersion` +1） |
| 字符串 | 设置密码（与原密码不同则原密码入历史，`passwordVersion` +1） |

> ⚠️ **实现说明**：本接口与 `PATCH` 共用同一段合并逻辑——**省略的可选字段保持原值**，
> 而非"重置为默认"。Web 端总是提交全部字段，因此表现等同全量替换；
> 其它客户端若期望真正的 replace 语义，请显式提交所有字段（含空串）。
> 这一点与"全量替换"的字面含义存在差异，已在 [设计文档](./01-开发设计文档.md) 记录为待定事项。

**响应** `200`：更新后的完整详情对象（同 4.3）。

**错误**：`400 VALIDATION_ERROR`、`401`、`404 NOT_FOUND`（条目或新 `categoryId` 不存在）

---

### 4.6 `PATCH /entries/:id` — 局部更新

> **鉴权**：Bearer。只传需修改的字段，**至少一个**。

**请求体**：4.2 中任意字段子集；额外支持 `changeNote`（≤ 100 字符，写入历史版本备注，
仅当本次密码确实变化时生效）。

**响应** `200`：更新后的完整详情对象（同 4.3）。

**错误**：`400 VALIDATION_ERROR`（空 body、`title` 传空串、字段非法）、`401`、`404`

---

### 4.7 `PATCH /entries/:id/favorite` — 切换收藏

> **鉴权**：Bearer。**可重放**：请求体指定目标状态，而不是"取反"，避免连点双写。

**请求体**

```json
{ "favorite": true }
```

**响应** `200`

```json
{ "data": { "id": "01JD8Z8G9QK3M2N7P5R6T8WXYZ", "favorite": true } }
```

**错误**：`400 VALIDATION_ERROR`（缺字段或非布尔）、`401`、`404`

---

### 4.8 `DELETE /entries/:id` — 删除条目

> **鉴权**：Bearer。同时把该条目的历史版本文件移入 `history/.trash/`，保留 7 天后自动清理。

**响应** `204`（无响应体）

**错误**：`401`、`404 NOT_FOUND`

---

### 4.9 `POST /entries/:id/restore-password` — 从历史恢复密码

> **鉴权**：Bearer。把指定历史版本设为当前密码；**恢复前会把当前密码先归档进历史**。

**请求体**

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `version` | int | ✓ | ≥ 1 |

**响应** `200`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 条目 ID |
| `restoredVersion` | number | 被恢复的历史版本号 |
| `currentVersion` | number | 恢复后的新版本号（递增，不复用旧号） |
| `updatedAt` | string | 更新时间 |

```json
{
  "data": {
    "id": "01JD8Z8G9QK3M2N7P5R6T8WXYZ",
    "restoredVersion": 3,
    "currentVersion": 5,
    "updatedAt": "2026-11-16T09:10:00.000Z"
  }
}
```

**错误**：`400 VALIDATION_ERROR`、`401`、`404 NOT_FOUND`（条目或版本不存在）

---

## 5. 密码历史 `/entries/:id/history`

### 5.1 `GET /entries/:id/history` — 历史版本列表

> **鉴权**：Bearer。**不返回**任何密码明文或密文，仅元数据。按版本号倒序。

**查询参数**

| 参数 | 类型 | 默认 | 约束 |
| --- | --- | --- | --- |
| `page` | int | 1 | ≥ 1 |
| `size` | int | 20 | 1-100 |

**响应** `200`

```json
{
  "data": [
    {
      "version": 3,
      "changedAt": "2026-11-16T09:00:00.000Z",
      "changeNote": "季度换密",
      "restorable": true
    },
    {
      "version": 2,
      "changedAt": "2026-08-01T02:00:00.000Z",
      "changeNote": null,
      "restorable": true
    }
  ],
  "pagination": { "page": 1, "size": 20, "total": 3 }
}
```

> `restorable` 目前恒为 `true`（保留给"因历史满额被裁剪的版本不可恢复"这类未来规则）。
> 历史保留条数由 `config.json` 的 `historyKeep`（默认 50）控制，超出丢弃最旧版本。

**错误**：`400`（`size` 越界）、`401`、`404 NOT_FOUND`

---

### 5.2 `GET /entries/:id/history/:version` — 读取某版本密码明文（敏感）

> **鉴权**：Bearer。写审计日志（`HISTORY_REVEAL`）。

**路径参数**

| 参数 | 类型 | 约束 |
| --- | --- | --- |
| `version` | int | 正整数 |

**响应** `200`

```json
{
  "data": {
    "version": 3,
    "password": "OldPass!2026",
    "changedAt": "2026-11-16T09:00:00.000Z"
  }
}
```

**错误**：`400 VALIDATION_ERROR`（版本号非正整数）、`401`、`404 NOT_FOUND`（条目或版本不存在）

---

## 6. 系统 `/system`

### 6.1 `GET /system/health` — 健康检查

> **鉴权**：无。供部署探活与 App 启动探测。

**响应** `200`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `status` | string | 恒为 `"ok"`（进程活着就能应答） |
| `version` | string | 应用版本，如 `1.0.0` |
| `schemaVersion` | number | 数据结构版本 |
| `initialized` | boolean | 主密码是否已初始化 |
| `dataDirWritable` | boolean | 数据目录当前是否可写（不可写则所有写操作会失败） |
| `uptimeSeconds` | number | 进程运行时长（秒） |

```json
{
  "data": {
    "status": "ok",
    "version": "1.0.0",
    "schemaVersion": 1,
    "initialized": true,
    "dataDirWritable": true,
    "uptimeSeconds": 3621
  }
}
```

---

### 6.2 `GET /system/status` — 系统状态

> **鉴权**：无。客户端据此决定跳 `/setup` 还是 `/login`。

**响应** `200`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `initialized` | boolean | 是否已初始化 |
| `lockMinutes` | number | 会话时长（分钟）= 访问令牌 TTL |
| `failedAttempts` | number | 配置的失败次数上限 |
| `failedAttemptsRemaining` | number | 距上次失败后还可再试的次数；锁定中为 `0` |
| `entryCount` | number | 条目总数（未初始化时为 0） |
| `categoryCount` | number | 分类总数（未初始化时为 0） |
| `schemaVersion` | number | 数据结构版本 |
| `lockedUntil` | string | **仅在锁定中**出现，锁定解除时间（ISO 8601） |

```json
{
  "data": {
    "initialized": true,
    "lockMinutes": 30,
    "failedAttempts": 5,
    "failedAttemptsRemaining": 5,
    "entryCount": 135,
    "categoryCount": 8,
    "schemaVersion": 1
  }
}
```

---

### 6.3 `GET /system/config` — 读取配置

> **鉴权**：Bearer。

**响应** `200`

```json
{
  "data": {
    "lockMinutes": 30,
    "failedAttempts": 5,
    "lockMinutesAfterBan": 15,
    "minPasswordLength": 10,
    "defaultCategoryId": "_default",
    "historyKeep": 50
  }
}
```

字段语义见 §9.7。

---

### 6.4 `PUT /system/config` — 更新配置

> **鉴权**：Bearer。请求体至少一项；**只接受**下列字段，其余（含 `defaultCategoryId`）被忽略。

**请求体**

| 字段 | 类型 | 约束 | 说明 |
| --- | --- | --- | --- |
| `lockMinutes` | int | 1-1440 | **会话时长 / 访问令牌 TTL（分钟）**；改动只影响之后新签发的令牌 |
| `failedAttempts` | int | 3-10 | 连续失败多少次后锁定 |
| `lockMinutesAfterBan` | int | 1-1440 | 锁定时长（分钟） |
| `minPasswordLength` | int | 10-32 | 主密码最小长度（只影响新设主密码） |
| `historyKeep` | int | 10-500 | 密码历史保留条数 |

**响应** `200`：更新后的**完整**配置对象（同 6.3）。

**错误**：`400 VALIDATION_ERROR`（越界、空 body、"没有可更新的字段"）、`401`

---

### 6.5 `GET /system/presets` — 内置分类模板与常用标签

> **鉴权**：Bearer。客户端用它做录入时的快捷选择。数据模型里标签只是条目上的自由字符串，
> 因此这里返回的是**候选值**，不是已存在的实体。

**响应** `200`

```json
{
  "data": {
    "categories": [
      { "name": "工作", "icon": "project", "sortOrder": 10 },
      { "name": "邮箱", "icon": "mail", "sortOrder": 20 }
    ],
    "tags": ["常用", "工作", "个人", "邮箱", "银行"]
  }
}
```

> `categories` 是**播种时用过的模板**，不含 `id`——实际分类请以 `GET /categories` 为准，
> 不要把它当作已存在的分类去调用 `/categories/:id`。
> `tags` 每项 ≤ 20 字符，与条目 `tags` 约束一致；客户端应允许用户自行输入其它标签。

**错误**：`401 TOKEN_*`

---

### 6.6 `GET /system/audit` — 审计日志查询

> **鉴权**：Bearer。读的是 `data/logs/audit.jsonl`，保留最近 1000 条。

**查询参数**

| 参数 | 类型 | 默认 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `page` | int | 1 | 1-100000 | 页码 |
| `size` | int | 50 | 1-200 | 每页条数 |
| `event` | string | — | ≤ 50 | 按事件码精确过滤，如 `LOGIN_OK` |

**响应** `200`

```json
{
  "data": [
    {
      "ts": "2026-11-16T09:00:00.000Z",
      "event": "LOGIN_OK",
      "ip": "127.0.0.1",
      "detail": "jti=01M7HAXV3WH7CZZMWZ0T7QY42W"
    },
    {
      "ts": "2026-11-16T08:59:31.000Z",
      "event": "LOGIN_FAIL",
      "ip": "127.0.0.1",
      "detail": "attempt=2"
    }
  ],
  "pagination": { "page": 1, "size": 50, "total": 87 }
}
```

> 结果按时间**倒序**（新在前）。`detail` 是服务端写入的 `k=v` 串，**严禁**包含密码明文；
> 事件码与 `detail` 的含义见 §7.2。

**错误**：`400 VALIDATION_ERROR`（`size` 越界、`event` 超长）、`401`

---

### 6.7 `POST /system/backup` — 触发一次数据备份

> **鉴权**：Bearer。备份到 `data/backups/<YYYYMMDD-HHmmss>/`，
> 自动排除 `backups/` 自身与进程锁文件，跳过 `*.tmp`。

**响应** `201`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `backupId` | string | 形如 `20261116-091500`（同时是目录名） |
| `label` | string | 触发方式，本端点固定为 `"manual"` |
| `path` | string | 相对仓库根的路径，如 `data/backups/20261116-091500` |
| `fileCount` | number | 归档文件数 |
| `sizeBytes` | number | 归档总字节数 |
| `createdAt` | string | 创建时间 |

**错误**：`401`、`503 SERVICE_UNAVAILABLE`（磁盘不可写/备份异常）、`507 STORAGE_FULL`（空间不足）

---

## 7. 错误码总表

### 7.1 错误码

> 通用规则：`401` 认证类；`403` 权限类；`404` 不存在；`409` 冲突；`423` 锁定；
> `429` 限速；`5xx` 服务端。`code` 一经发布**不得改变含义**，只增不改。

| HTTP | code | 含义 | 典型触发端点 |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 参数校验失败（`details` 给出字段级原因） | 所有写接口、列表查询 |
| 401 | `AUTH_INVALID_CREDENTIALS` | 主密码错误 | `POST /auth/login`、`change-master` |
| 401 | `TOKEN_MISSING` | 未携带 Bearer 令牌 / 缺少刷新令牌 Cookie | 所有需鉴权接口、`/auth/refresh` |
| 401 | `TOKEN_EXPIRED` | 访问令牌（或刷新令牌）已过期 | 所有需鉴权接口、`/auth/refresh` |
| 401 | `TOKEN_INVALID` | 签名错误、类型不符、已吊销、签发时间早于吊销线 | 同上 |
| 403 | `PROTECTED_RESOURCE` | 受保护资源（默认分类改名/删除） | `categories/:id` |
| 404 | `NOT_FOUND` | 资源不存在（含 ID 格式非法） | 所有 `:id` 端点 |
| 409 | `ALREADY_INITIALIZED` | 系统已初始化 | `POST /auth/setup` |
| 409 | `CONFLICT` | 同名分类已存在 | `POST/PUT /categories` |
| 409 | `NO_PASSWORD` | 该条目没有密码可读 | `GET /entries/:id/reveal` |
| 423 | `LOCKED_OUT` | 主密码尝试超限，账户锁定中 | `auth/*` |
| 429 | `RATE_LIMITED` | 触发限速（响应头带 `Retry-After`） | `auth/*` |
| 500 | `INTERNAL_ERROR` | 未知服务端错误 / 解密失败（密文损坏或密钥不匹配） | 所有 |
| 503 | `SERVICE_UNAVAILABLE` | 存储不可用、数据文件损坏、迁移缺失、备份失败 | 所有 |
| 507 | `STORAGE_FULL` | 磁盘空间不足 | 备份等写操作 |

**客户端处理约定**

1. `401` → 清除本地登录态。`TOKEN_EXPIRED` 先尝试 `/auth/refresh` 一次，失败再跳登录页。
2. `423` / `429` → 展示倒计时并禁用提交按钮（读 `Retry-After` 与 `details.lockedUntil`）。
3. `400` → 按 `details` 把错误回填到表单字段（`field` 为 `"_"` 时显示为整体提示）。
4. `404` → 提示"资源已不存在"并刷新列表。
5. `5xx` → 通用错误提示，**不要暴露堆栈**，可引导重试。

### 7.2 审计事件与 `detail` 格式

`detail` 是服务端写入的 `k=v` 逗号串（或裸文本），与事件码配合解读：

| 事件码 | 含义 | `detail` 示例 |
| --- | --- | --- |
| `SETUP_OK` | 初始化密码本 | `mode=dev,presets=7` |
| `LOGIN_OK` / `LOGOUT` | 解锁成功 / 手动锁定 | `jti=01M7…` |
| `LOGIN_FAIL` | 解锁失败 | `attempt=3` |
| `LOCKOUT` | 触发锁定 | `until=2026-11-16T13:20:00.000Z` |
| `MASTER_CHANGE` | 更换主密码 | `jti=…,reencrypted=0,mode=dev` |
| `CONFIG_UPDATE` | 修改系统配置 | `lockMinutes,historyKeep`（改动的字段名） |
| `CATEGORY_CREATE` / `CATEGORY_UPDATE` | 分类新增/修改 | `id=01M7…` |
| `CATEGORY_DELETE` | 删除分类 | `id=01M7…,moved=17` |
| `ENTRY_CREATE` / `ENTRY_DELETE` | 条目新增/删除 | `id=01M7…` |
| `ENTRY_UPDATE` | 条目修改 | `id=…`；收藏为 `id=…,favorite=true`；批量转移为 `transfer <源> -> <目标>,n=5` |
| `ENTRY_REVEAL` | 查看密码明文 | `id=01M7…` |
| `HISTORY_REVEAL` | 查看历史密码 | `id=01M7…,v=3` |
| `HISTORY_RESTORE` | 恢复历史密码 | `id=01M7…,from=v3` |
| `BACKUP_CREATE` | 创建备份 | `id=20261116-091500` |

> Web 端把事件码与 `detail` 翻成中文展示（映射在 `web/src/utils/audit.ts`），
> 原始机器码仍保留在标签 tooltip 中，便于与 `audit.jsonl` 对齐。

---

## 8. 客户端接入指引

### 8.1 Web（Ant Design）接入流程

```
启动 → GET /system/status
        ├─ initialized=false → 跳 /setup → POST /auth/setup → 跳 /login
        └─ initialized=true  → POST /auth/refresh（凭 Cookie 静默恢复）
                                 ├─ 成功 → 直接进入主界面
                                 └─ 失败 → 跳 /login → POST /auth/login
                                            → accessToken 存内存（不落 localStorage）
                                            → GET /categories + GET /entries 并行加载
```

- Axios 拦截器：请求自动带 `Authorization`；响应统一解包 `{ data }`，错误按第 7 章映射。
- 401 处理：`TOKEN_EXPIRED` → `POST /auth/refresh` → 重放原请求一次 → 仍失败跳登录。
- 启动恢复：应用挂载时若内存中没有访问令牌，先 `POST /auth/refresh`（携带 Cookie）尝试静默恢复；
  成功直接进主界面，失败才渲染登录页。**主动「锁定」会清除该 Cookie**，因此锁定后刷新仍须输入主密码。

### 8.2 手机 App 接入要点（预留）

1. **启动**：`GET /system/health` 探活 + `GET /system/status` 决定初始化/登录页。
2. **令牌存储**：iOS Keychain / Android Keystore 存 `accessToken`；`refreshToken` 优先用 Cookie 会话
   （或换取后同样入 Keychain，禁止明文存 `SharedPreferences`/`NSUserDefaults`）。
3. **静默恢复**：冷启动 `POST /auth/refresh`（或 `GET /auth/session` → 401 → `refresh`）→ 成功即进主界面。
4. **生物识别**：仅作**本地进入 UI 的门禁**，不等于认证；真正解锁仍需 `POST /auth/login`
   （可将主密码存 Keychain 由系统保护后自动提交，属实现细节）。
5. **弱网**：reveal 类接口加 loading 与失败重试；所有写操作失败要保留用户输入（与 Web 一致）。
6. **安全**：敏感页截图防护（`FLAG_SECURE` / `isSecureTextEntry`）、退后台自动掩码并触发
   `POST /auth/logout`（或本地锁定 + 服务端 `lockMinutes` 到期）。
7. **基线**：iOS 15+ / Android 9+，TLS 1.2+。

### 8.3 常用调用序列（联调用）

```bash
BASE=http://localhost:3100/api/v1

# 0) 探活与状态
curl -s $BASE/system/health
curl -s $BASE/system/status

# 1) 初始化（仅首次）→ 登录并保存 Cookie
curl -s -X POST $BASE/auth/setup -H 'Content-Type: application/json' \
  -d '{"masterPassword":"Your-Master-1"}'
curl -s -c jar.txt -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"masterPassword":"Your-Master-1"}'
TOKEN=$(curl -s -c jar.txt -X POST $BASE/auth/login -H 'Content-Type: application/json' \
  -d '{"masterPassword":"Your-Master-1"}' | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

# 2) 刷新（等价于页面刷新后的冷启动恢复；只靠 Cookie）
curl -s -b jar.txt -X POST $BASE/auth/refresh

# 3) 分类与列表
curl -s -H "Authorization: Bearer $TOKEN" $BASE/categories
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/entries?page=1&size=20&favorite=true&keyword=mail"

# 4) 创建（含密码与备注）
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  $BASE/entries \
  -d '{"title":"GitHub","username":"me","password":"xY9#safe","notes":"恢复码在保险箱","url":"https://github.com","tags":["开发","常用"]}'

# 5) 查看密码明文（写审计）→ 查看详情（含解密后的备注）
curl -s -H "Authorization: Bearer $TOKEN" $BASE/entries/<ID>/reveal
curl -s -H "Authorization: Bearer $TOKEN" $BASE/entries/<ID>

# 6) 改密码 → 看历史 → 恢复历史
curl -s -X PATCH -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  $BASE/entries/<ID> -d '{"password":"n3w$ecret","changeNote":"季度换密"}'
curl -s -H "Authorization: Bearer $TOKEN" $BASE/entries/<ID>/history
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  $BASE/entries/<ID>/restore-password -d '{"version":1}'

# 7) 系统侧
curl -s -H "Authorization: Bearer $TOKEN" $BASE/system/config
curl -s -H "Authorization: Bearer $TOKEN" $BASE/system/presets
curl -s -H "Authorization: Bearer $TOKEN" "$BASE/system/audit?size=50&event=LOGIN_OK"
curl -s -X POST -H "Authorization: Bearer $TOKEN" $BASE/system/backup

# 8) 锁定（吊销当前令牌并清除刷新 Cookie）
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H "Authorization: Bearer $TOKEN" $BASE/auth/logout
```

---

## 9. 数据字典

### 9.1 Category（分类）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | ULID；默认分类为 `_default` |
| `name` | string | 1-50 字符，全局唯一（同名创建返回 409） |
| `icon` | string | Ant Design 图标名约定，默认 `folder` |
| `sortOrder` | number | 排序值，小者在前；默认分类为 0，内置分类 10/20/…/70 |
| `protected` | boolean | `true` 时禁止删除、禁止改名（仅默认分类） |
| `entryCount` | number | 该分类下条目数（服务端聚合） |
| `createdAt` / `updatedAt` | string | ISO 8601 |

### 9.2 EntryListItem（条目摘要）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | ULID |
| `categoryId` | string | 所属分类 |
| `title` | string | 标题（明文） |
| `username` | string | 账号，无值时为空串 |
| `url` | string | 登录地址，无值时为空串 |
| `hasPassword` | boolean | 是否设置了密码（**不泄漏密文**） |
| `favorite` | boolean | 是否收藏 |
| `tags` | string[] | 标签 |
| `createdAt` / `updatedAt` | string | ISO 8601 |

> **不含** `notes`、`passwordVersion`、任何密文。

### 9.3 EntryDetail（条目详情）

在 9.2 基础上增加：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `notes` | string \| null | **解密后的备注**，无内容为 `null` |
| `passwordVersion` | number | 当前密码版本号；从未设置过密码为 `0`，首次设置后为 `1` |

> 仍**不含**密码明文；取明文请用 `reveal`。

### 9.4 RevealedPassword（密码明文）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 条目 ID |
| `password` | string | 密码明文 |
| `notes` | string \| null | 备注明文 |
| `fetchedAt` | string | 读取时间 |

### 9.5 HistoryVersion（历史版本摘要）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `version` | number | 版本号（单调递增） |
| `changedAt` | string | 该版本被归档的时间 |
| `changeNote` | string \| null | 变更备注（更新时通过 `changeNote` 传入） |
| `restorable` | boolean | 是否可恢复（当前恒为 `true`） |

### 9.6 SystemStatus / SystemHealth

见 §6.2 与 §6.1 的响应字段表。

### 9.7 SystemConfig（系统配置）

| 字段 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `lockMinutes` | number | 30 | 会话时长（分钟）= 访问令牌 TTL |
| `failedAttempts` | number | 5 | 连续失败多少次后锁定 |
| `lockMinutesAfterBan` | number | 15 | 锁定时长（分钟） |
| `minPasswordLength` | number | 10 | 主密码最小长度（只影响新设主密码） |
| `defaultCategoryId` | string | `_default` | 默认分类 ID（**只读**，不可通过 API 修改） |
| `historyKeep` | number | 50 | 密码历史保留条数 |

### 9.8 Presets（内置预设）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `categories` | `{ name, icon, sortOrder }[]` | 内置分类**模板**，无 `id` |
| `tags` | string[] | 常用标签候选，每项 ≤ 20 字符 |

### 9.9 AuditItem（审计记录）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `ts` | string | 事件时间（ISO 8601） |
| `event` | string | 事件码，见 §7.2 |
| `ip` | string \| null | 来源 IP；回环地址为 `127.0.0.1` |
| `detail` | string \| null | 事件细节（`k=v` 串），永不含密码明文 |

### 9.10 BackupResult（备份结果）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `backupId` | string | `YYYYMMDD-HHmmss` |
| `label` | string | 触发方式（`manual`） |
| `path` | string | 相对仓库根的备份路径 |
| `fileCount` | number | 文件数 |
| `sizeBytes` | number | 总字节数 |
| `createdAt` | string | 创建时间 |

### 9.11 Pagination（分页对象）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `page` | number | 当前页（从 1 开始） |
| `size` | number | 每页条数 |
| `total` | number | 符合条件的总条数 |

---

## 10. 端点总览（速查表）

| # | 方法 | 路径 | 鉴权 | 限速 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | POST | `/api/v1/auth/setup` | ✗ | ✓ | 初始化主密码（同时写入内置分类） |
| 2 | POST | `/api/v1/auth/login` | ✗ | ✓ | 登录（下发刷新 Cookie） |
| 3 | POST | `/api/v1/auth/refresh` | Cookie | ✗ | 刷新令牌（也用于冷启动恢复） |
| 4 | GET | `/api/v1/auth/session` | ✓ | ✗ | 会话校验 |
| 5 | POST | `/api/v1/auth/logout` | ✓ | ✗ | 退出/锁定（清 Cookie） |
| 6 | POST | `/api/v1/auth/change-master` | ✓ | ✓ | 更换主密码 |
| 7 | GET | `/api/v1/categories` | ✓ | ✗ | 分类列表（含条目数） |
| 8 | POST | `/api/v1/categories` | ✓ | ✗ | 创建分类 |
| 9 | GET | `/api/v1/categories/:id` | ✓ | ✗ | 分类详情 |
| 10 | PUT | `/api/v1/categories/:id` | ✓ | ✗ | 更新分类 |
| 11 | DELETE | `/api/v1/categories/:id` | ✓ | ✗ | 删除分类（条目迁移） |
| 12 | POST | `/api/v1/categories/:id/transfer` | ✓ | ✗ | 批量转移条目 |
| 13 | GET | `/api/v1/entries` | ✓ | ✗ | 列表/搜索/分页 |
| 14 | POST | `/api/v1/entries` | ✓ | ✗ | 创建条目 |
| 15 | GET | `/api/v1/entries/:id` | ✓ | ✗ | 条目详情（含解密备注） |
| 16 | GET | `/api/v1/entries/:id/reveal` | ✓ | ✗ | 读密码明文（写审计） |
| 17 | PUT | `/api/v1/entries/:id` | ✓ | ✗ | 更新（title 必填） |
| 18 | PATCH | `/api/v1/entries/:id` | ✓ | ✗ | 局部更新 |
| 19 | PATCH | `/api/v1/entries/:id/favorite` | ✓ | ✗ | 收藏状态设置 |
| 20 | DELETE | `/api/v1/entries/:id` | ✓ | ✗ | 删除条目 |
| 21 | POST | `/api/v1/entries/:id/restore-password` | ✓ | ✗ | 恢复历史密码 |
| 22 | GET | `/api/v1/entries/:id/history` | ✓ | ✗ | 历史列表 |
| 23 | GET | `/api/v1/entries/:id/history/:version` | ✓ | ✗ | 读历史明文（写审计） |
| 24 | GET | `/api/v1/system/health` | ✗ | ✗ | 健康检查 |
| 25 | GET | `/api/v1/system/status` | ✗ | ✗ | 初始化/锁定状态 |
| 26 | GET | `/api/v1/system/config` | ✓ | ✗ | 读配置 |
| 27 | PUT | `/api/v1/system/config` | ✓ | ✗ | 写配置 |
| 28 | GET | `/api/v1/system/presets` | ✓ | ✗ | 内置分类模板与常用标签 |
| 29 | GET | `/api/v1/system/audit` | ✓ | ✗ | 审计日志 |
| 30 | POST | `/api/v1/system/backup` | ✓ | ✗ | 触发备份 |

---

## 11. 版本与兼容策略

1. **加字段**：非破坏性，随时可加；客户端**必须忽略未知字段**，不得因多余字段报错。
2. **删字段 / 改语义 / 改必填性**：破坏性变更 → 新开 `/api/v2`，
   `/api/v1` 至少保留一个大版本周期并公告废弃时间。
3. **错误码**：只增不改含义；废弃码在本文档标注 ~~删除线~~ 并保留说明。
4. **端点废弃**：文档标注 `DEPRECATED` + 替代端点 + 移除版本，
   响应头附 `Deprecation: true`、`Sunset: <HTTP 日期>`。
5. 本文档每次变更须提升头部"文档版本"并追加修订记录。

---

## 12. 修订记录

| 版本 | 日期 | 修订内容 | 作者 |
| --- | --- | --- | --- |
| v1.0 | 2026-11-16 | 首次发布：29 个端点、信封规范、错误码总表、多端接入指引 | — |
| v1.1 | 2026-11-16 | 实现校对，无破坏性变更：① §1.3/§2.2/§6.4 明确 `lockMinutes` 即访问令牌的实际 TTL（`expiresIn = lockMinutes × 60`），改配置只影响新签发的令牌；② §4.4 修正 `reveal` 的错误码——无密码应为 `409 NO_PASSWORD`（原写 `CONFLICT`），并删除实现中并不存在的 `423 LOCKED_OUT`；③ §6.2 补上实现已返回但文档缺失的 `failedAttempts` 字段；④ 补充 `Secure` Cookie 仅 HTTPS 下发的说明 | — |
| v1.2 | 2026-11-16 | 新增端点，无破坏性变更：① 新增 §6.7 `GET /system/presets`（内置分类模板与常用标签候选），端点总数 29 → 30；② §2.1 补充说明初始化会写入内置分类，`GET /categories` 的初始内容因此从 1 个变为 8 个 | — |
| v2.0 | 2026-11-16 | **全文重写，端点与行为均无变化**：① 每个端点补齐「鉴权、限速、请求参数表、响应字段表、示例、错误」六要素；② 新增 §9 数据字典（11 个对象逐字段说明），统一由 §1.5 声明类型约定（时间/ID/布尔/可空/密文）；③ 新增 §1.6 限速与锁定总表、§1.7 CORS 与安全响应头、§7.2 审计事件与 `detail` 格式对照表；④ §4.5 明确 `PUT` 与 `PATCH` 共用合并逻辑（省略字段保持原值）而非字面意义的全量替换，并标注为待定事项；⑤ §1.3 与 §8.1 补充「页面刷新用 `/auth/refresh` 冷启动恢复会话」以及「锁定会清 Cookie」的语义 | — |
