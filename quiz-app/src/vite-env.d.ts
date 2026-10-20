/// <reference types="vite/client" />

/** package.json 的 version 與 bugs.url：vite.config.ts 的 shared.define 注入，vitest 用同一份（見 data/app-meta.ts） */
declare const __APP_VERSION__: string;
declare const __BUG_REPORT_URL__: string;
