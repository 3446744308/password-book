import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactElement } from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';

/**
 * 组件级测试：覆盖 docs/02 §9.1 点名的 SecretField，以及密码生成器与空闲自动锁定。
 * antd 依赖 React context（App）与 portal，故统一包一层 AntdApp。
 */

const mocks = vi.hoisted(() => ({
  revealEntry: vi.fn(),
  copyText: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('../src/api', () => ({
  revealEntry: mocks.revealEntry,
  logout: mocks.logout,
}));

vi.mock('../src/utils/clipboard', () => ({
  copyText: mocks.copyText,
}));

import SecretField from '../src/components/SecretField';
import PasswordGenerator from '../src/components/PasswordGenerator';
import AutoLock from '../src/components/AutoLock';
import { useAuthStore } from '../src/stores/authStore';

const MASK = '••••••••';

function wrap(ui: ReactElement) {
  return render(<AntdApp>{ui}</AntdApp>);
}

function revealWith(password: string) {
  mocks.revealEntry.mockResolvedValue({ id: 'e1', password, notes: null, fetchedAt: '' });
}

beforeEach(() => {
  mocks.revealEntry.mockReset();
  mocks.copyText.mockReset();
  mocks.logout.mockReset();
  useAuthStore.getState().clear();
});

describe('SecretField', () => {
  it('无密码时显示"未设置"，且不提供查看/复制按钮', () => {
    wrap(<SecretField entryId="e1" hasPassword={false} />);
    expect(screen.getByText('未设置')).toBeTruthy();
    expect(screen.queryByLabelText('显示密码')).toBeNull();
    expect(screen.queryByLabelText('复制密码')).toBeNull();
  });

  it('默认掩码；点击眼睛才调 reveal 并显示明文', async () => {
    revealWith('Str0ng!Pass');
    wrap(<SecretField entryId="e1" hasPassword />);
    expect(screen.getByText(MASK)).toBeTruthy();
    expect(mocks.revealEntry).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('显示密码'));
    });

    expect(mocks.revealEntry).toHaveBeenCalledWith('e1');
    expect(screen.getByText('Str0ng!Pass')).toBeTruthy();
    expect(screen.queryByText(MASK)).toBeNull();
  });

  it('窗口失焦立即重新掩码（不等 30 秒）', async () => {
    revealWith('blur-secret');
    wrap(<SecretField entryId="e1" hasPassword />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('显示密码'));
    });
    expect(screen.getByText('blur-secret')).toBeTruthy();

    act(() => {
      fireEvent(window, new Event('blur'));
    });

    expect(screen.queryByText('blur-secret')).toBeNull();
    expect(screen.getByText(MASK)).toBeTruthy();
  });

  it('页面切到后台立即重新掩码', async () => {
    revealWith('hidden-secret');
    wrap(<SecretField entryId="e1" hasPassword />);
    await act(async () => {
      fireEvent.click(screen.getByLabelText('显示密码'));
    });
    expect(screen.getByText('hidden-secret')).toBeTruthy();

    const original = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      act(() => {
        document.dispatchEvent(new Event('visibilitychange'));
      });
    } finally {
      if (original) Object.defineProperty(Document.prototype, 'visibilityState', original);
      else delete (document as unknown as Record<string, unknown>).visibilityState;
    }

    expect(screen.queryByText('hidden-secret')).toBeNull();
  });

  it('显示 30 秒后自动重新掩码', async () => {
    vi.useFakeTimers();
    try {
      revealWith('auto-hide-secret');
      wrap(<SecretField entryId="e1" hasPassword />);
      await act(async () => {
        fireEvent.click(screen.getByLabelText('显示密码'));
      });
      expect(screen.getByText('auto-hide-secret')).toBeTruthy();

      await act(async () => {
        vi.advanceTimersByTime(29_000);
      });
      expect(screen.getByText('auto-hide-secret')).toBeTruthy();

      await act(async () => {
        vi.advanceTimersByTime(1_500);
      });
      expect(screen.queryByText('auto-hide-secret')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('复制按钮先 reveal 再写剪贴板', async () => {
    revealWith('copy-me');
    mocks.copyText.mockResolvedValue(true);
    wrap(<SecretField entryId="e1" hasPassword />);

    await act(async () => {
      fireEvent.click(screen.getByLabelText('复制密码'));
    });

    expect(mocks.revealEntry).toHaveBeenCalledWith('e1');
    expect(mocks.copyText).toHaveBeenCalledWith('copy-me');
    // 复制不改变显示状态，仍保持掩码
    expect(screen.getByText(MASK)).toBeTruthy();
  });
});

describe('PasswordGenerator', () => {
  it('默认生成 20 位密码，点击"使用此密码"回传生成结果', () => {
    const onUse = vi.fn();
    wrap(<PasswordGenerator open onClose={() => {}} onUse={onUse} />);

    const input = screen.getByLabelText('生成的密码') as HTMLInputElement;
    expect(input.value).toHaveLength(20);

    fireEvent.click(screen.getByText('使用此密码'));
    expect(onUse).toHaveBeenCalledWith(input.value);
  });

  it('显示熵值分级标签', () => {
    wrap(<PasswordGenerator open onClose={() => {}} onUse={() => {}} />);
    expect(screen.getByText(/bits/)).toBeTruthy();
  });

  it('取消关闭不回传密码', () => {
    const onUse = vi.fn();
    const onClose = vi.fn();
    wrap(<PasswordGenerator open onClose={onClose} onUse={onUse} />);
    // antd 的 Button 会给两个汉字之间插入空格（「取 消」），故用容错匹配
    fireEvent.click(screen.getByRole('button', { name: /取\s*消/ }));
    expect(onClose).toHaveBeenCalled();
    expect(onUse).not.toHaveBeenCalled();
  });
});

describe('AutoLock（空闲自动锁定）', () => {
  it('空闲超过 lockMinutes 即吊销令牌、清空登录态', async () => {
    vi.useFakeTimers();
    try {
      mocks.logout.mockResolvedValue(undefined);
      useAuthStore.getState().setToken('token-abc');
      useAuthStore.getState().setLockMinutes(1);

      render(
        <MemoryRouter initialEntries={['/']}>
          <AutoLock />
        </MemoryRouter>,
      );
      expect(useAuthStore.getState().accessToken).toBe('token-abc');

      // 1 分钟阈值 + 检查间隔（15s）余量
      await act(async () => {
        vi.advanceTimersByTime(61_000);
      });

      expect(mocks.logout).toHaveBeenCalledTimes(1);
      expect(useAuthStore.getState().accessToken).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('未超时则不锁定', async () => {
    vi.useFakeTimers();
    try {
      useAuthStore.getState().setToken('token-abc');
      useAuthStore.getState().setLockMinutes(30);

      render(
        <MemoryRouter initialEntries={['/']}>
          <AutoLock />
        </MemoryRouter>,
      );

      await act(async () => {
        vi.advanceTimersByTime(120_000);
      });

      expect(mocks.logout).not.toHaveBeenCalled();
      expect(useAuthStore.getState().accessToken).toBe('token-abc');
    } finally {
      vi.useRealTimers();
    }
  });

  it('未登录时不做任何事', async () => {
    vi.useFakeTimers();
    try {
      render(
        <MemoryRouter initialEntries={['/']}>
          <AutoLock />
        </MemoryRouter>,
      );
      await act(async () => {
        vi.advanceTimersByTime(10 * 60_000);
      });
      expect(mocks.logout).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
