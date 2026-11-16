import { Router } from 'express';
import { h, ok, created } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';
import { systemService } from '../services/systemService.js';
import { authService } from '../services/authService.js';

const router = Router();

/** 无需鉴权：健康检查与状态（App 启动探测，docs/03 §6.1/6.2） */
router.get(
  '/health',
  h(async (_req, res) => {
    ok(res, await systemService.health());
  }),
);

router.get(
  '/status',
  h(async (_req, res) => {
    ok(res, await authService.status());
  }),
);

router.use(requireAuth);

router.get(
  '/config',
  h(async (_req, res) => {
    ok(res, await systemService.getConfig());
  }),
);

router.put(
  '/config',
  h(async (req, res) => {
    ok(res, await systemService.updateConfig(req.body, req.ip));
  }),
);

router.get(
  '/audit',
  h(async (req, res) => {
    const { list, pagination } = await systemService.listAudit(req.query);
    res.status(200).json({ data: list, pagination });
  }),
);

router.post(
  '/backup',
  h(async (req, res) => {
    created(res, await systemService.backup(req.ip));
  }),
);

export default router;
