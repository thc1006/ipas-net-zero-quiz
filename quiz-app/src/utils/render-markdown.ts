/** HTML 實體逸出 —— 這是 renderMarkdown 唯一的安全基礎。 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * 簡易 Markdown 轉 HTML
 * 支援：**粗體**、*斜體*、`程式碼`、標題、清單
 *
 * **輸出會被丟進 dangerouslySetInnerHTML，而輸入來自第三方 AI 服務。**
 * 因此第一步一定是把原始 HTML 逸出掉：先前沒有這一步，模型只要回
 * `<img src=x onerror=...>`，那段 HTML 就會被瀏覽器當成標籤執行。
 * 逸出之後，唯一會出現在輸出裡的標籤是本函式自己插入的 strong / em / code。
 */
export function renderMarkdown(text: string): string {
  if (!text) return '';

  let result = escapeHtml(text)
    // 標題 ### text 或 ## text
    .replace(/^###\s+(.+)$/gm, '<strong>$1</strong>')
    .replace(/^##\s+(.+)$/gm, '<strong>$1</strong>')
    // 粗體 **text** 或 __text__（支援跨空格）
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/__([^_]+)__/g, '<strong>$1</strong>')
    // 行內程式碼 `code`
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    // 清單項目 - item（轉為 bullet point）
    .replace(/^[-•]\s+/gm, '• ')
    // 數字清單 1. item
    .replace(/^\d+\.\s+/gm, '• ');

  // 斜體 *text*（在粗體處理後，避免衝突）
  // 只匹配單個星號包圍的文字，且不在單詞中間。星號內側不能是空白：算式的乘號前後都有空白
  result = result.replace(/(?:^|[\s>])(\*(?=\S)[^*\n]*[^*\s]\*)(?:[\s<]|$)/g, (match, p1) => {
    const inner = p1.slice(1, -1);
    return match.replace(p1, () => `<em>${inner}</em>`);
  });

  return result;
}
