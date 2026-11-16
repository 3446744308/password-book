import { Router } from 'express';
import { h, ok, created, noContent } from '../utils/http.js';
import { validate } from '../utils/validate.js';
import { parseCookies } from '../utils/jwt.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { requireAuth } from '../middleware/auth.js';
import { authService } from '../services/authService.js';
import { config } from '../config.js';

const router = Router();

/** 登录/setup 限速：5 次 / 5 分钟 / IP（docs/03 §2.2） */
const loginLimiter = rateLimit({
  windowMs: config.loginRate.windowMs,
  max: config.loginRate.max,
  name: 'login',
});
/** 更换主密码限速（独立桶，避免与登录互相挤占） */
const masterLimiter = rateLimit({
  windowMs: config.loginRate.windowMs,
  max: config.loginRate.max,
  name: 'master',
});

const PASSWORD_RULE = { field: 'masterPassword', required: true, trim: false, maxLength: 512 };

router.post(
  '/setup',
  loginLimiter,
  h(async (req, res) => {
    const v = validate(req.body, [PASSWORD_RULE]);
    created(res, await authService.setup(v.masterPassword, req.ip));
  }),
);

router.post(
  '/login',
  loginLimiter,
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
  masterLimiter,
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
