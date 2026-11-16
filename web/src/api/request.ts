import axios, { AxiosError, type AxiosRequestConfig } from 'axios';
import { useAuthStore } from '../stores/authStore';
import type { ApiError, Envelope } from '../types';

/**
 * Axios 实例：
 * - baseURL /api/v1，携带 HttpOnly 刷新 Cookie
 * - 请求拦截：自动附加 Bearer Token（仅内存态）
 * - 响应拦截：解包统一信封；401 TOKEN_EXPIRED 静默刷新一次并重放；
 *   其余 401 清除本地登录态；错误统一转 ApiError 形态
 */
const instance = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  timeout: 20000,
});

instance.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  try {
    const res = await axios.post('/api/v1/auth/refresh', {}, { withCredentials: true });
    const token = res.data?.data?.accessToken as string | undefined;
    if (token) {
      useAuthStore.getState().setToken(token);
      return token;
    }
    return null;
  } catch {
    useAuthStore.getState().clear();
    return null;
  }
}

function toApiError(error: AxiosError<{ error?: Partial<ApiError> }>): ApiError {
  const body = error.response?.data?.error;
  return {
    status: error.response?.status ?? 0,
    code: body?.code ?? (error.response ? 'INTERNAL_ERROR' : 'NETWORK_ERROR'),
    message: body?.message ?? error.message ?? '网络错误',
    details: body?.details,
  };
}

instance.interceptors.response.use(
  (response) => response.data,
  async (error: AxiosError<{ error?: Partial<ApiError> }>) => {
    const config = error.config as (AxiosRequestConfig & { _retried?: boolean }) | undefined;
    const apiError = toApiError(error);

    // 访问令牌过期 → 静默刷新一次并重放原请求
    if (
      apiError.status === 401 &&
      apiError.code === 'TOKEN_EXPIRED' &&
      config &&
      !config._retried
    ) {
      config._retried = true;
      refreshing = refreshing ?? refreshAccessToken();
      const newToken = await refreshing;
      refreshing = null;
      if (newToken) {
        const headers = config.headers as unknown as
          { set?: (k: string, v: string) => void } | undefined;
        if (headers && typeof headers.set === 'function') {
          headers.set('Authorization', `Bearer ${newToken}`);
        } else {
          config.headers = {
            ...(config.headers as Record<string, string>),
            Authorization: `Bearer ${newToken}`,
          };
        }
        return instance(config);
      }
    }

    // 其余 401 → 清登录态（RequireAuth 会跳转登录页）
    if (apiError.status === 401) {
      useAuthStore.getState().clear();
    }

    return Promise.reject(apiError);
  },
);

/** GET：返回信封（data + pagination） */
export async function httpGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  const res = (await instance.get(url, { params })) as unknown as { data: T };
  return res.data;
}

/** POST：返回信封 */
export async function httpPost<T>(
  url: string,
  body?: unknown,
  config?: AxiosRequestConfig,
): Promise<T> {
  const res = (await instance.post(url, body, config)) as unknown as { data: T };
  return res.data;
}

/** PUT/PATCH：返回信封 */
export async function httpPut<T>(url: string, body?: unknown): Promise<T> {
  const res = (await instance.put(url, body)) as unknown as { data: T };
  return res.data;
}

export async function httpPatch<T>(url: string, body?: unknown): Promise<T> {
  const res = (await instance.patch(url, body)) as unknown as { data: T };
  return res.data;
}

/** DELETE：204 无响应体 */
export async function httpDelete(url: string): Promise<void> {
  await instance.delete(url);
}

/** DELETE：返回 200 信封（部分 DELETE 端点带响应体，如分类删除） */
export async function httpDeleteData<T>(url: string): Promise<T> {
  const res = (await instance.delete(url)) as unknown as { data: T };
  return res.data;
}

export type { Envelope };
export default instance;
