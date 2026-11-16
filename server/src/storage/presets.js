/**
 * 内置预设：常用分类与常用标签。
 *
 * 设计约束：
 * - **分类**会在库初始化时（以及老库首次升级时）一次性写入 `data/categories.json`，
 *   之后就是普通的用户分类，可改名/删除/排序；`presetsSeeded` 标记保证不重复播种，
 *   因此用户删掉的内置分类不会在下次启动时"复活"。
 * - **标签**在数据模型里只是条目上的自由字符串（entry.tags），没有独立实体，
 *   所以这里作为**候选值**通过 GET /system/presets 提供给客户端做快捷选择，
 *   用户仍可自由输入任意标签。
 * - 这里是唯一事实源：服务端播种与客户端候选都以此为准。
 */

/** 内置分类（icon 为 Ant Design 图标名约定，sortOrder 小者在前） */
export const PRESET_CATEGORIES = [
  { name: '工作', icon: 'project', sortOrder: 10 },
  { name: '邮箱', icon: 'mail', sortOrder: 20 },
  { name: '银行金融', icon: 'bank', sortOrder: 30 },
  { name: '社交', icon: 'team', sortOrder: 40 },
  { name: '购物', icon: 'shopping-cart', sortOrder: 50 },
  { name: '开发工具', icon: 'code', sortOrder: 60 },
  { name: '影音娱乐', icon: 'play-circle', sortOrder: 70 },
];

/** 内置常用标签（每项 ≤ 20 字符，符合 docs/01 §4.3 的条目标签约束） */
export const PRESET_TAGS = [
  '常用',
  '工作',
  '个人',
  '邮箱',
  '银行',
  '支付',
  '社交',
  '购物',
  '开发',
  '服务器',
  '数据库',
  '云服务',
  '影音',
  '游戏',
  '学习',
  '临时',
];
