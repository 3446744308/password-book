#!/usr/bin/env node
/**
 * 校验 `docs/03-API接口文档.md` 与真实路由是否一致。
 *
 * docs/02 §4.6 要求"新增/修改端点必须在同一个 PR 内更新 API 文档"，
 * 但那条规则此前没有自动化保障。这里从路由源码抽出实际端点，
 * 再与文档的「章节标题」和「端点总览表」比对，任何一侧多出或少出都会报错。
 *
 * 用法：npm --prefix server run check:api-doc
 * 退出码：0 一致；1 不一致
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 路由文件 → 挂载前缀（与 server/src/routes/index.js 保持一致） */
const MOUNTS = {
  auth: '/auth',
  categories: '/categories',
  entries: '/entries',
  system: '/system',
};

const ROUTE_RE = /router\.(get|post|put|patch|delete)\(\s*\n?\s*'([^']+)'/g;
/** 端点小节标题：### 4.1 `GET /entries` */
const SECTION_RE = /^### (\d+\.\d+) `([A-Z]+) ([^`]+)`/gm;
/** 端点总览表行：| 13 | GET | `/api/v1/entries` | ... | */
const TABLE_RE = /^\|\s*\d+\s*\|\s*(GET|POST|PUT|PATCH|DELETE)\s*\|\s*`([^`]+)`\s*\|/gm;

const API_PREFIX = '/api/v1';

/** 从路由源码收集端点 */
export async function collectRoutes(routesDir) {
  const routes = [];
  for (const [file, prefix] of Object.entries(MOUNTS)) {
    const text = await fs.readFile(path.join(routesDir, `${file}.js`), 'utf8');
    for (const match of text.matchAll(ROUTE_RE)) {
      const sub = match[2] === '/' ? '' : match[2];
      routes.push({
        module: file,
        method: match[1].toUpperCase(),
        path: `${API_PREFIX}${prefix}${sub}`,
        /** 文档章节标题里用的是不带 /api/v1 的路径 */
        sectionPath: `${prefix}${sub}`,
      });
    }
  }
  return routes.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method));
}

/** 从文档收集章节与总览表 */
export async function collectDoc(docFile) {
  const text = await fs.readFile(docFile, 'utf8');
  return {
    sections: [...text.matchAll(SECTION_RE)].map((m) => ({
      section: m[1],
      method: m[2],
      path: m[3],
    })),
    table: [...text.matchAll(TABLE_RE)].map((m) => ({ method: m[1], path: m[2] })),
  };
}

/**
 * 比对路由与文档。
 * @returns {Promise<{ routes: object[], sections: object[], problems: string[] }>}
 */
export async function checkApiDoc({ rootDir }) {
  const routes = await collectRoutes(path.join(rootDir, 'server/src/routes'));
  const { sections, table } = await collectDoc(path.join(rootDir, 'docs/03-API接口文档.md'));
  const problems = [];

  const sectionKeys = new Set(sections.map((s) => `${s.method} ${s.path}`));
  const tableKeys = new Set(table.map((t) => `${t.method} ${t.path}`));

  for (const route of routes) {
    const key = `${route.method} ${route.sectionPath}`;
    if (!sectionKeys.has(key)) problems.push(`文档缺少端点小节：${route.method} ${route.path}`);
    if (!tableKeys.has(`${route.method} ${route.path}`)) {
      problems.push(`端点总览表缺少：${route.method} ${route.path}`);
    }
  }

  const routeKeys = new Set(routes.map((r) => `${r.method} ${r.sectionPath}`));
  for (const section of sections) {
    if (!routeKeys.has(`${section.method} ${section.path}`)) {
      problems.push(`文档记录了一个不存在的端点：${section.method} ${section.path}`);
    }
  }

  const routePaths = new Set(routes.map((r) => `${r.method} ${r.path}`));
  for (const row of table) {
    if (!routePaths.has(`${row.method} ${row.path}`)) {
      problems.push(`端点总览表记录了不存在的端点：${row.method} ${row.path}`);
    }
  }

  // 章节号必须唯一，否则交叉引用会指错
  const sectionNumbers = sections.map((s) => s.section);
  if (new Set(sectionNumbers).size !== sectionNumbers.length) {
    problems.push('文档存在重复的章节编号');
  }

  if (sections.length !== table.length) {
    problems.push(`章节数 ${sections.length} 与总览表行数 ${table.length} 不一致`);
  }

  return { routes, sections, problems };
}

async function main() {
  const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const { routes, sections, problems } = await checkApiDoc({ rootDir });

  console.log(`[api-doc] 路由 ${routes.length} 个，文档端点小节 ${sections.length} 个`);
  if (problems.length === 0) {
    console.log('[api-doc] 通过：文档与实现一致');
    return;
  }
  console.error(`[api-doc] 发现 ${problems.length} 处不一致：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
}

const invokedDirectly =
  Boolean(process.argv[1]) && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();

export default main;
