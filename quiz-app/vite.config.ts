import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'
import { readFileSync, writeFileSync, existsSync } from 'fs'

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

/** 把 %PLATFORM_X% 換成 platform.config.json 的值；打錯字硬失敗，不留在產出裡 */
function injectPlatform(text: string, where: string): string {
  return text.replace(/%PLATFORM_([A-Z_]+)%/g, (whole, key: string) => {
    const camel = key.toLowerCase().replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase())
    const value = platform[camel]
    if (value === undefined) {
      throw new Error(`${where} 用了 ${whole}，但 platform.config.json 沒有 "${camel}" 這個欄位`)
    }
    return value
  })
}

/**
 * index.html 與 public/ 的文字資產都要注入。
 *
 * 為什麼 public/ 也要：`public/` 是 Vite **原樣複製**的，而 robots.txt、sitemap.xml、
 * llms.txt 都寫著部署網址。只處理 index.html 的話，「改名稱只要改一個檔」就是假的 ——
 * 換平台的人會漏掉這三個，而且爬蟲吃到的是舊網址，沒有任何東西會報錯。
 * 這是自我複審時抓到的：我在 PR 描述裡先寫下了那句假宣稱。
 */
const PUBLIC_TEXT_ASSETS = ['llms.txt', 'robots.txt', 'sitemap.xml']

function platformHtml(): Plugin {
  return {
    name: 'platform-config-inject',
    transformIndexHtml(html) {
      return injectPlatform(html, 'index.html')
    },
    // public/ 的複製發生在 bundle 寫出之後，所以在這裡就地改寫
    closeBundle() {
      const outDir = resolve(__dirname, 'dist')
      for (const name of PUBLIC_TEXT_ASSETS) {
        const p = resolve(outDir, name)
        if (!existsSync(p)) continue
        const before = readFileSync(p, 'utf-8')
        const after = injectPlatform(before, `public/${name}`)
        if (after !== before) writeFileSync(p, after, 'utf-8')
      }
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
