/**
 * 集成冒烟测试：对真实运行的 server 发起完整请求链
 * 用法：node scripts/smoke.js <baseURL>
 */
const base = process.argv[2] || 'http://127.0.0.1:3100';

let passed = 0;
const failures = [];

function check(label, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  PASS  ${label}`);
  } else {
    failures.push(label + (extra ? ` :: ${extra}` : ''));
    console.log(`  FAIL  ${label} ${extra}`);
  }
}

async function call(pathname, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.status, body: json, raw: text, headers: res.headers };
}

const MASTER = 'Smoke123456';

async function main() {
  console.log(`\n== 冒烟测试 @ ${base} ==\n`);

  // 1. 健康检查（公开）
  const health = await call('/api/v1/system/health');
  check('GET /system/health 200', health.status === 200 && health.body?.data?.status === 'ok');
  check('health 返回版本号', Boolean(health.body?.data?.version));

  // 2. 状态（公开）
  const status = await call('/api/v1/system/status');
  check('GET /system/status 200', status.status === 200);
  const initialized = status.body?.data?.initialized;
  check('status.initialized 为布尔', typeof initialized === 'boolean');

  // 3. 初始化（若尚未初始化）
  let token;
  if (!initialized) {
    const setup = await call('/api/v1/auth/setup', {
      method: 'POST',
      body: { masterPassword: MASTER },
    });
    check('POST /auth/setup 201', setup.status === 201, JSON.stringify(setup.body));
  }

  // 4. 登录
  const login = await call('/api/v1/auth/login', {
    method: 'POST',
    body: { masterPassword: MASTER },
  });
  check('POST /auth/login 200', login.status === 200, JSON.stringify(login.body));
  token = login.body?.data?.accessToken;
  check('返回 accessToken', Boolean(token));
  const cookie = login.headers.get('set-cookie') || '';
  check('刷新令牌为 HttpOnly Cookie', /refreshToken=/.test(cookie) && /HttpOnly/.test(cookie));

  // 5. 无令牌被拒
  const noAuth = await call('/api/v1/entries');
  check(
    '无令牌 401 TOKEN_MISSING',
    noAuth.status === 401 && noAuth.body?.error?.code === 'TOKEN_MISSING',
  );

  // 6. 分类 CRUD
  const cats = await call('/api/v1/categories', { token });
  check('GET /categories 200', cats.status === 200 && Array.isArray(cats.body?.data));
  check(
    '默认分类存在',
    cats.body?.data?.some((c) => c.id === '_default'),
  );

  const newCat = await call('/api/v1/categories', {
    method: 'POST',
    token,
    body: { name: `冒烟分类-${Date.now() % 100000}` },
  });
  check('POST /categories 201', newCat.status === 201, JSON.stringify(newCat.body));
  const catId = newCat.body?.data?.id;

  // 7. 条目 CRUD
  const created = await call('/api/v1/entries', {
    method: 'POST',
    token,
    body: {
      title: '冒烟测试条目',
      username: 'smoke@example.com',
      password: 'Sup3rSecret!',
      notes: '备注内容',
      url: 'https://example.com',
      categoryId: catId,
      tags: ['测试'],
      favorite: true,
    },
  });
  check('POST /entries 201', created.status === 201, JSON.stringify(created.body));
  const entryId = created.body?.data?.id;
  check('响应不含密文字段', !JSON.stringify(created.body).includes('passwordEnc'));

  const detail = await call(`/api/v1/entries/${entryId}`, { token });
  check(
    'GET /entries/:id 200 + notes 解密',
    detail.status === 200 && detail.body?.data?.notes === '备注内容',
  );

  const reveal = await call(`/api/v1/entries/${entryId}/reveal`, { token });
  check(
    'GET reveal 返回明文',
    reveal.status === 200 && reveal.body?.data?.password === 'Sup3rSecret!',
  );

  const list = await call(`/api/v1/entries?keyword=${encodeURIComponent('冒烟')}`, { token });
  check('GET /entries 搜索命中', list.status === 200 && list.body?.pagination?.total >= 1);

  const patched = await call(`/api/v1/entries/${entryId}`, {
    method: 'PATCH',
    token,
    body: { password: 'N3wSecret!!', changeNote: '冒烟换密' },
  });
  check('PATCH 改密码 +1', patched.status === 200 && patched.body?.data?.passwordVersion === 2);

  const history = await call(`/api/v1/entries/${entryId}/history`, { token });
  check('历史生成 1 条', history.status === 200 && history.body?.pagination?.total === 1);

  const restored = await call(`/api/v1/entries/${entryId}/restore-password`, {
    method: 'POST',
    token,
    body: { version: 1 },
  });
  check('恢复历史版本', restored.status === 200 && restored.body?.data?.currentVersion === 3);

  const fav = await call(`/api/v1/entries/${entryId}/favorite`, {
    method: 'PATCH',
    token,
    body: { favorite: false },
  });
  check('PATCH favorite', fav.status === 200 && fav.body?.data?.favorite === false);

  // 8. 系统配置 / 审计 / 备份
  const cfg = await call('/api/v1/system/config', { token });
  check(
    'GET /system/config 200',
    cfg.status === 200 && typeof cfg.body?.data?.lockMinutes === 'number',
  );

  const audit = await call('/api/v1/system/audit?size=100', { token });
  const events = (audit.body?.data || []).map((e) => e.event);
  check(
    '审计含 LOGIN_OK / ENTRY_CREATE / ENTRY_REVEAL',
    audit.status === 200 &&
      ['LOGIN_OK', 'ENTRY_CREATE', 'ENTRY_REVEAL'].every((ev) => events.includes(ev)),
    events.slice(0, 8).join(','),
  );

  const backup = await call('/api/v1/system/backup', { method: 'POST', token });
  check(
    'POST /system/backup 201',
    backup.status === 201 && /^\d{8}-\d{6}$/.test(backup.body?.data?.backupId || ''),
  );

  // 9. 删除
  const del = await call(`/api/v1/entries/${entryId}`, { method: 'DELETE', token });
  check('DELETE /entries/:id 204', del.status === 204);

  const delCat = await call(`/api/v1/categories/${catId}`, { method: 'DELETE', token });
  check('DELETE /categories/:id 200', delCat.status === 200 && delCat.body?.data?.deleted === true);

  // 10. 错误信封形态
  const notFound = await call('/api/v1/entries/01JD8Z8G9QK3M2N7P5R6T8WXYZ', { token });
  check(
    '404 标准信封 {error:{code,message}}',
    notFound.status === 404 &&
      Boolean(notFound.body?.error?.code) &&
      Boolean(notFound.body?.error?.message),
    JSON.stringify(notFound.body),
  );

  const badRoute = await call('/api/v1/nope', { token });
  check(
    '未知 /api 路由 404',
    badRoute.status === 404 && badRoute.body?.error?.code === 'NOT_FOUND',
  );

  // 11. SPA 静态托管（仅生产模式下有 dist）
  const spa = await call('/');
  check(
    'GET / 返回 HTML（SPA 托管）',
    spa.status === 200 && /<!doctype html>/i.test(spa.raw),
    `status=${spa.status}`,
  );
  const spaDeep = await call('/settings');
  check(
    '深链 /settings 回退到 index.html',
    spaDeep.status === 200 && /<!doctype html>/i.test(spaDeep.raw),
  );

  // 12. 登出
  const logout = await call('/api/v1/auth/logout', { method: 'POST', token });
  check('POST /auth/logout 204', logout.status === 204);
  const after = await call('/api/v1/auth/session', { token });
  check('登出后令牌失效', after.status === 401);

  console.log(`\n结果：${passed} 通过，${failures.length} 失败\n`);
  if (failures.length) {
    console.log('失败项：');
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error('冒烟测试异常：', err);
  process.exitCode = 1;
});
