import { useCallback, useEffect, useState } from 'react';
import { Button, Drawer, Empty, Input, Modal, Space, Spin, Timeline, Typography } from 'antd';
import { EyeOutlined, UndoOutlined } from '@ant-design/icons';
import { listHistory, revealHistory, restorePassword } from '../api';
import { copyText } from '../utils/clipboard';
import { formatTime } from '../utils/format';
import { humanize } from '../utils/errors';
import { useNotify } from '../utils/notify';
import type { HistoryReveal, HistoryVersion } from '../types';

interface Props {
  open: boolean;
  entryId?: string;
  onClose: () => void;
  onRestored: () => void;
}

/** 密码历史抽屉：查看版本明文（审计）+ 恢复指定版本 */
export default function HistoryDrawer({ open, entryId, onClose, onRestored }: Props) {
  const { message, modal } = useNotify();
  const [versions, setVersions] = useState<HistoryVersion[]>([]);
  const [loading, setLoading] = useState(false);
  const [viewing, setViewing] = useState<HistoryReveal | null>(null);

  const load = useCallback(async () => {
    if (!entryId) return;
    setLoading(true);
    try {
      const res = await listHistory(entryId, 1, 50);
      setVersions(res.data);
    } catch (err) {
      message.error(humanize(err));
    } finally {
      setLoading(false);
    }
  }, [entryId, message]);

  useEffect(() => {
    if (open && entryId) void load();
  }, [open, entryId, load]);

  const handleView = (version: number) => {
    modal.confirm({
      title: `查看版本 v${version} 的密码？`,
      content: '此次查看会写入审计日志。',
      okText: '查看',
      cancelText: '取消',
      onOk: async () => {
        try {
          setViewing(await revealHistory(entryId as string, version));
        } catch (err) {
          message.error(humanize(err));
        }
      },
    });
  };

  const handleRestore = (version: number) => {
    modal.confirm({
      title: `恢复版本 v${version}？`,
      content: '当前密码会先归入历史，再把 v' + version + ' 设为当前密码。',
      okText: '恢复',
      cancelText: '取消',
      onOk: async () => {
        try {
          const result = await restorePassword(entryId as string, version);
          message.success(`已恢复为 v${version}，当前版本 v${result.currentVersion}`);
          await load();
          onRestored();
        } catch (err) {
          message.error(humanize(err));
        }
      },
    });
  };

  return (
    <>
      <Drawer
        title="密码历史"
        open={open}
        onClose={onClose}
        width={440}
        extra={<Typography.Text type="secondary">仅显示最近 50 条</Typography.Text>}
      >
        <Spin spinning={loading}>
          {versions.length === 0 ? (
            <Empty description="暂无历史版本（修改一次密码后生成）" />
          ) : (
            <Timeline
              items={versions.map((v) => ({
                color: 'blue',
                children: (
                  <div>
                    <Space wrap>
                      <Typography.Text strong>v{v.version}</Typography.Text>
                      <Typography.Text type="secondary">{formatTime(v.changedAt)}</Typography.Text>
                    </Space>
                    {v.changeNote && (
                      <div>
                        <Typography.Text type="secondary">{v.changeNote}</Typography.Text>
                      </div>
                    )}
                    <Space style={{ marginTop: 6 }}>
                      <Button size="small" icon={<EyeOutlined />} onClick={() => handleView(v.version)}>
                        查看密码
                      </Button>
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        icon={<UndoOutlined />}
                        onClick={() => handleRestore(v.version)}
                      >
                        恢复此版本
                      </Button>
                    </Space>
                  </div>
                ),
              }))}
            />
          )}
        </Spin>
      </Drawer>

      <Modal
        title={viewing ? `版本 v${viewing.version} 的密码` : '密码'}
        open={Boolean(viewing)}
        onCancel={() => setViewing(null)}
        footer={
          <Space>
            <Button
              onClick={async () => {
                if (!viewing) return;
                const ok = await copyText(viewing.password);
                if (ok) message.success('已复制');
                else message.warning('复制失败');
              }}
            >
              复制
            </Button>
            <Button type="primary" onClick={() => setViewing(null)}>
              关闭
            </Button>
          </Space>
        }
      >
        <Input.Password value={viewing?.password ?? ''} readOnly />
        {viewing && (
          <Typography.Text type="secondary" style={{ display: 'block', marginTop: 8 }}>
            变更时间：{formatTime(viewing.changedAt)}
          </Typography.Text>
        )}
      </Modal>
    </>
  );
}
