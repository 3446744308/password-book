import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // 每个测试文件独立进程，保证 DATA_DIR 等环境变量互不干扰
    pool: 'forks',
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['test/**/*.test.js'],
  },
});
