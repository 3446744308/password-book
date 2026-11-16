import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** 仓库根目录（server/src -> ../..） */
const rootDir = path.resolve(__dirname, '../..');

/** 极简 .env 加载：仅在环境变量未设置时生效（详见 docs/02 §11.1） */
function loadDotEnv() {
  const file = path.join(rootDir, 'server', '.env');
  if (!fs.existsSync(file)) return;
  const content = fs.readFileSync(file, 'utf8');
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m || m[1].startsWith('#')) continue;
    let value = m[2];
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
}
loadDotEnv();

function int(value, fallback) {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function bool(value) {
  return value === 'true' || value === '1';
}

const dataDir = path.resolve(rootDir, process.env.DATA_DIR || 'data');

export const config = {
  isProd: process.env.NODE_ENV === 'production',
  isTest: process.env.NODE_ENV === 'test',
  port: int(process.env.PORT, 3100),
  host: process.env.HOST || '127.0.0.1',
  rootDir,
  dataDir,
  /** dev: DEK 落盘；strict: 字段密钥 = 登录派生的 KEK（见 docs/01 §4.5） */
  authMode: process.env.AUTH_MODE === 'strict' ? 'strict' : 'dev',
  kdfIterations: int(process.env.KDF_ITERATIONS, 310000),
  /**
   * 访问令牌初始有效期（秒）。仅在 config.json 尚未写入 lockMinutes 时作为其初值，
   * 写入后运行期以 config.json 的 lockMinutes 为准（docs/03 §1.3）。
   */
  accessTokenTtl: int(process.env.ACCESS_TOKEN_TTL, 1800),
  refreshTokenTtl: int(process.env.REFRESH_TOKEN_TTL, 604800),
  jwtSecretFile: path.resolve(dataDir, process.env.JWT_SECRET_FILE || 'jwt.secret'),
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:5173')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  loginRate: {
    windowMs: int(process.env.RATE_LOGIN_WINDOW_MS, 5 * 60 * 1000),
    max: int(process.env.RATE_LOGIN_MAX, 5),
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  /** 结构化日志落盘到 <DATA_DIR>/logs/app-YYYYMMDD.log（docs/02 §11.3）；测试或只读介质可关闭 */
  logToFile: process.env.LOG_TO_FILE !== 'false',
  /** 日志文件保留天数，超期在启动时清理 */
  logRetentionDays: int(process.env.LOG_RETENTION_DAYS, 14),
  webDist: path.resolve(rootDir, 'web', 'dist'),
  trustProxy: bool(process.env.TRUST_PROXY),
};

export default config;
