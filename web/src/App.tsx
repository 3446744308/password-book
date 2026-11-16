import { useEffect, useState } from 'react';
import { ConfigProvider, App as AntdApp, Spin, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import MainLayout from './components/MainLayout';
import AutoLock from './components/AutoLock';
import SetupPage from './pages/SetupPage';
import LoginPage from './pages/LoginPage';
import ListPage from './pages/ListPage';
import CategoriesPage from './pages/CategoriesPage';
import SettingsPage from './pages/SettingsPage';
import NotFoundPage from './pages/NotFoundPage';
import useAuthStore from './stores/authStore';
import useUIStore from './stores/uiStore';

/** 路由守卫：无令牌 → 跳登录页；有令牌 → 渲染子路由 */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/**
 * 首次运行引导守卫。
 *
 * 注意：这里的重定向必须**判断当前路径**。`<Navigate to="/setup">` 渲染结果是 `null`，
 * 若用户本来就在 /setup（后端可达且库未初始化就是这种情况），replace 到同一路径会
 * 触发「渲染 → 重定向 → 再渲染」的死循环，整棵树永远是 null，表现为白屏。
 */
function AuthRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const { pathname } = useLocation();
  const [checking, setChecking] = useState(true);
  const [initialized, setInitialized] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 状态接口为公开端点，失败时视为"未知"，直接放行到登录页
    fetch('/api/v1/system/status')
      .then((r) => r.json())
      .then((body) => {
        if (cancelled) return;
        setInitialized(Boolean(body?.data?.initialized));
        // 取到服务端会话时长，供空闲自动锁定使用
        const minutes = body?.data?.lockMinutes;
        if (typeof minutes === 'number') useAuthStore.getState().setLockMinutes(minutes);
      })
      .catch(() => {
        if (!cancelled) setInitialized(null);
      })
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (checking) {
    return (
      <div className="page-center">
        <Spin size="large" />
      </div>
    );
  }

  const onSetupPage = pathname === '/setup';
  // 已登录且库已初始化 → 直接进主界面
  if (token && initialized) return <Navigate to="/" replace />;
  // 库未初始化：除 /setup 之外的页面都引导过去（已在该页则继续渲染，避免死循环）
  if (initialized === false && !onSetupPage) return <Navigate to="/setup" replace />;
  // 库已初始化却停在 /setup → 去登录页
  if (initialized === true && onSetupPage) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export default function App() {
  const themeMode = useUIStore((s) => s.theme);
  const dark = themeMode === 'dark';

  // 主题标记挂到根元素，供 styles.css 中的非 antd 背景（如 page-center）跟随
  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
  }, [themeMode]);

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        algorithm: dark ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: '#1677ff',
          borderRadius: 6,
        },
      }}
    >
      <AntdApp>
        {/* 提前启用 v7 行为，消除 React Router 的 future flag 警告（本项目无 splat 相对路由，风险为零） */}
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <AutoLock />
          <Routes>
            <Route
              path="/setup"
              element={
                <AuthRoute>
                  <SetupPage />
                </AuthRoute>
              }
            />
            <Route
              path="/login"
              element={
                <AuthRoute>
                  <LoginPage />
                </AuthRoute>
              }
            />
            <Route
              element={
                <RequireAuth>
                  <MainLayout />
                </RequireAuth>
              }
            >
              <Route path="/" element={<ListPage />} />
              <Route path="/categories" element={<CategoriesPage />} />
              {/* 设置分区与侧栏子菜单一一对应；/settings 重定向到第一个分区 */}
              <Route path="/settings" element={<Navigate to="/settings/master" replace />} />
              <Route path="/settings/master" element={<SettingsPage section="master" />} />
              <Route path="/settings/config" element={<SettingsPage section="config" />} />
              <Route path="/settings/backup" element={<SettingsPage section="backup" />} />
              <Route path="/settings/audit" element={<SettingsPage section="audit" />} />
              <Route path="/settings/about" element={<SettingsPage section="about" />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  );
}
