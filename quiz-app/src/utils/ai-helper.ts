// AI 輔助功能模組 - 使用 Puter.js + Gemini
// 提供題目講解和相似題目生成功能

import type { QuizQuestion } from '../types/quiz';

// Puter.js 全域物件型別定義
declare global {
  interface Window {
    puter?: {
      ai: {
        chat: (
          prompt: string,
          options?: { model?: string; stream?: boolean }
        ) => Promise<string | AsyncIterable<{ text?: string }>>;
      };
      print: (content: string) => void;
    };
  }
}

// AI 模型設定
const AI_MODEL = 'gemini-3-pro-preview';
const CONFIDENCE_THRESHOLD = 0.7;

// 系統提示詞（中文）
const SYSTEM_PROMPT = `你是一位專業的 iPAS 淨零碳規劃管理師考試輔導老師。
你的任務是幫助考生理解題目、解釋概念、提供額外的學習資源。

重要原則：
1. 只回答與淨零碳、碳中和、溫室氣體、ISO 14064、碳盤查、ESG 等相關的問題
2. 如果不確定答案，請明確說明「我不確定」，不要編造資訊
3. 回答要簡潔明瞭，適合考試準備
4. 使用繁體中文回答
5. 如果題目涉及最新法規或數據，請提醒考生確認最新資訊`;

/**
 * 檢查 Puter.js 是否已載入
 */
export function isPuterAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.puter?.ai;
}

/**
 * 載入 Puter.js SDK（如果尚未載入）
 */
export async function loadPuterSDK(): Promise<boolean> {
  if (isPuterAvailable()) {
    return true;
  }

  return new Promise((resolve) => {
    // 檢查是否已有 script 標籤
    if (document.querySelector('script[src*="puter.com"]')) {
      // 等待載入完成
      const checkInterval = setInterval(() => {
        if (isPuterAvailable()) {
          clearInterval(checkInterval);
          resolve(true);
        }
      }, 100);

      // 最多等待 10 秒
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(false);
      }, 10000);
      return;
    }

    // 動態載入 Puter.js
    const script = document.createElement('script');
    script.src = 'https://js.puter.com/v2/';
    script.async = true;

    script.onload = () => {
      const checkInterval = setInterval(() => {
        if (isPuterAvailable()) {
          clearInterval(checkInterval);
          resolve(true);
        }
      }, 100);

      setTimeout(() => {
        clearInterval(checkInterval);
        resolve(isPuterAvailable());
      }, 5000);
    };

    script.onerror = () => {
      resolve(false);
    };

    document.head.appendChild(script);
  });
}

/**
 * AI 回應結構
 */
export interface AIResponse {
  success: boolean;
  content: string;
  confidence: number;
  error?: string;
}

/**
 * Streaming 回呼函式型別
 * @param partialContent - 目前累積的內容
 * @param isDone - 是否已完成
 */
export type StreamCallback = (partialContent: string, isDone: boolean) => void;

/**
 * 請求 AI 解釋題目
 */
export async function explainQuestion(question: QuizQuestion): Promise<AIResponse> {
  const loaded = await loadPuterSDK();
  if (!loaded || !window.puter) {
    return {
      success: false,
      content: '',
      confidence: 0,
      error: 'AI 服務暫時無法使用，請稍後再試',
    };
  }

  const prompt = `${SYSTEM_PROMPT}

請解釋以下題目：

題目：${question.stem}

選項：
${question.options.map((o) => `${o.key}. ${o.text}`).join('\n')}

${question.answer ? `正確答案：${question.answer}` : '（此題無標準答案）'}

請提供：
1. 題目重點解析（2-3 句）
2. 各選項分析
3. 相關概念補充
4. 記憶小技巧（如有）`;

  try {
    const response = await window.puter.ai.chat(prompt, { model: AI_MODEL });

    // 處理回應
    const content = typeof response === 'string' ? response : '';

    // 簡單的信心分數估算（基於回應長度和是否包含關鍵詞）
    const confidence = estimateConfidence(content, question);

    if (confidence < CONFIDENCE_THRESHOLD) {
      return {
        success: true,
        content:
          content +
          '\n\n⚠️ 提醒：此回答的信心度較低，建議參考官方教材確認。',
        confidence,
      };
    }

    return {
      success: true,
      content,
      confidence,
    };
  } catch (error) {
    console.error('AI 請求失敗:', error);
    return {
      success: false,
      content: '',
      confidence: 0,
      error: 'AI 請求失敗，請稍後再試',
    };
  }
}

/**
 * 請求 AI 解釋題目（Streaming 版本）
 * 回應會逐步透過 onChunk 回呼傳送
 */
export async function explainQuestionStream(
  question: QuizQuestion,
  onChunk: StreamCallback
): Promise<AIResponse> {
  const loaded = await loadPuterSDK();
  if (!loaded || !window.puter) {
    return {
      success: false,
      content: '',
      confidence: 0,
      error: 'AI 服務暫時無法使用，請稍後再試',
    };
  }

  const prompt = `${SYSTEM_PROMPT}

請解釋以下題目：

題目：${question.stem}

選項：
${question.options.map((o) => `${o.key}. ${o.text}`).join('\n')}

${question.answer ? `正確答案：${question.answer}` : '（此題無標準答案）'}

請提供：
1. 題目重點解析（2-3 句）
2. 各選項分析
3. 相關概念補充
4. 記憶小技巧（如有）`;

  try {
    const response = await window.puter.ai.chat(prompt, {
      model: AI_MODEL,
      stream: true,
    });

    let fullContent = '';

    // 處理 streaming 回應
    if (typeof response !== 'string' && Symbol.asyncIterator in response) {
      for await (const part of response) {
        if (part?.text) {
          fullContent += part.text;
          onChunk(fullContent, false);
        }
      }
    } else if (typeof response === 'string') {
      // 如果不是 streaming 回應，直接使用
      fullContent = response;
      onChunk(fullContent, false);
    }

    onChunk(fullContent, true);

    const confidence = estimateConfidence(fullContent, question);

    if (confidence < CONFIDENCE_THRESHOLD) {
      const finalContent =
        fullContent + '\n\n⚠️ 提醒：此回答的信心度較低，建議參考官方教材確認。';
      onChunk(finalContent, true);
      return {
        success: true,
        content: finalContent,
        confidence,
      };
    }

    return {
      success: true,
      content: fullContent,
      confidence,
    };
  } catch (error) {
    console.error('AI 請求失敗:', error);
    return {
      success: false,
      content: '',
      confidence: 0,
      error: 'AI 請求失敗，請稍後再試',
    };
  }
}

/**
 * 請求 AI 生成相似題目
 */
export async function generateSimilarQuestion(
  question: QuizQuestion
): Promise<AIResponse> {
  const loaded = await loadPuterSDK();
  if (!loaded || !window.puter) {
    return {
      success: false,
      content: '',
      confidence: 0,
      error: 'AI 服務暫時無法使用',
    };
  }

  const prompt = `${SYSTEM_PROMPT}

參考以下題目，生成一道相似但不同的練習題：

原題目：${question.stem}

請生成：
1. 新題目（測試相同概念但使用不同情境或數據）
2. 四個選項 A/B/C/D
3. 正確答案
4. 簡短解析

格式要求：
- 題目難度與原題相近
- 確保答案正確
- 避免抄襲原題`;

  try {
    const response = await window.puter.ai.chat(prompt, { model: AI_MODEL });
    const content = typeof response === 'string' ? response : '';
    const confidence = content.length > 100 ? 0.8 : 0.5;

    return {
      success: true,
      content,
      confidence,
    };
  } catch (error) {
    console.error('AI 生成題目失敗:', error);
    return {
      success: false,
      content: '',
      confidence: 0,
      error: 'AI 生成題目失敗',
    };
  }
}

/**
 * 請求 AI 生成相似題目（Streaming 版本）
 * 回應會逐步透過 onChunk 回呼傳送
 */
export async function generateSimilarQuestionStream(
  question: QuizQuestion,
  onChunk: StreamCallback
): Promise<AIResponse> {
  const loaded = await loadPuterSDK();
  if (!loaded || !window.puter) {
    return {
      success: false,
      content: '',
      confidence: 0,
      error: 'AI 服務暫時無法使用',
    };
  }

  const prompt = `${SYSTEM_PROMPT}

參考以下題目，生成一道相似但不同的練習題：

原題目：${question.stem}

請生成：
1. 新題目（測試相同概念但使用不同情境或數據）
2. 四個選項 A/B/C/D
3. 正確答案
4. 簡短解析

格式要求：
- 題目難度與原題相近
- 確保答案正確
- 避免抄襲原題`;

  try {
    const response = await window.puter.ai.chat(prompt, {
      model: AI_MODEL,
      stream: true,
    });

    let fullContent = '';

    // 處理 streaming 回應
    if (typeof response !== 'string' && Symbol.asyncIterator in response) {
      for await (const part of response) {
        if (part?.text) {
          fullContent += part.text;
          onChunk(fullContent, false);
        }
      }
    } else if (typeof response === 'string') {
      fullContent = response;
      onChunk(fullContent, false);
    }

    onChunk(fullContent, true);

    const confidence = fullContent.length > 100 ? 0.8 : 0.5;

    return {
      success: true,
      content: fullContent,
      confidence,
    };
  } catch (error) {
    console.error('AI 生成題目失敗:', error);
    return {
      success: false,
      content: '',
      confidence: 0,
      error: 'AI 生成題目失敗',
    };
  }
}

/**
 * 估算回應的信心分數
 */
function estimateConfidence(content: string, _question: QuizQuestion): number {
  if (!content || content.length < 50) return 0.3;

  let score = 0.5;

  // 回應長度適中（100-500 字）
  if (content.length >= 100 && content.length <= 800) {
    score += 0.1;
  }

  // 包含選項分析
  if (content.includes('A') && content.includes('B')) {
    score += 0.1;
  }

  // 包含淨零碳相關關鍵詞
  const keywords = ['碳', '排放', 'ISO', '盤查', '溫室氣體', '淨零'];
  const keywordCount = keywords.filter((k) => content.includes(k)).length;
  score += keywordCount * 0.05;

  // 不包含不確定詞彙
  const uncertainWords = ['不確定', '可能', '也許', '大概'];
  const hasUncertainty = uncertainWords.some((w) => content.includes(w));
  if (hasUncertainty) {
    score -= 0.1;
  }

  return Math.min(1, Math.max(0, score));
}

/**
 * 取得 AI 服務狀態
 */
export async function getAIStatus(): Promise<{
  available: boolean;
  model: string;
}> {
  const available = await loadPuterSDK();
  return {
    available,
    model: AI_MODEL,
  };
}
