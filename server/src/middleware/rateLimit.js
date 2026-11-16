import { errors } from '../utils/errors.js';

/**
 * 进程内固定窗口限速（敏感端点强制，docs/02 §4.4）。
 * 超限返回 429 + Retry-After 头。
 *
 * 返回的中间件带 `reset()`，用于测试或运维手动清零计数。
 */
export function rateLimit({ windowMs, max, name = 'default' }) {
  const buckets = new Map();

  /** 计数桶超过阈值时清理过期项，避免长期运行内存膨胀 */
  function prune(now) {
    if (buckets.size < 1000) return;
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  function middleware(req, res, next) {
    const now = Date.now();
    prune(now);
    const key = `${name}:${req.ip || 'unknown'}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfter));
      return next(errors.rateLimited(retryAfter));
    }
    return next();
  }

  middleware.reset = () => buckets.clear();
  return middleware;
}

/** 清零某个限速中间件的计数（无 reset 能力时静默忽略） */
export function resetRateLimits(limiter) {
  if (limiter && typeof limiter.reset === 'function') limiter.reset();
}
