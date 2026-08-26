// AI 輔助功能模組 - 使用 Puter.js + OpenAI
// 提供題目講解和相似題目生成功能

import type { QuizQuestion } from '../types/quiz';
import { logger } from './logger';

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
      auth?: {
        isSignedIn: () => boolean;
        /**
         * attempt_temp_user_creation：明確要求「直接建立臨時帳號」，
         * 讓第一次造訪的使用者不必註冊就能用 AI 功能。
         */
        signIn: (options?: {
          attempt_temp_user_creation?: boolean;
        }) => Promise<unknown>;
        getUser: () => Promise<{
          username?: string;
          is_temp?: boolean;
          /** 部分版本用的別名，一併容忍 */
          is_temporary?: boolean;
        } | null>;
      };
      print: (content: string) => void;
    };
  }
}

// Puter.js 接受 vendor 前綴或 bare model name；本專案統一使用前綴格式以
// 明確 vendor。新增模型須先加進 union 並更新此常數。
type PuterModel =
  | 'openai/gpt-5.4'
  | 'openai/gpt-5.4-nano'
  | 'openai/gpt-5.2-chat'
  | 'anthropic/claude-sonnet-4-5'
  | 'google/gemini-2.5-flash-lite';

// AI 模型設定 - 使用 OpenAI GPT-5.4（透過 Puter.js）
const AI_MODEL: PuterModel = 'openai/gpt-5.4';
const CONFIDENCE_THRESHOLD = 0.7;

// 系統提示詞（中文）
const SYSTEM_PROMPT = `你是一位專業的 iPAS 淨零碳規劃管理師考試輔導老師。
你的任務是幫助考生理解題目、解釋概念，並提供清晰的解答。

回答原則：
1. 針對淨零碳、碳中和、溫室氣體、ISO 14064、碳盤查、ESG、GRI、SASB 等主題提供專業解答
2. 直接給出明確的答案和解釋，語氣自信且專業
3. 回答需完整但不冗長，包含必要的專業術語
4. 使用繁體中文回答
5. 每個選項都要分析對錯原因`;

const PUTER_SDK_URL = 'https://js.puter.com/v2/';
/** 只認自己插入的那個 script —— 不要用 src*="puter.com" 去猜別人的資源 */
const PUTER_SCRIPT_ATTR = 'data-ipas-puter-sdk';

/**
 * SDK 是否真的可用。
 *
 * 注意這裡要同時看 ai 與 auth：認證流程收回自己控制之後，只檢查 ai 會在
 * auth 尚未掛上時就宣稱 ready。
 */
export function isPuterAvailable(): boolean {
  return typeof window !== 'undefined' && !!window.puter?.ai && !!window.puter?.auth;
}

let sdkLoadPromise: Promise<boolean> | null = null;

/**
 * 載入 Puter.js SDK。
 *
 * 為什麼不是「看 DOM 裡有沒有 puter script」：那個判斷會把**載入失敗留下的死標籤**
 * 當成「還在載入中」，於是之後每一次點擊都只是對著死標籤輪詢十秒，直到使用者重新整理
 * 才會恢復。改成單一自有 promise：失敗或逾時就移除自己插入的 script 並清空狀態，
 * 下一次呼叫才會真的重試。
 */
export async function loadPuterSDK(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  if (isPuterAvailable()) return true;
  if (sdkLoadPromise) return sdkLoadPromise;

  sdkLoadPromise = new Promise<boolean>((resolve) => {
    // 一律用全新的 script 重來：若上一次留下了自己的標籤（例如載入成功後 SDK 又消失），
    // 沿用它會把 handler 掛在「onload 早已觸發過」的節點上，於是只能空等到逾時，
    // 而且因為不是本次插入的而不敢移除 —— 又變成同一種卡死。帶自家標記的節點只有我們會建立，
    // 直接清掉重插最安全。
    for (const stale of document.querySelectorAll(`script[${PUTER_SCRIPT_ATTR}="true"]`)) {
      stale.remove();
    }
    let script = document.querySelector<HTMLScriptElement>(
      `script[${PUTER_SCRIPT_ATTR}="true"]`
    );
    if (!script) {
      script = document.createElement('script');
      script.src = PUTER_SDK_URL;
      script.async = true;
      script.setAttribute(PUTER_SCRIPT_ATTR, 'true');
      document.head.appendChild(script);
    }

    let settled = false;
    const finish = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (script) {
        script.onload = null;
        script.onerror = null;
        // 載入失敗就把死標籤清掉，否則下次會被誤認為「還在載入」
        if (!ok) script.remove();
      }
      resolve(ok);
    };

    const timer = window.setTimeout(() => finish(false), 10_000);
    script.onload = () => finish(isPuterAvailable());
    script.onerror = () => finish(false);
  }).then((ok) => {
    // 只快取「進行中」的載入：成功後交給 isPuterAvailable() 判斷，
    // 這樣既能共用同一次載入，SDK 之後若消失也不會回傳過期的 true。
    sdkLoadPromise = null;
    return ok;
  });

  return sdkLoadPromise;
}

/** Puter 認證結果 */
export interface PuterAuthResult {
  ok: boolean;
  /** 已完成認證的帳號名稱 */
  username?: string;
  /** 是否為臨時帳號（本專案主動要求建立的那種） */
  isTemporary?: boolean;
  /**
   * 我們要求建立臨時帳號，但 Puter 判定不適用（例如瀏覽器已有使用紀錄或舊 session），
   * 於是走了一般登入／註冊流程並完成認證 —— 認證仍成功，只是拿到的不是臨時帳號。
   */
  fellBackToRegularSignIn?: boolean;
  error?: string;
}

/** 取出 Puter 錯誤碼（含巢狀 error.code 這種形狀） */
function puterErrorCode(error: unknown): string {
  if (typeof error === 'string') return error.toLowerCase();
  if (!error || typeof error !== 'object') return '';
  const e = error as { code?: unknown; error?: unknown };
  if (typeof e.code === 'string') return e.code.toLowerCase();
  if (typeof e.error === 'string') return e.error.toLowerCase();
  if (e.error && typeof e.error === 'object') {
    const nested = e.error as { code?: unknown };
    if (typeof nested.code === 'string') return nested.code.toLowerCase();
  }
  return '';
}

/** 這個錯誤代表「認證沒完成」，而不是「認證好了但讀不到 profile」 */
function isAuthFailure(error: unknown): boolean {
  const status =
    error && typeof error === 'object'
      ? Number((error as { status?: unknown }).status)
      : 0;
  const code = puterErrorCode(error);
  return (
    status === 401 ||
    [
      'reauth_required',
      'token_auth_failed',
      'auth_canceled',
      'auth_cancelled',
      'auth_window_closed',
      'popup_blocked',
    ].includes(code)
  );
}

/** 把 Puter 丟出來的錯誤轉成使用者看得懂的訊息 */
function describePuterAuthError(error: unknown): string {
  if (typeof error === 'string') return error;
  const e = error as { msg?: string; message?: string } | undefined;
  const code = puterErrorCode(error);
  if (code.includes('cancel') || code.includes('closed') || code.includes('abort')) {
    return '尚未完成 Puter 認證（視窗被關閉），請再試一次';
  }
  if (code.includes('popup') || code.includes('blocked')) {
    return '瀏覽器擋下了 Puter 認證視窗，請允許此網站的彈出式視窗後再試一次';
  }
  if (code === 'reauth_required' || code === 'token_auth_failed') {
    return '先前的 Puter 登入已失效，請重新認證後再試一次';
  }
  return e?.msg ?? e?.message ?? 'Puter 認證失敗，請稍後再試';
}

/**
 * 確保已完成 Puter 認證，並**明確要求**建立臨時帳號。
 *
 * 先前這個專案完全不碰 auth，直接呼叫 puter.ai.chat 讓 SDK 自行隱式跳認證：
 * 我們既不能指定要臨時帳號，也讀不到最後究竟是誰在用、是不是臨時帳號。
 * 這支把那段流程收回來自己控制。
 *
 * 呼叫端必須知道的兩個限制：
 *
 * 1. **signIn() 必須由 click／tap 等使用者操作直接觸發**，否則彈窗可能被瀏覽器封鎖。
 *    因此本函式只能放在事件處理函式的呼叫鏈上；若在它之前還有耗時的 await，
 *    請先用 preloadPuterSDK() 把 SDK 準備好。
 *
 * 2. **臨時帳號主要是給第一次造訪的使用者。** 若瀏覽器已有 Puter 使用紀錄、舊 session、
 *    登出狀態，或被判定不適合建立臨時帳號，仍會轉向一般登入／註冊頁面。
 *    此時認證可能照樣成功，只是拿到的不是臨時帳號 —— 見 fellBackToRegularSignIn。
 */
export async function ensurePuterAuth(): Promise<PuterAuthResult> {
  // 結果頁每張錯題卡都有自己的 AI 按鈕。連點兩張會同時走到這裡，各自看到「尚未登入」，
  // 於是彈出兩個認證視窗 —— 第二個通常還會被瀏覽器當成非使用者觸發而擋掉。
  // 同一時間只跑一次，其餘呼叫共用同一個 promise。
  if (authInFlight) return authInFlight;
  authInFlight = runPuterAuth();
  try {
    return await authInFlight;
  } finally {
    // 用完就清掉：下次點擊要能重新確認狀態（也讓失敗後的重試是真的重試）
    authInFlight = null;
  }
}

let authInFlight: Promise<PuterAuthResult> | null = null;

async function runPuterAuth(): Promise<PuterAuthResult> {
  const loaded = await loadPuterSDK();
  const auth = window.puter?.auth;
  if (!loaded || !auth) {
    return { ok: false, error: 'AI 服務暫時無法使用，請稍後再試' };
  }

  let requestedTempUser = false;
  try {
    if (!auth.isSignedIn()) {
      requestedTempUser = true;
      await auth.signIn({ attempt_temp_user_creation: true });
    }
  } catch (error) {
    logger.error('Puter 認證失敗', error);
    return { ok: false, error: describePuterAuthError(error) };
  }

  // getUser() 不只是拿頭像暱稱。isSignedIn() 只看本地有沒有 token，不保證伺服器仍接受它；
  // token 過期或被撤銷時，getUser() 可能回 401 並觸發重新認證，使用者取消還會丟出
  // 巢狀的 auth_canceled。把這種錯誤吞掉回 ok:true，等一下 ai.chat 會再跳一次登入 ——
  // 正是這個 PR 想消滅的「認證流程不受控制」。
  // 因此：認證類錯誤一律失敗；只有真正與認證無關的 profile 讀取失敗才降級放行。
  let user: { username?: string; is_temp?: boolean; is_temporary?: boolean } | null = null;
  try {
    user = await auth.getUser();
  } catch (error) {
    if (isAuthFailure(error)) {
      logger.warn('Puter 認證未完成', { reason: describePuterAuthError(error) });
      return { ok: false, error: describePuterAuthError(error) };
    }
    logger.warn('Puter 已認證，但暫時讀不到使用者資訊', {
      reason: describePuterAuthError(error),
    });
  }

  const isTemporary = Boolean(user?.is_temp ?? user?.is_temporary);
  const fellBack = requestedTempUser && user !== null && !isTemporary;

  logger.info('Puter 認證完成', {
    username: user?.username,
    temporary: isTemporary,
    fellBackToRegularSignIn: fellBack,
  });

  return {
    ok: true,
    username: user?.username,
    isTemporary,
    fellBackToRegularSignIn: fellBack,
  };
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

  const auth = await ensurePuterAuth();
  if (!auth.ok) {
    return {
      success: false,
      content: '',
      confidence: 0,
      error: auth.error ?? 'AI 服務需要 Puter 認證才能使用',
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

    // 處理回應 - Puter.js 可能返回字串、物件 { text: string } 或其他格式
    let content = '';
    if (typeof response === 'string') {
      content = response;
    } else if (response && typeof response === 'object') {
      // 排除 AsyncIterable（streaming 模式的回應）
      if (Symbol.asyncIterator in response) {
        // 如果是 streaming 回應，逐一收集
        for await (const part of response) {
          if (part?.text) {
            content += part.text;
          }
        }
      } else {
        // 嘗試從物件中提取文字內容
        // Puter.js 回應格式因模型而異：
        // - 簡單格式：response (字串)
        // - OpenAI/Grok 格式：response.message.content
        // - Claude 格式：response.message.content[0].text
        const respObj = response as unknown as Record<string, unknown>;

        // 檢查 message.content 格式（最常見）
        if (respObj.message && typeof respObj.message === 'object') {
          const message = respObj.message as Record<string, unknown>;
          if (typeof message.content === 'string') {
            // OpenAI/Grok 格式
            content = message.content;
          } else if (Array.isArray(message.content) && message.content.length > 0) {
            // Claude 格式：content 是陣列
            const firstContent = message.content[0] as Record<string, unknown>;
            if (typeof firstContent.text === 'string') {
              content = firstContent.text;
            } else if (typeof firstContent === 'string') {
              content = firstContent;
            }
          }
        }
        // 直接屬性檢查（備用）
        else if (typeof respObj.text === 'string') {
          content = respObj.text;
        } else if (typeof respObj.content === 'string') {
          content = respObj.content;
        } else if (typeof respObj.response === 'string') {
          content = respObj.response;
        }
      }
    }

    // 簡單的信心分數估算（基於回應長度和是否包含關鍵詞）
    const confidence = estimateConfidence(content, question);

    if (confidence < CONFIDENCE_THRESHOLD) {
      return {
        success: true,
        content:
          content +
          '\n\n提醒：此回答的信心度較低，建議參考官方教材確認。',
        confidence,
      };
    }

    return {
      success: true,
      content,
      confidence,
    };
  } catch (error) {
    logger.error('AI 請求失敗', error);
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

  const auth = await ensurePuterAuth();
  if (!auth.ok) {
    return {
      success: false,
      content: '',
      confidence: 0,
      error: auth.error ?? 'AI 服務需要 Puter 認證才能使用',
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
        fullContent + '\n\n提醒：此回答的信心度較低，建議參考官方教材確認。';
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
    logger.error('AI 請求失敗', error);
    return {
      success: false,
      content: '',
      confidence: 0,
      error: 'AI 請求失敗，請稍後再試',
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

  const auth = await ensurePuterAuth();
  if (!auth.ok) {
    return {
      success: false,
      content: '',
      confidence: 0,
      error: auth.error ?? 'AI 服務需要 Puter 認證才能使用',
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
    logger.error('AI 生成題目失敗', error);
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
 * 評估標準：長度、結構完整性、專業術語覆蓋
 */
function estimateConfidence(content: string, _question: QuizQuestion): number {
  if (!content || content.length < 50) return 0.3;

  let score = 0.5;

  // 回應長度適中（80-1500 字，放寬區間）
  if (content.length >= 80 && content.length <= 1500) {
    score += 0.15;
  }

  // 包含選項分析（檢查是否有分析多個選項）
  const hasOptionAnalysis =
    (content.includes('A') || content.includes('選項A')) &&
    (content.includes('B') || content.includes('選項B'));
  if (hasOptionAnalysis) {
    score += 0.1;
  }

  // 擴充專業關鍵詞清單（涵蓋題庫主要主題）
  const keywords = [
    // 核心概念
    '碳', '排放', '淨零', '碳中和', '減量', '移除',
    // 標準與框架
    'ISO', 'GRI', 'SASB', 'ESG', 'PCR', 'GWP',
    // 盤查相關
    '盤查', '溫室氣體', '範疇', '類別',
    // 其他專業術語
    '氣候', '永續', '低碳', '暖化', '調適', '碳權', '抵換'
  ];
  const keywordCount = keywords.filter((k) => content.includes(k)).length;
  // 每個關鍵詞 +0.03，上限 +0.25
  score += Math.min(keywordCount * 0.03, 0.25);

  // 僅對明確表達不確定的詞彙扣分（移除「可能」，因為這是正常解釋用語）
  const strongUncertainWords = ['我不確定', '無法確定', '不太清楚'];
  const hasStrongUncertainty = strongUncertainWords.some((w) => content.includes(w));
  if (hasStrongUncertainty) {
    score -= 0.15;
  }

  return Math.min(1, Math.max(0, score));
}
