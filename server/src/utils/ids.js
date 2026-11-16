import { randomBytes } from 'node:crypto';
import { errors } from './errors.js';

/** Crockford Base32（ULID 字母表，去除 I/L/O/U） */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** ULID：26 位，前 10 位时间戳（48bit），后 16 位随机（80bit），字典序即时间序 */
export function ulid(time = Date.now()) {
  let t = Math.floor(time);
  let timePart = '';
  for (let i = 0; i < 10; i++) {
    timePart = ALPHABET[t % 32] + timePart;
    t = Math.floor(t / 32);
  }
  const rand = randomBytes(10);
  let bits = 0;
  let acc = 0;
  let randPart = '';
  for (const byte of rand) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      randPart += ALPHABET[(acc >> bits) & 31];
      acc &= (1 << bits) - 1;
    }
  }
  if (bits > 0) randPart += ALPHABET[(acc << (5 - bits)) & 31];
  return timePart + randPart;
}

/** ULID 字符集（Crockford，正则写法与 docs/03 一致） */
export const ULID_RE = /^[0-9A-HJ-NP-TV-Z]{26}$/;
/** 分类 ID / 文件名安全字符（防路径穿越，见 docs/02 §6.5） */
export const SAFE_ID_RE = /^[A-Za-z0-9_][A-Za-z0-9_-]{0,49}$/;

export function isUlid(value) {
  return typeof value === 'string' && ULID_RE.test(value);
}

/** 校验用作文件名的 ID（分类 ID），非法直接抛 404 防止路径穿越 */
export function assertSafeId(value, label = 'ID') {
  if (typeof value !== 'string' || !SAFE_ID_RE.test(value)) {
    throw errors.notFound(`非法${label}`);
  }
  return value;
}

export function nowIso() {
  return new Date().toISOString();
}

export default ulid;
