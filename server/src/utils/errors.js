/** 统一错误对象与错误码（权威清单见 docs/03 §7） */

export class AppError extends Error {
  constructor(status, code, message, details, headers) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.headers = headers;
    /** 标记为预期内错误，错误中间件不打印堆栈 */
    this.expected = true;
  }
}

export const errors = {
  validation: (details, message = '参数校验失败') => new AppError(400, 'VALIDATION_ERROR', message, details),
  invalidCredentials: () => new AppError(401, 'AUTH_INVALID_CREDENTIALS', '主密码不正确'),
  tokenMissing: () => new AppError(401, 'TOKEN_MISSING', '未提供访问令牌'),
  tokenExpired: () => new AppError(401, 'TOKEN_EXPIRED', '访问令牌已过期'),
  tokenInvalid: (message = '访问令牌无效') => new AppError(401, 'TOKEN_INVALID', message),
  protectedResource: (message = '该资源受保护，禁止操作') => new AppError(403, 'PROTECTED_RESOURCE', message),
  notFound: (message = '资源不存在', details) => new AppError(404, 'NOT_FOUND', message, details),
  alreadyInitialized: () => new AppError(409, 'ALREADY_INITIALIZED', '系统已初始化'),
  conflict: (message = '资源冲突') => new AppError(409, 'CONFLICT', message),
  noPassword: () => new AppError(409, 'NO_PASSWORD', '该条目没有密码'),
  lockedOut: (lockedUntil) =>
    new AppError(
      423,
      'LOCKED_OUT',
      '主密码错误次数过多，账户已锁定',
      lockedUntil ? [{ field: 'lockedUntil', message: new Date(lockedUntil).toISOString() }] : undefined,
    ),
  rateLimited: (retryAfter) =>
    new AppError(429, 'RATE_LIMITED', `请求过于频繁，请 ${retryAfter} 秒后重试`, undefined, {
      'Retry-After': String(retryAfter),
    }),
  internal: (message = '服务器内部错误') => new AppError(500, 'INTERNAL_ERROR', message),
  unavailable: (message = '服务暂不可用') => new AppError(503, 'SERVICE_UNAVAILABLE', message),
  storageFull: () => new AppError(507, 'STORAGE_FULL', '磁盘空间不足'),
};

export default AppError;
