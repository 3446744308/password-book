import { useCallback, useMemo, useState } from 'react';
import { Button, Checkbox, Input, Modal, Slider, Space, Tag, Typography } from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import { copyText } from '../utils/clipboard';
import { estimateEntropy, entropyLevel, generatePassword } from '../utils/password';
import { useNotify } from '../utils/notify';

interface Props {
  open: boolean;
  onClose: () => void;
  onUse: (password: string) => void;
}

const OPTIONS = [
  { label: '小写字母', value: 'lower' },
  { label: '大写字母', value: 'upper' },
  { label: '数字', value: 'digit' },
  { label: '符号', value: 'symbol' },
];

/** 密码生成器：长度/字符集可调 + 熵值显示 */
export default function PasswordGenerator({ open, onClose, onUse }: Props) {
  const { message } = useNotify();
  const [length, setLength] = useState(20);
  const [flags, setFlags] = useState<string[]>(['lower', 'upper', 'digit', 'symbol']);

  const password = useMemo(() => generatePassword(length, flags), [length, flags]);
  const entropy = useMemo(() => estimateEntropy(flags, length), [flags, length]);

  const onCopy = useCallback(async () => {
    if (!password) return;
    const ok = await copyText(password);
    if (ok) message.success('已复制生成的密码');
    else message.warning('复制失败');
  }, [password, message]);

  const level = entropyLevel(entropy);
  const entropyTag =
    level === 'strong' ? (
      <Tag color="success">强 · {entropy} bits</Tag>
    ) : level === 'medium' ? (
      <Tag color="warning">中 · {entropy} bits</Tag>
    ) : (
      <Tag color="error">弱 · {entropy} bits</Tag>
    );

  return (
    <Modal
      title="密码生成器"
      open={open}
      onCancel={onClose}
      width={480}
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" disabled={!password} onClick={() => onUse(password)}>
            使用此密码
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Input.Search
          readOnly
          value={password}
          enterButton={<Button icon={<CopyOutlined />} />}
          onSearch={onCopy}
          aria-label="生成的密码"
        />

        <div>
          <Typography.Text>长度：{length}</Typography.Text>
          <Slider min={8} max={64} value={length} onChange={setLength} />
        </div>

        <div>
          <Typography.Text>字符类型：</Typography.Text>
          <div style={{ marginTop: 8 }}>
            <Checkbox.Group
              options={OPTIONS}
              value={flags}
              onChange={(vals) => setFlags(vals as string[])}
            />
          </div>
        </div>

        <Space>
          {entropyTag}
          <Typography.Text type="secondary">基于随机字符估算，不含常见弱口令规则</Typography.Text>
        </Space>
      </Space>
    </Modal>
  );
}
