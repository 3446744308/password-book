import { describe, it, expect } from 'vitest';
import {
  auditEventFilterOptions,
  auditEventMeta,
  describeAuditDetail,
  describeAuditIp,
  shortId,
} from '../src/utils/audit';

const ULID = '01M7HAXV3WH7CZZMWZ0T7QY42W';
const ULID_X = '01M7HAXV3WH7CZZMWZ0T7QY42X';
/** 与 shortId 的结果保持一致，避免测试里反复数位数 */
const SHORT = '01M7…Y42W';
const SHORT_X = '01M7…Y42X';

describe('事件码 → 中文', () => {
  it('已知事件返回中文名、配色与分组', () => {
    expect(auditEventMeta('LOGIN_OK')).toMatchObject({ label: '解锁成功', group: '认证与会话' });
    expect(auditEventMeta('ENTRY_REVEAL')).toMatchObject({ label: '查看密码', group: '条目' });
    expect(auditEventMeta('BACKUP_CREATE')).toMatchObject({ label: '创建备份', group: '系统' });
  });

  it('未知事件码原样回退，不丢信息', () => {
    expect(auditEventMeta('SOMETHING_NEW')).toEqual({
      label: 'SOMETHING_NEW',
      color: 'default',
      group: '其它',
    });
  });

  it('筛选选项按业务分组覆盖全部事件', () => {
    const groups = auditEventFilterOptions();
    expect(groups.map((g) => g.label)).toEqual(['认证与会话', '条目', '分类', '系统']);

    const values = groups.flatMap((g) => g.options.map((o) => o.value));
    expect(values).toContain('LOGIN_FAIL');
    expect(values).toContain('ENTRY_REVEAL');
    expect(values).toContain('CONFIG_UPDATE');
    // 无重复
    expect(new Set(values).size).toBe(values.length);
    // 展示中文而不是机器码
    expect(groups.find((g) => g.label === '条目')?.options).toContainEqual({
      label: '查看密码',
      value: 'ENTRY_REVEAL',
    });
  });
});

describe('ID 缩短', () => {
  it('短 ID 原样保留，ULID 缩短为首4…尾4', () => {
    expect(shortId('dev')).toBe('dev');
    expect(shortId('')).toBe('—');
    expect(shortId(ULID)).toBe(SHORT);
  });
});

describe('detail → 中文描述', () => {
  it('空 detail 显示占位符', () => {
    expect(describeAuditDetail('LOGIN_OK', null)).toBe('—');
  });

  it('初始化：模式与内置分类数量', () => {
    expect(describeAuditDetail('SETUP_OK', 'mode=dev,presets=7')).toBe('模式 dev，内置分类 7 个');
  });

  it('登录成功/手动锁定：显示会话', () => {
    expect(describeAuditDetail('LOGIN_OK', `jti=${ULID}`)).toBe(`会话 ${SHORT}`);
    expect(describeAuditDetail('LOGOUT', `jti=${ULID}`)).toBe(`会话 ${SHORT}`);
  });

  it('登录失败：第几次错误', () => {
    expect(describeAuditDetail('LOGIN_FAIL', 'attempt=3')).toBe('第 3 次密码错误');
  });

  it('锁定：显示解锁时间', () => {
    const text = describeAuditDetail('LOCKOUT', 'until=2026-11-16T13:20:00.000Z');
    expect(text.startsWith('锁定至 ')).toBe(true);
  });

  it('换主密码：模式与重加密字段数', () => {
    expect(describeAuditDetail('MASTER_CHANGE', `jti=${ULID},reencrypted=0,mode=dev`)).toBe(
      '模式 dev，重加密 0 个字段',
    );
  });

  it('配置更新：字段名翻成中文', () => {
    expect(describeAuditDetail('CONFIG_UPDATE', 'lockMinutes,historyKeep')).toBe(
      '修改了 会话时长、历史保留条数',
    );
    // 未知字段名原样保留
    expect(describeAuditDetail('CONFIG_UPDATE', 'lockMinutes,unknownField')).toBe(
      '修改了 会话时长、unknownField',
    );
  });

  it('条目操作：显示缩短后的条目 ID', () => {
    expect(describeAuditDetail('ENTRY_CREATE', `id=${ULID}`)).toBe(`条目 ${SHORT}`);
    expect(describeAuditDetail('ENTRY_DELETE', `id=${ULID}`)).toBe(`条目 ${SHORT}`);
    expect(describeAuditDetail('ENTRY_REVEAL', `id=${ULID}`)).toBe(`条目 ${SHORT}`);
  });

  it('条目更新：区分收藏动作与普通修改', () => {
    expect(describeAuditDetail('ENTRY_UPDATE', `id=${ULID},favorite=true`)).toBe(
      `条目 ${SHORT}，设为收藏`,
    );
    expect(describeAuditDetail('ENTRY_UPDATE', `id=${ULID},favorite=false`)).toBe(
      `条目 ${SHORT}，取消收藏`,
    );
    expect(describeAuditDetail('ENTRY_UPDATE', `id=${ULID}`)).toBe(`条目 ${SHORT}`);
  });

  it('批量转移：数量与来源/目标分类', () => {
    const detail = `transfer ${ULID} -> ${ULID_X},n=5`;
    expect(describeAuditDetail('ENTRY_UPDATE', detail)).toBe(
      `转移 5 个条目：${SHORT} → ${SHORT_X}`,
    );
  });

  it('历史密码：版本号与恢复来源', () => {
    expect(describeAuditDetail('HISTORY_REVEAL', `id=${ULID},v=3`)).toBe(`条目 ${SHORT}，版本 v3`);
    expect(describeAuditDetail('HISTORY_RESTORE', `id=${ULID},from=v1`)).toBe(
      `条目 ${SHORT}，恢复自 v1`,
    );
  });

  it('删除分类：附带迁移条目数', () => {
    expect(describeAuditDetail('CATEGORY_DELETE', `id=${ULID},moved=17`)).toBe(
      `分类 ${SHORT}，迁移 17 个条目到默认分类`,
    );
    expect(describeAuditDetail('CATEGORY_CREATE', `id=${ULID}`)).toBe(`分类 ${SHORT}`);
  });

  it('备份：显示备份编号', () => {
    expect(describeAuditDetail('BACKUP_CREATE', 'id=20261116-120000')).toBe(
      '备份编号 20261116-120000',
    );
  });

  it('未知事件保留原始 detail，便于排查', () => {
    expect(describeAuditDetail('SOMETHING_NEW', 'foo=bar')).toBe('foo=bar');
  });
});

describe('来源 IP', () => {
  it('回环地址显示为「本机」', () => {
    expect(describeAuditIp('127.0.0.1')).toBe('本机');
    expect(describeAuditIp('::1')).toBe('本机');
    expect(describeAuditIp('::ffff:127.0.0.1')).toBe('本机');
  });

  it('其它地址原样显示，空值给占位符', () => {
    expect(describeAuditIp('192.168.1.10')).toBe('192.168.1.10');
    expect(describeAuditIp(null)).toBe('—');
    expect(describeAuditIp(undefined)).toBe('—');
  });
});
