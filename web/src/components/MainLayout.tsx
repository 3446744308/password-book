import { useEffect } from 'react';
import { Layout, Menu, Button, Space, Typography, Tooltip } from 'antd';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  AppstoreOutlined,
  FolderOutlined,
  LockOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoonOutlined,
  SafetyCertificateOutlined,
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
    { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
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
        <Menu mode="inline" selectedKeys={[selectedKey]} items={menuItems} onSelect={onSelect} />
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
