import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createTestEnv } from './helpers.js';
import { encryptField, decryptField } from '../src/crypto/aes.js';
import { createKdfParams, deriveKek, createVerifier, verifyVerifier } from '../src/crypto/kdf.js';
import { ulid, isUlid } from '../src/utils/ids.js';
import { signJwt, verifyJwt } from '../src/utils/jwt.js';

let env;
beforeAll(async () => {
  env = await createTestEnv();
});
afterAll(async () => {
  await env.cleanup();
});

describe('AES-256-GCM 字段加解密', () => {
  const key = randomBytes(32);

  it('加解密往返一致，格式为 v1:iv:tag:ct', () => {
    const enc = encryptField(key, 'p@ss密码!2026');
    expect(enc.startsWith('v1:')).toBe(true);
    expect(enc.split(':')).toHaveLength(4);
    expect(decryptField(key, enc)).toBe('p@ss密码!2026');
  });

  it('相同明文两次加密产生不同密文（IV 随机不复用）', () => {
    const a = encryptField(key, 'same');
    const b = encryptField(key, 'same');
    expect(a).not.toBe(b);
    expect(decryptField(key, a)).toBe(decryptField(key, b));
  });

  it('密文被篡改 → 解密失败（GCM 认证标签）', () => {
    const enc = encryptField(key, 'secret');
    const parts = enc.split(':');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] ^= 0xff;
    parts[3] = ct.toString('base64');
    expect(() => decryptField(key, parts.join(':'))).toThrow(/解密失败/);
  });

  it('错误密钥 → 解密失败', () => {
    const enc = encryptField(key, 'secret');
    expect(() => decryptField(randomBytes(32), enc)).toThrow(/解密失败/);
  });

  it('不支持的版本前缀 → 报错', () => {
    expect(() => decryptField(key, 'v2:a:b:c')).toThrow(/密文版本/);
    expect(() => decryptField(key, 'garbage')).toThrow(/密文版本/);
  });
});

describe('KDF（PBKDF2-SHA256）', () => {
  it('相同口令与参数派生结果一致，长度 32 字节', async () => {
    const kdf = createKdfParams(1000);
    const a = await deriveKek('Master12345', kdf);
    const b = await deriveKek('Master12345', kdf);
    expect(a.equals(b)).toBe(true);
    expect(a).toHaveLength(32);
  });

  it('不同 salt 派生不同密钥', async () => {
    const a = await deriveKek('x', createKdfParams(1000));
    const b = await deriveKek('x', createKdfParams(1000));
    expect(a.equals(b)).toBe(false);
  });

  it('verifier 校验：正确 KEK 通过，错误 KEK 拒绝', async () => {
    const kdf = createKdfParams(1000);
    const kek = await deriveKek('Master12345', kdf);
    const verifier = createVerifier(kek);
    expect(verifyVerifier(kek, verifier)).toBe(true);
    const wrong = await deriveKek('Wrong99999', kdf);
    expect(verifyVerifier(wrong, verifier)).toBe(false);
    expect(verifyVerifier(kek, '')).toBe(false);
  });
});

describe('ULID', () => {
  it('长度 26、字符集合法', () => {
    const id = ulid();
    expect(id).toHaveLength(26);
    expect(isUlid(id)).toBe(true);
  });

  it('大批量生成无重复', () => {
    const set = new Set();
    for (let i = 0; i < 2000; i++) set.add(ulid());
    expect(set.size).toBe(2000);
  });
});

describe('JWT（HS256 自实现）', () => {
  const secret = 'test-secret';

  it('签发与校验往返', () => {
    const { token, payload } = signJwt({ sub: 'admin', typ: 'access' }, secret, 60);
    const verified = verifyJwt(token, secret);
    expect(verified.sub).toBe('admin');
    expect(verified.exp).toBeGreaterThan(payload.iat);
    expect(typeof verified.issuedAtMs).toBe('number');
  });

  it('篡改签名 / 篡改载荷 → 拒绝', () => {
    const { token } = signJwt({ sub: 'admin' }, secret, 60);
    const [h, p] = token.split('.');
    expect(() => verifyJwt(`${h}.${p}.AAAA`, secret)).toThrow();
    const evil = Buffer.from(JSON.stringify({ sub: 'hacker', exp: 9999999999 })).toString('base64url');
    expect(() => verifyJwt(`${h}.${evil}.${token.split('.')[2]}`, secret)).toThrow();
  });

  it('过期令牌 → TOKEN_EXPIRED', () => {
    const { token } = signJwt({ sub: 'admin' }, secret, -1);
    expect(() => verifyJwt(token, secret)).toThrow(/过期/);
  });
});
