import { httpGet, httpPost, httpPut, httpPatch, httpDelete, type Envelope } from './request';
import type {
  EntryCreateInput,
  EntryDetail,
  EntryListItem,
  EntryQuery,
  HistoryReveal,
  HistoryVersion,
  Pagination,
  RevealedPassword,
} from '../types';

/** 条目列表（搜索/筛选/分页） */
export async function listEntries(
  query: EntryQuery,
): Promise<{ data: EntryListItem[]; pagination: Pagination }> {
  const params: Record<string, unknown> = {};
  if (query.page) params.page = query.page;
  if (query.size) params.size = query.size;
  if (query.sort) params.sort = query.sort;
  if (query.order) params.order = query.order;
  if (query.keyword) params.keyword = query.keyword;
  if (query.categoryId) params.categoryId = query.categoryId;
  if (query.favorite) params.favorite = 'true';
  if (query.tag) params.tag = query.tag;
  const res = await httpGet<Envelope<EntryListItem[]>>('/entries', params);
  return { data: res.data, pagination: res.pagination ?? { page: 1, size: 20, total: 0 } };
}

export async function getEntry(id: string): Promise<EntryDetail> {
  const res = await httpGet<Envelope<EntryDetail>>(`/entries/${id}`);
  return res.data;
}

/** 读取密码明文（服务端写审计日志） */
export async function revealEntry(id: string): Promise<RevealedPassword> {
  const res = await httpGet<Envelope<RevealedPassword>>(`/entries/${id}/reveal`);
  return res.data;
}

export async function createEntry(input: EntryCreateInput): Promise<EntryDetail> {
  const res = await httpPost<Envelope<EntryDetail>>('/entries', input);
  return res.data;
}

/** 全量更新；password 字段省略=不变，null=清空 */
export type EntryUpdateInput = Omit<EntryCreateInput, 'password'> & {
  password?: string | null;
  changeNote?: string;
};

export async function updateEntry(id: string, input: EntryUpdateInput): Promise<EntryDetail> {
  const res = await httpPut<Envelope<EntryDetail>>(`/entries/${id}`, input);
  return res.data;
}

export type EntryPatchInput = Partial<Omit<EntryCreateInput, 'password'>> & {
  password?: string | null;
  changeNote?: string;
};

export async function patchEntry(id: string, patch: EntryPatchInput): Promise<EntryDetail> {
  const res = await httpPatch<Envelope<EntryDetail>>(`/entries/${id}`, patch);
  return res.data;
}

export async function setFavorite(id: string, favorite: boolean): Promise<{ id: string; favorite: boolean }> {
  const res = await httpPatch<Envelope<{ id: string; favorite: boolean }>>(`/entries/${id}/favorite`, {
    favorite,
  });
  return res.data;
}

export async function deleteEntry(id: string): Promise<void> {
  await httpDelete(`/entries/${id}`);
}

/** 密码历史列表（不含明文） */
export async function listHistory(
  id: string,
  page = 1,
  size = 50,
): Promise<{ data: HistoryVersion[]; pagination: Pagination }> {
  const res = await httpGet<Envelope<HistoryVersion[]>>(`/entries/${id}/history`, { page, size });
  return { data: res.data, pagination: res.pagination ?? { page: 1, size, total: 0 } };
}

/** 读取历史版本明文（写审计） */
export async function revealHistory(id: string, version: number): Promise<HistoryReveal> {
  const res = await httpGet<Envelope<HistoryReveal>>(`/entries/${id}/history/${version}`);
  return res.data;
}

/** 恢复历史版本为当前密码 */
export async function restorePassword(
  id: string,
  version: number,
): Promise<{ id: string; restoredVersion: number; currentVersion: number; updatedAt: string }> {
  const res = await httpPost<Envelope<{ id: string; restoredVersion: number; currentVersion: number; updatedAt: string }>>(
    `/entries/${id}/restore-password`,
    { version },
  );
  return res.data;
}
