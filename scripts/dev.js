#!/usr/bin/env node
/**
 * 一条命令同时启动后端与前端开发服务器。
 *
 * 用法（在仓库根目录执行）：
 *   node scripts/dev.js
 *
 * 为什么不用 npm 脚本包一层：
 * - Windows 上 `spawn('npm', ...)` 因为解析到 npm.cmd 需要 shell:true，容易踩坑；
 *   这里直接用当前 node 可执行文件跑两端入口，跨平台一致。
 * - 零第三方依赖（符合 docs/02 §2 依赖原则），不引入 concurrently 之类工具。
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const RESET = '\u001b[0m';
const COLORS = { server: '\u001b[36m', web: '\u001b[35m' };

const targets = [
  {
    name: 'server',
    label: '后端',
    cwd: path.join(rootDir, 'server'),
    args: ['--watch', 'src/server.js'],
    url: 'http://127.0.0.1:3100',
    requires: path.join(rootDir, 'server', 'node_modules'),
    install: 'npm --prefix server install',
  },
  {
    name: 'web',
    label: '前端',
    cwd: path.join(rootDir, 'web'),
    args: [path.join(rootDir, 'web', 'node_modules', 'vite', 'bin', 'vite.js')],
    url: 'http://localhost:5173',
    requires: path.join(rootDir, 'web', 'node_modules'),
    install: 'npm --prefix web install',
  },
];

function fail(message) {
  console.error(`\n[dev] ${message}\n`);
  process.exit(1);
}

// 依赖缺失时给出明确指令，而不是让子进程抛一堆 ERR_MODULE_NOT_FOUND
const missing = targets.filter((t) => !existsSync(t.requires));
if (missing.length > 0) {
  fail(`缺少依赖，请先安装：\n${missing.map((t) => `  ${t.install}`).join('\n')}`);
}

const children = [];
let shuttingDown = false;

/** 带进程名前缀地转发子进程输出，便于一眼看出是前端还是后端报的错 */
function pipeWithPrefix(child, name) {
  const color = COLORS[name] ?? '';
  const prefix = `${color}[${name}]${RESET} `;
  let buffer = '';

  const flush = (chunk, isErr) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const text = `${prefix}${line}`;
      if (isErr) console.error(text);
      else console.log(text);
    }
  };

  child.stdout?.setEncoding('utf8');
  child.stderr?.setEncoding('utf8');
  child.stdout?.on('data', (chunk) => flush(chunk, false));
  child.stderr?.on('data', (chunk) => flush(chunk, true));
}

function shutdown(reason) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (reason) console.log(`\n[dev] ${reason}，正在停止…`);
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
  // 给子进程一点时间做优雅退出（后端会释放 data/.server.lock）
  setTimeout(() => process.exit(0), 1500);
}

for (const target of targets) {
  const child = spawn(process.execPath, target.args, {
    cwd: target.cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  pipeWithPrefix(child, target.name);
  child.on('error', (err) => fail(`启动 ${target.label} 失败：${err.message}`));
  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    // 任一端退出就整体退出，避免留下孤儿进程占端口
    shutdown(`${target.label}已退出（code=${code}${signal ? `, signal=${signal}` : ''}）`);
  });
  children.push(child);
  console.log(
    `${COLORS[target.name]}[${target.name}]${RESET} 启动 ${target.label} → ${target.url}`,
  );
}

console.log('\n[dev] 两端已拉起，按 Ctrl+C 停止。');

process.on('SIGINT', () => shutdown('收到 Ctrl+C'));
process.on('SIGTERM', () => shutdown('收到 SIGTERM'));
