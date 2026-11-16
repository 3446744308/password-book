# 密码本系统 · API 接口文档

| 项目 | 内容 |
| --- | --- |
| 文档版本 | v1.1 |
| 编写日期 | 2026-11-16 |
| API 版本 | `v1`（Base URL：`/api/v1`） |
| 面向对象 | Web 前端（Ant Design）、未来手机 App、其他任何客户端 |
| 权威性 | **唯一权威接口源**，任何端点变更必须同步更新本文档 |

---

## 1. 通用说明

### 1.1 协议与基础约定

| 项 | 约定 |
| --- | --- |
| 协议 | HTTP/1.1，生产环境必须 HTTPS（`wss` 不涉及，V1.0 无 WebSocket） |
| 基础路径 | `http(s)://<host>:<port>/api/v1` |
| 编码 | UTF-8 |
| 请求头 | `Content-Type: application/json; charset=utf-8`（GET/DELETE 无 body） |
| 认证头 | `Authorization: Bearer <accessToken>` |
| 时间格式 | ISO 8601 UTC 字符串：`2026-11-16T09:00:00.000Z` |
| ID 格式 | ULID 字符串（26 位大写字母数字），特殊分类 ID 为 `_default` |
| 幂等性 | GET/PUT/DELETE 天然幂等；POST 动作端点如标注"可重放"则同样幂等 |

**开发期地址**：Web `http://localhost:5173`（Vite 代理 `/api` → `http://localhost:3100`）。

### 1.2 通用请求示例

```bash
curl -X POST http://localhost:3100/api/v1/entries \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <accessToken>" \
  -d '{
    "title": "公司邮箱",
    "username": "me@company.com",
    "password": "Str0ng!Pass",
    "categoryId": "_default",
    "url": "https://mail.company.com",
    "tags": ["工作", "邮箱"],
    "favorite": true
  }'
```

### 1.2.1 响应信封（强制）

**成功（2xx）**

```json
{ "data": { "id": "01JD8Z8G9QK3M2N7P5R6T8WXYZ", "title": "公司邮箱" } }
```

集合 + 分页：

```json
{
  "data": [ { "id": "..." } ],
  "pagination": { "page": 1, "size": 20, "total": 135 }
}
```

**错误（4xx/5xx）**

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "参数校验失败",
    "details": [ { "field": "title", "message": "标题不能为空" } ]
  }
}
```

> `details` 仅 `VALIDATION_ERROR` 时出现。客户端逻辑只应判断 `code` 与 HTTP 状态码。

### 1.3 鉴权模型

1. `POST /auth/setup` 初始化主密码（仅当系统未初始化）。
2. `POST /auth/login` 提交主密码，换取 `accessToken`（JWT，默认 30 分钟）+ `refreshToken`（HttpOnly Cookie，7 天）。
3. 后续请求携带 `Authorization: Bearer <accessToken>`。
4. 过期 → `401 TOKEN_EXPIRED` → 调 `POST /auth/refresh` 静默换新（App 亦然）。
5. 会话时长由服务端 `config.json` 的 **`lockMinutes`** 决定，它**就是访问令牌的实际 TTL**
   （`expiresIn = lockMinutes × 60`，登录与刷新共用同一取值）。修改 `lockMinutes` 只影响
   **之后新签发**的令牌，已签发的令牌按原 TTL 自然过期。
6. 失败 5 次 → `423 LOCKED_OUT`，冷却 15 分钟（配置可调）。

### 1.4 分页、排序、筛选（通用查询参数）

| 参数 | 类型 | 默认 | 说明 |
| --- | --- | --- | --- |
| `page` | int ≥1 | 1 | 页码 |
| `size` | int 1-100 | 20 | 每页条数 |
| `sort` | string | `updatedAt` | 排序字段：`updatedAt` \| `createdAt` \| `title` |
| `order` | string | `desc` | `asc` \| `desc` |
| `keyword` | string ≤100 | — | 关键词，匹配标题/用户名/URL/标签 |
| `categoryId` | string | — | 按分类过滤（entries 列表专用） |
| `favorite` | boolean | — | 只看收藏 |
| `tag` | string | — | 按标签过滤 |

### 1.5 CORS（供 App/Web 配置参考）

- 允许来源：配置白名单（开发期 `http://localhost:5173`）。
- 允许头：`Content-Type, Authorization`。
- 允许方法：`GET, POST, PUT, PATCH, DELETE, OPTIONS`。
- 预检缓存：`Access-Control-Max-Age: 600`。

---

## 2. 认证与会话 `/auth`

### 2.1 `POST /auth/setup` — 初始化主密码

> **鉴权**：无。仅当 `data/` 未初始化时可用；已初始化返回 `409 ALREADY_INITIALIZED`。

**请求体**

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `masterPassword` | string | ✓ | 长度 ≥ 10，需含字母+数字（服务端校验） |

**响应** `201`

```json
{ "data": { "initialized": true, "defaultCategoryId": "_default" } }
```

**错误**：`400 VALIDATION_ERROR`、`409 ALREADY_INITIALIZED`

---

### 2.2 `POST /auth/login` — 主密码登录/解锁

> **鉴权**：无。**限速**：5 次 / 5 分钟 / IP；触发锁定返回 423。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `masterPassword` | string | ✓ | 主密码明文（**必须 HTTPS 传输**） |

**响应** `200`

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

同时下发 Cookie：

```
Set-Cookie: refreshToken=<...>; HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth; Max-Age=604800
```

> `expiresIn` 的单位是**秒**，取值等于 `config.json` 的 `lockMinutes × 60`（默认 30 分钟 → 1800）。
> `Secure` 仅在 HTTPS 连接上附加，开发期 `http://localhost` 下不带，否则浏览器会丢弃该 Cookie。

**错误**

| 状态 | code | 说明 |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 主密码为空 |
| 401 | `AUTH_INVALID_CREDENTIALS` | 主密码错误 |
| 423 | `LOCKED_OUT` | 失败超限锁定中 |
| 429 | `RATE_LIMITED` | 触发限速（带 `Retry-After`） |

---

### 2.3 `POST /auth/refresh` — 刷新访问令牌

> **鉴权**：无（凭 `refreshToken` Cookie）。

**响应** `200`：结构同 2.2（新 accessToken，expiresIn 不变）。

**错误**：`401 TOKEN_EXPIRED`（refreshToken 也过期 → 需重新登录）

---

### 2.4 `GET /auth/session` — 会话校验（App 静默启动用）

> **鉴权**：Bearer。

**响应** `200`

```json
{
  "data": {
    "authenticated": true,
    "expiresAt": "2026-11-16T09:30:00.000Z",
    "lockMinutes": 30
  }
}
```

**错误**：`401 TOKEN_MISSING`、`401 TOKEN_EXPIRED`

---

### 2.5 `POST /auth/logout` — 退出/锁定

> **鉴权**：Bearer。立即吊销当前 Token（服务端黑名单 `jti`），并清除 refreshToken Cookie。

**响应** `204`（无响应体）

---

### 2.6 `POST /auth/change-master` — 更换主密码

> **鉴权**：Bearer。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `currentPassword` | string | ✓ | 旧主密码（再次校验） |
| `newPassword` | string | ✓ | ≥10，字母+数字 |

**响应** `200`

```json
{ "data": { "changed": true, "reencryptedEntries": 135, "reloginRequired": true } }
```

> dev 模式：仅重封装 DEK，`reencryptedEntries = 0`；strict 模式：全量重加密。更换后**所有已签发 Token 失效**，需重新登录。

**错误**：`401 AUTH_INVALID_CREDENTIALS`（旧密码错）、`400 VALIDATION_ERROR`

---

## 3. 分类 `/categories`

### 3.1 `GET /categories` — 获取全部分类

> **鉴权**：Bearer。数量少，不分页。

**响应** `200`

```json
{
  "data": [
    {
      "id": "_default",
      "name": "默认分类",
      "icon": "folder",
      "sortOrder": 0,
      "entryCount": 42,
      "protected": true,
      "createdAt": "2026-11-16T08:00:00.000Z",
      "updatedAt": "2026-11-16T08:00:00.000Z"
    },
    {
      "id": "01JD8Z8G9QK3M2N7P5R6T8WXYZ",
      "name": "工作",
      "icon": "bank",
      "sortOrder": 1,
      "entryCount": 17,
      "protected": false,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ]
}
```

> `entryCount` 由服务端聚合；`protected: true` 的分类禁止删除/改名。

---

### 3.2 `POST /categories` — 创建分类

> **鉴权**：Bearer。

**请求体**

| 字段 | 类型 | 必填 | 约束 |
| --- | --- | --- | --- |
| `name` | string | ✓ | 1-50 字符 |
| `icon` | string | ✗ | 默认 `"folder"` |
| `sortOrder` | int | ✗ | 默认 999 |

**响应** `201`：返回新分类对象（同 3.1 结构）。

**错误**：`400 VALIDATION_ERROR`、`409 CONFLICT`（同名分类已存在）

---

### 3.3 `GET /categories/:id` — 分类详情

> **鉴权**：Bearer。

**响应** `200`：分类对象（含 `entryCount`）。

**错误**：`404 NOT_FOUND`

---

### 3.4 `PUT /categories/:id` — 更新分类

> **鉴权**：Bearer。`_default` 分类仅允许改 `icon`、`sortOrder`，改 `name` 返回 `403 PROTECTED_RESOURCE`。

**请求体**（全部可选，至少一项）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 1-50 |
| `icon` | string | 图标名 |
| `sortOrder` | int | 排序值 |

**响应** `200`：更新后分类对象。

**错误**：`400`、`403 PROTECTED_RESOURCE`、`404`、`409`（重名）

---

### 3.5 `DELETE /categories/:id` — 删除分类

> **鉴权**：Bearer。`_default` 不可删除。**条目不级联删除**：先将该分类下所有条目迁移至 `_default`，再删除分类。

**响应** `200`

```json
{ "data": { "deleted": true, "movedEntries": 17 } }
```

**错误**：`403 PROTECTED_RESOURCE`（删除默认分类）、`404`

---

### 3.6 `POST /categories/:id/transfer` — 批量转移条目

> **鉴权**：Bearer。将若干条目从当前分类移动到目标分类（App 的"多选移动"用）。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `targetCategoryId` | string | ✓ | 目标分类 |
| `entryIds` | string[] | ✓ | 1-500 个条目 ID |

**响应** `200`

```json
{ "data": { "transferred": 5, "targetCategoryId": "01JD..." } }
```

**错误**：`400`、`404 NOT_FOUND`（分类或条目不存在，`details` 注明哪个）

---

## 4. 条目 `/entries`

> 列表接口**不返回** `passwordEnc` 密文，也不返回明文；查看密码必须走 reveal 端点。

### 4.1 `GET /entries` — 条目列表（搜索/筛选/分页）

> **鉴权**：Bearer。

**查询参数**：见 1.4（`page/size/sort/order/keyword/categoryId/favorite/tag`）。

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

> `hasPassword: boolean` 供前端决定是否显示"眼睛"图标，**不泄漏密文**。

**错误**：`400 VALIDATION_ERROR`（size 超限、keyword 超长）

---

### 4.2 `POST /entries` — 创建条目

> **鉴权**：Bearer。

**请求体**

| 字段 | 类型 | 必填 | 约束 | 说明 |
| --- | --- | --- | --- | --- |
| `title` | string | ✓ | 1-100 | 标题 |
| `username` | string | ✗ | ≤200 | 账号 |
| `password` | string | ✗ | ≤500 | 明文密码，服务端加密落盘，**不回显** |
| `notes` | string | ✗ | ≤2000 | 备注明文（可选加密，配置开启） |
| `categoryId` | string | ✗ | 默认 `_default` | 分类须存在 |
| `url` | string | ✗ | ≤500，须 `http/https` | 登录地址 |
| `tags` | string[] | ✗ | ≤10 项，每项 ≤20 | 标签 |
| `favorite` | boolean | ✗ | 默认 false | 收藏 |

**响应** `201`：返回对象同 4.1（不含密码明文，`hasPassword` 按实际值）。

**错误**：`400 VALIDATION_ERROR`、`404 NOT_FOUND`（categoryId 不存在）

---

### 4.3 `GET /entries/:id` — 条目详情

> **鉴权**：Bearer。返回全部非敏感字段 + `notes`（服务端解密返回，便于编辑）+ `hasPassword`，仍不含密码明文。

**响应** `200`：条目对象。

**错误**：`404 NOT_FOUND`

---

### 4.4 `GET /entries/:id/reveal` — 读取密码明文（敏感）

> **鉴权**：Bearer。**每次调用写审计日志**（`ENTRY_REVEAL`）。客户端展示后应 30 秒自动掩码。

**响应** `200`

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

**错误**：`404 NOT_FOUND`、`409 NO_PASSWORD`（该条目无密码）、`401 TOKEN_EXPIRED` / `TOKEN_INVALID`（会话失效需重新登录）

---

### 4.5 `PUT /entries/:id` — 全量更新

> **鉴权**：Bearer。字段语义同 4.2，全部必填项同创建；`password` 省略则**保持原密码不变**，传 `null` 表示清空密码。

**响应** `200`：更新后对象（同 4.1 结构）。

**错误**：`400`、`404`

---

### 4.6 `PATCH /entries/:id` — 局部更新

> **鉴权**：Bearer。只传需修改的字段，常用于改标题/URL/备注。

**请求体**：4.2 中任意字段子集（至少一个）。

**响应** `200`：更新后对象。

**错误**：`400`、`404`

---

### 4.7 `PATCH /entries/:id/favorite` — 切换收藏（App 常用动作）

> **鉴权**：Bearer。可重放：请求体指定目标状态，避免连点双写。

**请求体**

```json
{ "favorite": true }
```

**响应** `200`

```json
{ "data": { "id": "01JD...", "favorite": true } }
```

---

### 4.8 `DELETE /entries/:id` — 删除条目

> **鉴权**：Bearer。同时将该条目的历史版本文件移入 `history/.trash/`（保留 7 天后清理）。

**响应** `204`（无响应体）

**错误**：`404 NOT_FOUND`

---

### 4.9 `POST /entries/:id/restore-password` — 从历史恢复密码

> **鉴权**：Bearer。将指定历史版本的密码恢复为当前密码（当前密码自动入历史）。

**请求体**

| 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- |
| `version` | int | ✓ | 历史版本号 |

**响应** `200`

```json
{ "data": { "id": "01JD...", "restoredVersion": 3, "currentVersion": 5, "updatedAt": "..." } }
```

**错误**：`404`（条目或版本不存在）、`400 VALIDATION_ERROR`

---

## 5. 历史版本 `/entries/:id/history`

### 5.1 `GET /entries/:id/history` — 密码历史列表

> **鉴权**：Bearer。**不返回**任何密码明文/密文，仅元数据。

**响应** `200`

```json
{
  "data": [
    { "version": 3, "changedAt": "2026-11-16T09:00:00.000Z", "changeNote": "季度换密", "restorable": true },
    { "version": 2, "changedAt": "2026-08-01T02:00:00.000Z", "changeNote": null, "restorable": true }
  ],
  "pagination": { "page": 1, "size": 20, "total": 3 }
}
```

**错误**：`404 NOT_FOUND`

---

### 5.2 `GET /entries/:id/history/:version` — 读取某版本密码明文（敏感）

> **鉴权**：Bearer。写审计日志（`HISTORY_REVEAL`）。

**响应** `200`

```json
{ "data": { "version": 3, "password": "OldPass!2026", "changedAt": "2026-11-16T09:00:00.000Z" } }
```

**错误**：`404 NOT_FOUND`（条目或版本不存在）

---

## 6. 系统 `/system`

### 6.1 `GET /system/health` — 健康检查

> **鉴权**：无。供部署探活与 App 启动探测。

**响应** `200`

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

### 6.2 `GET /system/status` — 系统状态（是否需初始化/锁定信息）

> **鉴权**：无。App/Web 据此决定跳转 `/setup` 还是 `/login`。

**响应** `200`

```json
{
  "data": {
    "initialized": true,
    "lockMinutes": 30,
    "failedAttempts": 5,
    "failedAttemptsRemaining": 5,
    "entryCount": 135,
    "categoryCount": 5,
    "schemaVersion": 1
  }
}
```

> `lockMinutes` 即会话时长，也是访问令牌的实际 TTL（分钟）；`failedAttempts` 是配置的失败次数上限，
> `failedAttemptsRemaining` 是距上次失败后还可再试的次数。锁定中时 `failedAttemptsRemaining` 为 `0`
> 且额外带 `lockedUntil`。

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

---

### 6.4 `PUT /system/config` — 更新配置

> **鉴权**：Bearer。

**请求体**：6.3 中任意字段子集。

| 字段 | 类型 | 约束 |
| --- | --- | --- |
| `lockMinutes` | int | 1-1440，**会话时长 / 访问令牌 TTL（分钟）**，改动只影响之后新签发的令牌 |
| `failedAttempts` | int | 3-10 |
| `lockMinutesAfterBan` | int | 1-1440 |
| `minPasswordLength` | int | 10-32 |
| `historyKeep` | int | 10-500 |

**响应** `200`：更新后完整配置对象。

**错误**：`400 VALIDATION_ERROR`

---

### 6.5 `GET /system/audit` — 审计日志查询

> **鉴权**：Bearer。

**查询参数**：`page`（默认 1）、`size`（默认 50，最大 200）、`event`（如 `LOGIN_FAIL` 过滤）。

**响应** `200`

```json
{
  "data": [
    { "ts": "2026-11-16T09:00:00.000Z", "event": "LOGIN_OK", "ip": "127.0.0.1", "detail": "session=jti_xxx" },
    { "ts": "2026-11-16T08:59:31.000Z", "event": "LOGIN_FAIL", "ip": "127.0.0.1", "detail": "attempt=2" }
  ],
  "pagination": { "page": 1, "size": 50, "total": 87 }
}
```

> `detail` 中**严禁**出现密码明文（服务端已脱敏）。

---

### 6.6 `POST /system/backup` — 触发一次数据备份

> **鉴权**：Bearer。备份到 `data/backups/<时间戳>/`，返回备份元信息。

**响应** `201`

```json
{
  "data": {
    "backupId": "20261116-091500",
    "path": "data/backups/20261116-091500",
    "fileCount": 9,
    "sizeBytes": 48213,
    "createdAt": "2026-11-16T09:15:00.000Z"
  }
}
```

**错误**：`503 SERVICE_UNAVAILABLE`（磁盘不可写）

---

## 7. 错误码总表

> 通用规则：`401` Token 缺失/失效类；`403` 权限类；`404` 不存在；`409` 冲突；`423` 锁定；`429` 限速；`5xx` 服务端。

| HTTP | code | 含义 | 触发端点 |
| --- | --- | --- | --- |
| 400 | `VALIDATION_ERROR` | 参数校验失败（`details` 给出字段级原因） | 所有写接口 |
| 401 | `AUTH_INVALID_CREDENTIALS` | 主密码错误 | `POST /auth/login`、`change-master` |
| 401 | `TOKEN_MISSING` | 未携带 Authorization | 所有需鉴权接口 |
| 401 | `TOKEN_EXPIRED` | 访问令牌过期 | 所有需鉴权接口 |
| 401 | `TOKEN_INVALID` | 令牌签名错误/被吊销 | 所有需鉴权接口 |
| 403 | `PROTECTED_RESOURCE` | 资源受保护（如删除默认分类） | `categories/:id` |
| 404 | `NOT_FOUND` | 资源不存在 | `:id` 类端点 |
| 409 | `ALREADY_INITIALIZED` | 系统已初始化 | `POST /auth/setup` |
| 409 | `CONFLICT` | 同名分类已存在 / 版本冲突 | `categories`、`entries` |
| 409 | `NO_PASSWORD` | 该条目无密码可读 | `reveal` |
| 423 | `LOCKED_OUT` | 主密码尝试超限，账户锁定中 | `auth/*`、敏感读取 |
| 429 | `RATE_LIMITED` | 触发限速（响应头 `Retry-After`） | `auth/login` 等 |
| 500 | `INTERNAL_ERROR` | 未知服务端错误 | 所有 |
| 503 | `SERVICE_UNAVAILABLE` | 存储不可写 / 迁移中 / 单实例锁冲突 | 所有 |
| 507 | `STORAGE_FULL` | 磁盘空间不足 | 所有写接口 |

**客户端处理约定**：

1. `401` → 清除本地态，跳转登录/解锁页（`TOKEN_EXPIRED` 先尝试 `refresh` 一次，失败再跳）。
2. `423/429` → 展示倒计时，禁用登录按钮。
3. `400` → 表单字段级红字（读 `details`）。
4. `404` → 列表项消失并提示"资源已不存在"，刷新列表。
5. 其他 → 通用错误提示（读 `message`），不暴露堆栈。

---

## 8. 客户端接入指引

### 8.1 Web（Ant Design）接入流程

```
启动 → GET /system/status
        ├─ initialized=false → 跳 /setup → POST /auth/setup → 跳 /login
        └─ initialized=true  → 跳 /login → POST /auth/login
                                  → 存 accessToken（内存优先）
                                  → GET /categories + GET /entries 并行加载
```

- Axios 拦截器：请求自动带 `Authorization`；响应统一解包 `{ data }`，错误按第 7 章映射。
- 401 处理：`TOKEN_EXPIRED` → `POST /auth/refresh` → 重放原请求一次 → 仍失败跳登录。

### 8.2 手机 App 接入要点（预留）

1. **启动**：`GET /system/health` 探活 + `GET /system/status` 决定初始化/登录页。
2. **令牌存储**：iOS Keychain / Android Keystore 存 `accessToken`；`refreshToken` 仅用 Cookie 会话（或换取后同样入 Keychain，禁用明文 SharedPreferences/NSUserDefaults）。
3. **静默恢复**：冷启动 `GET /auth/session`，401 → `POST /auth/refresh` → 成功即进入主界面。
4. **生物识别**：仅作**本地进入 UI 的门禁**，不等于认证；真正解锁仍需 `POST /auth/login`（可将主密码入 Keychain 由系统保护后自动提交，属实现细节）。
5. **弱网**：reveal 类接口加 loading 与失败重试；所有写操作失败保留用户输入（与 Web 一致）。
6. **安全**：App 侧截图防护（敏感页 `FLAG_SECURE` / `isSecureTextEntry`）、退后台自动掩码并触发 `POST /auth/logout`（或本地锁定 + 服务端 lockMinutes 到期）。
7. **基线**：iOS 15+ / Android 9+，TLS1.2+。

### 8.3 常用调用序列（联调用）

```bash
# 0. 状态
curl http://localhost:3100/api/v1/system/status

# 1. 登录（保存 Cookie 与 token）
curl -c jar.txt -X POST http://localhost:3100/api/v1/auth/login \
  -H "Content-Type: application/json" -d '{"masterPassword":"your-master-pw"}'

# 2. 分类 + 列表
curl -H "Authorization: Bearer $TOKEN" http://localhost:3100/api/v1/categories
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3100/api/v1/entries?page=1&size=20&favorite=true"

# 3. 创建
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:3100/api/v1/entries \
  -d '{"title":"GitHub","username":"me","password":"xY9#safe","url":"https://github.com"}'

# 4. 查看密码（审计）→ 复制 → 30s 后前端掩码
curl -H "Authorization: Bearer $TOKEN" http://localhost:3100/api/v1/entries/01JD.../reveal

# 5. 换密 + 看历史
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:3100/api/v1/entries/01JD... -d '{"password":"n3w$ecret"}'
curl -H "Authorization: Bearer $TOKEN" http://localhost:3100/api/v1/entries/01JD.../history
```

---

## 9. 端点总览（速查表）

| # | 方法 | 路径 | 鉴权 | 说明 |
| --- | --- | --- | --- | --- |
| 1 | POST | `/api/v1/auth/setup` | ✗ | 初始化主密码 |
| 2 | POST | `/api/v1/auth/login` | ✗ | 登录（限速） |
| 3 | POST | `/api/v1/auth/refresh` | Cookie | 刷新 Token |
| 4 | GET | `/api/v1/auth/session` | ✓ | 会话校验 |
| 5 | POST | `/api/v1/auth/logout` | ✓ | 退出/吊销 |
| 6 | POST | `/api/v1/auth/change-master` | ✓ | 更换主密码 |
| 7 | GET | `/api/v1/categories` | ✓ | 分类列表 |
| 8 | POST | `/api/v1/categories` | ✓ | 创建分类 |
| 9 | GET | `/api/v1/categories/:id` | ✓ | 分类详情 |
| 10 | PUT | `/api/v1/categories/:id` | ✓ | 更新分类 |
| 11 | DELETE | `/api/v1/categories/:id` | ✓ | 删除（条目迁移） |
| 12 | POST | `/api/v1/categories/:id/transfer` | ✓ | 批量转移条目 |
| 13 | GET | `/api/v1/entries` | ✓ | 列表/搜索/分页 |
| 14 | POST | `/api/v1/entries` | ✓ | 创建条目 |
| 15 | GET | `/api/v1/entries/:id` | ✓ | 条目详情 |
| 16 | GET | `/api/v1/entries/:id/reveal` | ✓ | 读密码明文（审计） |
| 17 | PUT | `/api/v1/entries/:id` | ✓ | 全量更新 |
| 18 | PATCH | `/api/v1/entries/:id` | ✓ | 局部更新 |
| 19 | PATCH | `/api/v1/entries/:id/favorite` | ✓ | 收藏切换 |
| 20 | DELETE | `/api/v1/entries/:id` | ✓ | 删除条目 |
| 21 | POST | `/api/v1/entries/:id/restore-password` | ✓ | 恢复历史密码 |
| 22 | GET | `/api/v1/entries/:id/history` | ✓ | 历史列表 |
| 23 | GET | `/api/v1/entries/:id/history/:version` | ✓ | 读版本明文（审计） |
| 24 | GET | `/api/v1/system/health` | ✗ | 健康检查 |
| 25 | GET | `/api/v1/system/status` | ✗ | 初始化/锁定状态 |
| 26 | GET | `/api/v1/system/config` | ✓ | 读配置 |
| 27 | PUT | `/api/v1/system/config` | ✓ | 写配置 |
| 28 | GET | `/api/v1/system/audit` | ✓ | 审计日志 |
| 29 | POST | `/api/v1/system/backup` | ✓ | 触发备份 |

---

## 10. 版本与兼容策略

1. **加字段**：非破坏性，随时可加；客户端**必须忽略未知字段**，不得因多余字段报错。
2. **删字段/改语义/改必填性**：破坏性变更 → 新开 `/api/v2`，`/api/v1` 至少保留一个大版本周期并公告废弃时间。
3. **错误码**：只增不改含义；废弃码在本文档标注 ~~删除线~~ 并保留说明。
4. **端点废弃**：文档标注 `DEPRECATED` + 替代端点 + 移除版本，响应头附 `Deprecation: true`、`Sunset: <HTTP日期>`。
5. 本文档每次变更须提升头部"文档版本"并追加修订记录。

---

## 11. 修订记录

| 版本 | 日期 | 修订内容 | 作者 |
| --- | --- | --- | --- |
| v1.0 | 2026-11-16 | 首次发布：29 个端点、信封规范、错误码总表、多端接入指引 | — |
| v1.1 | 2026-11-16 | 实现校对，无破坏性变更：① §1.3/§2.2/§6.4 明确 `lockMinutes` 即访问令牌的实际 TTL（`expiresIn = lockMinutes × 60`），改配置只影响新签发的令牌；② §4.4 修正 `reveal` 的错误码——无密码应为 `409 NO_PASSWORD`（原写 `CONFLICT`），并删除实现中并不存在的 `423 LOCKED_OUT`；③ §6.2 补上实现已返回但文档缺失的 `failedAttempts` 字段；④ 补充 `Secure` Cookie 仅 HTTPS 下发的说明 | — |
