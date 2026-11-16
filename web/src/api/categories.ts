import { httpGet, httpPost, httpPut, httpDeleteData, type Envelope } from './request';
import type { Category } from '../types';

export async function listCategories(): Promise<Category[]> {
  const res = await httpGet<Envelope<Category[]>>('/categories');
  return res.data;
}

export async function getCategory(id: string): Promise<Category> {
  const res = await httpGet<Envelope<Category>>(`/categories/${id}`);
  return res.data;
}

export async function createCategory(input: {
  name: string;
  icon?: string;
  sortOrder?: number;
}): Promise<Category> {
  const res = await httpPost<Envelope<Category>>('/categories', input);
  return res.data;
}

export async function updateCategory(
  id: string,
  patch: { name?: string; icon?: string; sortOrder?: number },
): Promise<Category> {
  const res = await httpPut<Envelope<Category>>(`/categories/${id}`, patch);
  return res.data;
}

/** 删除分类（条目自动迁移到默认分类） */
export async function deleteCategory(
  id: string,
): Promise<{ deleted: boolean; movedEntries: number }> {
  const res = await httpDeleteData<Envelope<{ deleted: boolean; movedEntries: number }>>(
    `/categories/${id}`,
  );
  return res.data;
}

/** 批量转移条目到目标分类 */
export async function transferEntries(
  id: string,
  targetCategoryId: string,
  entryIds: string[],
): Promise<{ transferred: number; targetCategoryId: string }> {
  const res = await httpPost<Envelope<{ transferred: number; targetCategoryId: string }>>(
    `/categories/${id}/transfer`,
    { targetCategoryId, entryIds },
  );
  return res.data;
}
