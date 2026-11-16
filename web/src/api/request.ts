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

/**
 * 响应拦截器已把 axios 的响应解成**信封本身**（`{ data, pagination? }`），
 * 所以这里的辅助函数只做类型标注，**绝不能再取一次 `.data`**——
 * 多剥一层的后果是所有接口都返回 undefined（曾导致「创建主密码」报
 * Cannot read properties of undefined (reading 'accessToken')）。
 * 取 `.data` 的职责统一留在各 api 模块。
 */
async function unwrapEnvelope<T>(request: Promise<unknown>): Promise<T> {
  return (await request) as T;
}

/** GET：返回信封（data + pagination） */
export function httpGet<T>(url: string, params?: Record<string, unknown>): Promise<T> {
  return unwrapEnvelope<T>(instance.get(url, { params }));
}

/** POST：返回信封 */
export function httpPost<T>(url: string, body?: unknown, config?: AxiosRequestConfig): Promise<T> {
  return unwrapEnvelope<T>(instance.post(url, body, config));
}

/** PUT/PATCH：返回信封 */
export function httpPut<T>(url: string, body?: unknown): Promise<T> {
  return unwrapEnvelope<T>(instance.put(url, body));
}

export function httpPatch<T>(url: string, body?: unknown): Promise<T> {
  return unwrapEnvelope<T>(instance.patch(url, body));
}

/** DELETE：204 无响应体 */
export async function httpDelete(url: string): Promise<void> {
  await instance.delete(url);
}

/** DELETE：返回 200 信封（部分 DELETE 端点带响应体，如分类删除） */
export function httpDeleteData<T>(url: string): Promise<T> {
  return unwrapEnvelope<T>(instance.delete(url));
}

export type { Envelope };
export default instance;
