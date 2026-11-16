import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';

/**
 * 设置功能页测试。
 *
 * 导航已上移到侧边栏子菜单，页面只按 section 渲染对应功能区（内部不再有 Tabs）。
 * 这里锁住「分区 → 内容」的映射与各区取数行为。
 */

const mocks = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  createBackup: vi.fn(),
  listAudit: vi.fn(),
  health: vi.fn(),
  changeMaster: vi.fn(),
}));

vi.mock('../src/api', () => ({
  getConfig: mocks.getConfig,
  updateConfig: mocks.updateConfig,
  createBackup: mocks.createBackup,
  listAudit: mocks.listAudit,
  health: mocks.health,
  changeMaster: mocks.changeMaster,
}));

import SettingsPage from '../src/pages/SettingsPage';
import type { SettingsSection } from '../src/pages/SettingsPage';

const CONFIG = {
  lockMinutes: 30,
  failedAttempts: 5,
  lockMinutesAfterBan: 15,
  minPasswordLength: 10,
  defaultCategoryId: '_default',
  historyKeep: 50,
};

function renderSection(section: SettingsSection) {
  return render(
    <AntdApp>
      <MemoryRouter>
        <SettingsPage section={section} />
      </MemoryRouter>
    </AntdApp>,
  );
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.getConfig.mockResolvedValue(CONFIG);
  mocks.health.mockResolvedValue({
    status: 'ok',
    version: '1.0.0',
    schemaVersion: 1,
    initialized: true,
    dataDirWritable: true,
    uptimeSeconds: 60,
  });
  mocks.listAudit.mockResolvedValue({
    data: [{ ts: '2026-11-16T09:00:00.000Z', event: 'LOGIN_OK', ip: '127.0.0.1', detail: null }],
    pagination: { page: 1, size: 50, total: 1 },
  });
});

describe('分区 → 内容映射', () => {
  it('master：页头为主密码标题，渲染三个密码字段与右栏说明', () => {
    const { container } = renderSection('master');

    expect(screen.getByRole('heading', { name: '修改主密码' })).toBeTruthy();
    expect(screen.getByLabelText('当前主密码')).toBeTruthy();
    expect(screen.getByLabelText('新主密码')).toBeTruthy();
    expect(screen.getByLabelText('确认新主密码')).toBeTruthy();
    expect(screen.getByText('关于主密码')).toBeTruthy();
    // 导航交给侧边栏，页面内不应再有 Tabs
    expect(container.querySelector('.ant-tabs')).toBeNull();
    expect(container.querySelector('.settings-page')).toBeTruthy();
  });

  it('config：拉取配置并按两栏分组渲染，保存后回填', async () => {
    renderSection('config');

    await waitFor(() => expect(mocks.getConfig).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('会话与锁定')).toBeTruthy();
    expect(screen.getByText('密码与历史')).toBeTruthy();

    const lockMinutes = (await screen.findByLabelText('会话时长（分钟）')) as HTMLInputElement;
    expect(lockMinutes.value).toBe('30');

    mocks.updateConfig.mockResolvedValue({ ...CONFIG, lockMinutes: 15 });
    fireEvent.click(screen.getByRole('button', { name: /保存配置/ }));

    await waitFor(() => expect(mocks.updateConfig).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect((screen.getByLabelText('会话时长（分钟）') as HTMLInputElement).value).toBe('15');
    });
  });

  it('backup：点「立即备份」后展示备份结果', async () => {
    mocks.createBackup.mockResolvedValue({
      backupId: '20261116-120000',
      label: 'manual',
      path: 'data/backups/20261116-120000',
      fileCount: 9,
      sizeBytes: 48213,
      createdAt: '2026-11-16T12:00:00.000Z',
    });

    renderSection('backup');
    expect(await screen.findByText('恢复与保管建议')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /立即备份/ }));
    await waitFor(() => expect(mocks.createBackup).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/备份成功：20261116-120000/)).toBeTruthy();
  });

  it('audit：表格占满宽度并渲染事件', async () => {
    const { container } = renderSection('audit');

    await waitFor(() => expect(mocks.listAudit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('LOGIN_OK')).toBeTruthy();
    expect(container.querySelector('.settings-pane--wide')).toBeTruthy();
  });

  it('about：渲染运行状态与安全说明', async () => {
    renderSection('about');

    await waitFor(() => expect(mocks.health).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('运行状态')).toBeTruthy();
    expect(screen.getByText('安全说明')).toBeTruthy();
    expect(screen.getByText(/PBKDF2-SHA256/)).toBeTruthy();
  });
});
