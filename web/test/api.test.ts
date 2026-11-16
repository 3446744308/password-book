import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { AxiosAdapter, AxiosResponse, InternalAxiosRequestConfig } from 'axios';
import instance from '../src/api/request';
import {
  login,
  getStatus,
  getPresets,
  listCategories,
  createCategory,
  listEntries,
  createEntry,
  listAudit,
} from '../src/api';
import { useAuthStore } from '../src/stores/authStore';

/**
 * API 层契约测试：服务端统一返回 `{ data, pagination? }` 信封，
 * 响应拦截器把 axios 响应体解成该信封，因此 httpGet/httpPost 等辅助函数
 * 必须**原样返回信封**，由各 api 模块取 `.data`。
 *
 * 这里曾经多剥一层（辅助函数又取了一次 .data），导致所有接口返回值都是 undefined，
 * 表现就是「创建主密码」时报 Cannot read properties of undefined (reading 'accessToken')。
 * 用 axios 自定义 adapter 伪造响应，可在不启后端的情况下锁死这个契约。
 */

const originalAdapter = instance.defaults.adapter;
let seenConfigs: InternalAxiosRequestConfig[] = [];

function stubAdapter(route: (url: string) => { status: number; body: unknown }) {
  seenConfigs = [];
  const adapter = (async (config: InternalAxiosRequestConfig) => {
    seenConfigs.push(config);
    const { status, body } = route(config.url ?? '');
    return { data: body, status, statusText: 'OK', headers: {}, config } as AxiosResponse;
  }) as unknown as AxiosAdapter;
  instance.defaults.adapter = adapter;
}

beforeEach(() => {
  useAuthStore.getState().clear();
});

afterEach(() => {
  instance.defaults.adapter = originalAdapter;
  useAuthStore.getState().clear();
});

describe('信封解包只做一次', () => {
  it('listCategories 返回分类数组（而不是 undefined）', async () => {
    stubAdapter(() => ({
      status: 200,
      body: { data: [{ id: '_default', name: '默认分类', icon: 'folder', sortOrder: 0 }] },
    }));

    const categories = await listCategories();

    expect(Array.isArray(categories)).toBe(true);
    expect(categories).toHaveLength(1);
    expect(categories[0].id).toBe('_default');
  });

  it('login 返回带 accessToken 的对象（首次创建主密码的关键路径）', async () => {
    stubAdapter(() => ({
      status: 200,
      body: {
        data: {
          accessToken: 'jwt-token',
          tokenType: 'Bearer',
          expiresIn: 1800,
          serverTime: '2026-11-16T09:00:00.000Z',
        },
      },
    }));

    const res = await login('Master12345');

    expect(res).toBeDefined();
    expect(res.accessToken).toBe('jwt-token');
    expect(res.expiresIn).toBe(1800);
  });

  it('getStatus 返回 SystemStatus 对象', async () => {
    stubAdapter(() => ({
      status: 200,
      body: { data: { initialized: false, lockMinutes: 30, schemaVersion: 1 } },
    }));

    const status = await getStatus();

    expect(status).toBeDefined();
    expect(status.initialized).toBe(false);
    expect(status.lockMinutes).toBe(30);
  });

  it('getPresets 返回内置分类模板与常用标签', async () => {
    stubAdapter(() => ({
      status: 200,
      body: {
        data: {
          categories: [{ name: '工作', icon: 'project', sortOrder: 10 }],
          tags: ['常用', '工作'],
        },
      },
    }));

    const presets = await getPresets();

    expect(presets.tags).toEqual(['常用', '工作']);
    expect(presets.categories).toHaveLength(1);
    expect(presets.categories[0].name).toBe('工作');
  });

  it('listEntries 同时拿到 data 与 pagination', async () => {
    stubAdapter(() => ({
      status: 200,
      body: {
        data: [{ id: '01JD8Z8G9QK3M2N7P5R6T8WXYZ', title: '公司邮箱' }],
        pagination: { page: 1, size: 20, total: 1 },
      },
    }));

    const res = await listEntries({ page: 1, size: 20 });

    expect(res.data).toHaveLength(1);
    expect(res.data[0].title).toBe('公司邮箱');
    expect(res.pagination).toEqual({ page: 1, size: 20, total: 1 });
  });

  it('listAudit 同时拿到 data 与 pagination', async () => {
    stubAdapter(() => ({
      status: 200,
      body: {
        data: [
          { ts: '2026-11-16T09:00:00.000Z', event: 'LOGIN_OK', ip: '127.0.0.1', detail: null },
        ],
        pagination: { page: 1, size: 50, total: 1 },
      },
    }));

    const res = await listAudit({ page: 1, size: 50 });

    expect(res.data).toHaveLength(1);
    expect(res.pagination.total).toBe(1);
  });

  it('写接口返回创建后的对象', async () => {
    stubAdapter((url) =>
      url.includes('/entries')
        ? { status: 201, body: { data: { id: '01JD8Z8G9QK3M2N7P5R6T8WXYZ', title: 'GitHub' } } }
        : { status: 201, body: { data: { id: '01JD8Z8G9QK3M2N7P5R6T8WXY0', name: '工作' } } },
    );

    expect((await createEntry({ title: 'GitHub' })).title).toBe('GitHub');
    expect((await createCategory({ name: '工作' })).name).toBe('工作');
  });
});

describe('请求拦截器', () => {
  it('已登录时自动附加 Bearer 令牌', async () => {
    stubAdapter(() => ({ status: 200, body: { data: [] } }));
    useAuthStore.getState().setToken('token-abc');

    await listCategories();

    const header = seenConfigs[0]?.headers?.Authorization;
    expect(header).toBe('Bearer token-abc');
  });

  it('未登录时不附加 Authorization', async () => {
    stubAdapter(() => ({ status: 200, body: { data: [] } }));

    await listCategories();

    expect(seenConfigs[0]?.headers?.Authorization).toBeUndefined();
  });
});
