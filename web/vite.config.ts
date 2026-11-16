import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // 开发期同源代理：Cookie/跨域零配置（生产由 server 直接托管 dist）
      '/api': {
        target: 'http://127.0.0.1:3100',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks: {
          // 框架与 UI 库单独成块，长期缓存不受业务代码变更影响
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          vendor: ['axios', 'zustand'],
        },
      },
    },
  },
});
