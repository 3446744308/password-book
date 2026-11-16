import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App as AntdApp } from 'antd';

/**
 * 条目列表页：验证新增的「查看详情」入口及其与编辑弹窗的衔接。
 * 这里只关心交互链路，条目卡片内部的字段渲染由 entryDetail.test.tsx 覆盖。
 */

const mocks = vi.hoisted(() => ({
  listEntries: vi.fn(),
  listCategories: vi.fn(),
  getPresets: vi.fn(),
  deleteEntry: vi.fn(),
  getEntry: vi.fn(),
  createEntry: vi.fn(),
  updateEntry: vi.fn(),
  revealEntry: vi.fn(),
  listHistory: vi.fn(),
  revealHistory: vi.fn(),
  restorePassword: vi.fn(),
}));

vi.mock('../src/api', () => mocks);

vi.mock('../src/utils/clipboard', () => ({ copyText: vi.fn().mockResolvedValue(true) }));

import ListPage from '../src/pages/ListPage';
import { useDataStore } from '../src/stores/dataStore';

const ENTRY_ID = '01M7HAXV3WH7CZZMWZ0T7QY42W';

const ROW = {
  id: ENTRY_ID,
  categoryId: 'cat-1',
  title: '公司邮箱',
  username: 'me@company.com',
  url: 'https://mail.company.com',
  hasPassword: true,
  favorite: false,
  tags: ['工作'],
  createdAt: '2026-11-01T09:00:00.000Z',
  updatedAt: '2026-11-16T09:00:00.000Z',
};

const DETAIL = {
  ...ROW,
  notes: '备注内容',
  passwordVersion: 2,
};

beforeEach(() => {
  Object.values(mocks).forEach((fn) => fn.mockReset());
  mocks.listEntries.mockResolvedValue({
    data: [ROW],
    pagination: { page: 1, size: 20, total: 1 },
  });
  mocks.getEntry.mockResolvedValue(DETAIL);
  mocks.revealEntry.mockResolvedValue({
    id: ENTRY_ID,
    password: 'Str0ng!Pass',
    notes: '备注内容',
    fetchedAt: '2026-11-16T09:00:00.000Z',
  });

  useDataStore.setState({
    entries: [ROW],
    pagination: { page: 1, size: 20, total: 1 },
    categories: [{ id: 'cat-1', name: '公司分类', icon: 'project', sortOrder: 10 }],
    loading: false,
    keyword: '',
    categoryId: undefined,
    favoriteOnly: false,
  });
});

describe('条目列表的详情入口', () => {
  it('每行都有「查看详情」按钮，点击后拉取详情并打开抽屉', async () => {
    render(
      <AntdApp>
        <ListPage />
      </AntdApp>,
    );

    const detailButton = await screen.findByLabelText('查看详情');
    fireEvent.click(detailButton);

    await waitFor(() => expect(mocks.getEntry).toHaveBeenCalledWith(ENTRY_ID));
    expect(await screen.findByText('条目详情')).toBeTruthy();
    // 抽屉里能看到列表上没有的备注
    expect(await screen.findByText('备注内容')).toBeTruthy();
  });

  it('从详情里点「编辑」会关掉抽屉并打开编辑弹窗', async () => {
    render(
      <AntdApp>
        <ListPage />
      </AntdApp>,
    );

    fireEvent.click(await screen.findByLabelText('查看详情'));
    await screen.findByText('条目详情');

    fireEvent.click(screen.getByRole('button', { name: '编辑条目' }));

    // 编辑弹窗标题出现，说明抽屉已让位给编辑
    expect(await screen.findByText('编辑条目')).toBeTruthy();
    await waitFor(() => expect(mocks.getEntry).toHaveBeenCalledWith(ENTRY_ID));
  });
});
