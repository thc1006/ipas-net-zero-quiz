// 應用程式中繼資料 — 從 package.json 讀取，避免 hardcode 漂移
import packageJson from '../../package.json';

/** 問題回報 URL — 來自 package.json `bugs.url`（GitHub Discussions） */
export const BUG_REPORT_URL = packageJson.bugs.url;
