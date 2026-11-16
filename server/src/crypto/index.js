import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { readJson, writeJson } from '../storage/fsx.js';
import { paths } from '../storage/paths.js';
import { createKdfParams, deriveKek, createVerifier, verifyVerifier } from './kdf.js';
import { encryptField, decryptField } from './aes.js';
import { errors } from '../utils/errors.js';
import { nowIso } from '../utils/ids.js';

/**
 * 加密服务：持有字段密钥（DEK 或 strict 模式的 KEK），封装 setup / 校验 / 加解密。
 * 两级密钥设计见 docs/01 §4.5。
 */
class CryptoService {
  #initialized = false;
  #mode = config.authMode;
  #key = null;

  /** 载入 master.json / secrets.json（服务启动时调用） */
  async load() {
    const master = await readJson(paths.masterFile, null);
    const secrets = await readJson(paths.secretsFile, null);
    this.#initialized = Boolean(master);
    this.#mode =
      secrets?.mode === 'strict' ? 'strict' : secrets?.mode === 'dev' ? 'dev' : config.authMode;
    // dev 模式：DEK 落盘，启动即可用；strict 模式：待登录后注入 KEK
    if (secrets?.mode === 'dev' && secrets.dek) {
      this.#key = Buffer.from(secrets.dek, 'base64');
    } else {
      this.#key = null;
    }
  }

  get initialized() {
    return this.#initialized;
  }

  get mode() {
    return this.#mode;
  }

  /** 当前是否持有字段密钥（strict 模式登录前为 false） */
  get hasKey() {
    return this.#key !== null;
  }

  /** 当前字段密钥（strict 模式更换主密码时用于全量重加密） */
  currentKey() {
    if (!this.#key) throw errors.tokenInvalid('会话已失效，请重新登录');
    return this.#key;
  }

  setKey(key) {
    this.#key = key;
  }

  #requireKey() {
    if (!this.#key) throw errors.tokenInvalid('会话已失效，请重新登录');
  }

  encrypt(plaintext) {
    this.#requireKey();
    return encryptField(this.#key, plaintext);
  }

  decrypt(payload) {
    this.#requireKey();
    return decryptField(this.#key, payload);
  }

  /**
   * 初始化：创建主密码验证器 + KDF 参数 + 数据加密密钥（DEK）
   * dev：secrets.json 存 dek 明文 + dekEnc（供切 strict 迁移）；strict：只存 dekEnc
   */
  async setup(masterPassword) {
    if (this.#initialized) throw errors.alreadyInitialized();
    const kdf = createKdfParams(config.kdfIterations);
    const kek = await deriveKek(masterPassword, kdf);
    const verifier = createVerifier(kek);
    const dek = randomBytes(32);
    const dekB64 = dek.toString('base64');
    const secrets =
      this.#mode === 'strict'
        ? { mode: 'strict', dekEnc: encryptField(kek, dekB64), updatedAt: nowIso() }
        : { mode: 'dev', dek: dekB64, dekEnc: encryptField(kek, dekB64), updatedAt: nowIso() };
    const master = {
      kdf,
      verifier,
      updatedAt: nowIso(),
      failedAttempts: 0,
      lockedUntil: null,
    };
    await writeJson(paths.masterFile, master);
    await writeJson(paths.secretsFile, secrets);
    this.#initialized = true;
    this.#key = this.#mode === 'strict' ? kek : dek;
    return { master, secrets };
  }

  /** 校验主密码；成功时 strict 模式把 KEK 设为字段密钥 */
  async verifyMaster(masterPassword) {
    const master = await readJson(paths.masterFile, null);
    if (!master) throw errors.notFound('系统尚未初始化');
    const kek = await deriveKek(masterPassword, master.kdf);
    if (!verifyVerifier(kek, master.verifier)) return false;
    if (this.#mode === 'strict') this.#key = kek;
    return true;
  }
}

export const cryptoService = new CryptoService();
export default cryptoService;
