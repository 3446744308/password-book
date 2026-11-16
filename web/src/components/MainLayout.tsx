import { useEffect, useState } from 'react';
import { Layout, Menu, Button, Space, Typography, Tooltip } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppstoreOutlined,
  CloudSyncOutlined,
  FolderOutlined,
  InfoCircleOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SettingOutlined,
  StarOutlined,
  SunOutlined,
} from '@ant-design/icons';
import useDataStore from '../stores/dataStore';
import useUIStore from '../stores/uiStore';
import { useAuthStore } from '../stores/authStore';
import { logout as logoutApi } from '../api';
import { useNotify } from '../utils/notify';

const { Sider, Header, Content } = Layout;

/** 设置子菜单的父级 key（不是路由，仅用于展开状态） */
const SETTINGS_GROUP_KEY = 'g-settings';

/** 主框架：侧栏（分类导航）+ 顶栏（主题/锁定）+ 内容区 */
export default function MainLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const { message } = useNotify();
  const categories = useDataStore((s) => s.categories);
  const favoriteOnly = useDataStore((s) => s.favoriteOnly);
  const categoryId = useDataStore((s) => s.categoryId);
  const setFilter = useDataStore((s) => s.setFilter);
  const loadCategories = useDataStore((s) => s.loadCategories);
  const loadPresets = useDataStore((s) => s.loadPresets);
  const theme = useUIStore((s) => s.theme);
  const toggleTheme = useUIStore((s) => s.toggleTheme);
  const collapsed = useUIStore((s) => s.siderCollapsed);
  const setCollapsed = useUIStore((s) => s.setCollapsed);

  // 展开状态自己维护：进入任何 /settings/* 时自动展开设置子菜单
  const [openKeys, setOpenKeys] = useState<string[]>([SETTINGS_GROUP_KEY]);

  useEffect(() => {
    if (!location.pathname.startsWith('/settings')) return;
    setOpenKeys((prev) =>
      prev.includes(SETTINGS_GROUP_KEY) ? prev : [...prev, SETTINGS_GROUP_KEY],
    );
  }, [location.pathname]);

  useEffect(() => {
    void loadCategories();
    void loadPresets();
  }, [loadCategories, loadPresets]);

  const handleLock = async () => {
    try {
      await logoutApi();
    } catch {
      /* 令牌已失效也视为登出成功 */
    }
    useAuthStore.getState().clear();
    message.success('已锁定，需要主密码重新解锁');
    navigate('/login', { replace: true });
  };

  const selectedKey =
    location.pathname !== '/'
      ? location.pathname
      : favoriteOnly
        ? 'nav:fav'
        : categoryId
          ? `cat:${categoryId}`
          : 'nav:all';

  const menuItems = [
    { key: 'nav:all', icon: <SafetyCertificateOutlined />, label: '全部条目' },
    { key: 'nav:fav', icon: <StarOutlined />, label: '收藏' },
    { type: 'divider' as const },
    {
      key: 'g-categories',
      type: 'group' as const,
      label: '分类',
      children: categories.map((c) => ({
        key: `cat:${c.id}`,
        icon: <FolderOutlined />,
        label: `${c.name} (${c.entryCount ?? 0})`,
      })),
    },
    { type: 'divider' as const },
    { key: '/categories', icon: <AppstoreOutlined />, label: '分类管理' },
    {
      // 设置各分区做成侧栏可展开的子菜单（下拉形式），右侧内容区只承载当前分区
      key: SETTINGS_GROUP_KEY,
      icon: <SettingOutlined />,
      label: '系统设置',
      children: [
        { key: '/settings/master', icon: <SafetyCertificateOutlined />, label: '修改主密码' },
        { key: '/settings/config', icon: <SaveOutlined />, label: '系统配置' },
        { key: '/settings/backup', icon: <CloudSyncOutlined />, label: '数据备份' },
        { key: '/settings/audit', icon: <InfoCircleOutlined />, label: '审计日志' },
        { key: '/settings/about', icon: <LockOutlined />, label: '关于与健康检查' },
      ],
    },
  ];

  const onSelect = ({ key }: { key: string }) => {
    if (key === 'nav:all') {
      navigate('/');
      setFilter({ categoryId: undefined, favoriteOnly: false });
    } else if (key === 'nav:fav') {
      navigate('/');
      setFilter({ categoryId: undefined, favoriteOnly: true });
    } else if (key.startsWith('cat:')) {
      navigate('/');
      setFilter({ categoryId: key.slice(4), favoriteOnly: false });
    } else {
      navigate(key);
    }
  };

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        breakpoint="lg"
        collapsedWidth={60}
        theme="light"
        style={{ borderRight: '1px solid rgba(5, 5, 5, 0.06)' }}
      >
        <div
          style={{
            height: 56,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            fontWeight: 700,
            fontSize: 16,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          <LockOutlined style={{ color: '#1677ff' }} />
          {!collapsed && <span>密码本</span>}
        </div>
        <Menu
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onSelect={onSelect}
          // 折叠时交给 antd 用弹出层，避免受控 openKeys 与 inlineCollapsed 冲突
          {...(collapsed ? {} : { openKeys, onOpenChange: setOpenKeys })}
        />
      </Sider>

      <Layout>
        <Header
          style={{
            background: 'transparent',
            padding: '0 16px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(5, 5, 5, 0.06)',
          }}
        >
          <Space>
            <Button
              type="text"
              aria-label="折叠侧栏"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
            />
            <Typography.Text type="secondary">本地加密 · JSON 存储</Typography.Text>
          </Space>
          <Space>
            <Tooltip title={theme === 'light' ? '切换到暗色' : '切换到亮色'}>
              <Button
                type="text"
                aria-label="切换主题"
                icon={theme === 'light' ? <MoonOutlined /> : <SunOutlined />}
                onClick={toggleTheme}
              />
            </Tooltip>
            <Button type="text" danger icon={<LockOutlined />} onClick={handleLock}>
              锁定
            </Button>
          </Space>
        </Header>

        <Content style={{ padding: '16px 20px', overflow: 'auto' }}>
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
