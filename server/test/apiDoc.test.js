import { describe, it, expect } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkApiDoc, collectDoc, collectRoutes } from '../../scripts/check-api-doc.js';

/**
 * 文档漂移守卫（docs/02 §4.6：端点变更必须同步 docs/03）。
 *
 * 这里直接对真实仓库做比对：一旦有人新增/删除路由却没改文档，
 * `npm test` 就会失败，而不是等到联调时才发现。
 */

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

describe('docs/03 与实现一致', () => {
  it('每个路由都有对应的文档小节与总览表行，且无多余条目', async () => {
    const { routes, sections, problems } = await checkApiDoc({ rootDir });
    expect(problems).toEqual([]);
    expect(routes.length).toBeGreaterThan(0);
    expect(sections).toHaveLength(routes.length);
  });

  it('路由抽取覆盖全部四个模块且方法齐全', async () => {
    const routes = await collectRoutes(path.join(rootDir, 'server/src/routes'));
    expect(new Set(routes.map((r) => r.module))).toEqual(
      new Set(['auth', 'categories', 'entries', 'system']),
    );
    // 写操作与读操作都在
    expect(routes.some((r) => r.method === 'GET')).toBe(true);
    expect(routes.some((r) => r.method === 'POST')).toBe(true);
    expect(routes.some((r) => r.method === 'PUT')).toBe(true);
    expect(routes.some((r) => r.method === 'PATCH')).toBe(true);
    expect(routes.some((r) => r.method === 'DELETE')).toBe(true);
    // 带参数的路径应保留原样
    expect(routes.some((r) => r.path === '/api/v1/entries/:id/reveal')).toBe(true);
  });

  it('文档里的端点路径都带版本前缀', async () => {
    const { table } = await collectDoc(path.join(rootDir, 'docs/03-API接口文档.md'));
    expect(table.length).toBeGreaterThan(0);
    for (const row of table) expect(row.path.startsWith('/api/v1/')).toBe(true);
  });

  it('真能查出漂移：文档少一节时应报错（防止守卫自身失效）', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'pwbook-apidoc-'));
    try {
      const srcRoutes = path.join(rootDir, 'server/src/routes');
      const tmpRoutes = path.join(tmp, 'server/src/routes');
      await fs.mkdir(tmpRoutes, { recursive: true });
      await fs.mkdir(path.join(tmp, 'docs'), { recursive: true });
      for (const file of ['auth.js', 'categories.js', 'entries.js', 'system.js']) {
        await fs.copyFile(path.join(srcRoutes, file), path.join(tmpRoutes, file));
      }

      // 删掉 /entries/:id/reveal 的小节标题
      const realDoc = await fs.readFile(path.join(rootDir, 'docs/03-API接口文档.md'), 'utf8');
      const brokenDoc = realDoc.replace(/^### 4\.4 `GET \/entries\/:id\/reveal`.*$/m, '');
      expect(brokenDoc).not.toBe(realDoc);
      await fs.writeFile(path.join(tmp, 'docs/03-API接口文档.md'), brokenDoc, 'utf8');

      const { problems } = await checkApiDoc({ rootDir: tmp });
      expect(problems.length).toBeGreaterThan(0);
      expect(problems.some((p) => p.includes('/entries/:id/reveal'))).toBe(true);
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
