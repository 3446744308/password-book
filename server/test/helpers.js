import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

/**
 * 测试环境工厂：独立临时 data 目录 + 动态导入 app（必须先设 env 再 import）。
 * 每个测试文件只应调用一次（模块缓存共享同一 app 实例）。
 */
export async function createTestEnv(overrides = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'pwbook-test-'));
  process.env.NODE_ENV = 'test';
  process.env.DATA_DIR = dir;
  process.env.KDF_ITERATIONS = String(overrides.kdfIterations ?? 1000);
  process.env.AUTH_MODE = overrides.authMode ?? 'dev';
  process.env.LOG_LEVEL = 'error';
  process.env.RATE_LOGIN_MAX = String(overrides.rateLoginMax ?? 1000);
  process.env.CORS_ORIGINS = 'http://localhost:5173';

  const { default: app } = await import('../src/app.js');

  return {
    app,
    dir,
    /** 启动临时 HTTP 服务，返回 { server, base } */
    async start() {
      const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      return { server, base };
    },
    async cleanup() {
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** 统一 fetch 封装：自动序列化 + 解析标准信封 */
export async function api(base, pathname, { method = 'GET', token, body, headers = {} } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let json = null;
  if (res.status !== 204) {
    const text = await res.text();
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
  }
  return { status: res.status, body: json, headers: res.headers };
}

/** 初始化 + 登录，返回 accessToken */
export async function setupLogin(base, masterPassword = 'Master12345') {
  const setup = await api(base, '/api/v1/auth/setup', {
    method: 'POST',
    body: { masterPassword },
  });
  if (setup.status !== 201 && setup.body?.error?.code !== 'ALREADY_INITIALIZED') {
    throw new Error(`setup 失败: ${JSON.stringify(setup.body)}`);
  }
  const login = await api(base, '/api/v1/auth/login', {
    method: 'POST',
    body: { masterPassword },
  });
  if (login.status !== 200) throw new Error(`登录失败: ${JSON.stringify(login.body)}`);
  return login.body.data.accessToken;
}
