import { pbkdf2, randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import { errors } from '../utils/errors.js';

/** PBKDF2 默认迭代次数（OWASP 2023 建议下限，可由 config 覆盖） */
export const DEFAULT_ITERATIONS = 310000;
export const VERIFIER_CONTEXT = 'password-book-verifier-v1';

/** 生成 KDF 参数（salt 随机 16 字节） */
export function createKdfParams(iterations = DEFAULT_ITERATIONS) {
  return {
    algo: 'PBKDF2-SHA256',
    iterations,
    salt: randomBytes(16).toString('base64'),
  };
}

/** 派生 KEK（32 字节，异步避免阻塞事件循环） */
export function deriveKek(password, kdf) {
  if (!kdf || kdf.algo !== 'PBKDF2-SHA256') {
    throw errors.internal('不支持的 KDF 算法');
  }
  return new Promise((resolve, reject) => {
    pbkdf2(
      String(password),
      Buffer.from(kdf.salt, 'base64'),
      kdf.iterations,
      32,
      'sha256',
      (err, key) => (err ? reject(err) : resolve(key)),
    );
  });
}

/** 由 KEK 生成校验值（不存主密码明文） */
export function createVerifier(kek) {
  return createHmac('sha256', kek).update(VERIFIER_CONTEXT).digest('base64');
}

/** 常量时间比较校验值（docs/02 §6.4） */
export function verifyVerifier(kek, verifier) {
  const a = createHmac('sha256', kek).update(VERIFIER_CONTEXT).digest();
  const b = Buffer.from(String(verifier || ''), 'base64');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
