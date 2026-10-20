import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 开发时把 /api 代理到本机服务端，浏览器看到的是同源请求，Cookie 无需跨域。
// 端到端测试时可以用环境变量指向另一套服务。
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.WEB_PORT ?? 5180),
    strictPort: true,
    proxy: {
      '/api': process.env.API_PROXY_TARGET ?? 'http://localhost:8787',
    },
  },
});
