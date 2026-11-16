import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express from 'express';
import { config } from './config.js';
import { runtime } from './runtime.js';
import { logger, cleanupOldLogs } from './logger.js';
import { ensureDataDirs, ensureSchema, cleanupTrash } from './storage/migrate.js';
import { cryptoService } from './crypto/index.js';
import apiRouter from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';

/** 回环地址判定：dev 模式把字段密钥明文落盘，绑定到非本机地址时必须告警 */
function isLoopbackHost(host) {
  return ['127.0.0.1', '::1', 'localhost'].includes(String(host).toLowerCase());
}

/** 启动引导：数据目录 → 日志轮转 → JWT 密钥 → 结构迁移 → 加载加密态 → 清理历史垃圾 */
async function bootstrap() {
  await ensureDataDirs();

  const staleLogs = await cleanupOldLogs();
  if (staleLogs > 0) logger.info('log.rotated', { removed: staleLogs });

  if (!runtime.jwtSecret) {
    let secret = null;
    try {
      secret = (await fs.readFile(config.jwtSecretFile, 'utf8')).trim();
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (!secret) {
      secret = randomBytes(48).toString('hex');
      await fs.writeFile(config.jwtSecretFile, secret, { encoding: 'utf8', mode: 0o600 });
      logger.info('jwt.secret.created', { file: config.jwtSecretFile });
    }
    runtime.jwtSecret = secret;
  }

  await ensureSchema();

  // 恢复令牌吊销线（更换主密码后重启仍使旧令牌失效）
  try {
    const { readMaster } = await import('./storage/repository.js');
    const master = await readMaster();
    if (master?.tokensValidFrom) runtime.tokenNotBefore = master.tokensValidFrom;
  } catch (err) {
    logger.warn('token.notbefore.load.failed', { message: err.message });
  }

  await cryptoService.load();

  // 老库升级路径：已初始化但还没有内置分类时补写一次（presetsSeeded 标记保证只执行一次）
  if (cryptoService.initialized) {
    const { seedPresetCategories } = await import('./storage/repository.js');
    const { seeded } = await seedPresetCategories();
    if (seeded > 0) logger.info('presets.seeded', { categories: seeded });
  }

  // dev 模式把 DEK 明文写在 data/secrets.json，只适用于本机单机使用（docs/01 §4.5）
  if (cryptoService.mode === 'dev' && !isLoopbackHost(config.host)) {
    logger.warn('security.dev_mode.exposed', {
      host: config.host,
      advice: 'dev 模式下数据密钥明文落盘，仅限本机访问；对外提供服务请改用 AUTH_MODE=strict',
    });
  }

  const trashed = await cleanupTrash();
  if (trashed > 0) logger.info('history.trash.cleaned', { count: trashed });
}

await bootstrap();

const app = express();
app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');

// ---- 基础安全响应头（无第三方依赖） ----
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

// ---- CORS（白名单，docs/03 §1.5） ----
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && config.corsOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

// ---- 请求日志（不含任何敏感头） ----
app.use((req, res, next) => {
  const started = Date.now();
  res.on('finish', () => {
    logger.info('http', {
      m: req.method,
      p: req.originalUrl,
      s: res.statusCode,
      ms: Date.now() - started,
    });
  });
  next();
});

app.use(express.json({ limit: '1mb' }));

// ---- API ----
app.use('/api/v1', apiRouter);
app.use('/api', notFoundHandler);

// ---- 生产：托管前端构建产物（SPA 回退） ----
const indexHtml = path.join(config.webDist, 'index.html');
if (existsSync(indexHtml)) {
  app.use(express.static(config.webDist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next();
    res.sendFile(indexHtml);
  });
}

// ---- 统一错误出口 ----
app.use(errorHandler);

export default app;
