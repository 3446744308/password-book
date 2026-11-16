import { create } from 'zustand';

/** 认证态：访问令牌仅存内存（设计文档 §6.2），刷新页面需重新解锁 */
interface AuthState {
  accessToken: string | null;
  /** 服务端下发的会话时长（分钟），空闲超时自动锁定据此计算 */
  lockMinutes: number;
  setToken: (token: string) => void;
  setLockMinutes: (minutes: number) => void;
  clear: () => void;
}

/** 服务端未取到配置前的兜底值，与 docs/03 §6.3 的默认 lockMinutes 一致 */
const DEFAULT_LOCK_MINUTES = 30;

export const useAuthStore = create<AuthState>((set) => ({
  accessToken: null,
  lockMinutes: DEFAULT_LOCK_MINUTES,
  setToken: (token) => set({ accessToken: token }),
  setLockMinutes: (minutes) =>
    set({ lockMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_LOCK_MINUTES }),
  clear: () => set({ accessToken: null }),
}));

export default useAuthStore;
