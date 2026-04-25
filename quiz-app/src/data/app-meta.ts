// 應用程式中繼資料 — 從 package.json 讀取，避免 hardcode 漂移
import packageJson from '../../package.json';

export const APP_VERSION = packageJson.version;
export const APP_NAME = '淨零碳備考神器';

/** 問題回報 URL — 來自 package.json `bugs.url`（GitHub Discussions） */
export const BUG_REPORT_URL = packageJson.bugs.url;

/** GitHub repo URL — 來自 package.json `repository.url`，去掉 .git suffix */
export const REPO_URL = packageJson.repository.url.replace(/\.git$/, '');
