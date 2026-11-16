import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';
import { MemoryRouter } from 'react-router-dom';

/**
 * 系统设置页测试。
 *
 * 该页刚做过布局重构（横向 Tab 卡片 → 单卡片 + 左侧导航 + 栅格内容），
 * 这里锁住结构与各分区的取数行为，避免以后改样式时把功能改坏。
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

const CONFIG = {
  lockMinutes: 30,
  failedAttempts: 5,
  lockMinutesAfterBan: 15,
  minPasswordLength: 10,
  defaultCategoryId: '_default',
  historyKeep: 50,
};

function renderPage() {
  return render(
    <AntdApp>
      <MemoryRouter>
        <SettingsPage />
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

describe('系统设置页布局', () => {
  it('页头 + 单一卡片 + 左侧导航，五个分区入口齐全', () => {
    const { container } = renderPage();

    expect(screen.getByText('系统设置')).toBeTruthy();
    expect(container.querySelector('.settings-page')).toBeTruthy();
    // 布局核心：Tab 竖排在卡片内，保证切换分区时外框尺寸不变
    expect(container.querySelector('.settings-tabs')).toBeTruthy();

    for (const name of [/修改主密码/, /系统配置/, /数据备份/, /审计日志/, /关于与健康检查/]) {
      expect(screen.getByRole('tab', { name })).toBeTruthy();
    }
  });

  it('默认进入「修改主密码」分区', () => {
    renderPage();
    expect(screen.getByLabelText('当前主密码')).toBeTruthy();
    expect(screen.getByLabelText('新主密码')).toBeTruthy();
    expect(screen.getByLabelText('确认新主密码')).toBeTruthy();
    // 右侧说明栏与本分区同屏，避免出现大片空白
    expect(screen.getByText('关于主密码')).toBeTruthy();
  });
});

describe('切到各分区', () => {
  it('系统配置：拉取配置并按两栏分组渲染，保存后回填', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /系统配置/ }));

    await waitFor(() => expect(mocks.getConfig).toHaveBeenCalledTimes(1));

    // 分组标题
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

  it('数据备份：点「立即备份」后展示备份结果', async () => {
    mocks.createBackup.mockResolvedValue({
      backupId: '20261116-120000',
      label: 'manual',
      path: 'data/backups/20261116-120000',
      fileCount: 9,
      sizeBytes: 48213,
      createdAt: '2026-11-16T12:00:00.000Z',
    });

    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /数据备份/ }));

    expect(await screen.findByText('恢复与保管建议')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /立即备份/ }));

    await waitFor(() => expect(mocks.createBackup).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/备份成功：20261116-120000/)).toBeTruthy();
  });

  it('审计日志：表格占满宽度并渲染事件', async () => {
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('tab', { name: /审计日志/ }));

    await waitFor(() => expect(mocks.listAudit).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('LOGIN_OK')).toBeTruthy();
    // 宽表用 --wide 不受表单限宽约束
    expect(container.querySelector('.settings-pane--wide')).toBeTruthy();
  });
});
