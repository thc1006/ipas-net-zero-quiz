import { defineConfig, type Plugin, type UserConfig } from 'vite'
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

const PACKAGE_JSON = resolve(import.meta.dirname, 'package.json')
const pkg = JSON.parse(readFileSync(PACKAGE_JSON, 'utf-8')) as {
  version: string
  bugs: { url: string }
}

/**
 * vite 與 vitest 共用的設定（vitest.config.ts import 這一份）：兩邊各寫一次時，正式 build 那一份寫錯，單元測試
 * 照樣全綠（審查實測：對調兩個值，lint、單元測試、build、E2E 全過）。
 * - define：執行期只用到 package.json 的版本與問題回報網址，build 時注入成常數（src/vite-env.d.ts 宣告）。
 *   src 裡 import package.json 的話，Vite 8（Rolldown）不會只留用到的欄位，scripts、devDependencies、
 *   packageManager 都會進首頁的 chunk（bundleContents 擋下）。
 * - json：namedExports 開著時，Rolldown 把 JSON 寫成物件字面值（連 stringify: true 也一樣）；關掉之後整份 JSON
 *   是一個 JSON.parse 字串，冷載入時解析得比較快（2026-10 實測見 PR #146）。src 只用 default import 讀 JSON；
 *   測試也用同一個設定，動態 import 之後讀具名屬性這種寫法在單元測試就會壞，不會只在正式站壞。
 */
export const shared = {
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUG_REPORT_URL__: JSON.stringify(pkg.bugs.url),
  },
  json: { namedExports: false },
} satisfies UserConfig

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

/**
 * 出貨的內容：題庫的兩份 JSON 要整份以 JSON.parse 載入，package.json 不能出貨。
 *
 * json.namedExports 開著時，Rolldown 把 JSON 寫成物件字面值，冷載入時解析得比 JSON.parse 一個字串慢
 * （見 shared 的 json 設定）。這個設定被拿掉、或日後 Vite 改了輸出方式，不會有任何東西報錯，所以在檔案寫出
 * 之後檢查：每一份題庫 JSON 的模組，Rolldown 算繪出來的程式碼裡要有一個 JSON.parse，字串解開之後與那份檔案
 * 逐欄相同。看的是題庫模組自己：別的模組另外 JSON.parse 一份同樣的字串（例如 ?raw），不算數。
 * src 裡引用 package.json 也一樣安靜（?raw、?url、new URL、CSS 的 url()、動態 import 都算），所以照模組的
 * 路徑認：任何 chunk 或 asset 來自 package.json 就讓 build 失敗。比 inline 上限小的檔案會變成 base64 寫進
 * JS 或 CSS，路徑與字串都看不到，所以 build 的 assetsInlineLimit 讓 package.json 一律不 inline。
 * JS chunk 裡出現 devDependencies 也讓 build 失敗。
 */
function bundleContents(): Plugin {
  return {
    name: 'bundle-contents',
    apply: 'build',
    writeBundle(options, bundle) {
      const dir = options.dir ?? resolve(import.meta.dirname, 'dist')
      const files = Object.values(bundle)
      const chunks = files.filter((file) => file.type === 'chunk')
      // asset 的 originalFileNames 是相對於 Vite root（這個目錄）的路徑：從別的目錄執行 vite build 也要認得出來
      const fromPackageJson = (id: string) => resolve(import.meta.dirname, id.split('?')[0]) === PACKAGE_JSON
      for (const file of files) {
        const sources = file.type === 'chunk' ? file.moduleIds : (file.originalFileNames ?? [])
        if (sources.some(fromPackageJson)) {
          this.error(`${file.fileName} 來自 package.json：src 不要 import package.json，改用注入的常數（見 shared）`)
        }
      }
      for (const c of chunks) {
        if (readFileSync(resolve(dir, c.fileName), 'utf-8').includes('devDependencies')) {
          this.error(`${c.fileName} 帶著 package.json 的 devDependencies：src 不要 import package.json，改用注入的常數`)
        }
      }
      for (const name of ['integrated_dataset.json', 'practice_pool.json']) {
        const id = resolve(import.meta.dirname, 'src', 'data', name)
        const want = JSON.stringify(JSON.parse(readFileSync(id, 'utf-8')))
        // 只看題庫模組自己算繪出來的程式碼（Rolldown 的 chunk.modules）。模組 id 與 fromPackageJson 一樣比對
        // 正規化之後的路徑：Windows 上 resolve 給的是反斜線，模組 id 不一定是
        const own = chunks.flatMap((c) =>
          Object.entries(c.modules)
            .filter(([moduleId]) => resolve(import.meta.dirname, moduleId.split('?')[0]) === id)
            .flatMap(([, m]) => jsonParseArguments(m.code ?? ''))
        )
        const whole = (text: string) => {
          try {
            return JSON.stringify(JSON.parse(text)) === want
          } catch {
            return false
          }
        }
        if (!own.some(whole)) {
          this.error(`src/data/${name} 的模組不是以一個 JSON.parse 字串載入整份檔案：見 shared 的 json.namedExports`)
        }
      }
    },
  }
}

/** code 裡每一個 JSON.parse(字串) 的字串內容（acorn 解析，跳脫照 JS 的規則還原） */
function jsonParseArguments(code: string): string[] {
  const found: string[] = []
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return
    const n = node as Record<string, unknown> & { type?: string }
    if (n.type === 'CallExpression') {
      const callee = n.callee as Record<string, unknown>
      const args = n.arguments as Record<string, unknown>[]
      const object = callee.object as Record<string, unknown> | undefined
      const property = callee.property as Record<string, unknown> | undefined
      if (callee.type === 'MemberExpression' && object?.name === 'JSON' && property?.name === 'parse' && args.length === 1) {
        const arg = args[0]
        if (arg.type === 'Literal' && typeof arg.value === 'string') found.push(arg.value)
        const quasis = arg.quasis as { value: { cooked: string } }[] | undefined
        if (arg.type === 'TemplateLiteral' && quasis?.length === 1) found.push(quasis[0].value.cooked)
      }
    }
    for (const value of Object.values(n)) {
      if (Array.isArray(value)) value.forEach(visit)
      else if (value && typeof value === 'object' && 'type' in value) visit(value)
    }
  }
  visit(parse(code, { ecmaVersion: 'latest', sourceType: 'module' }))
  return found
}

// GitHub Pages 部署配置
// https://vitejs.dev/config/
export default defineConfig({
  ...shared,
  plugins: [react(), platformHtml(), syntaxFloor(), bundleContents()],
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
    // package.json 不 inline：被引用時一定變成 asset，bundleContents 才認得出來（見那裡的說明）
    assetsInlineLimit: (file) => (resolve(import.meta.dirname, file) === PACKAGE_JSON ? false : undefined),
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
