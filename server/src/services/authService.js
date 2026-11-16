import { config } from '../config.js';
import * as repo from '../storage/repository.js';
import { cryptoService } from '../crypto/index.js';
import { createKdfParams, deriveKek, createVerifier, verifyVerifier } from '../crypto/kdf.js';
import { encryptField, decryptField } from '../crypto/aes.js';
import { signJwt, verifyJwt } from '../utils/jwt.js';
import { runtime } from '../runtime.js';
import { errors } from '../utils/errors.js';
import { ulid, nowIso } from '../utils/ids.js';
import { masterPasswordIssues } from '../utils/validate.js';
import { readJson, writeJson } from '../storage/fsx.js';
import { paths } from '../storage/paths.js';
import { SCHEMA_VERSION } from '../version.js';

/** 认证服务：初始化 / 登录 / 限速计数 / 令牌 / 更换主密码 */
export const authService = {
  /** GET /system/status 数据源 */
  async status() {
    const cfg = await repo.readConfig();
    const master = await repo.readMaster();
    const base = {
      initialized: Boolean(master),
      lockMinutes: cfg.lockMinutes,
      failedAttempts: cfg.failedAttempts,
      failedAttemptsRemaining: 0,
      entryCount: 0,
      categoryCount: 0,
      schemaVersion: SCHEMA_VERSION,
    };
    if (!master) return base;

    const failed = master.failedAttempts || 0;
    const lockedUntil = master.lockedUntil;
    const locked = Boolean(lockedUntil) && new Date(lockedUntil).getTime() > Date.now();
    const c = await repo.counts();
    return {
      ...base,
      failedAttemptsRemaining: Math.max(0, cfg.failedAttempts - failed),
      ...(locked ? { lockedUntil } : {}),
      entryCount: c.entryCount,
      categoryCount: c.categoryCount,
    };
  },

  /** POST /auth/setup：初始化主密码（仅一次） */
  async setup(masterPassword, ip) {
    const cfg = await repo.readConfig();
    const issues = masterPasswordIssues(masterPassword, cfg.minPasswordLength);
    if (issues.length) throw errors.validation(issues);
    if (await repo.readMaster()) throw errors.alreadyInitialized();

    await cryptoService.setup(masterPassword);
    await repo.ensureDefaultCategory();
    await repo.appendAudit('SETUP_OK', { ip, detail: `mode=${cryptoService.mode}` });
    return { initialized: true, defaultCategoryId: '_default' };
  },

  /** POST /auth/login：主密码校验 + 失败计数 + 锁定 + 签发令牌 */
  async login(masterPassword, ip) {
    const master = await repo.readMaster();
    if (!master) {
      throw errors.validation(
        [{ field: 'masterPassword', message: '系统尚未初始化' }],
        '系统尚未初始化',
      );
    }
    const cfg = await repo.readConfig();
    const now = Date.now();

    if (master.lockedUntil && new Date(master.lockedUntil).getTime() > now) {
      throw errors.lockedOut(master.lockedUntil);
    }
    if (typeof masterPassword !== 'string' || masterPassword === '') {
      throw errors.validation([{ field: 'masterPassword', message: '请输入主密码' }]);
    }

    const passed = await cryptoService.verifyMaster(masterPassword);
    if (!passed) {
      const failed = (master.failedAttempts || 0) + 1;
      let lockedUntil = null;
      if (failed >= cfg.failedAttempts) {
        lockedUntil = new Date(now + cfg.lockMinutesAfterBan * 60000).toISOString();
      }
      await repo.mutateMaster((m) => ({
        ...m,
        failedAttempts: failed,
        lockedUntil,
        lastFailedAt: new Date(now).toISOString(),
      }));
      await repo.appendAudit('LOGIN_FAIL', { ip, detail: `attempt=${failed}` });
      if (lockedUntil) {
        await repo.appendAudit('LOCKOUT', { ip, detail: `until=${lockedUntil}` });
        throw errors.lockedOut(lockedUntil);
      }
      throw errors.invalidCredentials();
    }

    await repo.mutateMaster((m) => ({ ...m, failedAttempts: 0, lockedUntil: null }));
    // 会话时长以 config.json 的 lockMinutes 为准（docs/03 §1.3），刷新令牌仍用独立的长时效
    const ttl = cfg.lockMinutes * 60;
    const jti = ulid();
    const access = signJwt({ sub: 'admin', jti, typ: 'access' }, runtime.jwtSecret, ttl);
    const refresh = signJwt(
      { sub: 'admin', jti: ulid(), typ: 'refresh' },
      runtime.jwtSecret,
      config.refreshTokenTtl,
    );
    await repo.appendAudit('LOGIN_OK', { ip, detail: `jti=${jti}` });
    return {
      accessToken: access.token,
      tokenType: 'Bearer',
      expiresIn: ttl,
      serverTime: nowIso(),
      refreshToken: refresh.token,
      refreshMaxAge: config.refreshTokenTtl,
    };
  },

  /** POST /auth/refresh：凭 refreshToken Cookie 换新 accessToken */
  async refresh(refreshToken) {
    if (!refreshToken) throw errors.tokenMissing();
    const payload = verifyJwt(refreshToken, runtime.jwtSecret);
    if (payload.typ !== 'refresh' || payload.sub !== 'admin')
      throw errors.tokenInvalid('令牌类型错误');
    if (runtime.revokedJti.has(payload.jti)) throw errors.tokenInvalid('令牌已失效');
    if ((payload.issuedAtMs || 0) < runtime.tokenNotBefore)
      throw errors.tokenInvalid('令牌已失效，请重新登录');
    const cfg = await repo.readConfig();
    const ttl = cfg.lockMinutes * 60;
    const access = signJwt({ sub: 'admin', jti: ulid(), typ: 'access' }, runtime.jwtSecret, ttl);
    return {
      accessToken: access.token,
      tokenType: 'Bearer',
      expiresIn: ttl,
      serverTime: nowIso(),
    };
  },

  /** GET /auth/session */
  async session(auth) {
    const cfg = await repo.readConfig();
    return {
      authenticated: true,
      expiresAt: new Date(auth.exp * 1000).toISOString(),
      lockMinutes: cfg.lockMinutes,
    };
  },

  /** POST /auth/logout：吊销当前 jti */
  async logout(auth, ip) {
    runtime.revokedJti.add(auth.jti);
    await repo.appendAudit('LOGOUT', { ip, detail: `jti=${auth.jti}` });
  },

  /**
   * POST /auth/change-master
   * dev 模式：仅用新 KEK 重新封装 DEK（reencryptedEntries=0）
   * strict 模式：字段密钥即 KEK，全量重加密所有密文
   */
  async changeMaster(auth, currentPassword, newPassword, ip) {
    const master = await repo.readMaster();
    if (!master) throw errors.notFound('系统尚未初始化');
    const cfg = await repo.readConfig();

    const issues = masterPasswordIssues(newPassword, cfg.minPasswordLength, 'newPassword');
    if (issues.length) throw errors.validation(issues);

    const oldKek = await deriveKek(currentPassword, master.kdf);
    if (!verifyVerifier(oldKek, master.verifier)) throw errors.invalidCredentials();

    const newKdf = createKdfParams(config.kdfIterations);
    const newKek = await deriveKek(newPassword, newKdf);
    const newVerifier = createVerifier(newKek);

    let reencryptedEntries = 0;
    if (cryptoService.mode === 'strict') {
      const oldKey = cryptoService.currentKey();
      reencryptedEntries = await repo.reencryptAll((payload) =>
        encryptField(newKek, decryptField(oldKey, payload)),
      );
      cryptoService.setKey(newKek);
    } else {
      const secrets = await readJson(paths.secretsFile, null);
      if (secrets?.dek) {
        secrets.dekEnc = encryptField(newKek, secrets.dek);
        secrets.updatedAt = nowIso();
        await writeJson(paths.secretsFile, secrets);
      }
    }

    // 旧令牌全部失效（持久化吊销线，重启后依然生效）
    runtime.tokenNotBefore = Date.now();
    runtime.revokedJti.clear();

    await repo.mutateMaster((m) => ({
      ...m,
      kdf: newKdf,
      verifier: newVerifier,
      failedAttempts: 0,
      lockedUntil: null,
      tokensValidFrom: runtime.tokenNotBefore,
      updatedAt: nowIso(),
    }));
    await repo.appendAudit('MASTER_CHANGE', {
      ip,
      detail: `jti=${auth.jti},reencrypted=${reencryptedEntries},mode=${cryptoService.mode}`,
    });
    return { changed: true, reencryptedEntries, reloginRequired: true };
  },
};

export default authService;
