import { createHmac, timingSafeEqual } from 'node:crypto';
import { errors } from './errors.js';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** 生成 HS256 JWT，返回 { token, payload }（issuedAtMs 用于毫秒级吊销判定） */
export function signJwt(payload, secret, ttlSeconds) {
  const nowMs = Date.now();
  const now = Math.floor(nowMs / 1000);
  const body = { ...payload, iat: now, issuedAtMs: nowMs, exp: now + ttlSeconds };
  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify(body));
  const sig = createHmac('sha256', secret).update(`${header}.${claim}`).digest('base64url');
  return { token: `${header}.${claim}.${sig}`, payload: body };
}

/** 校验 HS256 JWT，失败抛 AppError（TOKEN_INVALID / TOKEN_EXPIRED） */
export function verifyJwt(token, secret) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) throw errors.tokenInvalid();
  const [header, claim, sig] = parts;
  const expected = createHmac('sha256', secret).update(`${header}.${claim}`).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw errors.tokenInvalid();
  let payload;
  try {
    payload = JSON.parse(Buffer.from(claim, 'base64url').toString('utf8'));
  } catch {
    throw errors.tokenInvalid();
  }
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now())
    throw errors.tokenExpired();
  return payload;
}

/** 解析 Cookie 头（不依赖第三方库） */
export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const pair of String(header).split(';')) {
    const idx = pair.indexOf('=');
    if (idx < 0) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}
