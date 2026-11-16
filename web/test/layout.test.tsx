import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

/**
 * 侧边栏导航测试。
 *
 * 设置分区被提到侧边栏做可展开子菜单，右侧内容区只承载当前分区。
 * 这里验证：子菜单存在且默认展开、点击子项会切换到对应路由。
 */

const mocks = vi.hoisted(() => ({
  logout: vi.fn(),
  listCategories: vi.fn(),
  listEntries: vi.fn(),
  getPresets: vi.fn(),
}));

vi.mock('../src/api', () => ({
  logout: mocks.logout,
  listCategories: mocks.listCategories,
  listEntries: mocks.listEntries,
  getPresets: mocks.getPresets,
}));

import MainLayout from '../src/components/MainLayout';

function PathProbe() {
  const location = useLocation();
  return <div data-testid="path">{location.pathname}</div>;
}

function renderLayout(initialPath = '/') {
  return render(
    <AntdApp>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route element={<MainLayout />}>
            <Route index element={<PathProbe />} />
            <Route path="*" element={<PathProbe />} />
          </Route>
        </Routes>
      </MemoryRouter>
    </AntdApp>,
  );
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.listCategories.mockResolvedValue([
    { id: '_default', name: '默认分类', icon: 'folder', sortOrder: 0, entryCount: 0 },
  ]);
  mocks.listEntries.mockResolvedValue({ data: [], pagination: { page: 1, size: 20, total: 0 } });
  mocks.getPresets.mockResolvedValue({ categories: [], tags: ['常用'] });
});

describe('侧边栏设置子菜单', () => {
  it('系统设置是可展开的子菜单，默认展开并列出五个分区', () => {
    renderLayout();

    expect(screen.getByText('系统设置')).toBeTruthy();
    for (const label of ['修改主密码', '系统配置', '数据备份', '审计日志', '关于与健康检查']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('点击子项跳转到对应路由', () => {
    renderLayout();

    fireEvent.click(screen.getByText('系统配置'));
    expect(screen.getByTestId('path').textContent).toBe('/settings/config');

    fireEvent.click(screen.getByText('审计日志'));
    expect(screen.getByTestId('path').textContent).toBe('/settings/audit');
  });

  it('直接进入 /settings/* 时会高亮对应子项', () => {
    const { container } = renderLayout('/settings/backup');

    const selected = container.querySelector('.ant-menu-item-selected');
    expect(selected?.textContent).toContain('数据备份');
  });
});

describe('左右独立滚动', () => {
  it('侧栏菜单区与右侧内容区是两个独立滚动容器，整页不滚动', () => {
    const { container } = renderLayout();

    expect(container.querySelector('.app-layout')).toBeTruthy();
    expect(container.querySelector('.app-sider-menu')).toBeTruthy();

    const content = container.querySelector('.app-content');
    expect(content).toBeTruthy();

    // 顶栏在内容区之外，滚内容时顶栏保持可见
    const header = container.querySelector('.app-header');
    expect(header).toBeTruthy();
    expect(content?.contains(header as Node)).toBe(false);
  });
});
