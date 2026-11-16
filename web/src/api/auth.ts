import { httpPost, httpGet, type Envelope } from './request';
import type { LoginResult, SystemStatus } from '../types';

/** 初始化主密码（仅首次可用） */
export async function setup(
  masterPassword: string,
): Promise<{ initialized: boolean; defaultCategoryId: string }> {
  const res = await httpPost<Envelope<{ initialized: boolean; defaultCategoryId: string }>>(
    '/auth/setup',
    {
      masterPassword,
    },
  );
  return res.data;
}

/** 主密码登录，返回访问令牌（刷新令牌走 HttpOnly Cookie） */
export async function login(masterPassword: string): Promise<LoginResult> {
  const res = await httpPost<Envelope<LoginResult>>('/auth/login', { masterPassword });
  return res.data;
}

/** 登出：吊销当前令牌 */
export async function logout(): Promise<void> {
  await httpPost('/auth/logout');
}

/** 会话校验 */
export async function session(): Promise<{
  authenticated: boolean;
  expiresAt: string;
  lockMinutes: number;
}> {
  const res =
    await httpGet<Envelope<{ authenticated: boolean; expiresAt: string; lockMinutes: number }>>(
      '/auth/session',
    );
  return res.data;
}

/** 更换主密码（旧令牌全部失效） */
export async function changeMaster(
  currentPassword: string,
  newPassword: string,
): Promise<{ changed: boolean; reencryptedEntries: number; reloginRequired: boolean }> {
  const res = await httpPost<
    Envelope<{ changed: boolean; reencryptedEntries: number; reloginRequired: boolean }>
  >('/auth/change-master', { currentPassword, newPassword });
  return res.data;
}

/** 系统状态（初始化/锁定信息，页面启动判断用） */
export async function getStatus(): Promise<SystemStatus> {
  const res = await httpGet<Envelope<SystemStatus>>('/system/status');
  return res.data;
}
