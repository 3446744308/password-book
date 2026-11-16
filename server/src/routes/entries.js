import { Router } from 'express';
import { h, ok, created, paged, noContent } from '../utils/http.js';
import { requireAuth } from '../middleware/auth.js';
import { entryService } from '../services/entryService.js';
import { validate } from '../utils/validate.js';
import { errors } from '../utils/errors.js';

const router = Router();
router.use(requireAuth);

const QUERY_RULES = [
  { field: 'page', type: 'int', min: 1 },
  { field: 'size', type: 'int', min: 1, max: 100 },
  { field: 'sort', type: 'enum', values: ['updatedAt', 'createdAt', 'title'] },
  { field: 'order', type: 'enum', values: ['asc', 'desc'] },
  { field: 'keyword', label: '关键词', maxLength: 100 },
  { field: 'categoryId', label: '分类', maxLength: 50 },
  { field: 'tag', label: '标签', maxLength: 20 },
];

router.get(
  '/',
  h(async (req, res) => {
    const raw = req.query;
    const q = validate(
      {
        page: raw.page,
        size: raw.size,
        sort: raw.sort,
        order: raw.order,
        keyword: raw.keyword,
        categoryId: raw.categoryId,
        tag: raw.tag,
      },
      QUERY_RULES,
    );
    if (raw.favorite !== undefined) {
      if (raw.favorite !== 'true' && raw.favorite !== 'false') {
        throw errors.validation([{ field: 'favorite', message: 'favorite 必须为 true 或 false' }]);
      }
      if (raw.favorite === 'true') q.favorite = true;
    }
    const { list, pagination } = await entryService.list(q);
    paged(res, list, pagination);
  }),
);

router.post(
  '/',
  h(async (req, res) => {
    created(res, await entryService.create(req.body, req.ip));
  }),
);

router.get(
  '/:id',
  h(async (req, res) => {
    ok(res, await entryService.detail(req.params.id));
  }),
);

router.get(
  '/:id/reveal',
  h(async (req, res) => {
    ok(res, await entryService.reveal(req.params.id, req.ip));
  }),
);

router.put(
  '/:id',
  h(async (req, res) => {
    ok(res, await entryService.update(req.params.id, req.body, req.ip, { partial: false }));
  }),
);

router.patch(
  '/:id/favorite',
  h(async (req, res) => {
    const v = validate(req.body, [{ field: 'favorite', type: 'bool', required: true }]);
    ok(res, await entryService.setFavorite(req.params.id, v.favorite, req.ip));
  }),
);

router.patch(
  '/:id',
  h(async (req, res) => {
    ok(res, await entryService.update(req.params.id, req.body, req.ip, { partial: true }));
  }),
);

router.delete(
  '/:id',
  h(async (req, res) => {
    await entryService.remove(req.params.id, req.ip);
    noContent(res);
  }),
);

// ===================== 密码历史 =====================

router.get(
  '/:id/history',
  h(async (req, res) => {
    const v = validate(req.query, [
      { field: 'page', type: 'int', min: 1 },
      { field: 'size', type: 'int', min: 1, max: 100 },
    ]);
    const { list, pagination } = await entryService.history(req.params.id, {
      page: v.page || 1,
      size: v.size || 20,
    });
    paged(res, list, pagination);
  }),
);

router.get(
  '/:id/history/:version',
  h(async (req, res) => {
    const version = Number(req.params.version);
    if (!Number.isInteger(version) || version < 1) {
      throw errors.validation([{ field: 'version', message: '版本号必须为正整数' }]);
    }
    ok(res, await entryService.historyReveal(req.params.id, version, req.ip));
  }),
);

router.post(
  '/:id/restore-password',
  h(async (req, res) => {
    const v = validate(req.body, [{ field: 'version', type: 'int', required: true, min: 1 }]);
    ok(res, await entryService.restorePassword(req.params.id, v.version, req.ip));
  }),
);

export default router;
