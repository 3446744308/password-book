import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';

/**
 * App 级路由守卫测试。
 *
 * 这里覆盖的是一个真实发生过的首次运行白屏：`AuthRoute` 在「后端可达且库未初始化」
 * 时无条件 `<Navigate to="/setup">`，而用户本来就在 /setup，于是 replace 到同一路径
 * → 重新渲染 → 再次 Navigate，形成无限重定向。`<Navigate>` 渲染结果是 null，
 * 所以整棵树始终渲染空白（React 已挂载，控制台只有 antd 的 Spin 警告，没有报错）。
 */

const mocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
  tryRefreshSession: vi.fn(),
}));

// 只替掉 getStatus 与启动续期，其余 api 导出保持真实（避免遗漏具名导出导致模块报错）
vi.mock('../src/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api')>();
  return { ...actual, getStatus: mocks.getStatus, tryRefreshSession: mocks.tryRefreshSession };
});

import App from '../src/App';
import { useAuthStore } from '../src/stores/authStore';

type StatusBody = Record<string, unknown>;

/** 模拟后端 /system/status 的返回；传 null 表示请求失败（后端未启动） */
function stubStatus(body: StatusBody | null) {
  const fetchMock = vi.fn(() => {
    if (body === null) return Promise.reject(new Error('ECONNREFUSED'));
    return Promise.resolve({ json: () => Promise.resolve({ data: body }) });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function setPath(pathname: string) {
  window.history.pushState({}, '', pathname);
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  // 页面组件自己也会取状态；默认「未初始化」
  mocks.getStatus.mockResolvedValue({ initialized: false, lockMinutes: 30 });
  // 默认没有可用的刷新令牌（刷新令牌 Cookie 不存在 / 已过期）
  mocks.tryRefreshSession.mockResolvedValue(null);
  useAuthStore.getState().clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  setPath('/');
});

describe('首次运行：未初始化库的引导', () => {
  it('在 /setup 且库未初始化时，必须渲染创建主密码表单（不回环重定向）', async () => {
    stubStatus({ initialized: false, lockMinutes: 30 });
    setPath('/setup');

    render(<App />);

    // 修复前这里会超时：整棵树一直在渲染 <Navigate>（=null），永远等不到内容
    expect(await screen.findByText('创建主密码', {}, { timeout: 4000 })).toBeTruthy();
  }, 10_000);

  it('在 /login 且库未初始化时，应引导到 /setup', async () => {
    stubStatus({ initialized: false, lockMinutes: 30 });
    setPath('/login');

    render(<App />);

    expect(await screen.findByText('创建主密码', {}, { timeout: 4000 })).toBeTruthy();
    expect(window.location.pathname).toBe('/setup');
  }, 10_000);
});

describe('已初始化库的引导', () => {
  it('在 /setup 且库已初始化时，应跳到 /login', async () => {
    stubStatus({ initialized: true, lockMinutes: 30 });
    mocks.getStatus.mockResolvedValue({ initialized: true, lockMinutes: 30 });
    setPath('/setup');

    render(<App />);

    expect(await screen.findByText('解锁密码本', {}, { timeout: 4000 })).toBeTruthy();
    expect(window.location.pathname).toBe('/login');
  }, 10_000);

  it('后端不可达时不白屏，放行到登录页', async () => {
    stubStatus(null);
    mocks.getStatus.mockRejectedValue(new Error('ECONNREFUSED'));
    setPath('/login');

    render(<App />);

    expect(await screen.findByText('解锁密码本', {}, { timeout: 4000 })).toBeTruthy();
  }, 10_000);
});

describe('页面刷新后的会话恢复', () => {
  it('刷新令牌有效时静默续期，直接停在主界面而不是弹回登录页', async () => {
    stubStatus({ initialized: true, lockMinutes: 30 });
    mocks.getStatus.mockResolvedValue({ initialized: true, lockMinutes: 30 });
    mocks.tryRefreshSession.mockImplementation(async () => {
      useAuthStore.getState().setToken('restored-token');
      return 'restored-token';
    });
    setPath('/');

    render(<App />);

    // 进入主界面（主框架头部出现），而不是登录页
    expect(await screen.findByText('本地加密 · JSON 存储', {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.queryByText('解锁密码本')).toBeNull();
    expect(window.location.pathname).toBe('/');
    expect(mocks.tryRefreshSession).toHaveBeenCalledTimes(1);
  }, 10_000);

  it('没有刷新令牌时仍然要求输入主密码', async () => {
    stubStatus({ initialized: true, lockMinutes: 30 });
    mocks.getStatus.mockResolvedValue({ initialized: true, lockMinutes: 30 });
    mocks.tryRefreshSession.mockResolvedValue(null);
    setPath('/');

    render(<App />);

    expect(await screen.findByText('解锁密码本', {}, { timeout: 4000 })).toBeTruthy();
    expect(window.location.pathname).toBe('/login');
    expect(useAuthStore.getState().accessToken).toBeNull();
  }, 10_000);

  it('内存里已有令牌时不再多余地调用续期接口', async () => {
    stubStatus({ initialized: true, lockMinutes: 30 });
    mocks.getStatus.mockResolvedValue({ initialized: true, lockMinutes: 30 });
    useAuthStore.getState().setToken('existing-token');
    setPath('/');

    render(<App />);

    expect(await screen.findByText('本地加密 · JSON 存储', {}, { timeout: 4000 })).toBeTruthy();
    expect(mocks.tryRefreshSession).not.toHaveBeenCalled();
  }, 10_000);
});
