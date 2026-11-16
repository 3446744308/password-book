import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestEnv, api } from './helpers.js';
import { rateLimit, resetRateLimits } from '../src/middleware/rateLimit.js';

const MASTER = 'Master12345';

let env;
let srv;
let base;

beforeAll(async () => {
  // 限速默认关闭（docs/03 §1.6），本文件专门验证限速行为，故显式开启。
  // 额度设为 7：让“失败计数→锁定(423)”先于“限速(429)”出现，便于分别断言。
  // 生产默认为 5（docs/03 §2.2），两者交互见 docs/01 §6.1。
  env = await createTestEnv({ rateLoginMax: 7, rateLimitEnabled: true });
  ({ base, server: srv } = await env.start());
});
afterAll(async () => {
  await new Promise((resolve) => srv.close(resolve));
  await env.cleanup();
});

async function login(password = MASTER) {
  return api(base, '/api/v1/auth/login', { method: 'POST', body: { masterPassword: password } });
}

describe('登录限速与锁定', () => {
  it('初始化成功（占用 1 次限速额度）', async () => {
    const res = await api(base, '/api/v1/auth/setup', {
      method: 'POST',
      body: { masterPassword: MASTER },
    });
    expect(res.status).toBe(201);
  });

  it('连续失败：先 401，第 5 次失败触发 423 锁定，随后 423 快速返回', async () => {
    const s1 = await login('WrongPass111');
    expect(s1.status).toBe(401);
    const s2 = await login('WrongPass222');
    expect(s2.status).toBe(401);
    const s3 = await login('WrongPass333');
    expect(s3.status).toBe(401);
    const s4 = await login('WrongPass444');
    expect(s4.status).toBe(401);
    // 第 5 次失败 → 达到 failedAttempts 阈值 → 锁定
    const s5 = await login('WrongPass555');
    expect(s5.status).toBe(423);
    expect(s5.body.error.code).toBe('LOCKED_OUT');
    // 锁定期内正确密码也拒绝（快速路径，不派生 KDF）
    const s6 = await login(MASTER);
    expect(s6.status).toBe(423);
  });

  it('超出限速窗口额度 → 429 RATE_LIMITED + Retry-After', async () => {
    const seen = [];
    for (let i = 0; i < 8; i++) {
      const res = await login('WrongPass666');
      seen.push(res.status);
      if (res.status === 429) {
        expect(res.body.error.code).toBe('RATE_LIMITED');
        expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
        break;
      }
    }
    expect(seen).toContain(429);
  });
});

describe('限速中间件（单元）', () => {
  function fakeRes() {
    const headers = {};
    return { headers, setHeader: (k, v) => (headers[k] = v) };
  }

  it('额度内放行，超限返回 429 + Retry-After，reset 后重新计数', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 2, name: 'unit' });
    const req = { ip: '10.0.0.1' };
    const seen = [];
    const next = (err) => seen.push(err);

    limiter(req, fakeRes(), next);
    limiter(req, fakeRes(), next);
    const res = fakeRes();
    limiter(req, res, next);

    expect(seen).toHaveLength(3);
    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBeUndefined();
    expect(seen[2]?.status).toBe(429);
    expect(seen[2]?.code).toBe('RATE_LIMITED');
    expect(Number(res.headers['Retry-After'])).toBeGreaterThan(0);

    // resetRateLimits 必须真的清零，而不是空壳
    resetRateLimits(limiter);
    const after = [];
    limiter(req, fakeRes(), (err) => after.push(err));
    expect(after[0]).toBeUndefined();
  });

  it('不同 IP 的计数互相隔离', () => {
    const limiter = rateLimit({ windowMs: 60_000, max: 1, name: 'unit2' });
    const seen = [];
    const next = (err) => seen.push(err);

    limiter({ ip: '10.0.0.2' }, fakeRes(), next);
    limiter({ ip: '10.0.0.3' }, fakeRes(), next);
    limiter({ ip: '10.0.0.2' }, fakeRes(), next);

    expect(seen[0]).toBeUndefined();
    expect(seen[1]).toBeUndefined();
    expect(seen[2]?.status).toBe(429);
  });
});
