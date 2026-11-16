import { App } from 'antd';

/** 统一取 antd 上下文版 message/modal/notification（避免静态函数警告） */
export function useNotify() {
  const { message, modal, notification } = App.useApp();
  return { message, modal, notification };
}
