// 結果頁面元件
import { useMemo, useCallback, useState } from 'react';
import { getQuestionById, getSimilarQuestions } from '../data/questions';
import {
  explainQuestionStream,
  generateSimilarQuestionStream,
  type AIResponse,
} from '../utils/ai-helper';
import type { QuizResult, QuizQuestion } from '../types/quiz';
import './ResultPage.css';

interface ResultPageProps {
  result: QuizResult;
  onGoHome: () => void;
  onRetry: () => void;
}

export function ResultPage({ result, onGoHome, onRetry }: ResultPageProps) {
  const { score, correctCount, wrongCount, totalAnswerable, answers, totalTime } =
    result;

  // AI 解析狀態（key 為 questionId）
  const [aiResponses, setAiResponses] = useState<Record<string, AIResponse>>({});
  const [loadingAI, setLoadingAI] = useState<Record<string, boolean>>({});
  // Streaming 暫存內容
  const [streamingAI, setStreamingAI] = useState<Record<string, string>>({});

  // AI 生成相似題狀態
  const [generatedQuestions, setGeneratedQuestions] = useState<Record<string, AIResponse>>({});
  const [loadingGenerate, setLoadingGenerate] = useState<Record<string, boolean>>({});
  // Streaming 暫存內容
  const [streamingGenerate, setStreamingGenerate] = useState<Record<string, string>>({});

  // 題庫內相似題展開狀態（key 為 questionId）
  const [showBankSimilar, setShowBankSimilar] = useState<Record<string, boolean>>({});

  // 切換題庫相似題顯示
  const toggleBankSimilar = useCallback((questionId: string) => {
    setShowBankSimilar((prev) => ({
      ...prev,
      [questionId]: !prev[questionId],
    }));
  }, []);

  // 計算時間
  const formattedTime = useMemo(() => {
    const minutes = Math.floor(totalTime / 60000);
    const seconds = Math.floor((totalTime % 60000) / 1000);
    return `${minutes} 分 ${seconds} 秒`;
  }, [totalTime]);

  // 篩選錯誤題目
  const wrongAnswers = useMemo(
    () => answers.filter((a) => a.isCorrect === false),
    [answers]
  );

  // 請求 AI 解釋特定題目（Streaming）
  const handleAskAI = useCallback(async (question: QuizQuestion) => {
    const qid = question.id;
    if (loadingAI[qid]) return;

    setLoadingAI((prev) => ({ ...prev, [qid]: true }));
    setStreamingAI((prev) => ({ ...prev, [qid]: '' }));

    try {
      const response = await explainQuestionStream(question, (content, isDone) => {
        // 更新 streaming 暫存內容
        setStreamingAI((prev) => ({ ...prev, [qid]: content }));
        if (isDone) {
          // 完成時清除 streaming 狀態
          setStreamingAI((prev) => {
            const next = { ...prev };
            delete next[qid];
            return next;
          });
        }
      });
      setAiResponses((prev) => ({ ...prev, [qid]: response }));
    } catch {
      setAiResponses((prev) => ({
        ...prev,
        [qid]: {
          success: false,
          content: '',
          confidence: 0,
          error: '請求失敗，請稍後再試',
        },
      }));
    } finally {
      setLoadingAI((prev) => ({ ...prev, [qid]: false }));
    }
  }, [loadingAI]);

  // 請求 AI 生成相似題目（Streaming）
  const handleGenerateSimilar = useCallback(async (question: QuizQuestion) => {
    const qid = question.id;
    if (loadingGenerate[qid]) return;

    setLoadingGenerate((prev) => ({ ...prev, [qid]: true }));
    setStreamingGenerate((prev) => ({ ...prev, [qid]: '' }));

    try {
      const response = await generateSimilarQuestionStream(question, (content, isDone) => {
        // 更新 streaming 暫存內容
        setStreamingGenerate((prev) => ({ ...prev, [qid]: content }));
        if (isDone) {
          // 完成時清除 streaming 狀態
          setStreamingGenerate((prev) => {
            const next = { ...prev };
            delete next[qid];
            return next;
          });
        }
      });
      setGeneratedQuestions((prev) => ({ ...prev, [qid]: response }));
    } catch {
      setGeneratedQuestions((prev) => ({
        ...prev,
        [qid]: {
          success: false,
          content: '',
          confidence: 0,
          error: '生成失敗，請稍後再試',
        },
      }));
    } finally {
      setLoadingGenerate((prev) => ({ ...prev, [qid]: false }));
    }
  }, [loadingGenerate]);

  // 匯出結果為 JSON
  const handleExport = useCallback(() => {
    const exportData = {
      date: new Date().toISOString(),
      score,
      correctCount,
      wrongCount,
      totalQuestions: answers.length,
      totalTime,
      wrongQuestions: wrongAnswers.map((a) => {
        const q = getQuestionById(a.questionId);
        return {
          questionId: a.questionId,
          stem: q?.stem ?? '',
          yourAnswer: a.selectedAnswer,
          correctAnswer: a.correctAnswer,
        };
      }),
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ipas-quiz-result-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [score, correctCount, wrongCount, answers, totalTime, wrongAnswers]);

  // 分數評語
  const scoreComment = useMemo(() => {
    if (score >= 90) return { text: '太棒了！', icon: 'emoji_events', class: 'excellent' };
    if (score >= 70) return { text: '不錯喔！', icon: 'thumb_up', class: 'good' };
    if (score >= 60) return { text: '及格了！', icon: 'done', class: 'pass' };
    return { text: '再加油！', icon: 'fitness_center', class: 'fail' };
  }, [score]);

  return (
    <div className="result-page animate-fade-in">
      {/* 分數區 */}
      <section className={`score-section card ${scoreComment.class}`}>
        <div className="score-icon">
          <span className="material-icons">{scoreComment.icon}</span>
        </div>
        <h1 className="score-value">{score}</h1>
        <p className="score-label">分</p>
        <p className="score-comment">{scoreComment.text}</p>
      </section>

      {/* 統計區 */}
      <section className="stats-section">
        <div className="stat-item correct">
          <span className="material-icons">check_circle</span>
          <span className="stat-value">{correctCount}</span>
          <span className="stat-label">答對</span>
        </div>
        <div className="stat-item wrong">
          <span className="material-icons">cancel</span>
          <span className="stat-value">{wrongCount}</span>
          <span className="stat-label">答錯</span>
        </div>
        <div className="stat-item total">
          <span className="material-icons">quiz</span>
          <span className="stat-value">{totalAnswerable}</span>
          <span className="stat-label">總題數</span>
        </div>
        <div className="stat-item time">
          <span className="material-icons">timer</span>
          <span className="stat-value">{formattedTime}</span>
          <span className="stat-label">用時</span>
        </div>
      </section>

      {/* 錯題列表 */}
      {wrongAnswers.length > 0 && (
        <section className="wrong-section card">
          <h2>
            <span className="material-icons">error_outline</span>
            錯誤題目 ({wrongAnswers.length} 題)
          </h2>

          {/* AI 功能說明與免責聲明 */}
          <div className="ai-disclaimer">
            <div className="ai-disclaimer-header">
              <span className="material-icons">info</span>
              <span>AI 輔助功能說明</span>
            </div>
            <ul className="ai-disclaimer-list">
              <li>
                <span className="material-icons sm">login</span>
                <span>首次使用 AI 功能時，會開啟 Puter 認證頁面，認證完成後分頁會自動關閉。</span>
              </li>
              <li>
                <span className="material-icons sm">warning</span>
                <span>AI 可能產生錯誤資訊，請務必參考官方教材核實答案。</span>
              </li>
              <li>
                <span className="material-icons sm">security</span>
                <span>請勿輸入個人機密資料（如身分證字號、密碼等）。</span>
              </li>
            </ul>
          </div>

          <div className="wrong-list">
            {wrongAnswers.map((answer, index) => {
              const question = getQuestionById(answer.questionId);
              if (!question) return null;

              const qid = question.id;
              const aiResponse = aiResponses[qid];
              const isLoading = loadingAI[qid];
              const streamingContent = streamingAI[qid];
              const generatedQ = generatedQuestions[qid];
              const isGenerating = loadingGenerate[qid];
              const streamingGenerateContent = streamingGenerate[qid];

              return (
                <article key={answer.questionId} className="wrong-item">
                  <div className="wrong-number">#{index + 1}</div>
                  <div className="wrong-content">
                    <p className="wrong-stem">{question.stem}</p>
                    <div className="wrong-answers">
                      <span className="your-answer">
                        你的答案：
                        <strong className="text-error">{answer.selectedAnswer}</strong>
                      </span>
                      <span className="correct-answer">
                        正確答案：
                        <strong className="text-success">{answer.correctAnswer}</strong>
                      </span>
                    </div>

                    {/* AI 功能區 */}
                    <div className="wrong-ai-section">
                      <div className="ai-buttons">
                        {!aiResponse && !isLoading && (
                          <button
                            className="btn-small btn-ai"
                            onClick={() => handleAskAI(question)}
                          >
                            <span className="material-icons sm">smart_toy</span>
                            AI 解析
                          </button>
                        )}

                        {!generatedQ && !isGenerating && (
                          <button
                            className="btn-small btn-generate"
                            onClick={() => handleGenerateSimilar(question)}
                          >
                            <span className="material-icons sm">auto_awesome</span>
                            AI 生成相似題
                          </button>
                        )}

                        <button
                          className="btn-small btn-bank"
                          onClick={() => toggleBankSimilar(qid)}
                        >
                          <span className="material-icons sm">library_books</span>
                          {showBankSimilar[qid] ? '收起題庫相似題' : '題庫相似題'}
                        </button>
                      </div>

                      {isLoading && (
                        <div className="ai-response-inline streaming">
                          <div className="ai-response-header-inline">
                            <span className="material-icons sm rotating">sync</span>
                            <span>AI 分析中...</span>
                          </div>
                          {streamingContent && (
                            <div className="ai-content">
                              {streamingContent.split('\n').map((line, i) => (
                                <p key={i}>{line}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {aiResponse && (
                        <div className={`ai-response-inline ${aiResponse.success ? '' : 'error'}`}>
                          <div className="ai-response-header-inline">
                            <span className="material-icons sm">smart_toy</span>
                            <span>AI 解析</span>
                            {aiResponse.confidence > 0 && (
                              <span className="confidence-inline">
                                信心度 {Math.round(aiResponse.confidence * 100)}%
                              </span>
                            )}
                          </div>
                          {aiResponse.success ? (
                            <div className="ai-content">
                              {aiResponse.content.split('\n').map((line, i) => (
                                <p key={i}>{line}</p>
                              ))}
                            </div>
                          ) : (
                            <div className="ai-error">
                              <span className="material-icons sm">error_outline</span>
                              {aiResponse.error}
                            </div>
                          )}
                        </div>
                      )}

                      {isGenerating && (
                        <div className="ai-response-inline generated streaming">
                          <div className="ai-response-header-inline">
                            <span className="material-icons sm rotating">sync</span>
                            <span>AI 生成題目中...</span>
                          </div>
                          {streamingGenerateContent && (
                            <div className="ai-content generated-content">
                              {streamingGenerateContent.split('\n').map((line, i) => (
                                <p key={i}>{line}</p>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {generatedQ && (
                        <div className={`ai-response-inline generated ${generatedQ.success ? '' : 'error'}`}>
                          <div className="ai-response-header-inline">
                            <span className="material-icons sm">auto_awesome</span>
                            <span>AI 生成的相似題</span>
                            {generatedQ.confidence > 0 && generatedQ.confidence < 0.7 && (
                              <span className="confidence-warning">⚠️ 低信心度</span>
                            )}
                          </div>
                          {generatedQ.success ? (
                            <div className="ai-content generated-content">
                              {generatedQ.content.split('\n').map((line, i) => (
                                <p key={i}>{line}</p>
                              ))}
                            </div>
                          ) : (
                            <div className="ai-error">
                              <span className="material-icons sm">error_outline</span>
                              {generatedQ.error}
                            </div>
                          )}
                        </div>
                      )}

                      {/* 題庫內相似題 */}
                      {showBankSimilar[qid] && (
                        <div className="bank-similar-section">
                          <div className="bank-similar-header">
                            <span className="material-icons sm">library_books</span>
                            <span>題庫內相似題目</span>
                          </div>
                          {(() => {
                            const similarQs = getSimilarQuestions(qid, 5);
                            if (similarQs.length === 0) {
                              return (
                                <p className="no-similar">未找到相似題目</p>
                              );
                            }
                            return (
                              <ul className="bank-similar-list">
                                {similarQs.map((sq, idx) => (
                                  <li key={sq.id} className="bank-similar-item">
                                    <span className="similar-index">{idx + 1}.</span>
                                    <div className="similar-content">
                                      <p className="similar-stem">{sq.stem}</p>
                                      <div className="similar-meta">
                                        <span className="similar-subject">
                                          {sq.subject === '考科1' ? '考科一' : '考科二'}
                                        </span>
                                        {sq.answer && (
                                          <span className="similar-answer">
                                            答案：{sq.answer}
                                          </span>
                                        )}
                                      </div>
                                    </div>
                                  </li>
                                ))}
                              </ul>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      )}

      {/* 操作按鈕 */}
      <section className="action-section">
        <button className="btn btn-secondary" onClick={handleExport}>
          <span className="material-icons">download</span>
          匯出結果
        </button>
        <button className="btn btn-secondary" onClick={onRetry}>
          <span className="material-icons">replay</span>
          再測一次
        </button>
        <button className="btn btn-primary" onClick={onGoHome}>
          <span className="material-icons">home</span>
          返回首頁
        </button>
      </section>
    </div>
  );
}

export default ResultPage;
