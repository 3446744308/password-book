import * as repo from '../storage/repository.js';
import { errors } from '../utils/errors.js';
import { validate } from '../utils/validate.js';
import { SAFE_ID_RE, isUlid } from '../utils/ids.js';

/** 分类服务：校验 + 业务规则 + 审计 */
export const categoryService = {
  list() {
    return repo.listCategories();
  },

  async get(id) {
    if (id !== '_default' && !isUlid(id)) return null;
    return repo.getCategory(id);
  },

  async create(body, ip) {
    const v = validate(body, [
      { field: 'name', label: '分类名', required: true, minLength: 1, maxLength: 50 },
      { field: 'icon', label: '图标', maxLength: 50 },
      { field: 'sortOrder', type: 'int', min: 0, max: 99999 },
    ]);
    const cat = await repo.createCategory({
      name: v.name,
      icon: v.icon,
      sortOrder: v.sortOrder,
    });
    await repo.appendAudit('CATEGORY_CREATE', { ip, detail: `id=${cat.id}` });
    return cat;
  },

  async update(id, body, ip) {
    if (id !== '_default' && !isUlid(id)) throw errors.notFound('分类不存在');
    if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
      throw errors.validation([{ field: '_', message: '至少提交一个待更新字段' }]);
    }
    const v = validate(body, [
      { field: 'name', label: '分类名', minLength: 1, maxLength: 50 },
      { field: 'icon', label: '图标', maxLength: 50 },
      { field: 'sortOrder', type: 'int', min: 0, max: 99999 },
    ]);
    const patch = {};
    if (Object.prototype.hasOwnProperty.call(body, 'name')) patch.name = v.name;
    if (Object.prototype.hasOwnProperty.call(body, 'icon')) patch.icon = v.icon;
    if (Object.prototype.hasOwnProperty.call(body, 'sortOrder')) patch.sortOrder = v.sortOrder;
    if (!Object.keys(patch).length) {
      throw errors.validation([{ field: '_', message: '没有可更新的字段' }]);
    }
    const cat = await repo.updateCategory(id, patch);
    await repo.appendAudit('CATEGORY_UPDATE', { ip, detail: `id=${id}` });
    return cat;
  },

  async remove(id, ip) {
    if (id !== '_default' && !isUlid(id)) throw errors.notFound('分类不存在');
    const result = await repo.deleteCategory(id);
    await repo.appendAudit('CATEGORY_DELETE', { ip, detail: `id=${id},moved=${result.movedEntries}` });
    return result;
  },

  async transfer(id, body, ip) {
    if (id !== '_default' && !isUlid(id)) throw errors.notFound('分类不存在');
    const v = validate(body, [
      {
        field: 'targetCategoryId',
        label: '目标分类',
        required: true,
        pattern: SAFE_ID_RE,
        patternMessage: '目标分类 ID 非法',
      },
      { field: 'entryIds', type: 'stringArray', required: true, minItems: 1, maxItems: 500 },
    ]);
    if (v.targetCategoryId === id) throw errors.validation([{ field: 'targetCategoryId', message: '目标分类不能是当前分类' }]);
    const target = await repo.getCategory(v.targetCategoryId);
    if (!target) throw errors.notFound('目标分类不存在');

    const result = await repo.transferEntries(id, v.targetCategoryId, v.entryIds);
    await repo.appendAudit('ENTRY_UPDATE', {
      ip,
      detail: `transfer ${id} -> ${v.targetCategoryId},n=${result.transferred}`,
    });
    return result;
  },
};

export default categoryService;
