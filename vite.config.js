import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { VitePWA } from 'vite-plugin-pwa'
import { visualizer } from 'rollup-plugin-visualizer'

// https://vitejs.dev/config/
export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  
  return {
    // Set base path for GitHub Pages deployment
    base: process.env.NODE_ENV === 'production' ? '/ipas-net-zero-quiz/' : '/',
    plugins: [
      vue({
        // Enable template compilation optimizations
        template: {
          compilerOptions: {
            // Remove whitespace between elements to reduce bundle size
            whitespace: 'condense'
          }
        }
      }),
      // PWA Configuration
      VitePWA({
        registerType: 'autoUpdate',
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2}'],
          // Cache Chinese fonts specifically
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                }
              }
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                }
              }
            },
            {
              urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp|avif)$/,
              handler: 'CacheFirst',
              options: {
                cacheName: 'images-cache',
                expiration: {
                  maxEntries: 60,
                  maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
                }
              }
            }
          ]
        },
        includeAssets: ['favicon.svg', 'robots.txt'],
        manifest: {
          name: 'iPAS 淨零碳認證測驗系統',
          short_name: 'iPAS Quiz',
          description: '台灣 iPAS 淨零碳認證測驗系統 - 互動式學習平台',
          theme_color: '#1e40af',
          background_color: '#ffffff',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: process.env.NODE_ENV === 'production' ? '/ipas-net-zero-quiz/' : '/',
          scope: process.env.NODE_ENV === 'production' ? '/ipas-net-zero-quiz/' : '/',
          categories: ['education', 'productivity'],
          lang: 'zh-TW',
          icons: [
            {
              src: 'favicon.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            },
            {
              src: '/icons/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png'
            },
            {
              src: '/icons/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png'
            }
          ]
        }
      }),
      // Bundle analyzer for production builds
      mode === 'production' && visualizer({
        filename: 'dist/bundle-analysis.html',
        open: false,
        gzipSize: true,
        brotliSize: true
      })
    ].filter(Boolean),
    css: {
      postcss: './postcss.config.js',
      devSourcemap: mode === 'development'
    },
    server: {
      port: 3000,
      open: true,
      host: true
    },
    build: {
      outDir: 'dist',
      sourcemap: mode === 'development',
      minify: 'esbuild',
      target: 'es2015',
      // Optimize for Chinese font loading
      cssCodeSplit: true,
      rollupOptions: {
        output: {
          manualChunks: {
            vendor: ['vue'],
            // Separate chunks for better caching
            utils: ['./src/composables/useQuiz.js']
          },
          // Optimize asset naming for CDN
          assetFileNames: (assetInfo) => {
            const info = assetInfo.name.split('.')
            let extType = info[info.length - 1]
            if (/\.(mp4|webm|ogg|mp3|wav|flac|aac)(\?.*)?$/i.test(assetInfo.name)) {
              extType = 'media'
            } else if (/\.(png|jpe?g|gif|svg|webp|avif)(\?.*)?$/i.test(assetInfo.name)) {
              extType = 'images'
            } else if (/\.(woff2?|eot|ttf|otf)(\?.*)?$/i.test(assetInfo.name)) {
              extType = 'fonts'
            }
            return `assets/${extType}/[name]-[hash][extname]`
          },
          chunkFileNames: 'assets/js/[name]-[hash].js',
          entryFileNames: 'assets/js/[name]-[hash].js'
        }
      },
      // Compression settings for better performance
      chunkSizeWarningLimit: 1000
    },
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version),
      __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
      // Environment variables for runtime
      'process.env.VITE_APP_TITLE': JSON.stringify(env.VITE_APP_TITLE || 'iPAS Net Zero Quiz'),
      'process.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL || ''),
      'process.env.VITE_ENABLE_ANALYTICS': JSON.stringify(env.VITE_ENABLE_ANALYTICS || 'false')
    },
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src')
      }
    },
    // PWA and caching optimization
    assetsInclude: ['**/*.json'],
    // Optimize deps for Chinese content
    optimizeDeps: {
      include: ['vue'],
      exclude: []
    }
  }
})