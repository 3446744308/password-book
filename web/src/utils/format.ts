/** 时间格式化 */
export function formatTime(iso?: string | null): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', { hour12: false });
}

/** 文件体积格式化 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 相对时间（如「3 分钟前」），用于审计日志这类按时间扫读的列表。
 *
 * 超过 30 天返回空串——那种场景看绝对时间更有意义，由调用方决定是否展示。
 *
 * @param iso ISO 时间串
 * @param now 当前时间戳，测试可注入
 */
export function formatRelativeTime(iso?: string | null, now: number = Date.now()): string {
  if (!iso) return '';
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';

  const diffMs = now - time;
  if (diffMs < 0) return '刚刚';

  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} 天前`;

  return '';
}
