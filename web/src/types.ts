/** 全局类型定义（与 docs/03 API 文档字段一一对应） */

export interface Pagination {
  page: number;
  size: number;
  total: number;
}

/** 统一响应信封 */
export interface Envelope<T> {
  data: T;
  pagination?: Pagination;
}

export interface Category {
  id: string;
  name: string;
  icon: string;
  sortOrder: number;
  protected?: boolean;
  entryCount?: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface EntryListItem {
  id: string;
  categoryId: string;
  title: string;
  username: string;
  url: string;
  hasPassword: boolean;
  favorite: boolean;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface EntryDetail extends EntryListItem {
  notes: string | null;
  passwordVersion: number;
}

export interface RevealedPassword {
  id: string;
  password: string;
  notes: string | null;
  fetchedAt: string;
}

export interface HistoryVersion {
  version: number;
  changedAt: string;
  changeNote: string | null;
  restorable: boolean;
}

export interface HistoryReveal {
  version: number;
  password: string;
  changedAt: string;
}

export interface SystemStatus {
  initialized: boolean;
  lockMinutes: number;
  failedAttempts: number;
  failedAttemptsRemaining: number;
  lockedUntil?: string;
  entryCount: number;
  categoryCount: number;
  schemaVersion: number;
}

export interface SystemHealth {
  status: string;
  version: string;
  schemaVersion: number;
  initialized: boolean;
  dataDirWritable: boolean;
  uptimeSeconds: number;
}

export interface SystemConfig {
  lockMinutes: number;
  failedAttempts: number;
  lockMinutesAfterBan: number;
  minPasswordLength: number;
  defaultCategoryId: string;
  historyKeep: number;
}

export interface AuditItem {
  ts: string;
  event: string;
  ip: string | null;
  detail: string | null;
}

export interface LoginResult {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  serverTime: string;
}

export interface BackupResult {
  backupId: string;
  label: string;
  path: string;
  fileCount: number;
  sizeBytes: number;
  createdAt: string;
}

export interface EntryQuery {
  page?: number;
  size?: number;
  sort?: 'updatedAt' | 'createdAt' | 'title';
  order?: 'asc' | 'desc';
  keyword?: string;
  categoryId?: string;
  favorite?: boolean;
  tag?: string;
}

export interface EntryCreateInput {
  title: string;
  username?: string;
  password?: string;
  notes?: string;
  url?: string;
  categoryId?: string;
  tags?: string[];
  favorite?: boolean;
}

/** 统一 API 错误（拦截器转换后的形态） */
export interface ApiError {
  status: number;
  code: string;
  message: string;
  details?: { field: string; message: string }[];
}
