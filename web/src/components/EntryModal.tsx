import { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Switch, Tag } from 'antd';
import { KeyOutlined } from '@ant-design/icons';
import { createEntry, getEntry, updateEntry } from '../api';
import PasswordGenerator from './PasswordGenerator';
import useDataStore from '../stores/dataStore';
import { humanize, applyFieldErrors } from '../utils/errors';
import { useNotify } from '../utils/notify';
import type { EntryCreateInput } from '../types';

interface Props {
  open: boolean;
  entryId?: string;
  defaultCategoryId?: string;
  onClose: () => void;
  onSaved: () => void;
}

type PasswordMode = 'keep' | 'set' | 'clear';

interface FormValues {
  title: string;
  username?: string;
  url?: string;
  categoryId?: string;
  tags?: string[];
  favorite?: boolean;
  notes?: string;
}

/** 条目新建/编辑弹窗（密码字段支持 生成 / 保留 / 清除 三态） */
export default function EntryModal({ open, entryId, defaultCategoryId, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>();
  const { message } = useNotify();
  const categories = useDataStore((s) => s.categories);
  const loadCategories = useDataStore((s) => s.loadCategories);

  const [saving, setSaving] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [hasExistingPassword, setHasExistingPassword] = useState(false);
  const [pwMode, setPwMode] = useState<PasswordMode>('keep');
  const [pwValue, setPwValue] = useState('');
  const [genOpen, setGenOpen] = useState(false);

  const isEdit = Boolean(entryId);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setPwMode('keep');
    setPwValue('');
    setHasExistingPassword(false);
    if (!isEdit) {
      form.setFieldsValue({
        categoryId: defaultCategoryId ?? '_default',
        favorite: false,
        tags: [],
        username: '',
        url: '',
        notes: '',
      });
      return;
    }
    setLoadingDetail(true);
    getEntry(entryId as string)
      .then((detail) => {
        setHasExistingPassword(detail.hasPassword);
        form.setFieldsValue({
          title: detail.title,
          username: detail.username,
          url: detail.url,
          categoryId: detail.categoryId,
          tags: detail.tags,
          favorite: detail.favorite,
          notes: detail.notes ?? '',
        });
      })
      .catch((err) => message.error(humanize(err)))
      .finally(() => setLoadingDetail(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, entryId, isEdit]);

  const onFinish = async (values: FormValues) => {
    setSaving(true);
    try {
      if (!isEdit) {
        const payload: EntryCreateInput = {
          title: values.title,
          username: values.username || undefined,
          url: values.url || undefined,
          categoryId: values.categoryId,
          tags: values.tags ?? [],
          favorite: values.favorite ?? false,
          notes: values.notes || undefined,
          password: pwMode === 'set' && pwValue ? pwValue : undefined,
        };
        await createEntry(payload);
        message.success('条目已创建');
      } else {
        const payload: Omit<EntryCreateInput, 'password'> & { password?: string | null } = {
          title: values.title,
          username: values.username ?? '',
          url: values.url ?? '',
          categoryId: values.categoryId,
          tags: values.tags ?? [],
          favorite: values.favorite ?? false,
          notes: values.notes ?? '',
        };
        if (pwMode === 'set') payload.password = pwValue;
        else if (pwMode === 'clear') payload.password = null;
        await updateEntry(entryId as string, payload);
        message.success('条目已保存');
      }
      await loadCategories();
      onSaved();
      onClose();
    } catch (err) {
      applyFieldErrors(err, form.setFields);
      message.error(humanize(err));
    } finally {
      setSaving(false);
    }
  };

  const passwordHint = (() => {
    if (!isEdit) return '可留空';
    if (pwMode === 'clear') return '保存后将清除密码（原密码进历史）';
    if (pwMode === 'set') return '保存后将更新密码（原密码进历史）';
    return hasExistingPassword ? '留空保持原密码不变' : '当前未设置密码';
  })();

  return (
    <>
      <Modal
        title={isEdit ? '编辑条目' : '新建条目'}
        open={open}
        onCancel={onClose}
        width={640}
        destroyOnHidden
        confirmLoading={saving || loadingDetail}
        footer={
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={saving} onClick={() => form.submit()}>
              {isEdit ? '保存' : '创建'}
            </Button>
          </Space>
        }
      >
        <Form form={form} layout="vertical" onFinish={onFinish} disabled={loadingDetail}>
          <Form.Item
            name="title"
            label="标题"
            rules={[
              { required: true, message: '请输入标题' },
              { max: 100, message: '标题最多 100 字符' },
            ]}
          >
            <Input placeholder="例如：GitHub、公司邮箱" maxLength={100} />
          </Form.Item>

          <Form.Item
            name="username"
            label="账号 / 用户名"
            rules={[{ max: 200, message: '账号最多 200 字符' }]}
          >
            <Input placeholder="用户名 / 邮箱 / 手机号" maxLength={200} />
          </Form.Item>

          <Form.Item
            label={
              <Space>
                <span>密码</span>
                {isEdit && hasExistingPassword && pwMode !== 'clear' && (
                  <Tag color="green">已设置</Tag>
                )}
                <TypographyHint text={passwordHint} />
              </Space>
            }
            required
          >
            <Space.Compact block>
              <Input.Password
                value={pwValue}
                placeholder={passwordHint}
                onChange={(e) => {
                  setPwValue(e.target.value);
                  if (pwMode !== 'set') setPwMode('set');
                }}
              />
              <Button icon={<KeyOutlined />} onClick={() => setGenOpen(true)}>
                生成
              </Button>
              {isEdit && hasExistingPassword && pwMode !== 'clear' && (
                <Button
                  onClick={() => {
                    setPwMode('clear');
                    setPwValue('');
                    message.info('已标记清除，保存后生效');
                  }}
                >
                  清除
                </Button>
              )}
              {pwMode === 'clear' && (
                <Button
                  onClick={() => {
                    setPwMode('keep');
                    message.info('已取消清除');
                  }}
                >
                  取消清除
                </Button>
              )}
            </Space.Compact>
          </Form.Item>

          <Form.Item
            name="url"
            label="网址"
            rules={[{ pattern: /^$|^https?:\/\/.+/, message: '网址需以 http:// 或 https:// 开头' }]}
          >
            <Input placeholder="https://example.com" maxLength={500} />
          </Form.Item>

          <Space size={16} style={{ display: 'flex' }}>
            <Form.Item name="categoryId" label="分类" style={{ width: 200 }}>
              <Select
                options={categories.map((c) => ({ value: c.id, label: c.name }))}
                placeholder="选择分类"
              />
            </Form.Item>
            <Form.Item name="favorite" label="收藏" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>

          <Form.Item
            name="tags"
            label="标签"
            rules={[{ max: 10, type: 'array', message: '最多 10 个标签' }]}
          >
            <Select
              mode="tags"
              tokenSeparators={[',', ' ']}
              placeholder="回车添加标签（最多 10 个）"
              maxTagCount={6}
              open={false}
            />
          </Form.Item>

          <Form.Item
            name="notes"
            label="备注"
            rules={[{ max: 2000, message: '备注最多 2000 字符' }]}
          >
            <Input.TextArea
              rows={3}
              maxLength={2000}
              showCount
              placeholder="安全提示、恢复邮箱等"
            />
          </Form.Item>
        </Form>
      </Modal>

      <PasswordGenerator
        open={genOpen}
        onClose={() => setGenOpen(false)}
        onUse={(pw) => {
          setPwValue(pw);
          setPwMode('set');
          setGenOpen(false);
          message.success('已填入生成的密码');
        }}
      />
    </>
  );
}

function TypographyHint({ text }: { text: string }) {
  return <span style={{ color: 'rgba(0,0,0,0.45)', fontWeight: 400, fontSize: 12 }}>{text}</span>;
}
