import { errors } from './errors.js';

/**
 * 声明式输入校验（服务端唯一校验入口，docs/02 §6.5）
 * validate(input, rules) -> 校验通过返回白名单后的字段对象，失败抛 VALIDATION_ERROR
 *
 * rule: { field, label?, type?='string'|'int'|'bool'|'enum'|'stringArray',
 *         required?, default?, minLength?, maxLength?, min?, max?,
 *         values?（enum）, pattern?, patternMessage?, itemMaxLength?, minItems?, maxItems?, trim? }
 */
export function validate(input, rules) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  const details = [];

  for (const rule of rules) {
    const field = rule.field;
    const label = rule.label || field;
    let value = src[field];

    if (value === undefined || value === null) {
      if (rule.required) {
        details.push({ field, message: `${label}不能为空` });
      } else if (rule.default !== undefined) {
        out[field] = rule.default;
      }
      continue;
    }

    const type = rule.type || 'string';

    if (type === 'string') {
      if (typeof value !== 'string') {
        details.push({ field, message: `${label}格式错误` });
        continue;
      }
      if (rule.trim !== false) value = value.trim();
      if (rule.required && value === '') {
        details.push({ field, message: `${label}不能为空` });
        continue;
      }
      if (value === '' && !rule.required) {
        out[field] = '';
        continue;
      }
      if (rule.minLength && value.length < rule.minLength) {
        details.push({ field, message: `${label}至少 ${rule.minLength} 个字符` });
        continue;
      }
      if (rule.maxLength && value.length > rule.maxLength) {
        details.push({ field, message: `${label}最多 ${rule.maxLength} 个字符` });
        continue;
      }
      if (rule.pattern && !rule.pattern.test(value)) {
        details.push({ field, message: rule.patternMessage || `${label}格式错误` });
        continue;
      }
      out[field] = value;
    } else if (type === 'int') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isInteger(n)) {
        details.push({ field, message: `${label}必须为整数` });
        continue;
      }
      if (rule.min !== undefined && n < rule.min) {
        details.push({ field, message: `${label}不能小于 ${rule.min}` });
        continue;
      }
      if (rule.max !== undefined && n > rule.max) {
        details.push({ field, message: `${label}不能大于 ${rule.max}` });
        continue;
      }
      out[field] = n;
    } else if (type === 'bool') {
      if (typeof value !== 'boolean') {
        details.push({ field, message: `${label}必须为布尔值` });
        continue;
      }
      out[field] = value;
    } else if (type === 'enum') {
      if (!rule.values || !rule.values.includes(value)) {
        details.push({ field, message: `${label}取值非法` });
        continue;
      }
      out[field] = value;
    } else if (type === 'stringArray') {
      if (!Array.isArray(value)) {
        details.push({ field, message: `${label}必须为数组` });
        continue;
      }
      if (rule.minItems && value.length < rule.minItems) {
        details.push({ field, message: `${label}至少 ${rule.minItems} 项` });
        continue;
      }
      if (rule.maxItems && value.length > rule.maxItems) {
        details.push({ field, message: `${label}最多 ${rule.maxItems} 项` });
        continue;
      }
      const items = [];
      let bad = false;
      for (const item of value) {
        if (
          typeof item !== 'string' ||
          item.trim() === '' ||
          (rule.itemMaxLength && item.length > rule.itemMaxLength)
        ) {
          details.push({ field, message: `${label}包含非法项` });
          bad = true;
          break;
        }
        items.push(item.trim());
      }
      if (!bad) out[field] = items;
    } else {
      details.push({ field, message: `未知字段类型 ${type}` });
    }
  }

  if (details.length) throw errors.validation(details);
  return out;
}

/** 主密码强度规则：长度 + 含字母与数字（docs/03 §2.1） */
export function masterPasswordIssues(password, minLength = 10, fieldName = 'masterPassword') {
  const details = [];
  if (typeof password !== 'string' || password.length < minLength) {
    details.push({ field: fieldName, message: `主密码至少 ${minLength} 个字符` });
  } else if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    details.push({ field: fieldName, message: '主密码需同时包含字母和数字' });
  }
  return details;
}
