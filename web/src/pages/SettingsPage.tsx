import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Progress,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CloudSyncOutlined,
  InfoCircleOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import {
  changeMaster as changeMasterApi,
  createBackup,
  getConfig,
  health,
  listAudit,
  updateConfig,
} from '../api';
import { useAuthStore } from '../stores/authStore';
import { formatBytes, formatTime } from '../utils/format';
import { humanize } from '../utils/errors';
import { useNotify } from '../utils/notify';
import { useNavigate } from 'react-router-dom';
import type { AuditItem, BackupResult, Pagination, SystemConfig, SystemHealth } from '../types';

const MASTER_RULES = [
  { required: true, message: '请输入主密码' },
  { min: 10, message: '主密码至少 10 个字符' },
];

interface MasterForm {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

/** 系统设置：改主密码 / 系统配置 / 备份 / 审计日志 / 关于 */
export default function SettingsPage() {
  const navigate = useNavigate();

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        系统设置
      </Typography.Title>
      <Tabs
        defaultActiveKey="master"
        items={[
          {
            key: 'master',
            label: (
              <Space>
                <SafetyCertificateOutlined />
                修改主密码
              </Space>
            ),
            children: <MasterPasswordTab onDone={() => navigate('/login', { replace: true })} />,
          },
          {
            key: 'config',
            label: (
              <Space>
                <SaveOutlined />
                系统配置
              </Space>
            ),
            children: <ConfigTab />,
          },
          {
            key: 'backup',
            label: (
              <Space>
                <CloudSyncOutlined />
                数据备份
              </Space>
            ),
            children: <BackupTab />,
          },
          {
            key: 'audit',
            label: (
              <Space>
                <InfoCircleOutlined />
                审计日志
              </Space>
            ),
            children: <AuditTab />,
          },
          {
            key: 'about',
            label: (
              <Space>
                <LockOutlined />
                关于 / 健康检查
              </Space>
            ),
            children: <AboutTab />,
          },
        ]}
      />
    </Space>
  );
}

// ===================== 修改主密码 =====================

function MasterPasswordTab({ onDone }: { onDone: () => void }) {
  const [form] = Form.useForm<MasterForm>();
  const { message, modal } = useNotify();
  const [submitting, setSubmitting] = useState(false);

  const onFinish = (values: MasterForm) => {
    modal.confirm({
      title: '确认修改主密码？',
      content:
        '修改后所有已登录设备都会退出，需要使用新主密码重新解锁。请确保新主密码已被妥善记录。',
      okText: '确认修改',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setSubmitting(true);
        try {
          const result = await changeMasterApi(values.currentPassword, values.newPassword);
          message.success(
            `主密码已修改（重加密 ${result.reencryptedEntries} 个字段），请使用新主密码重新解锁`,
          );
          useAuthStore.getState().clear();
          form.resetFields();
          onDone();
        } catch (err) {
          message.error(humanize(err));
        } finally {
          setSubmitting(false);
        }
      },
    });
  };

  return (
    <Card style={{ maxWidth: 560 }}>
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message="修改主密码会立即使当前登录失效"
        description="dev 模式下仅重新封装数据加密密钥（秒级完成）；strict 模式下会全量重加密所有条目，条目越多耗时越长。"
      />
      <Form form={form} layout="vertical" onFinish={onFinish} requiredMark={false}>
        <Form.Item name="currentPassword" label="当前主密码" rules={MASTER_RULES}>
          <Input.Password placeholder="请输入当前主密码" autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新主密码"
          rules={[
            ...MASTER_RULES,
            {
              validator(_, value: string) {
                if (!value) return Promise.resolve();
                if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
                  return Promise.reject(new Error('新主密码需同时包含字母和数字'));
                }
                return Promise.resolve();
              },
            },
          ]}
        >
          <Input.Password placeholder="至少 10 位，含字母与数字" autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirm"
          label="确认新主密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新主密码' },
            ({ getFieldValue }) => ({
              validator(_, value: string) {
                if (!value || getFieldValue('newPassword') === value) return Promise.resolve();
                return Promise.reject(new Error('两次输入的新主密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password placeholder="再次输入新主密码" autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" danger htmlType="submit" loading={submitting}>
          修改主密码
        </Button>
      </Form>
    </Card>
  );
}

// ===================== 系统配置 =====================

function ConfigTab() {
  const [form] = Form.useForm<SystemConfig>();
  const { message } = useNotify();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      form.setFieldsValue(await getConfig());
    } catch (err) {
      message.error(humanize(err));
    } finally {
      setLoading(false);
    }
  }, [form, message]);

  useEffect(() => {
    void load();
  }, [load]);

  const onFinish = async (values: SystemConfig) => {
    setSaving(true);
    try {
      form.setFieldsValue(await updateConfig(values));
      message.success('配置已保存');
    } catch (err) {
      message.error(humanize(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <Spin />;

  return (
    <Card style={{ maxWidth: 560 }}>
      <Form form={form} layout="vertical" onFinish={onFinish}>
        <Form.Item
          name="lockMinutes"
          label="令牌有效期（分钟）"
          tooltip="超过该时长未操作需重新解锁"
          rules={[{ required: true, message: '请输入' }]}
        >
          <InputNumber min={1} max={1440} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="failedAttempts"
          label="允许连续失败次数"
          tooltip="达到上限后锁定账户"
          rules={[{ required: true, message: '请输入' }]}
        >
          <InputNumber min={3} max={10} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="lockMinutesAfterBan"
          label="锁定时长（分钟）"
          rules={[{ required: true, message: '请输入' }]}
        >
          <InputNumber min={1} max={1440} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="minPasswordLength"
          label="主密码最小长度"
          tooltip="仅影响新设主密码，已存在主密码不受影响"
          rules={[{ required: true, message: '请输入' }]}
        >
          <InputNumber min={10} max={32} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="historyKeep"
          label="密码历史保留条数"
          rules={[{ required: true, message: '请输入' }]}
        >
          <InputNumber min={10} max={500} style={{ width: '100%' }} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
          保存配置
        </Button>
      </Form>
    </Card>
  );
}

// ===================== 数据备份 =====================

function BackupTab() {
  const { message } = useNotify();
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<BackupResult | null>(null);

  const doBackup = async () => {
    setBusy(true);
    try {
      const result = await createBackup();
      setLast(result);
      message.success(`备份完成：${result.backupId}`);
    } catch (err) {
      message.error(humanize(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card style={{ maxWidth: 640 }}>
        <Typography.Paragraph type="secondary">
          将 <Typography.Text code>data/</Typography.Text> 整个目录归档到{' '}
          <Typography.Text code>data/backups/&lt;时间戳&gt;/</Typography.Text>
          ，排除备份自身与进程锁文件。建议定期手动备份，并将归档复制到其他存储介质。
        </Typography.Paragraph>
        <Button type="primary" icon={<CloudSyncOutlined />} loading={busy} onClick={doBackup}>
          立即备份
        </Button>
        {last && (
          <Alert
            type="success"
            showIcon
            style={{ marginTop: 16 }}
            message={`备份成功：${last.backupId}`}
            description={
              <Descriptions column={1} size="small">
                <Descriptions.Item label="路径">{last.path}</Descriptions.Item>
                <Descriptions.Item label="文件数">{last.fileCount}</Descriptions.Item>
                <Descriptions.Item label="大小">{formatBytes(last.sizeBytes)}</Descriptions.Item>
                <Descriptions.Item label="时间">{formatTime(last.createdAt)}</Descriptions.Item>
              </Descriptions>
            }
          />
        )}
      </Card>
      <Alert
        type="info"
        showIcon
        message="恢复方法"
        description="停止服务 → 用备份目录内容整体覆盖 data/ → 重新启动服务。恢复后所有旧访问令牌仍然有效（JWT 密钥一并备份）。"
      />
    </Space>
  );
}

// ===================== 审计日志 =====================

function AuditTab() {
  const { message } = useNotify();
  const [data, setData] = useState<AuditItem[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ page: 1, size: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState('');

  const load = useCallback(
    async (page: number, size: number, ev: string) => {
      setLoading(true);
      try {
        const res = await listAudit({ page, size, event: ev || undefined });
        setData(res.data);
        setPagination(res.pagination);
      } catch (err) {
        message.error(humanize(err));
      } finally {
        setLoading(false);
      }
    },
    [message],
  );

  useEffect(() => {
    void load(1, 50, '');
  }, [load]);

  const columns: ColumnsType<AuditItem> = [
    { title: '时间', dataIndex: 'ts', key: 'ts', width: 180, render: (v: string) => formatTime(v) },
    {
      title: '事件',
      dataIndex: 'event',
      key: 'event',
      width: 170,
      render: (v: string) => (
        <Tag color={v.endsWith('_FAIL') || v === 'LOCKOUT' ? 'red' : 'blue'}>{v}</Tag>
      ),
    },
    { title: 'IP', dataIndex: 'ip', key: 'ip', width: 130, render: (v: string | null) => v || '-' },
    {
      title: '详情',
      dataIndex: 'detail',
      key: 'detail',
      ellipsis: true,
      render: (v: string | null) => v || '-',
    },
  ];

  return (
    <Card
      title="审计日志"
      extra={
        <Space>
          <Input.Search
            placeholder="按事件过滤，如 LOGIN_OK"
            allowClear
            style={{ width: 260 }}
            onSearch={(value) => {
              setEvent(value);
              void load(1, 50, value);
            }}
          />
          <Button onClick={() => void load(pagination.page, pagination.size, event)}>刷新</Button>
        </Space>
      }
    >
      <Table<AuditItem>
        rowKey={(row) => `${row.ts}-${row.event}-${row.detail ?? ''}`}
        columns={columns}
        dataSource={data}
        loading={loading}
        size="small"
        scroll={{ x: 760 }}
        pagination={{
          current: pagination.page,
          pageSize: pagination.size,
          total: pagination.total,
          showSizeChanger: false,
          showTotal: (total) => `共 ${total} 条`,
          onChange: (page, size) => void load(page, size || 50, event),
        }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        审计日志最多保留 1000 条（超出后自动轮转），且绝不记录密码明文。
      </Typography.Text>
    </Card>
  );
}

// ===================== 关于 / 健康检查 =====================

function AboutTab() {
  const { message } = useNotify();
  const [info, setInfo] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setInfo(await health());
    } catch (err) {
      message.error(humanize(err));
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spin />;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card style={{ maxWidth: 640 }}>
        {info && (
          <Descriptions column={1} size="small" bordered>
            <Descriptions.Item label="状态">
              <Tag color={info.status === 'ok' ? 'success' : 'error'}>{info.status}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="应用版本">{info.version}</Descriptions.Item>
            <Descriptions.Item label="数据结构版本">v{info.schemaVersion}</Descriptions.Item>
            <Descriptions.Item label="已初始化">{info.initialized ? '是' : '否'}</Descriptions.Item>
            <Descriptions.Item label="数据目录可写">
              {info.dataDirWritable ? (
                <Tag color="success">可写</Tag>
              ) : (
                <Tag color="error">不可写（将无法保存数据）</Tag>
              )}
            </Descriptions.Item>
            <Descriptions.Item label="运行时长">
              {Math.floor(info.uptimeSeconds / 3600)} 小时{' '}
              {Math.floor((info.uptimeSeconds % 3600) / 60)} 分钟
            </Descriptions.Item>
          </Descriptions>
        )}
        <Button style={{ marginTop: 16 }} onClick={() => void load()}>
          重新检查
        </Button>
      </Card>

      <Card style={{ maxWidth: 640 }} title="安全说明">
        <Progress percent={100} showInfo={false} strokeColor="#52c41a" />
        <ul style={{ paddingLeft: 20, margin: 0, lineHeight: 2 }}>
          <li>主密码经 PBKDF2-SHA256（31 万次迭代）派生密钥，数据库不存明文。</li>
          <li>条目密码与备注使用 AES-256-GCM 加密后落盘。</li>
          <li>访问令牌仅存内存，刷新令牌为 HttpOnly Cookie。</li>
          <li>登录限速 + 连续失败锁定，密码查看与复制均写入审计日志。</li>
          <li>数据全部保存在本地 data/ 目录，不经过任何第三方服务。</li>
        </ul>
      </Card>
    </Space>
  );
}
