import type { FormInstance } from 'antd';
import type { ApiError } from '../types';

/** 错误码 → 中文兜底文案（docs/03 §7；服务端 message 优先） */
const CODE_MESSAGES: Record<string, string> = {
  VALIDATION_ERROR: '输入参数有误',
  AUTH_INVALID_CREDENTIALS: '主密码不正确',
  TOKEN_MISSING: '未提供访问令牌',
  TOKEN_EXPIRED: '登录已过期，请重新解锁',
  TOKEN_INVALID: '登录状态已失效，请重新解锁',
  PROTECTED_RESOURCE: '该资源受保护，禁止操作',
  NOT_FOUND: '资源不存在',
  ALREADY_INITIALIZED: '系统已初始化',
  CONFLICT: '资源冲突',
  NO_PASSWORD: '该条目没有密码',
  LOCKED_OUT: '失败次数过多，账户已锁定',
  RATE_LIMITED: '操作过于频繁，请稍后再试',
  INTERNAL_ERROR: '服务器内部错误',
  SERVICE_UNAVAILABLE: '服务暂不可用',
  STORAGE_FULL: '磁盘空间不足',
  NETWORK_ERROR: '网络连接失败，请检查后端服务',
};

/** 把 API 错误转为用户可读文案；校验错误优先展示字段级原因 */
export function humanize(err: unknown): string {
  const e = err as ApiError | undefined;
  if (!e) return '操作失败';
  if (e.code === 'VALIDATION_ERROR' && e.details?.length) {
    return e.details.map((d) => d.message).join('；');
  }
  if (e.code === 'RATE_LIMITED') return e.message || CODE_MESSAGES.RATE_LIMITED;
  return e.message || CODE_MESSAGES[e.code] || '操作失败';
}

/**
 * 把服务端字段级错误回填到 antd Form。
 * 第二参直接传 form.setFields；类型取自 antd，避免 any。
 */
export function applyFieldErrors(err: unknown, setFields: FormInstance['setFields']): void {
  const e = err as ApiError | undefined;
  if (e?.code === 'VALIDATION_ERROR' && e.details?.length) {
    setFields(
      e.details.map((d) => ({ name: d.field === '_' ? [] : d.field, errors: [d.message] })),
    );
  }
}

export function isApiError(err: unknown): err is ApiError {
  return Boolean(err) && typeof (err as ApiError).code === 'string';
}
