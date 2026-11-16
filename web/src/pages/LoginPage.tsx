import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Form, Input, Space, Spin, Typography } from 'antd';
import { LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getStatus, login } from '../api';
import { useAuthStore } from '../stores/authStore';
import { formatTime } from '../utils/format';
import { humanize } from '../utils/errors';
import { useNotify } from '../utils/notify';
import type { ApiError, SystemStatus } from '../types';

interface FormValues {
  masterPassword: string;
}

/** 主密码解锁页 */
export default function LoginPage() {
  const [form] = Form.useForm<FormValues>();
  const navigate = useNavigate();
  const { message } = useNotify();
  const setToken = useAuthStore((s) => s.setToken);

  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await getStatus();
      setStatus(next);
      if (typeof next.lockMinutes === 'number') {
        useAuthStore.getState().setLockMinutes(next.lockMinutes);
      }
      if (!next.initialized) navigate('/setup', { replace: true });
    } catch {
      /* 状态接口失败不阻塞登录表单 */
    } finally {
      setChecking(false);
    }
  }, [navigate]);

  useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  const lockedUntil = status?.lockedUntil ? new Date(status.lockedUntil).getTime() : 0;
  const isLocked = lockedUntil > Date.now();

  const onFinish = async (values: FormValues) => {
    setSubmitting(true);
    try {
      const res = await login(values.masterPassword);
      setToken(res.accessToken);
      navigate('/', { replace: true });
    } catch (err) {
      const apiErr = err as ApiError;
      message.error(humanize(err));
      // 登录类错误后刷新剩余次数与锁定状态
      if ([401, 423, 429].includes(apiErr.status)) await refreshStatus();
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="page-center">
        <Spin />
      </div>
    );
  }

  return (
    <div className="page-center">
      <Card style={{ width: 420 }} styles={{ body: { padding: 32 } }}>
        <Space direction="vertical" size={8} style={{ width: '100%', textAlign: 'center' }}>
          <LockOutlined style={{ fontSize: 40, color: '#1677ff' }} />
          <Typography.Title level={3} style={{ margin: 0 }}>
            解锁密码本
          </Typography.Title>
          <Typography.Text type="secondary">
            输入主密码以解密本地数据（当前条目 {status?.entryCount ?? 0} 条）
          </Typography.Text>
        </Space>

        {isLocked && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 16 }}
            message="账户已锁定"
            description={`主密码错误次数过多，请于 ${formatTime(status?.lockedUntil)} 后再试。`}
          />
        )}
        {!isLocked && status && status.failedAttemptsRemaining < status.failedAttempts && (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 16 }}
            message={`剩余尝试次数 ${status.failedAttemptsRemaining} 次`}
            description="达到上限后将临时锁定 15 分钟。"
          />
        )}

        <Form form={form} layout="vertical" onFinish={onFinish} style={{ marginTop: 16 }}>
          <Form.Item
            name="masterPassword"
            label="主密码"
            rules={[{ required: true, message: '请输入主密码' }]}
          >
            <Input.Password placeholder="请输入主密码" autoFocus disabled={isLocked} />
          </Form.Item>
          <Button type="primary" htmlType="submit" block loading={submitting} disabled={isLocked}>
            解锁
          </Button>
        </Form>

        <Typography.Paragraph
          type="secondary"
          style={{ marginTop: 16, marginBottom: 0, fontSize: 12 }}
        >
          访问令牌仅保存在内存中，刷新页面需重新解锁；超时 {status?.lockMinutes ?? 30}{' '}
          分钟未操作将自动失效。
        </Typography.Paragraph>
      </Card>
    </div>
  );
}
