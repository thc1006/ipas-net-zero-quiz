// 應用程式中繼資料：package.json 的版本與 repo 網址，避免 hardcode 漂移。
// build 時由 vite.config.ts 注入（不在執行期 import 整份 package.json，否則 scripts、devDependencies
// 都會進首頁的 chunk）。

/** 版本：package.json 的 `version` */
export const APP_VERSION = __APP_VERSION__;

/** GitHub repo：package.json 的 `repository.url` 去掉結尾的 .git。回報問題與討論區的網址都由它組出來 */
export const REPO_URL = __REPO_URL__;
