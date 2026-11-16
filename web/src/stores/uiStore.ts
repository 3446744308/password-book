import { create } from 'zustand';

/** UI 偏好（主题不敏感，允许持久化到 localStorage） */
type Theme = 'light' | 'dark';

interface UIState {
  theme: Theme;
  siderCollapsed: boolean;
  toggleTheme: () => void;
  setCollapsed: (collapsed: boolean) => void;
}

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('pwbook-theme');
    if (saved === 'dark' || saved === 'light') return saved;
  } catch {
    /* localStorage 不可用则用默认值 */
  }
  return 'light';
}

export const useUIStore = create<UIState>((set) => ({
  theme: initialTheme(),
  siderCollapsed: false,
  toggleTheme: () =>
    set((s) => {
      const theme: Theme = s.theme === 'light' ? 'dark' : 'light';
      try {
        localStorage.setItem('pwbook-theme', theme);
      } catch {
        /* 忽略 */
      }
      return { theme };
    }),
  setCollapsed: (collapsed) => set({ siderCollapsed: collapsed }),
}));

export default useUIStore;
