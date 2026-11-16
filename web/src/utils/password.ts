/**
 * 密码生成器核心逻辑（与 UI 解耦，便于单元测试）。
 *
 * 字符集刻意排除易混淆字符：I / l / 1 / O / 0。
 */

export const CHARSETS: Record<string, string> = {
  lower: 'abcdefghijkmnopqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digit: '23456789',
  symbol: '!@#$%^&*()-_=+[]{}<>?/|~',
};

/** 取所选字符类型的并集字符池 */
export function buildPool(flags: string[]): string {
  let pool = '';
  for (const flag of flags) pool += CHARSETS[flag] ?? '';
  return pool;
}

/** 默认随机源：Web Crypto，返回 length 个 32 位无符号整数 */
function secureRandomUint32(length: number): Uint32Array {
  const buffer = new Uint32Array(length);
  crypto.getRandomValues(buffer);
  return buffer;
}

/**
 * 生成随机密码。
 *
 * 采用拒绝采样（rejection sampling）消除 `随机数 % 池长度` 带来的取模偏差，
 * 保证每个字符等概率出现。
 *
 * @param length 密码长度
 * @param flags  启用的字符类型（CHARSETS 的键）
 * @param randomUint32 随机源，测试可注入确定性实现
 */
export function generatePassword(
  length: number,
  flags: string[],
  randomUint32: (n: number) => Uint32Array = secureRandomUint32,
): string {
  const pool = buildPool(flags);
  if (!pool || length <= 0 || !Number.isInteger(length)) return '';

  // 只接受小于 limit 的随机值，余数区间因此完全均匀
  const limit = Math.floor(0x1_0000_0000 / pool.length) * pool.length;
  let out = '';
  let buffer = randomUint32(length);
  let cursor = 0;
  while (out.length < length) {
    // 随机源返回空数组时直接收尾，绝不死循环
    if (!buffer || buffer.length === 0) break;
    if (cursor >= buffer.length) {
      buffer = randomUint32(length);
      cursor = 0;
      continue;
    }
    const value = buffer[cursor++];
    if (value >= limit) continue;
    out += pool[value % pool.length];
  }
  return out;
}

/**
 * 估算熵值（单位 bit）= log2(字符池大小) × 长度。
 *
 * 该值假设字符独立均匀分布，未考虑常见弱口令规则，仅用于给用户一个量级提示。
 */
export function estimateEntropy(flags: string[], length: number): number {
  const poolSize = buildPool(flags).length;
  if (!poolSize || length <= 0) return 0;
  return Math.round(Math.log2(poolSize) * length);
}

/** 熵值分级：强 / 中 / 弱（阈值与 UI 颜色一一对应） */
export function entropyLevel(bits: number): 'strong' | 'medium' | 'weak' {
  if (bits >= 80) return 'strong';
  if (bits >= 60) return 'medium';
  return 'weak';
}

/**
 * 依据**实际字符组成**估算已有密码的强度，用于录入时的即时反馈。
 *
 * 与 estimateEntropy 的区别：后者按"选中的字符类型"预估一个待生成密码的强度，
 * 这里看的是用户已经敲进去的那串字符实际用到了哪几类。
 * 依然只是量级提示，不含常见弱口令字典与重复模式检测。
 */
export function describePasswordStrength(value: string): {
  bits: number;
  level: 'strong' | 'medium' | 'weak';
} {
  if (!value) return { bits: 0, level: 'weak' };

  let poolSize = 0;
  if (/[a-z]/.test(value)) poolSize += CHARSETS.lower.length;
  if (/[A-Z]/.test(value)) poolSize += CHARSETS.upper.length;
  if (/[0-9]/.test(value)) poolSize += CHARSETS.digit.length;
  if (/[^A-Za-z0-9]/.test(value)) poolSize += CHARSETS.symbol.length;

  if (poolSize === 0) return { bits: 0, level: 'weak' };
  const bits = Math.round(Math.log2(poolSize) * value.length);
  return { bits, level: entropyLevel(bits) };
}
