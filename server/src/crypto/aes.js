import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { errors } from '../utils/errors.js';

/** 密文格式：v1:<iv_b64>:<tag_b64>:<ct_b64>（AES-256-GCM，docs/01 §4.4） */
const PREFIX = 'v1';

/** AES-256-GCM 加密字段，IV 每次随机 12 字节 */
export function encryptField(key, plaintext) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${ct.toString('base64')}`;
}

/** 解密字段；篡改/密钥不匹配抛 INTERNAL_ERROR（GCM 认证失败） */
export function decryptField(key, payload) {
  if (typeof payload !== 'string') throw errors.internal('密文格式错误');
  const parts = payload.split(':');
  if (parts.length !== 4 || parts[0] !== PREFIX) throw errors.internal('不支持的密文版本');
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(parts[1], 'base64'));
    decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
    const out = Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]);
    return out.toString('utf8');
  } catch {
    throw errors.internal('解密失败：数据已损坏或密钥不匹配');
  }
}
