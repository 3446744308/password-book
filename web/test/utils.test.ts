import { describe, it, expect } from 'vitest';

import {
  CHARSETS,
  buildPool,
  describePasswordStrength,
  estimateEntropy,
  entropyLevel,
  generatePassword,
} from '../src/utils/password';
import { formatBytes, formatTime } from '../src/utils/format';
import { applyFieldErrors, humanize, isApiError } from '../src/utils/errors';

describe('密码生成器', () => {
  it('按长度生成且字符全部来自所选字符池', () => {
    const pool = buildPool(['lower', 'upper', 'digit']);
    for (const length of [8, 20, 64]) {
      const password = generatePassword(length, ['lower', 'upper', 'digit']);
      expect(password).toHaveLength(length);
      for (const ch of password) expect(pool).toContain(ch);
    }
  });

  it('字符池排除易混淆字符 I / l / 1 / O / 0', () => {
    const pool = buildPool(['lower', 'upper', 'digit']);
    for (const ch of ['I', 'l', '1', 'O', '0']) expect(pool).not.toContain(ch);
  });

  it('确定随机源时结果可预测', () => {
    // digit 池为 '23456789'（8 个字符），0..7 依次映射到各字符
    const seq = () => new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(generatePassword(8, ['digit'], seq)).toBe('23456789');
  });

  it('拒绝采样：超出均匀区间的随机值被丢弃，不产生取模偏差', () => {
    CHARSETS.__probe = 'abc';
    try {
      const limit = Math.floor(0x1_0000_0000 / 3) * 3; // 4294967295
      const seq = () => new Uint32Array([limit, 1]);
      // limit 被拒绝，1 → 'b'；缓冲区耗尽后重新取值，同样得到 'b'
      expect(generatePassword(2, ['__probe'], seq)).toBe('bb');
    } finally {
      delete CHARSETS.__probe;
    }
  });

  it('未选任何字符类型 / 非法长度 → 空串', () => {
    expect(generatePassword(12, [])).toBe('');
    expect(generatePassword(12, ['unknown'])).toBe('');
    expect(generatePassword(0, ['lower'])).toBe('');
    expect(generatePassword(-3, ['lower'])).toBe('');
  });

  it('生成的密码默认互不相同（随机性冒烟）', () => {
    const a = generatePassword(24, ['lower', 'upper', 'digit', 'symbol']);
    const b = generatePassword(24, ['lower', 'upper', 'digit', 'symbol']);
    expect(a).not.toBe(b);
  });
});

describe('熵值估算', () => {
  it('log2(池大小) × 长度', () => {
    // digit 池 8 个字符 → log2(8) = 3
    expect(estimateEntropy(['digit'], 10)).toBe(30);
    expect(estimateEntropy(['lower'], 10)).toBe(Math.round(Math.log2(CHARSETS.lower.length) * 10));
  });

  it('空字符集或非法长度 → 0', () => {
    expect(estimateEntropy([], 20)).toBe(0);
    expect(estimateEntropy(['lower'], 0)).toBe(0);
  });

  it('分级阈值：80 强 / 60 中 / 以下弱', () => {
    expect(entropyLevel(120)).toBe('strong');
    expect(entropyLevel(80)).toBe('strong');
    expect(entropyLevel(79)).toBe('medium');
    expect(entropyLevel(60)).toBe('medium');
    expect(entropyLevel(59)).toBe('weak');
    expect(entropyLevel(0)).toBe('weak');
  });
});

describe('已有密码的强度反馈', () => {
  it('空值返回 0 且为弱', () => {
    expect(describePasswordStrength('')).toEqual({ bits: 0, level: 'weak' });
  });

  it('按实际用到的字符类别计算池大小', () => {
    // 纯小写：池 24 → log2(24) × 10 ≈ 46
    expect(describePasswordStrength('abcdefghij').bits).toBe(
      Math.round(Math.log2(CHARSETS.lower.length) * 10),
    );
    // 纯数字：池 8 → 3 × 8 = 24
    expect(describePasswordStrength('12345678').bits).toBe(24);
  });

  it('四类字符齐全时判为强', () => {
    const result = describePasswordStrength('Abcdef1234!@#$');
    expect(result.level).toBe('strong');
    expect(result.bits).toBeGreaterThanOrEqual(80);
  });

  it('中等强度落在 60-79 区间', () => {
    // 小写 + 数字：池 = 25 + 8 = 33 → log2(33) × 12 ≈ 61
    const value = 'abcdef123456';
    const expected = Math.round(
      Math.log2(CHARSETS.lower.length + CHARSETS.digit.length) * value.length,
    );
    const result = describePasswordStrength(value);
    expect(result.bits).toBe(expected);
    expect(result.bits).toBeGreaterThanOrEqual(60);
    expect(result.bits).toBeLessThan(80);
    expect(result.level).toBe('medium');
  });

  it('分级与 entropyLevel 保持一致', () => {
    for (const value of ['a', 'abcdefghij', 'abcdef123456', 'Abcdef1234!@#$']) {
      const { bits, level } = describePasswordStrength(value);
      expect(level).toBe(entropyLevel(bits));
    }
  });
});

describe('格式化工具', () => {
  it('formatBytes 按量级换算', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('formatTime 对空值与非法值容错', () => {
    expect(formatTime(null)).toBe('-');
    expect(formatTime(undefined)).toBe('-');
    expect(formatTime('not-a-date')).toBe('not-a-date');
    expect(formatTime('2026-11-16T09:00:00.000Z')).not.toBe('-');
  });
});

/** 捕获 applyFieldErrors 回填的字段列表，避免在用例里写类型断言 */
function captureSetFields() {
  const calls: unknown[][] = [];
  const setFields = ((fields: unknown[]) => {
    calls.push(fields);
  }) as unknown as Parameters<typeof applyFieldErrors>[1];
  return { calls, setFields };
}

describe('错误文案与表单回填', () => {
  it('校验错误优先展示字段级原因', () => {
    expect(
      humanize({
        status: 400,
        code: 'VALIDATION_ERROR',
        message: '参数校验失败',
        details: [
          { field: 'title', message: '标题不能为空' },
          { field: 'url', message: '网址格式错误' },
        ],
      }),
    ).toBe('标题不能为空；网址格式错误');
  });

  it('服务端 message 优先，缺失时回落错误码文案', () => {
    expect(humanize({ status: 400, code: 'CONFLICT', message: '同名分类已存在' })).toBe(
      '同名分类已存在',
    );
    expect(humanize({ status: 423, code: 'LOCKED_OUT', message: '' })).toBe(
      '失败次数过多，账户已锁定',
    );
    expect(humanize(undefined)).toBe('操作失败');
  });

  it('applyFieldErrors 只回填字段级错误，_ 映射到表单根', () => {
    const { calls, setFields } = captureSetFields();
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
      setFields,
    );
    expect(calls).toEqual([
      [
        { name: 'title', errors: ['标题不能为空'] },
        { name: [], errors: ['至少提交一个待更新字段'] },
      ],
    ]);
  });

  it('非校验错误不回填表单', () => {
    const { calls, setFields } = captureSetFields();
    applyFieldErrors({ status: 500, code: 'INTERNAL_ERROR', message: '炸了' }, setFields);
    expect(calls).toHaveLength(0);
  });

  it('isApiError 识别形态', () => {
    expect(isApiError({ code: 'NOT_FOUND' })).toBe(true);
    expect(isApiError(new Error('x'))).toBe(false);
    expect(isApiError(null)).toBe(false);
  });
});
