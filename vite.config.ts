import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tsconfigPaths from "vite-tsconfig-paths";

// https://vite.dev/config/
export default defineConfig({
  test: {
    env: {
      // 单测若直接 import api 模块链（如 opLogs 纯函数测试）会触发 db.ts 初始化，
      // 强制指向临时库并关闭演示 seed，绝不污染生产库 data/app.db
      FORTUNE_DB_PATH: '/tmp/fortune-vitest.db',
      FORTUNE_SEED_DEMO: '0',
    },
  },
  plugins: [
    react({
      babel: {
        plugins: [
          'react-dev-locator',
        ],
      },
    }),
    tsconfigPaths(),
  ],
  build: {
    rollupOptions: {
      output: {
        // recharts 及其 d3 依赖体量较大且仅在统计/报表页使用，拆独立 chunk 避免拖慢首屏
        manualChunks(id: string) {
          if (id.includes('node_modules')) {
            if (
              id.includes('recharts') ||
              id.includes('victory-vendor') ||
              /\/d3-/.test(id) ||
              id.includes('internmap')
            ) {
              return 'vendor-charts'
            }
            return 'vendor'
          }
        },
      },
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
        configure: (proxy) => {
          proxy.on('error', (err) => {
            console.log('proxy error', err);
          });
          proxy.on('proxyReq', (proxyReq, req) => {
            console.log('Sending Request to the Target:', req.method, req.url);
          });
          proxy.on('proxyRes', (proxyRes, req) => {
            console.log('Received Response from the Target:', proxyRes.statusCode, req.url);
          });
        },
      }
    }
  }
})
