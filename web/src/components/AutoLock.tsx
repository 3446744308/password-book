import { useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { logout as logoutApi } from '../api';
import useAuthStore from '../stores/authStore';

/** 计入"用户仍在操作"的交互事件（docs/01 §6.2） */
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'mousemove'];
/** 空闲检查间隔；实际锁定时机精度等于该值，对分钟级阈值足够 */
const TICK_MS = 15_000;

/**
 * 空闲自动锁定（docs/01 §6.2「页面离开超过锁定阈值自动跳回解锁页」）。
 *
 * - 任意用户交互刷新"最后活跃时间"
 * - 空闲超过服务端下发的 lockMinutes 即重新锁定
 * - 页面切到后台/最小化期间同样计时，回到前台立即判定一次
 *
 * 锁定 = 尽力吊销令牌 + 清空内存态 + 回登录页。
 */
export default function AutoLock() {
  const navigate = useNavigate();
  const token = useAuthStore((s) => s.accessToken);
  const lockMinutes = useAuthStore((s) => s.lockMinutes);

  const lastActiveRef = useRef(Date.now());
  const hiddenAtRef = useRef<number | null>(null);
  const lockingRef = useRef(false);

  const lock = useCallback(async () => {
    if (lockingRef.current) return;
    lockingRef.current = true;
    try {
      // 令牌可能已过期，吊销失败不应阻止本地锁定
      await logoutApi();
    } catch {
      /* 忽略：本地态必须清掉 */
    }
    useAuthStore.getState().clear();
    navigate('/login', { replace: true });
  }, [navigate]);

  useEffect(() => {
    if (!token) return undefined;

    lockingRef.current = false;
    lastActiveRef.current = Date.now();
    hiddenAtRef.current = null;
    const timeoutMs = Math.max(1, lockMinutes) * 60_000;

    const markActive = () => {
      lastActiveRef.current = Date.now();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAtRef.current = Date.now();
        return;
      }
      const hiddenAt = hiddenAtRef.current;
      hiddenAtRef.current = null;
      if (hiddenAt !== null && Date.now() - hiddenAt >= timeoutMs) {
        void lock();
        return;
      }
      markActive();
    };

    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, markActive, { passive: true });
    }
    document.addEventListener('visibilitychange', onVisibilityChange);

    const timer = window.setInterval(
      () => {
        if (Date.now() - lastActiveRef.current >= timeoutMs) void lock();
      },
      Math.min(TICK_MS, timeoutMs),
    );

    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, markActive);
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.clearInterval(timer);
    };
  }, [token, lockMinutes, lock]);

  return null;
}
