# SPEC — iPAS 淨零碳規劃管理師題庫蒐集（Crawler/Extractor）

## 範圍
- 證照：iPAS「淨零碳規劃管理師」
- 年份優先：2026、2025（次要：可補充更早期，但需標 year_confidence）
- 題庫形式：官方樣題 PDF、學校公開模擬題 PDF、公開解析文（HTML）

## 禁用來源
- 網域：hackmd.io、github.com、gist.github.com
- 關鍵字：hctsai1006、thc1006
- 不得登入/繞過付費牆/繞過存取控制

## 輸出
- dataset.json：符合 `schemas/dataset.schema.json`
- 題目至少含：stem、year（可 null）、source.url

## 去重策略（dedupe）
- 正規化（NFKC + 去空白/標點 + 小寫）後的 stem hash
- 同題多來源：保留權威度最高的主來源，其餘列入 alt_sources

## 合規策略
- robots.txt/ToS 檢查（預設啟用）
- 節流：每網域固定 RPS，遇 429/5xx 指數退避
- 快取：以 URL hash 儲存 raw 檔，支援 ETag/Last-Modified

