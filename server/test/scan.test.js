import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { scanDataDir } from '../../scripts/scan-plaintext.js';

/** 合法的密文形态（v1:iv:tag:ct） */
const GOOD_CIPHER = 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCC';

let dir;

beforeAll(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pwbook-scan-'));
});

afterAll(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

/** 每个用例前清空临时数据目录 */
beforeEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(dir, { recursive: true });
});

async function write(rel, content) {
  const file = path.join(dir, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
}

describe('明文扫描（docs/01 §10.3 验收标准 #2）', () => {
  it('全部密文落盘的干净库 → 无告警', async () => {
    await write('meta.json', { schemaVersion: 1 });
    await write('master.json', { kdf: { algo: 'PBKDF2-SHA256' }, verifier: 'YQ==' });
    await write('entries/_default.json', {
      categoryId: '_default',
      items: [
        { id: '01JD8Z8G9QK3M2N7P5R6T8WXYZ', title: '邮箱', passwordEnc: GOOD_CIPHER, notesEnc: null },
        { id: '01JD8Z8G9QK3M2N7P5R6T8WXY0', title: '无密码', passwordEnc: null, notesEnc: GOOD_CIPHER },
      ],
    });
    await write('history/01JD8Z8G9QK3M2N7P5R6T8WXYZ.json', {
      entryId: '01JD8Z8G9QK3M2N7P5R6T8WXYZ',
      versions: [{ version: 1, passwordEnc: GOOD_CIPHER, changedAt: '2026-11-16T09:00:00.000Z' }],
    });
    await write('logs/audit.jsonl', '{"ts":"2026-11-16T09:00:00.000Z","event":"LOGIN_OK","ip":"127.0.0.1","detail":"jti=x"}\n');

    const { scannedFiles, findings } = await scanDataDir(dir);
    // meta.json + master.json + entries/_default.json + history/<id>.json + logs/audit.jsonl
    expect(scannedFiles).toBe(5);
    expect(findings).toEqual([]);
  });

  it('带 UTF-8 BOM 的数据文件仍可正常解析（不误判为损坏）', async () => {
    await fs.writeFile(
      path.join(dir, 'entries-bom.json'),
      `\uFEFF${JSON.stringify({ items: [{ id: 'a', passwordEnc: GOOD_CIPHER }] })}`,
      'utf8',
    );
    const { findings } = await scanDataDir(dir);
    expect(findings).toEqual([]);
  });

  it('条目里出现明文字段 password → 告警', async () => {
    await write('entries/_default.json', {
      items: [{ id: '01JD8Z8G9QK3M2N7P5R6T8WXYZ', title: '邮箱', password: 'Str0ng!Pass' }],
    });
    const { findings } = await scanDataDir(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toContain('password');
    expect(findings[0].file).toContain('_default.json');
  });

  it('明文 notes 字段 → 告警（应为 notesEnc）', async () => {
    await write('entries/_default.json', { items: [{ id: 'x', notes: '恢复邮箱：a@b.c' }] });
    const { findings } = await scanDataDir(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toContain('notes');
  });

  it('密文格式非法 → 告警', async () => {
    await write('entries/_default.json', {
      items: [
        { id: 'a', passwordEnc: 'Str0ng!Pass' },
        { id: 'b', passwordEnc: 'v1:只有两段' },
        { id: 'c', notesEnc: 'v1:AAAAAAAAAAAAAAAA:BBBBBBBBBBBBBBBBBBBBBB:CCCCCCCCCCCC' },
      ],
    });
    const { findings } = await scanDataDir(dir);
    expect(findings).toHaveLength(2);
    expect(findings.every((f) => f.reason.includes('密文字段格式非法'))).toBe(true);
  });

  it('审计日志行内出现明文字段 → 告警（按行解析，定位到行号）', async () => {
    await write(
      'logs/audit.jsonl',
      '{"event":"LOGIN_OK","ip":"127.0.0.1"}\n{"event":"LOGIN_FAIL","password":"hunter2"}\n',
    );
    const { findings } = await scanDataDir(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toContain('line 2');
    expect(findings[0].reason).toContain('明文字段');
  });

  it('审计日志行不是合法 JSON → 告警', async () => {
    await write('logs/audit.jsonl', '{"event":"LOGIN_OK"}\nnot-json\n');
    const { findings } = await scanDataDir(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].field).toContain('line 2');
  });

  it('损坏的 JSON 文件 → 告警而非静默通过', async () => {
    await write('entries/broken.json', '{ not json');
    const { findings } = await scanDataDir(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].reason).toContain('不是合法 JSON');
  });

  it('递归扫描子目录（含 backups）', async () => {
    await write('backups/20261116-090000/entries/_default.json', {
      items: [{ id: 'x', password: 'leaked' }],
    });
    const { findings } = await scanDataDir(dir);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toContain('backups');
  });

  it('目录不存在时返回零文件而不是抛错', async () => {
    const { scannedFiles, findings } = await scanDataDir(path.join(dir, 'not-exist'));
    expect(scannedFiles).toBe(0);
    expect(findings).toEqual([]);
  });
});
