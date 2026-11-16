import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Descriptions, Divider, Drawer, Space, Spin, Tag, Typography } from 'antd';
import {
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  HistoryOutlined,
  LinkOutlined,
  StarFilled,
} from '@ant-design/icons';
import { getEntry } from '../api';
import SecretField from './SecretField';
import useDataStore from '../stores/dataStore';
import { formatTime } from '../utils/format';
import { humanize } from '../utils/errors';
import { useNotify } from '../utils/notify';
import { copyText } from '../utils/clipboard';
import type { EntryDetail } from '../types';

interface Props {
  open: boolean;
  entryId?: string;
  onClose: () => void;
  onEdit: (id: string) => void;
  onShowHistory: (id: string) => void;
  onDelete: (id: string) => void;
}

/**
 * 条目详情抽屉（只读）。
 *
 * 列表为了轻量只返回非敏感摘要，备注、分类、密码版本、创建时间等都拿不到；
 * 这里按需拉 `GET /entries/:id` 把完整信息摊开，并复用 SecretField 处理密码
 * 的「点击才 reveal + 定时掩码」。
 */
export default function EntryDetailDrawer({
  open,
  entryId,
  onClose,
  onEdit,
  onShowHistory,
  onDelete,
}: Props) {
  const { message } = useNotify();
  const categories = useDataStore((s) => s.categories);

  const [detail, setDetail] = useState<EntryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!entryId) return;
    setLoading(true);
    setError(null);
    try {
      setDetail(await getEntry(entryId));
    } catch (err) {
      setDetail(null);
      setError(humanize(err));
    } finally {
      setLoading(false);
    }
  }, [entryId]);

  useEffect(() => {
    if (!open) return;
    setDetail(null);
    void load();
  }, [open, load]);

  const categoryName = detail
    ? (categories.find((c) => c.id === detail.categoryId)?.name ?? detail.categoryId)
    : '';

  const copyUsername = async (username: string) => {
    const ok = await copyText(username);
    if (ok) message.success('账号已复制');
    else message.warning('复制失败');
  };

  return (
    <Drawer
      title="条目详情"
      open={open}
      onClose={onClose}
      width={560}
      extra={
        detail && (
          <Space size={4}>
            <Button
              size="small"
              type="text"
              aria-label="查看历史版本"
              icon={<HistoryOutlined />}
              onClick={() => onShowHistory(detail.id)}
            >
              历史版本
            </Button>
            <Button
              size="small"
              type="text"
              aria-label="编辑条目"
              icon={<EditOutlined />}
              onClick={() => onEdit(detail.id)}
            >
              编辑
            </Button>
            <Button
              size="small"
              type="text"
              danger
              aria-label="删除条目"
              icon={<DeleteOutlined />}
              onClick={() => onDelete(detail.id)}
            >
              删除
            </Button>
          </Space>
        )
      }
    >
      {loading && (
        <div className="entry-detail-loading">
          <Spin />
        </div>
      )}

      {!loading && error && <Alert type="error" showIcon message={error} />}

      {!loading && detail && (
        <Descriptions column={1} size="small" bordered className="entry-detail">
          <Descriptions.Item label="标题">
            <Space size={6}>
              {detail.favorite && <StarFilled style={{ color: '#faad14' }} />}
              <Typography.Text strong>{detail.title}</Typography.Text>
            </Space>
          </Descriptions.Item>

          <Descriptions.Item label="账号">
            {detail.username ? (
              <Space size={4}>
                <span>{detail.username}</span>
                <Button
                  size="small"
                  type="text"
                  aria-label="复制账号"
                  icon={<CopyOutlined />}
                  onClick={() => void copyUsername(detail.username)}
                />
              </Space>
            ) : (
              <span className="entry-detail-empty">—</span>
            )}
          </Descriptions.Item>

          <Descriptions.Item label="密码">
            <SecretField entryId={detail.id} hasPassword={detail.hasPassword} />
          </Descriptions.Item>

          <Descriptions.Item label="网址">
            {detail.url ? (
              <a href={detail.url} target="_blank" rel="noreferrer noopener">
                <LinkOutlined /> {detail.url}
              </a>
            ) : (
              <span className="entry-detail-empty">—</span>
            )}
          </Descriptions.Item>

          <Descriptions.Item label="分类">{categoryName || '—'}</Descriptions.Item>

          <Descriptions.Item label="标签">
            {detail.tags.length ? (
              <Space size={4} wrap>
                {detail.tags.map((tag) => (
                  <Tag key={tag}>{tag}</Tag>
                ))}
              </Space>
            ) : (
              <span className="entry-detail-empty">—</span>
            )}
          </Descriptions.Item>

          <Descriptions.Item label="备注">
            {detail.notes ? (
              <span className="entry-detail-notes">{detail.notes}</span>
            ) : (
              <span className="entry-detail-empty">—</span>
            )}
          </Descriptions.Item>

          <Descriptions.Item label="密码版本">
            {detail.passwordVersion ? `v${detail.passwordVersion}` : '未设置'}
          </Descriptions.Item>

          <Descriptions.Item label="创建时间">{formatTime(detail.createdAt)}</Descriptions.Item>

          <Descriptions.Item label="更新时间">{formatTime(detail.updatedAt)}</Descriptions.Item>

          <Descriptions.Item label="条目 ID">
            <Typography.Text code copyable={{ text: detail.id }} className="entry-detail-id">
              {detail.id}
            </Typography.Text>
          </Descriptions.Item>
        </Descriptions>
      )}

      <Divider />
      <Typography.Text type="secondary" className="entry-detail-hint">
        密码默认掩码，点击眼睛图标才会向服务端取明文（每次查看都会写入审计日志），30
        秒后自动重新掩码。
      </Typography.Text>
    </Drawer>
  );
}
