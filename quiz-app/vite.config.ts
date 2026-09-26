import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync } from 'fs'

/**
 * 平台識別（名稱、網址、SEO 文案）只有一份：repo 根目錄的 platform.config.json。
 *
 * 為什麼要這樣：這個專案的目標之一是「別人換上自己的題庫、改個名稱，就變成另一個考古題
 * 平台」。原本平台名稱散在 index.html 的 title／og／twitter／canonical／keywords、
 * vite 的 base、以及 package.json —— 共 28 處硬編，改名等於全域搜尋取代，而且沒有任何東西
 * 守它們一致。現在 index.html 只寫 %PLATFORM_*% 佔位符，build 時由這裡替換，
 * 並有 gate 釘住「index.html 不得再出現硬編的平台名稱」。
 */
const platform = JSON.parse(
  readFileSync(resolve(__dirname, '..', 'platform.config.json'), 'utf-8')
) as Record<string, string>

function platformHtml(): Plugin {
  return {
    name: 'platform-config-html',
    transformIndexHtml(html) {
      return html.replace(/%PLATFORM_([A-Z_]+)%/g, (whole, key: string) => {
        const camel = key.toLowerCase().replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())
        const value = platform[camel]
        if (value === undefined) {
          // 佔位符打錯字就會安靜地留在產出的 HTML 裡 —— 那比硬編更糟，所以硬失敗。
          throw new Error(
            `index.html 用了 ${whole}，但 platform.config.json 沒有 "${camel}" 這個欄位`
          )
        }
        return value
      })
    },
  }
}

// GitHub Pages 部署配置
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), platformHtml()],
  base: platform.basePath,
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
