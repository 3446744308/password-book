import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs/promises';
import { createTestEnv, api } from './helpers.js';

/**
 * 两个与「重新开始」相关的回归用例：
 *
 * 1. **删掉 data/ 后必须能重新创建主密码**
 *    曾经的缺陷：`cryptoService` 的"已初始化"是启动时载入内存的布尔值，
 *    删掉数据目录后它仍是 true，于是 POST /auth/setup 永远返回 409。
 * 2. **默认不启用限速**
 *    频繁重试主密码时不应出现 429；暴力破解由「连续失败锁定」兜底。
 */

const MASTER = 'Master12345';
const MASTER2 = 'Rebuilt67890';

let env;
let srv;
let base;

beforeAll(async () => {
  // 不传 rateLimitEnabled：走默认（关闭）
  env = await createTestEnv();
  ({ base, server: srv } = await env.start());
});

afterAll(async () => {
  await new Promise((resolve) => srv.close(resolve));
  await env.cleanup();
});

function setup(password) {
  return api(base, '/api/v1/auth/setup', { method: 'POST', body: { masterPassword: password } });
}

function login(password) {
  return api(base, '/api/v1/auth/login', { method: 'POST', body: { masterPassword: password } });
}

describe('删除 data/ 后可以重新创建密码本', () => {
  it('服务运行期间删掉数据目录，再次 setup 应当成功', async () => {
    const first = await setup(MASTER);
    expect(first.status).toBe(201);

    const firstLogin = await login(MASTER);
    expect(firstLogin.status).toBe(200);
    const oldToken = firstLogin.body.data.accessToken;

    // 模拟"手工把 data 目录删掉"（服务进程仍在运行，内存态还是已初始化）
    await fs.rm(env.dir, { recursive: true, force: true });

    const rebuilt = await setup(MASTER2);
    expect(rebuilt.status).toBe(201);
    expect(rebuilt.body.data).toEqual({ initialized: true, defaultCategoryId: '_default' });

    // 新的库结构被重新补齐
    const status = await api(base, '/api/v1/system/status');
    expect(status.body.data.initialized).toBe(true);
    expect(status.body.data.categoryCount).toBe(8);
    expect(status.body.data.entryCount).toBe(0);

    // 旧令牌必须失效（JWT 密钥已轮换），否则清空重建后旧会话能直接进新库
    const withOldToken = await api(base, '/api/v1/categories', { token: oldToken });
    expect(withOldToken.status).toBe(401);
    expect(['TOKEN_INVALID', 'TOKEN_EXPIRED']).toContain(withOldToken.body.error.code);

    // 旧主密码不能再用，新主密码可以
    expect((await login(MASTER)).status).toBe(401);
    const secondLogin = await login(MASTER2);
    expect(secondLogin.status).toBe(200);
    expect(secondLogin.body.data.accessToken).toBeTruthy();
  });
});

describe('默认不启用限速', () => {
  it('连续输错主密码只触发锁定(423)，不会出现 429', async () => {
    const seen = [];
    for (let i = 0; i < 8; i += 1) {
      const res = await login(`WrongPass${i}00`);
      seen.push(res.status);
    }

    expect(seen).not.toContain(429);
    // 前 4 次是普通的密码错误，第 5 次达到阈值触发锁定，之后一直是 423
    expect(seen.slice(0, 4)).toEqual([401, 401, 401, 401]);
    expect(seen.slice(4)).toEqual([423, 423, 423, 423]);
  });
});
