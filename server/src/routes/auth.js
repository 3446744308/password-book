import { Router } from 'express';
import { h, ok, created, noContent } from '../utils/http.js';
import { validate } from '../utils/validate.js';
import { parseCookies } from '../utils/jwt.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { authService } from '../services/authService.js';
import { config } from '../config.js';

const router = Router();

/**
 * 敏感端点的限速中间件。
 *
 * **默认关闭**（`RATE_LIMIT_ENABLED=true` 可开启）：频繁重试主密码时先撞 429 反而
 * 挡在「失败锁定」前面，体验很差。关闭后暴力破解仍由连续失败锁定兜底
 * （默认 5 次失败 → 锁定 15 分钟）。详见 docs/03 §1.6。
 */
const loginGuards = config.rateLimitEnabled
  ? [rateLimit({ windowMs: config.loginRate.windowMs, max: config.loginRate.max, name: 'login' })]
  : [];
const masterGuards = config.rateLimitEnabled
  ? [rateLimit({ windowMs: config.loginRate.windowMs, max: config.loginRate.max, name: 'master' })]
  : [];

const PASSWORD_RULE = { field: 'masterPassword', required: true, trim: false, maxLength: 512 };

router.post(
  '/setup',
  ...loginGuards,
  h(async (req, res) => {
    const v = validate(req.body, [PASSWORD_RULE]);
    created(res, await authService.setup(v.masterPassword, req.ip));
  }),
);

router.post(
  '/login',
  ...loginGuards,
  h(async (req, res) => {
    const v = validate(req.body, [PASSWORD_RULE]);
    const result = await authService.login(v.masterPassword, req.ip);
    const secure = req.secure ? '; Secure' : '';
    res.append(
      'Set-Cookie',
      `refreshToken=${encodeURIComponent(result.refreshToken)}; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=${result.refreshMaxAge}${secure}`,
    );
    const { refreshToken, refreshMaxAge, ...data } = result;
    ok(res, data);
  }),
);

router.post(
  '/refresh',
  h(async (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    ok(res, await authService.refresh(cookies.refreshToken));
  }),
);

router.get(
  '/session',
  requireAuth,
  h(async (req, res) => {
    ok(res, await authService.session(req.auth));
  }),
);

router.post(
  '/logout',
  requireAuth,
  h(async (req, res) => {
    await authService.logout(req.auth, req.ip);
    res.append(
      'Set-Cookie',
      'refreshToken=; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=0',
    );
    noContent(res);
  }),
);

router.post(
  '/change-master',
  requireAuth,
  ...masterGuards,
  h(async (req, res) => {
    const v = validate(req.body, [
      { field: 'currentPassword', required: true, trim: false, maxLength: 512 },
      { field: 'newPassword', required: true, trim: false, maxLength: 512 },
    ]);
    const result = await authService.changeMaster(
      req.auth,
      v.currentPassword,
      v.newPassword,
      req.ip,
    );
    res.append(
      'Set-Cookie',
      'refreshToken=; HttpOnly; SameSite=Strict; Path=/api/v1/auth; Max-Age=0',
    );
    ok(res, result);
  }),
);

export default router;
