import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// GitHub Pages 部署配置
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/ipas-net-zero-quiz/',
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@components': resolve(__dirname, 'src/components'),
      '@data': resolve(__dirname, 'src/data'),
      '@hooks': resolve(__dirname, 'src/hooks'),
      '@types': resolve(__dirname, 'src/types'),
      '@utils': resolve(__dirname, 'src/utils'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // 提高 warning threshold；practice_pool.json 已 dynamic split，main bundle
    // 仍含 React + 主題庫 (integrated_dataset.json) ~640KB。
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      output: {
        manualChunks: {
          // React 生態獨立 chunk — 變動少，瀏覽器可長期 cache
          'react-vendor': ['react', 'react-dom', 'react-dom/client'],
        },
      },
    },
  },
})
