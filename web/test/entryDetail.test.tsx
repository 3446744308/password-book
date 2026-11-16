import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';

/**
 * 条目详情抽屉：列表只返回摘要字段，详情抽屉按需拉 GET /entries/:id，
 * 把备注、分类、密码版本、时间等摊开，并提供编辑/历史/删除入口。
 */

const mocks = vi.hoisted(() => ({
  getEntry: vi.fn(),
  revealEntry: vi.fn(),
  copyText: vi.fn(),
}));

vi.mock('../src/api', () => ({
  getEntry: mocks.getEntry,
  revealEntry: mocks.revealEntry,
}));

vi.mock('../src/utils/clipboard', () => ({
  copyText: mocks.copyText,
}));

import EntryDetailDrawer from '../src/components/EntryDetailDrawer';
import { useDataStore } from '../src/stores/dataStore';

const ENTRY_ID = '01M7HAXV3WH7CZZMWZ0T7QY42W';

const DETAIL = {
  id: ENTRY_ID,
  categoryId: 'cat-1',
  title: '公司邮箱',
  username: 'me@company.com',
  url: 'https://mail.company.com',
  notes: '备用邮箱：backup@company.com\n恢复码在保险箱',
  favorite: true,
  tags: ['工作', '邮箱'],
  hasPassword: true,
  passwordVersion: 3,
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-16T09:00:00.000Z',
};

function renderDrawer(props: Partial<Parameters<typeof EntryDetailDrawer>[0]> = {}) {
  return render(
    <AntdApp>
      <EntryDetailDrawer
        open
        entryId={ENTRY_ID}
        onClose={() => {}}
        onEdit={() => {}}
        onShowHistory={() => {}}
        onDelete={() => {}}
        {...props}
      />
    </AntdApp>,
  );
}

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.getEntry.mockResolvedValue(DETAIL);
  mocks.revealEntry.mockResolvedValue({
    id: ENTRY_ID,
    password: 'Str0ng!Pass',
    notes: DETAIL.notes,
    fetchedAt: '2026-11-16T09:00:00.000Z',
  });
  mocks.copyText.mockResolvedValue(true);
  useDataStore.setState({
    categories: [{ id: 'cat-1', name: '公司分类', icon: 'project', sortOrder: 10 }],
  });
});

describe('条目详情抽屉', () => {
  it('打开时按 id 拉取详情并展示完整字段', async () => {
    renderDrawer();

    await waitFor(() => expect(mocks.getEntry).toHaveBeenCalledWith(ENTRY_ID));

    expect(await screen.findByText('公司邮箱')).toBeTruthy();
    expect(screen.getByText('me@company.com')).toBeTruthy();
    expect(screen.getByText('https://mail.company.com')).toBeTruthy();
    // 分类 ID 翻成分类名（用不与标签重名的名字，避免选择器歧义）
    expect(screen.getByText('公司分类')).toBeTruthy();
    expect(screen.getByText('工作')).toBeTruthy();
    expect(screen.getByText('邮箱')).toBeTruthy();
    // 备注保留换行内容
    expect(screen.getByText(/恢复码在保险箱/)).toBeTruthy();
    // 密码版本
    expect(screen.getByText('v3')).toBeTruthy();
    // 条目 ID 也展示出来，便于与审计日志对齐
    expect(screen.getByText(ENTRY_ID)).toBeTruthy();
  });

  it('密码默认掩码，点击眼睛才向服务端取明文', async () => {
    renderDrawer();
    await screen.findByText('公司邮箱');

    expect(screen.getByText('••••••••')).toBeTruthy();
    expect(mocks.revealEntry).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('显示密码'));

    await waitFor(() => expect(mocks.revealEntry).toHaveBeenCalledWith(ENTRY_ID));
    expect(await screen.findByText('Str0ng!Pass')).toBeTruthy();
  });

  it('账号可一键复制', async () => {
    renderDrawer();
    await screen.findByText('公司邮箱');

    fireEvent.click(screen.getByLabelText('复制账号'));

    await waitFor(() => expect(mocks.copyText).toHaveBeenCalledWith('me@company.com'));
  });

  it('编辑 / 历史版本 / 删除 会回传条目 id', async () => {
    const onEdit = vi.fn();
    const onShowHistory = vi.fn();
    const onDelete = vi.fn();
    renderDrawer({ onEdit, onShowHistory, onDelete });

    await screen.findByText('公司邮箱');

    fireEvent.click(screen.getByRole('button', { name: '编辑条目' }));
    expect(onEdit).toHaveBeenCalledWith(ENTRY_ID);

    fireEvent.click(screen.getByRole('button', { name: '查看历史版本' }));
    expect(onShowHistory).toHaveBeenCalledWith(ENTRY_ID);

    fireEvent.click(screen.getByRole('button', { name: '删除条目' }));
    expect(onDelete).toHaveBeenCalledWith(ENTRY_ID);
  });

  it('空字段显示占位符而不是空白', async () => {
    mocks.getEntry.mockResolvedValue({
      ...DETAIL,
      username: '',
      url: '',
      notes: null,
      tags: [],
      hasPassword: false,
      passwordVersion: 0,
    });
    renderDrawer();

    await screen.findByText('公司邮箱');
    // 账号 / 网址 / 标签 / 备注 / 密码 五处占位
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    expect(screen.getAllByText('未设置').length).toBeGreaterThanOrEqual(1);
  });

  it('加载失败展示错误而不是空白抽屉', async () => {
    mocks.getEntry.mockRejectedValue({
      status: 404,
      code: 'NOT_FOUND',
      message: '条目不存在',
    });
    renderDrawer();

    await waitFor(() => expect(mocks.getEntry).toHaveBeenCalled());
    expect(await screen.findByText(/条目不存在/)).toBeTruthy();
  });
});
