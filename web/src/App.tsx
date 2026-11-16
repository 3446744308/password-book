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

/** 未初始化 → 引导到 /setup；已初始化且在 /setup → 跳 /login */
function AuthRoute({ children }: { children: React.ReactNode }) {
  const token = useAuthStore((s) => s.accessToken);
  const [checking, setChecking] = useState(true);
  const [initialized, setInitialized] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    // 健康检查为公开端点，失败时视为"未知"，直接放行到登录页
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
        <Spin size="large" tip="加载中..." />
      </div>
    );
  }
  if (initialized === false) return <Navigate to="/setup" replace />;
  if (token && initialized) return <Navigate to="/" replace />;
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
        <BrowserRouter>
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
              <Route path="/settings" element={<SettingsPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AntdApp>
    </ConfigProvider>
  );
}
