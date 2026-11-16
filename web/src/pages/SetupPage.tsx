import { useEffect, useState } from 'react';
import { Button, Card, Form, Input, Space, Spin, Typography } from 'antd';
import { CheckCircleTwoTone, CloseCircleTwoTone, LockOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { getStatus, login, setup } from '../api';
import { useAuthStore } from '../stores/authStore';
import { applyFieldErrors, humanize } from '../utils/errors';
import { useNotify } from '../utils/notify';

interface FormValues {
  masterPassword: string;
  confirm: string;
}

const MIN_LENGTH = 10;

/** 首次初始化：创建主密码（仅系统未初始化时可访问） */
export default function SetupPage() {
  const [form] = Form.useForm<FormValues>();
  const navigate = useNavigate();
  const { message } = useNotify();
  const setToken = useAuthStore((s) => s.setToken);

  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStatus()
      .then((status) => {
        if (cancelled) return;
        setChecking(false);
        if (status.initialized) navigate('/login', { replace: true });
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  const password = Form.useWatch('masterPassword', form) ?? '';
  const lenOk = password.length >= MIN_LENGTH;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const strengthOk = lenOk && hasLetter && hasDigit;

  const onFinish = async (values: FormValues) => {
    setSubmitting(true);
    try {
      await setup(values.masterPassword);
      const res = await login(values.masterPassword);
      setToken(res.accessToken);
      message.success('主密码创建成功，已自动解锁');
      navigate('/', { replace: true });
    } catch (err) {
      applyFieldErrors(err, form.setFields);
      message.error(humanize(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (checking) {
    return (
      <div className="page-center">
        {/* antd 的 Spin 只有 nest/fullscreen 模式才会显示 tip，裸用会告警，故不带文案 */}
        <Spin size="large" />
      </div>
    );
  }

  return (
    <div className="page-center">
      <Card style={{ width: 460 }} styles={{ body: { padding: 32 } }}>
        <Space direction="vertical" size={8} style={{ width: '100%', textAlign: 'center' }}>
          <LockOutlined style={{ fontSize: 40, color: '#1677ff' }} />
          <Typography.Title level={3} style={{ margin: 0 }}>
            创建主密码
          </Typography.Title>
          <Typography.Text type="secondary">
            主密码是打开密码本的唯一钥匙：忘记即无法找回数据，请务必离线妥善保管。
          </Typography.Text>
        </Space>

        <Form
          form={form}
          layout="vertical"
          onFinish={onFinish}
          style={{ marginTop: 24 }}
          requiredMark={false}
        >
          <Form.Item
            name="masterPassword"
            label="主密码"
            rules={[
              { required: true, message: '请输入主密码' },
              { min: MIN_LENGTH, message: `主密码至少 ${MIN_LENGTH} 个字符` },
            ]}
          >
            <Input.Password placeholder={`至少 ${MIN_LENGTH} 位，含字母与数字`} autoFocus />
          </Form.Item>

          <Form.Item
            name="confirm"
            label="确认主密码"
            dependencies={['masterPassword']}
            rules={[
              { required: true, message: '请再次输入主密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('masterPassword') === value) return Promise.resolve();
                  return Promise.reject(new Error('两次输入的主密码不一致'));
                },
              }),
            ]}
          >
            <Input.Password placeholder="再次输入主密码" />
          </Form.Item>

          <Space direction="vertical" size={4} style={{ marginBottom: 16, width: '100%' }}>
            <Requirement ok={lenOk} text={`至少 ${MIN_LENGTH} 个字符`} />
            <Requirement ok={hasLetter} text="包含字母" />
            <Requirement ok={hasDigit} text="包含数字" />
          </Space>

          <Button
            type="primary"
            htmlType="submit"
            block
            loading={submitting}
            disabled={!strengthOk}
          >
            创建主密码并进入
          </Button>
        </Form>
      </Card>
    </div>
  );
}

function Requirement({ ok, text }: { ok: boolean; text: string }) {
  return (
    <Space size={6}>
      {ok ? (
        <CheckCircleTwoTone twoToneColor="#52c41a" />
      ) : (
        <CloseCircleTwoTone twoToneColor="#d9d9d9" />
      )}
      <Typography.Text type={ok ? 'success' : 'secondary'}>{text}</Typography.Text>
    </Space>
  );
}
