import { AppError, errors } from '../utils/errors.js';
import { logger } from '../logger.js';
import { config } from '../config.js';

/** 未匹配的 /api 路由 → 404 标准信封 */
export function notFoundHandler(req, _res, next) {
  next(errors.notFound(`接口不存在：${req.method} ${req.path}`));
}

/** 集中式错误中间件：AppError 按码返回；未知异常记日志且不回传堆栈（docs/02 §8.3） */
export function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  let error = err;
  if (!(err instanceof AppError)) {
    // body 解析失败 / 体积超限
    if (err?.type === 'entity.parse.failed') {
      error = errors.validation([{ field: 'body', message: '请求体不是合法 JSON' }]);
    } else if (err?.type === 'entity.too.large') {
      error = errors.validation([{ field: 'body', message: '请求体过大' }]);
    } else {
      logger.error('unhandled.error', {
        message: err?.message,
        stack: config.isProd ? undefined : err?.stack,
        path: req.originalUrl,
        method: req.method,
      });
      error = errors.internal();
    }
  }

  if (!error.expected) {
    logger.error('error.response', {
      code: error.code,
      status: error.status,
      path: req.originalUrl,
    });
  }

  if (error.headers) {
    for (const [k, v] of Object.entries(error.headers)) res.setHeader(k, v);
  }

  const body = { error: { code: error.code, message: error.message } };
  if (error.details) body.error.details = error.details;
  res.status(error.status || 500).json(body);
}
