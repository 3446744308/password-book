/** HTTP 响应辅助：统一信封（docs/03 §1.2.1） */

/** 包装异步路由处理器，异常转交错误中间件 */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function ok(res, data, status = 200) {
  res.status(status).json({ data });
}

export function created(res, data) {
  res.status(201).json({ data });
}

export function paged(res, list, pagination) {
  res.status(200).json({ data: list, pagination });
}

export function noContent(res) {
  res.status(204).end();
}
