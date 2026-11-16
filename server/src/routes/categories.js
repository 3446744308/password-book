import { Router } from 'express';
import { h, ok, created } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';
import { categoryService } from '../services/categoryService.js';
import { errors } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

router.get(
  '/',
  h(async (_req, res) => {
    ok(res, await categoryService.list());
  }),
);

router.post(
  '/',
  h(async (req, res) => {
    created(res, await categoryService.create(req.body, req.ip));
  }),
);

router.get(
  '/:id',
  h(async (req, res) => {
    const cat = await categoryService.get(req.params.id);
    if (!cat) throw errors.notFound('分类不存在');
    ok(res, cat);
  }),
);

router.put(
  '/:id',
  h(async (req, res) => {
    ok(res, await categoryService.update(req.params.id, req.body, req.ip));
  }),
);

router.delete(
  '/:id',
  h(async (req, res) => {
    ok(res, await categoryService.remove(req.params.id, req.ip));
  }),
);

router.post(
  '/:id/transfer',
  h(async (req, res) => {
    ok(res, await categoryService.transfer(req.params.id, req.body, req.ip));
  }),
);

export default router;
