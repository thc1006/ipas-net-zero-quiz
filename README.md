# iPAS 淨零碳規劃管理師 題庫蒐集工具（nzq）

這是一個「合規、可重跑、可測試」的爬蟲 + 題目抽取工具，將公開的 iPAS 淨零碳規劃管理師題目整理成結構化 JSON。

## 特色
- Source Adapter 架構：每個題庫來源各自實作 adapter，統一輸出同一資料合約
- Pipeline 分階段落地：discover → fetch → parse → extract → normalize/dedupe → validate → export
- JSON Schema 驗證：輸出前強制 schema validate
- 合規守門：禁止來源清單、robots.txt 檢查、節流與快取

## 快速開始
```bash
pip install -e .
nzq crawl --profile official
nzq export
```

## 目錄
- `configs/`：seed 清單與 run 設定
- `schemas/`：JSON schema
- `src/nzq/`：程式碼
- `tests/`：測試與 fixtures
