# iPAS Net Zero Quiz Application Documentation

## 文件目錄導覽

這是台灣 iPAS (產業職能評鑑體系) 淨零碳認證測驗系統的技術文件。本文件集提供完整的技術架構、API 文件、使用指南和部署說明。

## 📚 文件結構

### 核心文件

1. **[API Documentation](./api-documentation.md)** - 完整的組件和 Composables API 文件
2. **[Architecture Overview](./architecture-overview.md)** - 系統架構與組件層級結構
3. **[State Management](./state-management.md)** - 狀態管理流程與資料流向
4. **[User Guide (繁體中文)](./user-guide-zh-TW.md)** - 使用者操作指南
5. **[Developer Guide](./developer-guide.md)** - 開發者入門指南
6. **[Deployment Guide](./deployment-guide.md)** - 部署與設定指南
7. **[Configuration Guide](./configuration-guide.md)** - questions.json 格式與設定說明

### 進階文件

8. **[Component Specifications](./component-specifications.md)** - 組件詳細規格
9. **[Quiz Logic Documentation](./quiz-logic.md)** - 測驗邏輯與評分演算法
10. **[Performance Optimization](./performance-optimization.md)** - 效能優化指南
11. **[Testing Guide](./testing-guide.md)** - 測試策略與指南
12. **[Troubleshooting](./troubleshooting.md)** - 常見問題與解決方案

## 🚀 快速開始

### 系統需求

- Node.js 18.0 或更高版本
- npm 9.0 或更高版本
- 現代瀏覽器 (Chrome 90+, Firefox 88+, Safari 14+, Edge 90+)

### 安裝步驟

```bash
# 複製專案
git clone [repository-url]

# 進入專案目錄
cd ipas-net-zero-quiz

# 安裝相依套件
npm install

# 啟動開發伺服器
npm run dev

# 建置生產版本
npm run build
```

## 🏗️ 技術堆疊

- **前端框架**: Vue 3.4 with Composition API
- **建置工具**: Vite 5.0
- **樣式框架**: Tailwind CSS 3.4
- **程式語言**: JavaScript (ES6+)
- **狀態管理**: Vue Composition API with Composables
- **本地儲存**: localStorage API

## 📊 專案統計

- **組件總數**: 9 個 Vue 組件
- **Composables**: 1 個核心狀態管理 composable
- **測驗題目**: 可配置的 JSON 格式題庫
- **支援語言**: 繁體中文 (台灣)
- **響應式設計**: 支援桌面、平板、手機

## 🔗 相關資源

- [Vue 3 官方文件](https://vuejs.org/)
- [Vite 官方文件](https://vitejs.dev/)
- [Tailwind CSS 文件](https://tailwindcss.com/)
- [iPAS 產業職能評鑑](https://www.ipas.org.tw/)

## 📝 授權

本專案採用 MIT 授權條款 - 詳見 [LICENSE](../LICENSE) 文件

## 🤝 貢獻指南

歡迎貢獻！請先閱讀 [Developer Guide](./developer-guide.md) 了解開發流程。

## 📧 聯絡方式

如有任何問題或建議，請透過以下方式聯絡：

- GitHub Issues
- Email: [contact@example.com]

---

最後更新日期：2025-08-21