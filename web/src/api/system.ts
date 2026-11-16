import { httpGet, httpPut, httpPost, type Envelope } from './request';
import type { AuditItem, BackupResult, Pagination, SystemConfig, SystemHealth } from '../types';

export async function health(): Promise<SystemHealth> {
  const res = await httpGet<Envelope<SystemHealth>>('/system/health');
  return res.data;
}

export async function getConfig(): Promise<SystemConfig> {
  const res = await httpGet<Envelope<SystemConfig>>('/system/config');
  return res.data;
}

export async function updateConfig(patch: Partial<SystemConfig>): Promise<SystemConfig> {
  const res = await httpPut<Envelope<SystemConfig>>('/system/config', patch);
  return res.data;
}

export async function listAudit(
  query: { page?: number; size?: number; event?: string } = {},
): Promise<{ data: AuditItem[]; pagination: Pagination }> {
  const params: Record<string, unknown> = {};
  if (query.page) params.page = query.page;
  if (query.size) params.size = query.size;
  if (query.event) params.event = query.event;
  const res = await httpGet<Envelope<AuditItem[]>>('/system/audit', params);
  return { data: res.data, pagination: res.pagination ?? { page: 1, size: 50, total: 0 } };
}

/** 触发一次数据备份 */
export async function createBackup(): Promise<BackupResult> {
  const res = await httpPost<Envelope<BackupResult>>('/system/backup');
  return res.data;
}
