import { verifyJwt } from '../utils/jwt.js';
import { runtime } from '../runtime.js';
import { errors } from '../utils/errors.js';

/** Bearer Token 鉴权中间件（docs/03 §1.3） */
export function requireAuth(req, _res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return next(errors.tokenMissing());
  try {
    const payload = verifyJwt(token, runtime.jwtSecret);
    if (payload.typ !== 'access') throw errors.tokenInvalid('令牌类型错误');
    if (payload.sub !== 'admin') throw errors.tokenInvalid();
    if (runtime.revokedJti.has(payload.jti)) throw errors.tokenInvalid('令牌已失效');
    if ((payload.issuedAtMs || 0) < runtime.tokenNotBefore) throw errors.tokenInvalid('令牌已失效，请重新登录');
    req.auth = payload;
    next();
  } catch (err) {
    next(err);
  }
}
