/**
 * 前端纯逻辑单元测试（零依赖）。
 *
 * 运行：npm test  →  node --experimental-strip-types --test test/
 *
 * 为什么不用 Vitest + jsdom：当前环境无法访问 npm registry，装不了 jsdom /
 * @testing-library/react。组件级测试待可联网安装依赖后补齐（见 README「测试」）。
 * 这里覆盖的都是不含 DOM 依赖的纯函数，Node 的类型剥离即可直接导入 .ts 源文件。
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CHARSETS,
  buildPool,
  estimateEntropy,
  entropyLevel,
  generatePassword,
} from '../src/utils/password.ts';
import { formatBytes, formatTime } from '../src/utils/format.ts';
import { applyFieldErrors, humanize, isApiError } from '../src/utils/errors.ts';

describe('密码生成器', () => {
  test('按长度生成且字符全部来自所选字符池', () => {
    const pool = buildPool(['lower', 'upper', 'digit']);
    for (const length of [8, 20, 64]) {
      const password = generatePassword(length, ['lower', 'upper', 'digit']);
      assert.equal(password.length, length);
      for (const ch of password) assert.ok(pool.includes(ch), `字符 ${ch} 不在池内`);
    }
  });

  test('字符池排除易混淆字符 I / l / 1 / O / 0', () => {
    const pool = buildPool(['lower', 'upper', 'digit']);
    for (const ch of ['I', 'l', '1', 'O', '0']) assert.ok(!pool.includes(ch), `池中不应有 ${ch}`);
  });

  test('确定随机源时结果可预测', () => {
    // digit 池为 '23456789'（8 个字符），0..7 依次映射到各字符
    const seq = () => new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    assert.equal(generatePassword(8, ['digit'], seq), '23456789');
  });

  test('拒绝采样：超出均匀区间的随机值被丢弃，不产生取模偏差', () => {
    CHARSETS.__probe = 'abc';
    try {
      const limit = Math.floor(0x1_0000_0000 / 3) * 3; // 4294967295
      const seq = () => new Uint32Array([limit, 1]);
      // limit 被拒绝，1 → 'b'；缓冲区耗尽后重新取值，同样得到 'b'
      assert.equal(generatePassword(2, ['__probe'], seq), 'bb');
    } finally {
      delete CHARSETS.__probe;
    }
  });

  test('未选任何字符类型 / 非法长度 → 空串', () => {
    assert.equal(generatePassword(12, []), '');
    assert.equal(generatePassword(12, ['unknown']), '');
    assert.equal(generatePassword(0, ['lower']), '');
    assert.equal(generatePassword(-3, ['lower']), '');
  });

  test('生成的密码默认互不相同（随机性冒烟）', () => {
    const a = generatePassword(24, ['lower', 'upper', 'digit', 'symbol']);
    const b = generatePassword(24, ['lower', 'upper', 'digit', 'symbol']);
    assert.notEqual(a, b);
  });
});

describe('熵值估算', () => {
  test('log2(池大小) × 长度', () => {
    // digit 池 8 个字符 → log2(8) = 3
    assert.equal(estimateEntropy(['digit'], 10), 30);
    // lower 池 24 个字符
    assert.equal(estimateEntropy(['lower'], 10), Math.round(Math.log2(CHARSETS.lower.length) * 10));
  });

  test('空字符集或非法长度 → 0', () => {
    assert.equal(estimateEntropy([], 20), 0);
    assert.equal(estimateEntropy(['lower'], 0), 0);
  });

  test('分级阈值：80 强 / 60 中 / 以下弱', () => {
    assert.equal(entropyLevel(120), 'strong');
    assert.equal(entropyLevel(80), 'strong');
    assert.equal(entropyLevel(79), 'medium');
    assert.equal(entropyLevel(60), 'medium');
    assert.equal(entropyLevel(59), 'weak');
    assert.equal(entropyLevel(0), 'weak');
  });
});

describe('格式化工具', () => {
  test('formatBytes 按量级换算', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(512), '512 B');
    assert.equal(formatBytes(2048), '2.0 KB');
    assert.equal(formatBytes(3 * 1024 * 1024), '3.0 MB');
  });

  test('formatTime 对空值与非法值容错', () => {
    assert.equal(formatTime(null), '-');
    assert.equal(formatTime(undefined), '-');
    assert.equal(formatTime('not-a-date'), 'not-a-date');
    assert.notEqual(formatTime('2026-11-16T09:00:00.000Z'), '-');
  });
});

describe('错误文案与表单回填', () => {
  test('校验错误优先展示字段级原因', () => {
    const message = humanize({
      status: 400,
      code: 'VALIDATION_ERROR',
      message: '参数校验失败',
      details: [
        { field: 'title', message: '标题不能为空' },
        { field: 'url', message: '网址格式错误' },
      ],
    });
    assert.equal(message, '标题不能为空；网址格式错误');
  });

  test('服务端 message 优先，缺失时回落错误码文案', () => {
    assert.equal(humanize({ status: 400, code: 'CONFLICT', message: '同名分类已存在' }), '同名分类已存在');
    assert.equal(humanize({ status: 423, code: 'LOCKED_OUT', message: '' }), '失败次数过多，账户已锁定');
    assert.equal(humanize(undefined), '操作失败');
  });

  test('applyFieldErrors 只回填字段级错误，_ 映射到表单根', () => {
    const calls = [];
    applyFieldErrors(
      {
        status: 400,
        code: 'VALIDATION_ERROR',
        message: '参数校验失败',
        details: [
          { field: 'title', message: '标题不能为空' },
          { field: '_', message: '至少提交一个待更新字段' },
        ],
      },
      (fields) => calls.push(fields),
    );
    assert.deepEqual(calls[0], [
      { name: 'title', errors: ['标题不能为空'] },
      { name: [], errors: ['至少提交一个待更新字段'] },
    ]);
  });

  test('非校验错误不回填表单', () => {
    const calls = [];
    applyFieldErrors({ status: 500, code: 'INTERNAL_ERROR', message: '炸了' }, (f) => calls.push(f));
    assert.equal(calls.length, 0);
  });

  test('isApiError 识别形态', () => {
    assert.equal(isApiError({ code: 'NOT_FOUND' }), true);
    assert.equal(isApiError(new Error('x')), false);
    assert.equal(isApiError(null), false);
  });
});
