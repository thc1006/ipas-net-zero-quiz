import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { parse } from 'acorn'
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
  readFileSync(resolve(import.meta.dirname, '..', 'platform.config.json'), 'utf-8')
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
      const outDir = resolve(import.meta.dirname, 'dist')
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

/**
 * 產物的語法不得超過支援底線 ES2020（Safari 14）。
 *
 * build.target 只是請轉譯器降級：刪掉它、或日後 Vite 再改預設，產物就會悄悄帶上新語法，
 * 不會有任何東西報錯。Vite 6 升 8 時預設從 Safari 14 改成 16.4，就是這樣。
 * 這裡在檔案寫出之後，用 acorn 以 ES2020 重新解析每一個 JS chunk（解析的是會部署出去的那份，
 * 壓縮器帶進來的語法也算在內）；解析不了就讓 build 失敗。
 */
function syntaxFloor(): Plugin {
  return {
    name: 'syntax-floor-es2020',
    apply: 'build',
    writeBundle(options, bundle) {
      const dir = options.dir ?? resolve(import.meta.dirname, 'dist')
      let parsed = 0
      let entryParsed = false
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk') continue
        const code = readFileSync(resolve(dir, file.fileName), 'utf-8')
        try {
          parse(code, { ecmaVersion: 2020, sourceType: 'module' })
        } catch (e) {
          this.error(`${file.fileName} 超出支援底線 ES2020（見 build.target）：${(e as Error).message}`)
        }
        parsed++
        if (file.isEntry) entryParsed = true
      }
      // 不能空轉：一個 chunk 都沒解析、或漏掉入口 chunk，等於什麼都沒檢查
      if (parsed === 0 || !entryParsed) {
        this.error(`syntax-floor 沒有解析到入口 chunk（解析了 ${parsed} 個 chunk）`)
      }
    },
  }
}

// GitHub Pages 部署配置
// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), platformHtml(), syntaxFloor()],
  base: platform.basePath,
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      '@components': resolve(import.meta.dirname, 'src/components'),
      '@data': resolve(import.meta.dirname, 'src/data'),
      '@hooks': resolve(import.meta.dirname, 'src/hooks'),
      '@types': resolve(import.meta.dirname, 'src/types'),
      '@utils': resolve(import.meta.dirname, 'src/utils'),
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    // 支援底線是 Safari 14（iOS 16.4 以前的 iPhone 也要開得起來；見 src/browser-compat.test.ts）。
    // 這一組是 Vite 6 的預設（'modules'）。Vite 8 的預設改成 Safari 16.4／Chrome 111，
    // 不寫出來就會在升級時悄悄放棄這些瀏覽器：產物會帶 ES2022 語法（||=、class fields）。
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
    // 提高 warning threshold；practice_pool.json 已 dynamic split，main bundle
    // 仍含 React + 主題庫 (integrated_dataset.json) ~640KB。
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            // React 生態獨立 chunk：變動少，瀏覽器可長期 cache
            {
              name: 'react-vendor',
              test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
    },
  },
})
