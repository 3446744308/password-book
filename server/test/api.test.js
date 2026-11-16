import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnv, api } from './helpers.js';
// fsx 不依赖 config，可静态导入（用于直接修改 master.json 模拟锁定）
import { readJson, writeJson } from '../src/storage/fsx.js';

const MASTER = 'Master12345';
const NEW_MASTER = 'NewMaster678';

let env;
let srv;
let base;
let token;
let paths;
/** 测试间传递的实体 ID */
let workCatId;
let entryId;
let noPwEntryId;
let plainPassword = 'Str0ng!Pass2026';

beforeAll(async () => {
  env = await createTestEnv();
  ({ base, server: srv } = await env.start());
  ({ paths } = await import('../src/storage/paths.js'));
});

afterAll(async () => {
  await new Promise((resolve) => srv.close(resolve));
  await env.cleanup();
});

describe('1. 系统初始化与认证', () => {
  it('status 显示未初始化（无需鉴权）', async () => {
    const res = await api(base, '/api/v1/system/status');
    expect(res.status).toBe(200);
    expect(res.body.data.initialized).toBe(false);
    expect(res.body.data.schemaVersion).toBe(1);
  });

  it('health 正常（无需鉴权）', async () => {
    const res = await api(base, '/api/v1/system/health');
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data.dataDirWritable).toBe(true);
  });

  it('未初始化时登录 → 400', async () => {
    const res = await api(base, '/api/v1/auth/login', { method: 'POST', body: { masterPassword: MASTER } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('弱主密码初始化被拒 → 400（长度不足 / 缺字母数字）', async () => {
    const short = await api(base, '/api/v1/auth/setup', { method: 'POST', body: { masterPassword: 'abc123' } });
    expect(short.status).toBe(400);
    const noDigit = await api(base, '/api/v1/auth/setup', {
      method: 'POST',
      body: { masterPassword: 'abcdefghijkl' },
    });
    expect(noDigit.status).toBe(400);
  });

  it('合法主密码初始化 → 201', async () => {
    const res = await api(base, '/api/v1/auth/setup', { method: 'POST', body: { masterPassword: MASTER } });
    expect(res.status).toBe(201);
    expect(res.body.data).toEqual({ initialized: true, defaultCategoryId: '_default' });
  });

  it('重复初始化 → 409 ALREADY_INITIALIZED', async () => {
    const res = await api(base, '/api/v1/auth/setup', { method: 'POST', body: { masterPassword: MASTER } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ALREADY_INITIALIZED');
  });

  it('错误主密码登录 → 401 AUTH_INVALID_CREDENTIALS', async () => {
    const res = await api(base, '/api/v1/auth/login', {
      method: 'POST',
      body: { masterPassword: 'WrongPass999' },
    });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
  });

  it('正确主密码登录 → 200 令牌 + HttpOnly 刷新 Cookie', async () => {
    const res = await api(base, '/api/v1/auth/login', { method: 'POST', body: { masterPassword: MASTER } });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.tokenType).toBe('Bearer');
    expect(res.body.data.expiresIn).toBeGreaterThan(0);
    expect(res.body.data).not.toHaveProperty('refreshToken');
    const cookie = res.headers.get('set-cookie') || '';
    expect(cookie).toMatch(/refreshToken=/);
    expect(cookie).toMatch(/HttpOnly/);
    token = res.body.data.accessToken;
  });

  it('无令牌 → 401 TOKEN_MISSING；伪造令牌 → 401 TOKEN_INVALID', async () => {
    const missing = await api(base, '/api/v1/entries');
    expect(missing.status).toBe(401);
    expect(missing.body.error.code).toBe('TOKEN_MISSING');
    const fake = await api(base, '/api/v1/entries', { token: 'abc.def.ghi' });
    expect(fake.status).toBe(401);
    expect(fake.body.error.code).toBe('TOKEN_INVALID');
  });

  it('session 可校验会话 → authenticated=true', async () => {
    const res = await api(base, '/api/v1/auth/session', { token });
    expect(res.status).toBe(200);
    expect(res.body.data.authenticated).toBe(true);
    expect(res.body.data.lockMinutes).toBe(30);
  });
});

describe('2. 分类管理', () => {
  it('默认分类存在且受保护', async () => {
    const res = await api(base, '/api/v1/categories', { token });
    expect(res.status).toBe(200);
    const def = res.body.data.find((c) => c.id === '_default');
    expect(def).toBeTruthy();
    expect(def.protected).toBe(true);
    expect(def.entryCount).toBe(0);
  });

  it('创建分类 → 201', async () => {
    const res = await api(base, '/api/v1/categories', {
      method: 'POST',
      token,
      body: { name: '工作', icon: 'bank', sortOrder: 1 },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('工作');
    expect(res.body.data.id).toMatch(/^[0-9A-HJ-NP-TV-Z]{26}$/);
    workCatId = res.body.data.id;
  });

  it('同名分类 → 409 CONFLICT', async () => {
    const res = await api(base, '/api/v1/categories', { method: 'POST', token, body: { name: '工作' } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('重命名分类 → 200', async () => {
    const res = await api(base, `/api/v1/categories/${workCatId}`, {
      method: 'PUT',
      token,
      body: { name: '工作账号' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('工作账号');
  });

  it('默认分类改名 → 403 PROTECTED_RESOURCE', async () => {
    const res = await api(base, '/api/v1/categories/_default', {
      method: 'PUT',
      token,
      body: { name: '新名字' },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PROTECTED_RESOURCE');
  });

  it('不存在的分类 → 404', async () => {
    const res = await api(base, '/api/v1/categories/01JD8Z8G9QK3M2N7P5R6T8WXYZ', { token });
    expect(res.status).toBe(404);
  });
});

describe('3. 条目 CRUD 与密码查看', () => {
  it('创建条目 → 201，响应不含密文', async () => {
    const res = await api(base, '/api/v1/entries', {
      method: 'POST',
      token,
      body: {
        title: '公司邮箱',
        username: 'me@company.com',
        password: plainPassword,
        notes: '公司主邮箱',
        url: 'https://mail.company.com',
        categoryId: workCatId,
        tags: ['工作', '邮箱'],
        favorite: true,
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.hasPassword).toBe(true);
    expect(res.body.data.notes).toBe('公司主邮箱');
    expect(res.body.data.passwordVersion).toBe(1);
    expect(JSON.stringify(res.body.data)).not.toContain('Enc');
    entryId = res.body.data.id;
  });

  it('校验失败（缺标题/非法网址）→ 400 + 字段级 details', async () => {
    const noTitle = await api(base, '/api/v1/entries', { method: 'POST', token, body: { username: 'x' } });
    expect(noTitle.status).toBe(400);
    expect(noTitle.body.error.details.some((d) => d.field === 'title')).toBe(true);

    const badUrl = await api(base, '/api/v1/entries', {
      method: 'POST',
      token,
      body: { title: 'x', url: 'ftp://evil' },
    });
    expect(badUrl.status).toBe(400);
    expect(badUrl.body.error.details.some((d) => d.field === 'url')).toBe(true);
  });

  it('创建无密码条目', async () => {
    const res = await api(base, '/api/v1/entries', {
      method: 'POST',
      token,
      body: { title: '官网主页', url: 'https://example.com' },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.hasPassword).toBe(false);
    noPwEntryId = res.body.data.id;
  });

  it('列表：关键词/收藏/分页过滤', async () => {
    const all = await api(base, '/api/v1/entries?page=1&size=10', { token });
    expect(all.status).toBe(200);
    expect(all.body.pagination.total).toBeGreaterThanOrEqual(2);

    const kw = await api(base, '/api/v1/entries?keyword=' + encodeURIComponent('公司'), { token });
    expect(kw.body.data).toHaveLength(1);
    expect(kw.body.data[0].id).toBe(entryId);

    const fav = await api(base, '/api/v1/entries?favorite=true', { token });
    expect(fav.body.data.every((e) => e.favorite)).toBe(true);
    expect(fav.body.data.some((e) => e.id === entryId)).toBe(true);

    const byCat = await api(base, `/api/v1/entries?categoryId=${workCatId}`, { token });
    expect(byCat.body.data).toHaveLength(1);

    // 列表绝不返回密文或明文密码
    expect(JSON.stringify(all.body)).not.toContain('passwordEnc');
    expect(JSON.stringify(all.body)).not.toContain(plainPassword);
  });

  it('详情：notes 解密返回，密码仍不可见', async () => {
    const res = await api(base, `/api/v1/entries/${entryId}`, { token });
    expect(res.status).toBe(200);
    expect(res.body.data.notes).toBe('公司主邮箱');
    expect(res.body.data).not.toHaveProperty('passwordEnc');
    expect(res.body.data).not.toHaveProperty('password');
  });

  it('reveal 返回密码明文', async () => {
    const res = await api(base, `/api/v1/entries/${entryId}/reveal`, { token });
    expect(res.status).toBe(200);
    expect(res.body.data.password).toBe(plainPassword);
    expect(res.body.data.fetchedAt).toBeTruthy();
  });

  it('无密码条目 reveal → 409 NO_PASSWORD', async () => {
    const res = await api(base, `/api/v1/entries/${noPwEntryId}/reveal`, { token });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NO_PASSWORD');
  });

  it('不存在的条目 → 404', async () => {
    const res = await api(base, '/api/v1/entries/01JD8Z8G9QK3M2N7P5R6T8WXYZ', { token });
    expect(res.status).toBe(404);
  });
});

describe('4. 收藏 / 更新 / 密码历史', () => {
  it('切换收藏 → PATCH favorite', async () => {
    const off = await api(base, `/api/v1/entries/${noPwEntryId}/favorite`, {
      method: 'PATCH',
      token,
      body: { favorite: true },
    });
    expect(off.status).toBe(200);
    expect(off.body.data.favorite).toBe(true);
    const invalid = await api(base, `/api/v1/entries/${noPwEntryId}/favorite`, {
      method: 'PATCH',
      token,
      body: { favorite: 'yes' },
    });
    expect(invalid.status).toBe(400);
  });

  it('PATCH 局部改标题：不动密码与版本号', async () => {
    const res = await api(base, `/api/v1/entries/${entryId}`, {
      method: 'PATCH',
      token,
      body: { title: '公司邮箱(主)' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('公司邮箱(主)');
    expect(res.body.data.passwordVersion).toBe(1);
  });

  it('PATCH 空 body → 400', async () => {
    const res = await api(base, `/api/v1/entries/${entryId}`, { method: 'PATCH', token, body: {} });
    expect(res.status).toBe(400);
  });

  it('修改密码：旧密码入历史，版本号 +1', async () => {
    const newPw = 'N3w$ecret9999';
    const res = await api(base, `/api/v1/entries/${entryId}`, {
      method: 'PUT',
      token,
      body: { title: '公司邮箱(主)', username: 'me@company.com', password: newPw, changeNote: '季度换密' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.passwordVersion).toBe(2);

    const history = await api(base, `/api/v1/entries/${entryId}/history`, { token });
    expect(history.status).toBe(200);
    expect(history.body.pagination.total).toBe(1);
    expect(history.body.data[0].version).toBe(1);
    expect(history.body.data[0].changeNote).toBe('季度换密');
    expect(JSON.stringify(history.body)).not.toContain(plainPassword);

    const reveal = await api(base, `/api/v1/entries/${entryId}/reveal`, { token });
    expect(reveal.body.data.password).toBe(newPw);
    plainPassword = newPw;
  });

  it('查看历史版本明文 → 旧密码', async () => {
    const res = await api(base, `/api/v1/entries/${entryId}/history/1`, { token });
    expect(res.status).toBe(200);
    expect(res.body.data.version).toBe(1);
    expect(res.body.data.password).toBe('Str0ng!Pass2026');
    const missing = await api(base, `/api/v1/entries/${entryId}/history/99`, { token });
    expect(missing.status).toBe(404);
  });

  it('恢复历史版本：当前版本先归档，版本号继续递增', async () => {
    const res = await api(base, `/api/v1/entries/${entryId}/restore-password`, {
      method: 'POST',
      token,
      body: { version: 1 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.restoredVersion).toBe(1);
    expect(res.body.data.currentVersion).toBe(3);

    const reveal = await api(base, `/api/v1/entries/${entryId}/reveal`, { token });
    expect(reveal.body.data.password).toBe('Str0ng!Pass2026');

    const history = await api(base, `/api/v1/entries/${entryId}/history`, { token });
    expect(history.body.pagination.total).toBe(2); // v1 保留 + v2 归档
    plainPassword = 'Str0ng!Pass2026';
  });

  it('设置密码为 null → 清空（原密码入历史）', async () => {
    const res = await api(base, `/api/v1/entries/${entryId}`, {
      method: 'PATCH',
      token,
      body: { password: null },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.hasPassword).toBe(false);
    const reveal = await api(base, `/api/v1/entries/${entryId}/reveal`, { token });
    expect(reveal.status).toBe(409);
    const history = await api(base, `/api/v1/entries/${entryId}/history`, { token });
    expect(history.body.pagination.total).toBe(3);
    // 恢复密码，便于后续测试
    await api(base, `/api/v1/entries/${entryId}/restore-password`, {
      method: 'POST',
      token,
      body: { version: 3 },
    });
    const back = await api(base, `/api/v1/entries/${entryId}/reveal`, { token });
    expect(back.status).toBe(200);
  });
});

describe('5. 转移与删除', () => {
  it('条目转移：把默认分类下的第二个条目移到工作分类', async () => {
    const res = await api(base, `/api/v1/categories/_default/transfer`, {
      method: 'POST',
      token,
      body: { targetCategoryId: workCatId, entryIds: [noPwEntryId] },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.transferred).toBe(1);
    const detail = await api(base, `/api/v1/entries/${noPwEntryId}`, { token });
    expect(detail.body.data.categoryId).toBe(workCatId);
  });

  it('转移不存在的条目 → 404 + details', async () => {
    const res = await api(base, `/api/v1/categories/_default/transfer`, {
      method: 'POST',
      token,
      body: { targetCategoryId: workCatId, entryIds: ['01JD8Z8G9QK3M2N7P5R6T8WXYZ'] },
    });
    expect(res.status).toBe(404);
    expect(res.body.error.details).toBeTruthy();
  });

  it('删除分类：条目迁回默认分类，不丢失', async () => {
    const before = await api(base, `/api/v1/categories/${workCatId}`, { token });
    expect(before.body.data.entryCount).toBe(2); // 邮箱 + 官网主页

    const del = await api(base, `/api/v1/categories/${workCatId}`, { method: 'DELETE', token });
    expect(del.status).toBe(200);
    expect(del.body.data).toEqual({ deleted: true, movedEntries: 2 });

    const moved = await api(base, `/api/v1/entries?categoryId=_default`, { token });
    expect(moved.body.pagination.total).toBe(2);

    const gone = await api(base, `/api/v1/categories/${workCatId}`, { token });
    expect(gone.status).toBe(404);
  });

  it('删除默认分类 → 403', async () => {
    const res = await api(base, '/api/v1/categories/_default', { method: 'DELETE', token });
    expect(res.status).toBe(403);
  });

  it('删除条目 → 204，之后读取 404', async () => {
    const del = await api(base, `/api/v1/entries/${noPwEntryId}`, { method: 'DELETE', token });
    expect(del.status).toBe(204);
    const gone = await api(base, `/api/v1/entries/${noPwEntryId}`, { token });
    expect(gone.status).toBe(404);
    // 历史被移入 trash（该条目原本无历史则无文件）
    const history = await api(base, `/api/v1/entries/${noPwEntryId}/history`, { token });
    expect(history.status).toBe(404);
  });
});

describe('6. 系统配置 / 审计 / 备份', () => {
  it('读取配置 → 默认值', async () => {
    const res = await api(base, '/api/v1/system/config', { token });
    expect(res.status).toBe(200);
    expect(res.body.data.lockMinutes).toBe(30);
    expect(res.body.data.minPasswordLength).toBe(10);
  });

  it('更新配置 → 200；越界 → 400', async () => {
    const okRes = await api(base, '/api/v1/system/config', {
      method: 'PUT',
      token,
      body: { lockMinutes: 15, historyKeep: 100 },
    });
    expect(okRes.status).toBe(200);
    expect(okRes.body.data.lockMinutes).toBe(15);

    const bad = await api(base, '/api/v1/system/config', { method: 'PUT', token, body: { lockMinutes: 0 } });
    expect(bad.status).toBe(400);
    const empty = await api(base, '/api/v1/system/config', { method: 'PUT', token, body: {} });
    expect(empty.status).toBe(400);
  });

  it('lockMinutes 决定访问令牌的实际有效期（不是仅展示值）', async () => {
    // 上文已把 lockMinutes 改为 15 分钟
    const login = await api(base, '/api/v1/auth/login', { method: 'POST', body: { masterPassword: MASTER } });
    expect(login.status).toBe(200);
    expect(login.body.data.expiresIn).toBe(15 * 60);

    // 直接解出 JWT 载荷，确认 exp - iat 与配置一致
    const claim = login.body.data.accessToken.split('.')[1];
    const payload = JSON.parse(Buffer.from(claim, 'base64url').toString('utf8'));
    expect(payload.exp - payload.iat).toBe(15 * 60);

    // session 与 login 的口径一致
    const session = await api(base, '/api/v1/auth/session', { token: login.body.data.accessToken });
    expect(session.body.data.lockMinutes).toBe(15);
  });

  it('审计日志：含登录与 reveal 事件，支持过滤与分页', async () => {
    const res = await api(base, '/api/v1/system/audit?size=100', { token });
    expect(res.status).toBe(200);
    const events = res.body.data.map((e) => e.event);
    expect(events).toContain('SETUP_OK');
    expect(events).toContain('LOGIN_OK');
    expect(events).toContain('LOGIN_FAIL');
    expect(events).toContain('ENTRY_REVEAL');
    expect(events).toContain('HISTORY_RESTORE');
    // 日志绝不含密码明文
    expect(JSON.stringify(res.body)).not.toContain(plainPassword);
    expect(JSON.stringify(res.body)).not.toContain('Str0ng!Pass2026');

    const filtered = await api(base, '/api/v1/system/audit?event=LOGIN_OK', { token });
    expect(filtered.body.data.every((e) => e.event === 'LOGIN_OK')).toBe(true);
  });

  it('触发备份 → 201 且目录落盘', async () => {
    const res = await api(base, '/api/v1/system/backup', { method: 'POST', token });
    expect(res.status).toBe(201);
    expect(res.body.data.backupId).toMatch(/^\d{8}-\d{6}$/);
    const { exists } = await import('../src/storage/fsx.js');
    expect(await exists(`${paths.backupsDir}/${res.body.data.backupId}`)).toBe(true);
  });
});

describe('7. 会话生命周期（登出 / 刷新 / 更换主密码）', () => {
  let sessionToken;

  it('登出 → 204，之后令牌失效', async () => {
    const login = await api(base, '/api/v1/auth/login', { method: 'POST', body: { masterPassword: MASTER } });
    sessionToken = login.body.data.accessToken;
    const out = await api(base, '/api/v1/auth/logout', { method: 'POST', token: sessionToken });
    expect(out.status).toBe(204);
    const after = await api(base, '/api/v1/auth/session', { token: sessionToken });
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('TOKEN_INVALID');
  });

  it('凭 Cookie 刷新令牌 → 新 accessToken', async () => {
    const login = await api(base, '/api/v1/auth/login', {
      method: 'POST',
      body: { masterPassword: MASTER },
      headers: {},
    });
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const res = await api(base, '/api/v1/auth/refresh', { method: 'POST', headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.accessToken).not.toBe(login.body.data.accessToken);
    // 旧 access token 仍然有效（未过期）
    const check = await api(base, '/api/v1/auth/session', { token: login.body.data.accessToken });
    expect(check.status).toBe(200);
  });

  it('无 Cookie 刷新 → 401 TOKEN_MISSING', async () => {
    const res = await api(base, '/api/v1/auth/refresh', { method: 'POST' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_MISSING');
  });

  it('更换主密码：旧密码错 → 401', async () => {
    const res = await api(base, '/api/v1/auth/change-master', {
      method: 'POST',
      token,
      body: { currentPassword: 'WrongPass999', newPassword: NEW_MASTER },
    });
    expect(res.status).toBe(401);
  });

  it('更换主密码成功 → 旧令牌全部失效，新旧密码登录表现正确', async () => {
    const res = await api(base, '/api/v1/auth/change-master', {
      method: 'POST',
      token,
      body: { currentPassword: MASTER, newPassword: NEW_MASTER },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.changed).toBe(true);
    expect(res.body.data.reloginRequired).toBe(true);
    expect(res.body.data.reencryptedEntries).toBe(0); // dev 模式仅重封装 DEK

    // 更换前签发的 token 失效
    const stale = await api(base, '/api/v1/auth/session', { token });
    expect(stale.status).toBe(401);

    // 旧主密码失效、新主密码可用
    const oldPw = await api(base, '/api/v1/auth/login', { method: 'POST', body: { masterPassword: MASTER } });
    expect(oldPw.status).toBe(401);
    const newPw = await api(base, '/api/v1/auth/login', {
      method: 'POST',
      body: { masterPassword: NEW_MASTER },
    });
    expect(newPw.status).toBe(200);
    token = newPw.body.data.accessToken;
  });

  it('换密后数据完好：条目可读、reveal 解密正常', async () => {
    const detail = await api(base, `/api/v1/entries/${entryId}`, { token });
    expect(detail.status).toBe(200);
    expect(detail.body.data.notes).toBe('公司主邮箱');
    const reveal = await api(base, `/api/v1/entries/${entryId}/reveal`, { token });
    expect(reveal.status).toBe(200);
    expect(reveal.body.data.password).toBe(plainPassword);
  });
});

describe('8. 锁定状态（直接写 master.json 模拟）', () => {
  it('锁定期内即使主密码正确也返回 423 LOCKED_OUT', async () => {
    const master = await readJson(paths.masterFile, null);
    const lockedUntil = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    await writeJson(paths.masterFile, { ...master, failedAttempts: 5, lockedUntil });

    const res = await api(base, '/api/v1/auth/login', { method: 'POST', body: { masterPassword: NEW_MASTER } });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('LOCKED_OUT');
    expect(res.body.error.details[0].field).toBe('lockedUntil');

    // 状态接口反映锁定与剩余次数
    const status = await api(base, '/api/v1/system/status');
    expect(status.body.data.lockedUntil).toBe(lockedUntil);
    expect(status.body.data.failedAttemptsRemaining).toBe(0);

    // 解除锁定
    const cleared = await readJson(paths.masterFile, null);
    await writeJson(paths.masterFile, { ...cleared, failedAttempts: 0, lockedUntil: null });
    const okRes = await api(base, '/api/v1/auth/login', { method: 'POST', body: { masterPassword: NEW_MASTER } });
    expect(okRes.status).toBe(200);
    token = okRes.body.data.accessToken;
  });
});

describe('9. 数据落盘形态（抽查 data/ 目录）', () => {
  it('master.json 无主密码明文，entries 无密码明文', async () => {
    const master = await readJson(paths.masterFile, null);
    expect(master.verifier).toBeTruthy();
    expect(master.kdf.algo).toBe('PBKDF2-SHA256');
    expect(JSON.stringify(master)).not.toContain(NEW_MASTER);

    const { readdir } = await import('node:fs/promises');
    const files = await readdir(paths.entriesDir);
    for (const f of files) {
      const content = await readJson(`${paths.entriesDir}/${f}`, null);
      const text = JSON.stringify(content);
      expect(text).not.toContain(plainPassword);
      expect(text).not.toContain('Str0ng!Pass2026');
    }
  });

  it('data 目录包含全部约定文件', async () => {
    const { exists } = await import('../src/storage/fsx.js');
    for (const f of ['meta.json', 'config.json', 'master.json', 'secrets.json', 'categories.json', 'jwt.secret']) {
      expect(await exists(`${paths.root}/${f}`), f).toBe(true);
    }
  });
});
