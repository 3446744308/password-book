import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Empty,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import {
  DeleteOutlined,
  EditOutlined,
  FolderAddOutlined,
  FolderOutlined,
  LockOutlined,
  SaveOutlined,
} from '@ant-design/icons';
import { createCategory, deleteCategory, updateCategory } from '../api';
import useDataStore from '../stores/dataStore';
import { formatTime } from '../utils/format';
import { humanize } from '../utils/errors';
import { useNotify } from '../utils/notify';
import type { Category } from '../types';

interface FormValues {
  name: string;
  icon?: string;
  sortOrder?: number;
}

/** 分类管理：增删改 + 受保护分类规则 + 删除时迁移提示 */
export default function CategoriesPage() {
  const { message, modal } = useNotify();
  const categories = useDataStore((s) => s.categories);
  const loadCategories = useDataStore((s) => s.loadCategories);

  const [form] = Form.useForm<FormValues>();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadCategories().catch((err) => message.error(humanize(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadCategories]);

  const resetForm = () => {
    setEditingId(null);
    form.resetFields();
  };

  const onFinish = async (values: FormValues) => {
    setSaving(true);
    try {
      if (editingId) {
        await updateCategory(editingId, {
          name: values.name,
          icon: values.icon || 'folder',
          sortOrder: values.sortOrder,
        });
        message.success('分类已更新');
      } else {
        await createCategory({
          name: values.name,
          icon: values.icon || 'folder',
          sortOrder: values.sortOrder,
        });
        message.success('分类已创建');
      }
      resetForm();
      await loadCategories();
    } catch (err) {
      message.error(humanize(err));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (record: Category) => {
    setEditingId(record.id);
    form.setFieldsValue({
      name: record.name,
      icon: record.icon,
      sortOrder: record.sortOrder,
    });
  };

  const handleDelete = async (record: Category) => {
    try {
      const result = await deleteCategory(record.id);
      message.success(
        result.movedEntries > 0
          ? `分类已删除，${result.movedEntries} 个条目已迁移到「默认分类」`
          : '分类已删除',
      );
      if (editingId === record.id) resetForm();
      await loadCategories();
    } catch (err) {
      message.error(humanize(err));
    }
  };

  const askDelete = (record: Category) => {
    modal.confirm({
      title: `删除分类「${record.name}」？`,
      content:
        record.entryCount && record.entryCount > 0
          ? `该分类下有 ${record.entryCount} 个条目，删除后将全部迁移到「默认分类」，条目不会丢失。`
          : '该分类下没有条目，可安全删除。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => handleDelete(record),
    });
  };

  const columns: ColumnsType<Category> = [
    {
      title: '分类',
      key: 'name',
      render: (_, record) => (
        <Space size={8}>
          <FolderOutlined style={{ color: '#1677ff' }} />
          <Typography.Text strong>{record.name}</Typography.Text>
          {record.protected && (
            <Tag icon={<LockOutlined />} color="default">
              受保护
            </Tag>
          )}
        </Space>
      ),
    },
    {
      title: '条目数',
      dataIndex: 'entryCount',
      key: 'entryCount',
      width: 100,
      render: (count: number = 0) => <Tag color="blue">{count}</Tag>,
    },
    {
      title: '排序',
      dataIndex: 'sortOrder',
      key: 'sortOrder',
      width: 90,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      key: 'createdAt',
      width: 170,
      render: (value?: string) => formatTime(value),
    },
    {
      title: '操作',
      key: 'actions',
      width: 140,
      render: (_, record) => (
        <Space size={2}>
          <Button
            size="small"
            type="text"
            icon={<EditOutlined />}
            disabled={Boolean(record.protected && editingId === record.id)}
            onClick={() => startEdit(record)}
          >
            {editingId === record.id ? '编辑中' : '编辑'}
          </Button>
          <Popconfirm
            title="删除该分类？"
            description="条目将迁移到默认分类"
            okText="删除"
            cancelText="取消"
            okButtonProps={{ danger: true }}
            onConfirm={() => askDelete(record)}
            disabled={Boolean(record.protected)}
          >
            <Button size="small" type="text" danger disabled={Boolean(record.protected)} icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const editing = categories.find((c) => c.id === editingId);

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Typography.Title level={4} style={{ margin: 0 }}>
        分类管理
      </Typography.Title>

      {editing?.protected && (
        <Alert
          type="info"
          showIcon
          message="受保护分类仅允许修改排序，名称与删除操作不可用"
          action={
            <Button size="small" onClick={resetForm}>
              取消编辑
            </Button>
          }
        />
      )}

      <Card title={editingId ? `编辑分类：${editing?.name ?? ''}` : '新建分类'}>
        <Form form={form} layout="inline" onFinish={onFinish} style={{ rowGap: 12, flexWrap: 'wrap' }}>
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: '请输入分类名称' },
              { max: 50, message: '名称最多 50 字符' },
            ]}
          >
            <Input placeholder="例如：工作、银行、社交" style={{ width: 220 }} maxLength={50} />
          </Form.Item>
          <Form.Item name="icon" label="图标" rules={[{ max: 50, message: '图标名最多 50 字符' }]}>
            <Input placeholder="folder" style={{ width: 160 }} maxLength={50} />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序">
            <InputNumber min={0} max={99999} style={{ width: 120 }} placeholder="999" />
          </Form.Item>
          <Space>
            <Button type="primary" htmlType="submit" loading={saving} icon={editingId ? <SaveOutlined /> : <FolderAddOutlined />}>
              {editingId ? '保存修改' : '创建分类'}
            </Button>
            {editingId && (
              <Button onClick={resetForm}>取消编辑</Button>
            )}
          </Space>
        </Form>
      </Card>

      <Card title="全部分类">
        <Table<Category>
          rowKey="id"
          columns={columns}
          dataSource={categories}
          pagination={false}
          size="middle"
          scroll={{ x: 720 }}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无分类" />
            ),
          }}
        />
      </Card>
    </Space>
  );
}
