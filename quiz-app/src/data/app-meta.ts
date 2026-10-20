// 應用程式中繼資料：package.json 的版本與問題回報網址，避免 hardcode 漂移。
// build 時由 vite.config.ts 注入（不在執行期 import 整份 package.json，否則 scripts、devDependencies
// 都會進首頁的 chunk）。

/** 問題回報 URL：package.json 的 `bugs.url`（GitHub Discussions） */
export const BUG_REPORT_URL = __BUG_REPORT_URL__;

/** 版本：package.json 的 `version` */
export const APP_VERSION = __APP_VERSION__;
