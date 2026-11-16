import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Space, Typography } from 'antd';
import { CopyOutlined, EyeInvisibleOutlined, EyeOutlined } from '@ant-design/icons';
import { revealEntry } from '../api';
import { copyText } from '../utils/clipboard';
import { humanize } from '../utils/errors';
import { useNotify } from '../utils/notify';

interface Props {
  entryId: string;
  hasPassword: boolean;
}

const MASK = '••••••••';
/** 展示 30 秒后自动重新掩码（设计文档 §6.2） */
const AUTO_HIDE_MS = 30_000;

/** 密码字段：眼睛切换（调 reveal 审计接口）+ 直接复制 + 定时掩码 */
export default function SecretField({ entryId, hasPassword }: Props) {
  const { message } = useNotify();
  const [shown, setShown] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const clearTimer = useCallback(() => {
    if (timer.current !== undefined) {
      window.clearTimeout(timer.current);
      timer.current = undefined;
    }
  }, []);

  const hide = useCallback(() => setShown(null), []);

  useEffect(() => clearTimer, [clearTimer]);

  // 窗口失焦 / 页面切到后台立即掩码（docs/02 §6.11），不必等满 30 秒
  useEffect(() => {
    const mask = () => {
      clearTimer();
      hide();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') mask();
    };
    window.addEventListener('blur', mask);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('blur', mask);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [clearTimer, hide]);

  const toggle = async () => {
    if (shown) {
      clearTimer();
      hide();
      return;
    }
    if (!hasPassword) return;
    setLoading(true);
    try {
      const data = await revealEntry(entryId);
      setShown(data.password);
      clearTimer();
      timer.current = window.setTimeout(hide, AUTO_HIDE_MS);
    } catch (err) {
      message.error(humanize(err));
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!hasPassword) return;
    try {
      const data = await revealEntry(entryId);
      const ok = await copyText(data.password);
      if (ok) message.success('密码已复制到剪贴板');
      else message.warning('复制失败，请手动选择复制');
    } catch (err) {
      message.error(humanize(err));
    }
  };

  if (!hasPassword) {
    return <Typography.Text type="secondary">未设置</Typography.Text>;
  }

  return (
    <Space size={2}>
      <span className="secret-text">{shown ?? MASK}</span>
      <Button
        size="small"
        type="text"
        aria-label={shown ? '隐藏密码' : '显示密码'}
        icon={shown ? <EyeInvisibleOutlined /> : <EyeOutlined />}
        loading={loading}
        onClick={toggle}
      />
      <Button
        size="small"
        type="text"
        aria-label="复制密码"
        icon={<CopyOutlined />}
        onClick={copy}
      />
    </Space>
  );
}
