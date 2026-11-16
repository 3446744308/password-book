#!/usr/bin/env node
/**
 * 明文扫描：断言 data/ 目录中不含任何明文密码（docs/01 §10.3 验收标准 #2）。
 *
 * 用法：
 *   node scripts/scan-plaintext.js [dataDir]        # 默认读 DATA_DIR 或 ./data
 *   node scripts/scan-plaintext.js --json           # 机器可读输出
 *
 * 退出码：0 = 干净；1 = 发现问题；2 = 数据目录不存在。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 密文字段必须匹配的形态：v1:<iv>:<tag>:<ct>（docs/01 §4.4） */
const CIPHER_RE = /^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

/** 这些键名一旦出现，说明明文落盘了 */
const FORBIDDEN_KEYS = ['password', 'masterpassword', 'plainpassword', 'passwordplain', 'notes'];

/** 这些字段必须为密文（值为 null 表示"未设置"，合法） */
const ENCRYPTED_FIELDS = ['passwordEnc', 'notesEnc'];

/** 跳过与主数据无关的目录，避免把备份/依赖扫进来 */
const SKIP_DIRS = new Set(['node_modules', '.git']);

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return out;
    throw err;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
  return out;
}

/** 递归检查一个已解析的 JSON 值 */
function inspectValue(value, file, pointer, findings) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectValue(item, file, `${pointer}[${index}]`, findings));
    return;
  }
  if (value === null || typeof value !== 'object') return;

  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    const location = `${pointer}.${key}`;

    if (FORBIDDEN_KEYS.includes(lower)) {
      findings.push({ file, field: location, reason: `出现明文字段「${key}」，应为 passwordEnc / notesEnc` });
    } else if (ENCRYPTED_FIELDS.includes(key) && child !== null) {
      if (typeof child !== 'string' || !CIPHER_RE.test(child)) {
        findings.push({ file, field: location, reason: '密文字段格式非法（应形如 v1:iv:tag:ct）' });
      }
    }
    inspectValue(child, file, location, findings);
  }
}

/**
 * 扫描指定目录。
 * @param {string} dataDir 数据目录
 * @returns {Promise<{ scannedFiles: number, findings: Array<{file:string, field:string, reason:string}> }>}
 */
export async function scanDataDir(dataDir) {
  const root = path.resolve(dataDir);
  const files = await walk(root);
  const findings = [];
  let scannedFiles = 0;

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    const rel = path.relative(root, file);
    let text;
    try {
      // 去掉可能存在的 UTF-8 BOM：手工编辑/外部工具导出的文件常带，不应被误判为损坏
      text = (await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '');
    } catch {
      continue; // 二进制/不可读文件跳过
    }

    if (ext === '.json') {
      scannedFiles++;
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        findings.push({ file: rel, field: '(root)', reason: '数据文件不是合法 JSON（可能已损坏）' });
        continue;
      }
      inspectValue(parsed, rel, '', findings);
    } else if (ext === '.jsonl') {
      scannedFiles++;
      const lines = text.split(/\r?\n/).filter(Boolean);
      lines.forEach((line, index) => {
        try {
          inspectValue(JSON.parse(line), rel, `[line ${index + 1}]`, findings);
        } catch {
          findings.push({ file: rel, field: `[line ${index + 1}]`, reason: '审计日志行不是合法 JSON' });
        }
      });
    }
  }

  return { scannedFiles, findings };
}

async function main() {
  const args = process.argv.slice(2);
  const json = args.includes('--json');
  const dirArg = args.find((a) => !a.startsWith('--'));
  // 默认数据目录与 server 的约定一致：<仓库根>/<DATA_DIR 或 data>，与当前工作目录无关
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const dataDir = dirArg
    ? path.resolve(process.cwd(), dirArg)
    : path.resolve(repoRoot, process.env.DATA_DIR || 'data');

  try {
    await fs.access(dataDir);
  } catch {
    console.error(`[scan] 数据目录不存在：${dataDir}`);
    process.exitCode = 2;
    return;
  }

  const { scannedFiles, findings } = await scanDataDir(dataDir);

  if (json) {
    console.log(JSON.stringify({ dataDir, scannedFiles, findings }, null, 2));
  } else {
    console.log(`[scan] 目录：${dataDir}`);
    console.log(`[scan] 已扫描 ${scannedFiles} 个 JSON/JSONL 文件`);
    if (findings.length === 0) {
      console.log('[scan] 通过：未发现明文密码字段，密文格式均合法');
    } else {
      console.log(`[scan] 发现 ${findings.length} 处问题：`);
      for (const f of findings) console.log(`  - ${f.file} ${f.field} —— ${f.reason}`);
    }
  }

  if (findings.length > 0) process.exitCode = 1;
}

// 直接执行时才跑 CLI（被测试 import 时不执行）
const invokedDirectly = Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();

export default main;
