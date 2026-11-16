import { formatTime } from './format';

/**
 * 审计日志的「人话化」。
 *
 * 服务端写入的是稳定机器码（`LOGIN_OK`、`ENTRY_REVEAL`…）与 `k=v` 形式的 detail，
 * 便于过滤与排查，但不适合直接展示。这里集中做三件事：
 * 1. 事件码 → 中文名 + 配色 + 分组（docs/01 §6.3 的事件清单）
 * 2. detail 字符串 → 一句中文描述（含 ID 缩短、字段名翻译）
 * 3. IP → 「本机」等可读文案
 *
 * 未知事件码不丢弃，原样回退展示，保证新加事件时页面不会空白。
 */

export interface AuditEventMeta {
  /** 中文名，用于展示 */
  label: string;
  /** antd Tag 配色 */
  color: string;
  /** 筛选下拉里的分组名 */
  group: string;
}

/** 事件字典：保持按业务分组声明，筛选下拉直接沿用这个顺序 */
const AUDIT_EVENTS: Record<string, AuditEventMeta> = {
  SETUP_OK: { label: '初始化密码本', color: 'blue', group: '认证与会话' },
  LOGIN_OK: { label: '解锁成功', color: 'green', group: '认证与会话' },
  LOGIN_FAIL: { label: '解锁失败', color: 'red', group: '认证与会话' },
  LOCKOUT: { label: '触发锁定', color: 'red', group: '认证与会话' },
  LOGOUT: { label: '手动锁定', color: 'default', group: '认证与会话' },
  MASTER_CHANGE: { label: '更换主密码', color: 'orange', group: '认证与会话' },

  ENTRY_CREATE: { label: '新增条目', color: 'green', group: '条目' },
  ENTRY_UPDATE: { label: '修改条目', color: 'blue', group: '条目' },
  ENTRY_DELETE: { label: '删除条目', color: 'red', group: '条目' },
  ENTRY_REVEAL: { label: '查看密码', color: 'gold', group: '条目' },
  HISTORY_REVEAL: { label: '查看历史密码', color: 'gold', group: '条目' },
  HISTORY_RESTORE: { label: '恢复历史密码', color: 'purple', group: '条目' },

  CATEGORY_CREATE: { label: '新增分类', color: 'green', group: '分类' },
  CATEGORY_UPDATE: { label: '修改分类', color: 'blue', group: '分类' },
  CATEGORY_DELETE: { label: '删除分类', color: 'red', group: '分类' },

  CONFIG_UPDATE: { label: '修改系统配置', color: 'blue', group: '系统' },
  BACKUP_CREATE: { label: '创建备份', color: 'cyan', group: '系统' },
};

/** 已知事件的元信息；未知码原样返回 */
export function auditEventMeta(event: string): AuditEventMeta {
  return AUDIT_EVENTS[event] ?? { label: event, color: 'default', group: '其它' };
}

/** 筛选下拉的分组选项（值为事件码，展示为中文） */
export function auditEventFilterOptions(): {
  label: string;
  options: { label: string; value: string }[];
}[] {
  const groups = new Map<string, { label: string; value: string }[]>();
  for (const [code, meta] of Object.entries(AUDIT_EVENTS)) {
    const bucket = groups.get(meta.group) ?? [];
    bucket.push({ label: meta.label, value: code });
    groups.set(meta.group, bucket);
  }
  return [...groups].map(([label, options]) => ({ label, options }));
}

/** 过长的 ID（ULID / 会话 jti）缩短为首4…尾4，仍可人工比对 */
export function shortId(value: string): string {
  if (!value) return '—';
  return value.length <= 12 ? value : `${value.slice(0, 4)}…${value.slice(-4)}`;
}

/** 系统配置字段名 → 中文 */
const CONFIG_FIELD_LABELS: Record<string, string> = {
  lockMinutes: '会话时长',
  failedAttempts: '失败次数上限',
  lockMinutesAfterBan: '锁定时长',
  minPasswordLength: '主密码最小长度',
  historyKeep: '历史保留条数',
  defaultCategoryId: '默认分类',
};

/** 解析 detail：逗号分隔的 `k=v`，以及不带等号的裸文本 */
function parseDetail(detail: string): { pairs: Record<string, string>; bare: string } {
  const pairs: Record<string, string> = {};
  const bare: string[] = [];
  for (const token of detail.split(',')) {
    const piece = token.trim();
    if (!piece) continue;
    const eq = piece.indexOf('=');
    if (eq > 0) pairs[piece.slice(0, eq)] = piece.slice(eq + 1);
    else bare.push(piece);
  }
  return { pairs, bare: bare.join(',') };
}

/**
 * 把一条审计记录翻译成中文描述。
 *
 * @param event  事件码
 * @param detail 服务端原样写入的 detail
 */
export function describeAuditDetail(event: string, detail?: string | null): string {
  if (!detail) return '—';
  const { pairs, bare } = parseDetail(detail);
  const entry = pairs.id ? `条目 ${shortId(pairs.id)}` : null;

  switch (event) {
    case 'SETUP_OK': {
      const parts: string[] = [];
      if (pairs.mode) parts.push(`模式 ${pairs.mode}`);
      if (pairs.presets) parts.push(`内置分类 ${pairs.presets} 个`);
      return parts.join('，') || '已完成初始化';
    }

    case 'LOGIN_OK':
    case 'LOGOUT':
      return pairs.jti ? `会话 ${shortId(pairs.jti)}` : '—';

    case 'LOGIN_FAIL':
      return pairs.attempt ? `第 ${pairs.attempt} 次密码错误` : '密码错误';

    case 'LOCKOUT':
      return pairs.until ? `锁定至 ${formatTime(pairs.until)}` : '账户已锁定';

    case 'MASTER_CHANGE': {
      const parts: string[] = [];
      if (pairs.mode) parts.push(`模式 ${pairs.mode}`);
      if (pairs.reencrypted !== undefined) parts.push(`重加密 ${pairs.reencrypted} 个字段`);
      return parts.join('，') || '主密码已更换';
    }

    case 'CONFIG_UPDATE': {
      const names = bare
        .split(',')
        .map((n) => CONFIG_FIELD_LABELS[n.trim()] ?? n.trim())
        .filter(Boolean);
      return names.length ? `修改了 ${names.join('、')}` : '配置已更新';
    }

    case 'ENTRY_CREATE':
    case 'ENTRY_DELETE':
    case 'ENTRY_REVEAL':
      return entry ?? detail;

    case 'ENTRY_UPDATE': {
      if (pairs.favorite !== undefined) {
        return `${entry ?? '条目'}，${pairs.favorite === 'true' ? '设为收藏' : '取消收藏'}`;
      }
      // 批量转移的 detail 形如：transfer <源分类> -> <目标分类>,n=5
      const transfer = /^transfer\s+(\S+)\s*->\s*(\S+)/.exec(bare);
      if (transfer) {
        return `转移 ${pairs.n ?? '?'} 个条目：${shortId(transfer[1])} → ${shortId(transfer[2])}`;
      }
      return entry ?? detail;
    }

    case 'HISTORY_REVEAL':
      return `${entry ?? '条目'}，版本 v${pairs.v ?? '?'}`;

    case 'HISTORY_RESTORE':
      return `${entry ?? '条目'}，恢复自 ${pairs.from ?? '?'}`;

    case 'CATEGORY_CREATE':
    case 'CATEGORY_UPDATE':
      return pairs.id ? `分类 ${shortId(pairs.id)}` : detail;

    case 'CATEGORY_DELETE': {
      const head = pairs.id ? `分类 ${shortId(pairs.id)}` : '分类';
      return pairs.moved ? `${head}，迁移 ${pairs.moved} 个条目到默认分类` : head;
    }

    case 'BACKUP_CREATE':
      return pairs.id ? `备份编号 ${pairs.id}` : '已创建备份';

    default:
      return detail;
  }
}

/** IP 的可读文案：回环地址显示为「本机」 */
export function describeAuditIp(ip?: string | null): string {
  if (!ip) return '—';
  if (['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip)) return '本机';
  return ip;
}
