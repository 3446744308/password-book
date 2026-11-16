import { useEffect, useState } from 'react';
import { Button, Empty, Input, Popconfirm, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  LinkOutlined,
  PlusOutlined,
  StarFilled,
} from '@ant-design/icons';
import SecretField from '../components/SecretField';
import EntryModal from '../components/EntryModal';
import HistoryDrawer from '../components/HistoryDrawer';
import useDataStore from '../stores/dataStore';
import { deleteEntry } from '../api';
import { copyText } from '../utils/clipboard';
import { formatTime } from '../utils/format';
import { humanize } from '../utils/errors';
import { useNotify } from '../utils/notify';
import type { EntryListItem } from '../types';

/** 主界面：搜索 + 条目表格 + 新建/编辑/历史/删除 */
export default function ListPage() {
  const { message } = useNotify();
  const {
    entries,
    pagination,
    loading,
    keyword,
    favoriteOnly,
    categoryId,
    categories,
    loadEntries,
    loadCategories,
    setFilter,
  } = useDataStore();

  const [search, setSearch] = useState(keyword);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [historyId, setHistoryId] = useState<string | undefined>(undefined);

  // 初次加载
  useEffect(() => {
    loadEntries().catch((err) => message.error(humanize(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadEntries]);

  // 搜索防抖 300ms
  useEffect(() => {
    if (search === keyword) return;
    const timer = window.setTimeout(() => setFilter({ keyword: search }), 300);
    return () => window.clearTimeout(timer);
  }, [search, keyword, setFilter]);

  const scopeTitle = favoriteOnly
    ? '收藏条目'
    : categoryId
      ? (categories.find((c) => c.id === categoryId)?.name ?? '分类条目')
      : '全部条目';

  const handleDelete = async (id: string) => {
    try {
      await deleteEntry(id);
      message.success('条目已删除');
      await loadEntries();
      await loadCategories();
    } catch (err) {
      message.error(humanize(err));
    }
  };

  const columns: ColumnsType<EntryListItem> = [
    {
      title: '标题',
      dataIndex: 'title',
      key: 'title',
      width: 240,
      ellipsis: true,
      render: (title: string, record) => (
        <Space size={6}>
          {record.favorite && <StarFilled style={{ color: '#faad14' }} />}
          {record.url ? (
            <a href={record.url} target="_blank" rel="noreferrer noopener">
              <LinkOutlined style={{ marginRight: 6 }} />
              {title}
            </a>
          ) : (
            <span>{title}</span>
          )}
        </Space>
      ),
    },
    {
      title: '账号',
      dataIndex: 'username',
      key: 'username',
      width: 200,
      ellipsis: true,
      render: (username: string) =>
        username ? (
          <Space size={4}>
            <span>{username}</span>
            <Button
              size="small"
              type="text"
              aria-label="复制账号"
              icon={<CopyOutlined />}
              onClick={async () => {
                const ok = await copyText(username);
                if (ok) message.success('账号已复制');
                else message.warning('复制失败');
              }}
            />
          </Space>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    {
      title: '密码',
      key: 'password',
      width: 200,
      render: (_, record) => <SecretField entryId={record.id} hasPassword={record.hasPassword} />,
    },
    {
      title: '标签',
      key: 'tags',
      width: 170,
      render: (_, record) =>
        record.tags.length ? (
          <Space size={4} wrap>
            {record.tags.slice(0, 3).map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
            {record.tags.length > 3 && <Tag>+{record.tags.length - 3}</Tag>}
          </Space>
        ) : (
          <Typography.Text type="secondary">-</Typography.Text>
        ),
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      key: 'updatedAt',
      width: 170,
      render: (value: string) => formatTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size={2}>
          <Button
            size="small"
            type="text"
            aria-label="编辑"
            icon={<EditOutlined />}
            onClick={() => {
              setEditingId(record.id);
              setModalOpen(true);
            }}
          />
          <Button
            size="small"
            type="text"
            aria-label="历史版本"
            icon={<HistoryOutlined />}
            onClick={() => setHistoryId(record.id)}
          />
          <Popconfirm
            title="删除该条目？"
            description="历史版本将移入回收区，7 天后自动清理"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(record.id)}
          >
            <Button size="small" type="text" danger aria-label="删除" icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Space style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }} wrap>
        <Space align="center">
          <Typography.Title level={4} style={{ margin: 0 }}>
            {scopeTitle}
          </Typography.Title>
          <Tag color="blue">共 {pagination.total} 条</Tag>
        </Space>
        <Space wrap>
          <Input.Search
            allowClear
            placeholder="搜索标题 / 账号 / 网址 / 标签"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: 300 }}
            aria-label="搜索条目"
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              setEditingId(undefined);
              setModalOpen(true);
            }}
          >
            新建条目
          </Button>
        </Space>
      </Space>

      <Table<EntryListItem>
        rowKey="id"
        columns={columns}
        dataSource={entries}
        loading={loading}
        scroll={{ x: 960 }}
        locale={{
          emptyText: (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                keyword || favoriteOnly || categoryId
                  ? '没有符合条件的条目'
                  : '还没有条目，点击右上角“新建条目”开始'
              }
            />
          ),
        }}
        pagination={{
          current: pagination.page,
          pageSize: pagination.size,
          total: pagination.total,
          showSizeChanger: false,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, size) => {
            void loadEntries({ page, size: size || pagination.size });
          },
        }}
      />

      <EntryModal
        open={modalOpen}
        entryId={editingId}
        defaultCategoryId={categoryId ?? '_default'}
        onClose={() => setModalOpen(false)}
        onSaved={() => {
          void loadEntries();
          void loadCategories();
        }}
      />

      <HistoryDrawer
        open={Boolean(historyId)}
        entryId={historyId}
        onClose={() => setHistoryId(undefined)}
        onRestored={() => {
          void loadEntries();
        }}
      />
    </div>
  );
}
