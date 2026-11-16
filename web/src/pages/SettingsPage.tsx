import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Spin,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  CheckCircleTwoTone,
  CloudSyncOutlined,
  ReloadOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import {
  changeMaster as changeMasterApi,
  createBackup,
  getConfig,
  health,
  listAudit,
  updateConfig,
} from '../api';
import { useAuthStore } from '../stores/authStore';
import {
  auditEventFilterOptions,
  auditEventMeta,
  describeAuditDetail,
  describeAuditIp,
} from '../utils/audit';
import { formatBytes, formatRelativeTime, formatTime } from '../utils/format';
import { humanize } from '../utils/errors';
import { useNotify } from '../utils/notify';
import type { AuditItem, BackupResult, Pagination, SystemConfig, SystemHealth } from '../types';

/** 设置分区标识，与侧边栏子菜单、路由一一对应 */
export type SettingsSection = 'master' | 'config' | 'backup' | 'audit' | 'about';

/** 各分区的页头文案 */
const SECTION_META: Record<SettingsSection, { title: string; description: string }> = {
  master: {
    title: '修改主密码',
    description: '主密码不落盘，修改后所有已登录设备都需要重新解锁。',
  },
  config: {
    title: '系统配置',
    description: '会话时长、失败锁定策略、主密码强度要求与密码历史保留条数。',
  },
  backup: {
    title: '数据备份',
    description: '把 data/ 目录整体归档，或查看恢复流程与保管建议。',
  },
  audit: {
    title: '审计日志',
    description: '登录、查看密码等敏感操作的留痕，最多保留 1000 条。',
  },
  about: {
    title: '关于与健康检查',
    description: '运行状态、数据目录可写性与安全设计说明。',
  },
};

const MASTER_RULES = [
  { required: true, message: '请输入主密码' },
  { min: 10, message: '主密码至少 10 个字符' },
];

/** 「安全说明」固定文案 */
const SECURITY_NOTES = [
  '主密码经 PBKDF2-SHA256（31 万次迭代）派生密钥，数据库不存明文。',
  '条目密码与备注使用 AES-256-GCM 加密后落盘。',
  '访问令牌仅存内存，刷新令牌为 HttpOnly Cookie。',
  '连续失败锁定保护主密码，查看与复制密码均写入审计日志。',
  '数据全部保存在本地 data/ 目录，不经过任何第三方服务。',
];

interface MasterForm {
  currentPassword: string;
  newPassword: string;
  confirm: string;
}

/**
 * 主题感知的项目符号列表。
 * 用 Typography 包一层是为了拿到 antd 的 colorText 令牌——裸 <ul> 在暗色模式下
 * 会沿用浏览器默认黑字，落在深色卡片上不可读。
 */
function RichList({ items, check = false }: { items: ReactNode[]; check?: boolean }) {
  return (
    <Typography className="settings-list-block">
      <ul className={check ? 'settings-list settings-list--check' : 'settings-list'}>
        {items.map((item, index) => (
          <li key={index}>
            {check && <CheckCircleTwoTone twoToneColor="#52c41a" className="settings-list__icon" />}
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </Typography>
  );
}

/**
 * 设置功能页。
 *
 * 分区导航由**侧边栏子菜单**承担（见 MainLayout），页面内不再放 Tabs，
 * 避免两套导航并存。这里只按 section 渲染对应功能区：
 * - 页头：分区标题 + 一句话说明
 * - 主体：单张卡片铺满内容区；内部用栅格与控件宽度上限控制观感，
 *   不给容器加 max-width（否则宽屏下右侧会留白）
 */
export default function SettingsPage({ section }: { section: SettingsSection }) {
  const navigate = useNavigate();
  const meta = SECTION_META[section];

  return (
    <div className="settings-page">
      <Typography.Title level={4} className="settings-title">
        {meta.title}
      </Typography.Title>
      <Typography.Paragraph type="secondary" className="settings-subtitle">
        {meta.description}
      </Typography.Paragraph>

      <Card className="settings-card">
        {section === 'master' && (
          <MasterPasswordTab onDone={() => navigate('/login', { replace: true })} />
        )}
        {section === 'config' && <ConfigTab />}
        {section === 'backup' && <BackupTab />}
        {section === 'audit' && <AuditTab />}
        {section === 'about' && <AboutTab />}
      </Card>
    </div>
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
    <div className="settings-pane">
      {/* 页宽铺满后，用栅格把「表单」与「说明」按比例摊开，密码字段两列并排，
          避免输入框被拉到整行那么长 */}
      <Row gutter={[24, 24]}>
        <Col xs={24} xl={14}>
          <Alert
            type="warning"
            showIcon
            message="修改主密码会立即使当前登录失效"
            description="所有已签发的访问令牌都会作废，需要用新主密码重新解锁；已保存的条目数据不受影响。"
          />
          <Form
            form={form}
            layout="vertical"
            onFinish={onFinish}
            requiredMark={false}
            className="settings-form"
          >
            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item name="currentPassword" label="当前主密码" rules={MASTER_RULES}>
                  <Input.Password placeholder="请输入当前主密码" autoComplete="current-password" />
                </Form.Item>
              </Col>

              <Col xs={24} md={12}>
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
                  <Input.Password
                    placeholder="至少 10 位，含字母与数字"
                    autoComplete="new-password"
                  />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col xs={24} md={12}>
                <Form.Item
                  name="confirm"
                  label="确认新主密码"
                  dependencies={['newPassword']}
                  rules={[
                    { required: true, message: '请再次输入新主密码' },
                    ({ getFieldValue }) => ({
                      validator(_, value: string) {
                        if (!value || getFieldValue('newPassword') === value) {
                          return Promise.resolve();
                        }
                        return Promise.reject(new Error('两次输入的新主密码不一致'));
                      },
                    }),
                  ]}
                >
                  <Input.Password placeholder="再次输入新主密码" autoComplete="new-password" />
                </Form.Item>
              </Col>
            </Row>

            <div className="settings-actions">
              <Button type="primary" danger htmlType="submit" loading={submitting}>
                修改主密码
              </Button>
            </div>
          </Form>
        </Col>

        <Col xs={24} xl={10}>
          <Card size="small" title="关于主密码">
            <RichList
              items={[
                '主密码不落盘，库里只保存校验值（PBKDF2-SHA256，31 万次迭代）。',
                '忘记主密码无法找回，建议离线记录在只有你能取到的地方。',
                <>
                  <Typography.Text code>dev</Typography.Text> 模式只重新封装数据密钥（秒级完成）；
                  <Typography.Text code>strict</Typography.Text> 模式会全量重加密所有条目。
                </>,
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
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

  if (loading) {
    return (
      <div className="settings-pane">
        <Spin />
      </div>
    );
  }

  return (
    <div className="settings-pane">
      <Form form={form} layout="vertical" onFinish={onFinish} className="settings-form">
        <Card size="small" title="会话与锁定" className="settings-group">
          <Row gutter={16}>
            <Col xs={24} sm={12} xl={8}>
              <Form.Item
                name="lockMinutes"
                label="会话时长（分钟）"
                tooltip="访问令牌的实际有效期；改动只影响之后新签发的令牌"
                rules={[{ required: true, message: '请输入' }]}
              >
                <InputNumber min={1} max={1440} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} xl={8}>
              <Form.Item
                name="failedAttempts"
                label="允许连续失败次数"
                tooltip="达到上限后锁定账户"
                rules={[{ required: true, message: '请输入' }]}
              >
                <InputNumber min={3} max={10} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} xl={8}>
              <Form.Item
                name="lockMinutesAfterBan"
                label="锁定时长（分钟）"
                tooltip="连续失败达到上限后，需要等待多久才能再次尝试"
                rules={[{ required: true, message: '请输入' }]}
              >
                <InputNumber min={1} max={1440} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <Card size="small" title="密码与历史" className="settings-group">
          <Row gutter={16}>
            <Col xs={24} sm={12} xl={8}>
              <Form.Item
                name="minPasswordLength"
                label="主密码最小长度"
                tooltip="仅影响新设主密码，已存在主密码不受影响"
                rules={[{ required: true, message: '请输入' }]}
              >
                <InputNumber min={10} max={32} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col xs={24} sm={12} xl={8}>
              <Form.Item
                name="historyKeep"
                label="密码历史保留条数"
                tooltip="超出后丢弃最旧的版本"
                rules={[{ required: true, message: '请输入' }]}
              >
                <InputNumber min={10} max={500} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
          </Row>
        </Card>

        <div className="settings-actions">
          <Button type="primary" htmlType="submit" loading={saving} icon={<SaveOutlined />}>
            保存配置
          </Button>
          <Button icon={<ReloadOutlined />} onClick={() => void load()}>
            重新加载
          </Button>
        </div>
      </Form>
    </div>
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
    <div className="settings-pane">
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={14}>
          <Card size="small" title="立即备份">
            <Typography.Paragraph type="secondary">
              将 <Typography.Text code>data/</Typography.Text> 整个目录归档到{' '}
              <Typography.Text code>data/backups/&lt;时间戳&gt;/</Typography.Text>
              ，自动排除备份自身与进程锁文件。
            </Typography.Paragraph>
            <Button type="primary" icon={<CloudSyncOutlined />} loading={busy} onClick={doBackup}>
              立即备份
            </Button>
            {last && (
              <Alert
                type="success"
                showIcon
                className="settings-group"
                message={`备份成功：${last.backupId}`}
                description={
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label="路径">{last.path}</Descriptions.Item>
                    <Descriptions.Item label="文件数">{last.fileCount}</Descriptions.Item>
                    <Descriptions.Item label="大小">
                      {formatBytes(last.sizeBytes)}
                    </Descriptions.Item>
                    <Descriptions.Item label="时间">{formatTime(last.createdAt)}</Descriptions.Item>
                  </Descriptions>
                }
              />
            )}
          </Card>
        </Col>

        <Col xs={24} lg={10}>
          <Card size="small" title="恢复与保管建议">
            <RichList
              items={[
                '恢复：停服 → 用备份目录内容整体覆盖 data/ → 重新启动。',
                <>
                  <Typography.Text code>jwt.secret</Typography.Text>{' '}
                  一并恢复时旧令牌仍然有效；只覆盖业务数据则需重新解锁。
                </>,
                '备份目录同样含密钥材料，请不要放进任何第三方云同步目录。',
                '建议定期手动备份，并复制到其它存储介质。',
              ]}
            />
          </Card>
        </Col>
      </Row>
    </div>
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
    {
      title: '时间',
      dataIndex: 'ts',
      key: 'ts',
      width: 190,
      render: (ts: string) => {
        const relative = formatRelativeTime(ts);
        return (
          <div className="audit-time">
            <span>{formatTime(ts)}</span>
            {relative && <span className="audit-time__relative">{relative}</span>}
          </div>
        );
      },
    },
    {
      title: '操作',
      dataIndex: 'event',
      key: 'event',
      width: 150,
      render: (code: string) => {
        const meta = auditEventMeta(code);
        // 中文名给人看，原始事件码留在 tooltip 里，排查问题时仍能对上日志文件
        return (
          <Tooltip title={`事件码：${code}`}>
            <Tag color={meta.color}>{meta.label}</Tag>
          </Tooltip>
        );
      },
    },
    {
      title: '来源',
      dataIndex: 'ip',
      key: 'ip',
      width: 130,
      render: (ip: string | null) => describeAuditIp(ip),
    },
    {
      title: '详情',
      dataIndex: 'detail',
      key: 'detail',
      ellipsis: true,
      render: (detail: string | null, row) => (
        <span title={detail ?? ''}>{describeAuditDetail(row.event, detail)}</span>
      ),
    },
  ];

  return (
    <div className="settings-pane">
      <Card
        size="small"
        title="审计日志"
        extra={
          <Space>
            <Select
              allowClear
              showSearch
              placeholder="筛选操作类型"
              style={{ width: 200 }}
              optionFilterProp="label"
              options={auditEventFilterOptions()}
              value={event || undefined}
              onChange={(value?: string) => {
                const next = value ?? '';
                setEvent(next);
                void load(1, 50, next);
              }}
            />
            <Button
              icon={<ReloadOutlined />}
              onClick={() => void load(pagination.page, pagination.size, event)}
            >
              刷新
            </Button>
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
          locale={{
            emptyText: event ? '没有该类型的操作记录' : '还没有任何操作记录',
          }}
          pagination={{
            current: pagination.page,
            pageSize: pagination.size,
            total: pagination.total,
            showSizeChanger: false,
            showTotal: (total) => `共 ${total} 条`,
            onChange: (page, size) => void load(page, size || 50, event),
          }}
        />
        <Typography.Text type="secondary" className="settings-note">
          审计日志最多保留 1000 条（超出后自动轮转），且绝不记录密码明文。
          鼠标悬停操作标签可看到原始事件码。
        </Typography.Text>
      </Card>
    </div>
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

  if (loading) {
    return (
      <div className="settings-pane">
        <Spin />
      </div>
    );
  }

  return (
    <div className="settings-pane">
      <Row gutter={[24, 24]}>
        <Col xs={24} lg={12}>
          <Card
            size="small"
            title="运行状态"
            extra={
              <Button size="small" icon={<ReloadOutlined />} onClick={() => void load()}>
                重新检查
              </Button>
            }
          >
            {info && (
              <Descriptions column={1} size="small">
                <Descriptions.Item label="状态">
                  <Tag color={info.status === 'ok' ? 'success' : 'error'}>{info.status}</Tag>
                </Descriptions.Item>
                <Descriptions.Item label="应用版本">{info.version}</Descriptions.Item>
                <Descriptions.Item label="数据结构版本">v{info.schemaVersion}</Descriptions.Item>
                <Descriptions.Item label="已初始化">
                  {info.initialized ? '是' : '否'}
                </Descriptions.Item>
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
          </Card>
        </Col>

        <Col xs={24} lg={12}>
          <Card size="small" title="安全说明">
            <RichList items={SECURITY_NOTES} check />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
