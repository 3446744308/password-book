import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * 前端测试配置：jsdom 环境 + 自动 JSX 转换（复用生产构建的 plugin-react），
 * 因此测试里不需要 `import React`。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: false,
    include: ['test/**/*.test.{ts,tsx}'],
    setupFiles: ['./test/setup.ts'],
    restoreMocks: true,
    css: false,
  },
});
