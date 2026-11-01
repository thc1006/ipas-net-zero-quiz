// QuestionCard 元件測試（TDD - 先寫測試）
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent, isInaccessible } from '@testing-library/react';
import { QuestionCard } from './QuestionCard';
import type { QuizQuestion } from '../../types/quiz';

const mockQuestion: QuizQuestion = {
  id: 'test-1',
  stem: '下列何者屬於溫室氣體？',
  options: [
    { key: 'A', text: '二氧化碳 (CO₂)' },
    { key: 'B', text: '氧氣 (O₂)' },
    { key: 'C', text: '氮氣 (N₂)' },
    { key: 'D', text: '氬氣 (Ar)' },
  ],
  answer: 'A',
  subject: '考科1',
  sourceType: 'gist',
  year: null,
  hasAnswer: true,
};

describe('QuestionCard 元件', () => {
  describe('基本渲染', () => {
    it('應顯示題目題幹', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText(/下列何者屬於溫室氣體/)).toBeInTheDocument();
    });

    it('應顯示題號', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={5}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText(/第 5 題/)).toBeInTheDocument();
    });

    it('應顯示四個選項', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText(/二氧化碳/)).toBeInTheDocument();
      expect(screen.getByText(/氧氣/)).toBeInTheDocument();
      expect(screen.getByText(/氮氣/)).toBeInTheDocument();
      expect(screen.getByText(/氬氣/)).toBeInTheDocument();
    });

    it('應顯示選項代號 A/B/C/D', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText('A')).toBeInTheDocument();
      expect(screen.getByText('B')).toBeInTheDocument();
      expect(screen.getByText('C')).toBeInTheDocument();
      expect(screen.getByText('D')).toBeInTheDocument();
    });
  });

  describe('選項互動', () => {
    it('點擊選項應觸發 onSelectAnswer', () => {
      const handleSelect = vi.fn();
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={handleSelect}
        />
      );

      fireEvent.click(screen.getByText(/二氧化碳/));

      expect(handleSelect).toHaveBeenCalledWith('A');
    });

    it('選項應可透過鍵盤選擇', () => {
      const handleSelect = vi.fn();
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={handleSelect}
        />
      );

      const optionA = screen.getByRole('radio', { name: /二氧化碳/ });
      fireEvent.keyDown(optionA, { key: 'Enter' });

      expect(handleSelect).toHaveBeenCalledWith('A');
    });
  });

  // 原生 radio 的方向鍵與真實焦點順序在 tests/e2e/practice-keyboard.spec.ts，這裡驗元件自己的邏輯
  describe('選了就鎖定的模式（有 onKeyboardAnswered）', () => {
    const renderLocking = () => {
      const onSelectAnswer = vi.fn();
      const onKeyboardAnswered = vi.fn();
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={onSelectAnswer}
          onKeyboardAnswered={onKeyboardAnswered}
        />
      );
      return { onSelectAnswer, onKeyboardAnswered, radios: screen.getAllByRole('radio') };
    };

    it('方向鍵不作答：攔下原生行為，焦點與選取移到下一個選項，顯示提示', () => {
      const { onSelectAnswer, onKeyboardAnswered, radios } = renderLocking();
      radios[0].focus();

      // fireEvent 回傳 false 表示事件被 preventDefault
      expect(fireEvent.keyDown(radios[0], { key: 'ArrowDown' })).toBe(false);

      expect(onSelectAnswer).not.toHaveBeenCalled();
      expect(onKeyboardAnswered).not.toHaveBeenCalled();
      expect(radios[1]).toHaveFocus();
      expect(radios[1]).toBeChecked();
      expect(radios[1].closest('.option-item')).toHaveClass('selected');
      expect(screen.getByRole('status')).toHaveTextContent('按 Enter 或空白鍵確認答案');
    });

    it('焦點離開選項群組：移到的選項不再是選中的樣子，提示收起', () => {
      const { radios, onSelectAnswer } = renderLocking();
      const outside = document.body.appendChild(document.createElement('button'));
      radios[0].focus();
      fireEvent.keyDown(radios[0], { key: 'ArrowDown' });

      act(() => outside.focus());

      expect(radios[1]).not.toBeChecked();
      expect(document.querySelector('.option-item.selected')).toBeNull();
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      expect(onSelectAnswer).not.toHaveBeenCalled();
      outside.remove();
    });

    it('焦點在選項之間移動：提示留著', () => {
      const { radios } = renderLocking();
      radios[0].focus();
      fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
      fireEvent.keyDown(radios[1], { key: 'ArrowDown' });

      expect(radios[2]).toBeChecked();
      expect(screen.getByRole('status')).toHaveTextContent('按 Enter 或空白鍵確認答案');
    });

    it('移到的選項已經是 checked，再點一次也作答', () => {
      const { onSelectAnswer, radios } = renderLocking();
      radios[0].focus();
      fireEvent.keyDown(radios[0], { key: 'ArrowDown' });

      fireEvent.click(radios[1]);

      expect(onSelectAnswer).toHaveBeenCalledExactlyOnceWith('B');
    });

    it('鍵盤 Tab 進來時就看得到提示；滑鼠聚焦不顯示', () => {
      const { radios } = renderLocking();

      // jsdom 沒有 :focus-visible 的啟發式，用 matches 模擬瀏覽器的判斷
      const matches = vi.spyOn(radios[0], 'matches').mockReturnValue(false);
      act(() => radios[0].focus());
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
      act(() => radios[0].blur());

      matches.mockReturnValue(true);
      act(() => radios[0].focus());
      expect(matches).toHaveBeenCalledWith(':focus-visible');
      expect(screen.getByRole('status')).toHaveTextContent('按 Enter 或空白鍵確認答案');

      act(() => radios[0].blur());
      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it.each([
      ['ArrowUp', 0, 3],
      ['ArrowLeft', 0, 3],
      ['ArrowDown', 3, 0],
      ['ArrowRight', 3, 0],
      ['ArrowRight', 1, 2],
      ['ArrowLeft', 2, 1],
    ])('%s 從第 %i 個移到第 %i 個（頭尾相接）', (key, from, to) => {
      const { radios } = renderLocking();
      radios[from].focus();

      fireEvent.keyDown(radios[from], { key });

      expect(radios[to]).toHaveFocus();
    });

    it.each(['altKey', 'ctrlKey', 'metaKey'])('%s 加方向鍵也攔下、不移動：WebKit 放行就會點下一個選項，直接交卷', (modifier) => {
      const { radios, onSelectAnswer } = renderLocking();
      radios[0].focus();

      expect(fireEvent.keyDown(radios[0], { key: 'ArrowDown', [modifier]: true })).toBe(false);

      expect(radios[0]).toHaveFocus();
      expect(radios[1]).not.toBeChecked();
      expect(onSelectAnswer).not.toHaveBeenCalled();
    });

    it.each([['Enter'], [' ']])('按「%s」才作答，答的是焦點所在的選項，並通知移走焦點', (key) => {
      const { onSelectAnswer, onKeyboardAnswered, radios } = renderLocking();
      radios[0].focus();
      fireEvent.keyDown(radios[0], { key: 'ArrowDown' });
      fireEvent.keyDown(radios[1], { key: 'ArrowDown' });

      expect(fireEvent.keyDown(radios[2], { key })).toBe(false);

      expect(onSelectAnswer).toHaveBeenCalledExactlyOnceWith('C');
      expect(onKeyboardAnswered).toHaveBeenCalledOnce();
    });

    it('滑鼠、觸控與螢幕閱讀器的點擊照舊：點了就作答，不移走焦點', () => {
      const { onSelectAnswer, onKeyboardAnswered } = renderLocking();

      fireEvent.click(screen.getByText(/二氧化碳/));

      expect(onSelectAnswer).toHaveBeenCalledExactlyOnceWith('A');
      expect(onKeyboardAnswered).not.toHaveBeenCalled();
    });

    it('還沒聚焦時提示是空的，不佔版面', () => {
      renderLocking();

      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('提示排在選項前面：放在後面矮視窗看不到', () => {
      renderLocking();

      const [status, group] = [screen.getByRole('status'), screen.getByRole('radiogroup')];
      expect(status.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('作答後提示收起', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          selectedAnswer="A"
          showAnswer
          onSelectAnswer={vi.fn()}
          onKeyboardAnswered={vi.fn()}
        />
      );

      expect(screen.getByRole('status')).toBeEmptyDOMElement();
    });

    it('鍵盤聚焦選項：把整個選項捲進視窗（radio 高度 0，瀏覽器只保一條線）', () => {
      const { radios } = renderLocking();
      const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
      scrollIntoView.mockClear();
      vi.spyOn(radios[1], 'matches').mockReturnValue(true);

      act(() => radios[1].focus());

      expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest' });
      expect(scrollIntoView.mock.contexts[0]).toBe(radios[1].closest('.option-item'));
    });
  });

  describe('可以改答案的模式（沒有 onKeyboardAnswered，考試模式）', () => {
    it('方向鍵交給瀏覽器：不攔、不移動焦點，也沒有提示', () => {
      render(<QuestionCard question={mockQuestion} questionNumber={1} onSelectAnswer={vi.fn()} />);
      const radios = screen.getAllByRole('radio');
      radios[0].focus();

      expect(fireEvent.keyDown(radios[0], { key: 'ArrowDown' })).toBe(true);

      expect(radios[0]).toHaveFocus();
      expect(screen.queryByRole('status')).toBeNull();
    });
  });

  describe('已選擇狀態', () => {
    it('應標示已選擇的選項', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          selectedAnswer="B"
          onSelectAnswer={vi.fn()}
        />
      );

      const optionB = screen.getByRole('radio', { name: /氧氣/ });
      expect(optionB).toBeChecked();
    });

    // #148：考試模式選了 D，D 用的是正確答案的綠色，看起來就像系統說答案是 D。
    // 選取的樣式要有顏色以外的記號（實心的圓點），而且不能帶任何代表「正確」的圖示或字
    it('揭曉前，選取的選項有圓點記號，沒有代表正確的圖示或字；其他選項沒有記號', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          selectedAnswer="D"
          onSelectAnswer={vi.fn()}
        />
      );
      const picked = screen.getByTestId('option-D');
      expect(picked).toHaveClass('selected');
      expect(picked).not.toHaveClass('correct');
      expect(picked.querySelectorAll('.option-selected-mark')).toHaveLength(1);
      // 圓點只是畫面上的記號：radio 本身已是 checked，報讀不再念一次
      expect(picked.querySelector('.option-selected-mark')).toHaveAttribute('aria-hidden', 'true');
      expect(picked.querySelector('.option-icon')).toBeNull();
      expect(picked.textContent).not.toMatch(/check_circle|verified|正確|答對/);
      for (const key of ['A', 'B', 'C']) {
        expect(screen.getByTestId(`option-${key}`).querySelector('.option-selected-mark'), key).toBeNull();
      }
    });

    it('揭曉之後不再顯示選取記號：正確與錯誤的樣式照舊', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          selectedAnswer="D"
          showAnswer={true}
          onSelectAnswer={vi.fn()}
        />
      );
      expect(document.querySelector('.option-selected-mark')).toBeNull();
      expect(screen.getByTestId('option-A')).toHaveClass('correct');
      expect(screen.getByTestId('option-A').querySelector('.option-icon')?.textContent).toBe('check_circle');
      expect(screen.getByTestId('option-D')).toHaveClass('incorrect');
      expect(screen.getByTestId('option-D').querySelector('.option-icon')?.textContent).toBe('cancel');
    });
  });

  describe('答案顯示模式', () => {
    it('showAnswer 時應標示正確答案', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          selectedAnswer="B"
          showAnswer={true}
          onSelectAnswer={vi.fn()}
        />
      );

      // 正確答案（A）應有 correct 樣式
      const optionA = screen.getByTestId('option-A');
      expect(optionA).toHaveClass('correct');

      // 錯誤選擇（B）應有 incorrect 樣式
      const optionB = screen.getByTestId('option-B');
      expect(optionB).toHaveClass('incorrect');
    });

    it('showAnswer 後選項應為禁用狀態', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          selectedAnswer="A"
          showAnswer={true}
          onSelectAnswer={vi.fn()}
        />
      );

      const options = screen.getAllByRole('radio');
      options.forEach((option) => {
        expect(option).toBeDisabled();
      });
    });
  });

  describe('無答案題目', () => {
    const noAnswerQuestion: QuizQuestion = {
      ...mockQuestion,
      answer: null,
      hasAnswer: false,
    };

    it('無答案題目應顯示提示', () => {
      render(
        <QuestionCard
          question={noAnswerQuestion}
          questionNumber={1}
          showAnswer={true}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText(/此題目無標準答案/)).toBeInTheDocument();
    });
  });

  describe('考科標籤', () => {
    it('應顯示考科分類', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );

      expect(screen.getByText(/考科一/)).toBeInTheDocument();
    });
  });

  describe('無障礙', () => {
    it('選項應有正確的 ARIA 屬性', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );

      const radioGroup = screen.getByRole('radiogroup');
      expect(radioGroup).toHaveAttribute('aria-labelledby');

      const options = screen.getAllByRole('radio');
      expect(options).toHaveLength(4);
    });
  });

  describe('作答歷史 chip（Refs #64）', () => {
    // 這些測試在 question-stats-storage 真實 mock 下跑
    // (test-setup 的 vi.fn() 預設會回 undefined → loadStats 視為空)
    it('未作答過的題目顯示「新題目」', () => {
      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );
      expect(screen.getByTestId('question-stat-chip')).toHaveTextContent('新題目');
    });

    it('無標準答案題目（hasAnswer=false）不渲染 chip', () => {
      render(
        <QuestionCard
          question={{ ...mockQuestion, answer: null, hasAnswer: false }}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );
      expect(screen.queryByTestId('question-stat-chip')).not.toBeInTheDocument();
    });

    it('已有 stats 時顯示答對率 + 次數', () => {
      // 安裝 real localStorage 並寫入該題 stats
      const store = new Map<string, string>();
      store.set(
        'ipas-question-stats',
        JSON.stringify({
          version: 1,
          items: { [mockQuestion.id]: { attempts: 5, correct: 3, lastTriedAt: 0 } },
        })
      );
      Object.defineProperty(globalThis, 'localStorage', {
        value: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => store.set(k, v),
          removeItem: (k: string) => {
            store.delete(k);
          },
          clear: () => store.clear(),
          key: (i: number) => Array.from(store.keys())[i] ?? null,
          get length() {
            return store.size;
          },
        },
        writable: true,
        configurable: true,
      });

      render(
        <QuestionCard
          question={mockQuestion}
          questionNumber={1}
          onSelectAnswer={vi.fn()}
        />
      );
      const chip = screen.getByTestId('question-stat-chip');
      expect(chip).toHaveTextContent(/答對率\s*60%/);
      expect(chip).toHaveTextContent(/5 次/);
    });
  });
});

describe('QuestionCard 冗餘前綴 dim 化', () => {
  it('當所有選項共享題幹中的 prefix 時 → 渲染 dim span', () => {
    const griQuestion: QuizQuestion = {
      id: 'test-gri-67',
      stem: 'GRI 準則 2021 之系統架構分為三個系列準則，下列何者正確？',
      options: [
        { key: 'A', text: 'GRI 環境準則、GRI 社會準則、GRI 治理準則' },
        { key: 'B', text: 'GRI 環境準則、GRI 社會準則、GRI 經濟準則' },
        { key: 'C', text: 'GRI 通用準則、GRI 進階準則、GRI 特殊準則' },
        { key: 'D', text: 'GRI 通用準則、GRI 行業準則、GRI 主題準則' },
      ],
      answer: 'D',
      subject: '考科1',
      sourceType: 'gist',
      year: null,
      hasAnswer: true,
    };
    const { container } = render(
      <QuestionCard
        question={griQuestion}
        questionNumber={67}
        onSelectAnswer={vi.fn()}
      />
    );
    const dimSpans = container.querySelectorAll('.option-text__redundant');
    // 4 個選項都該有 dim 前綴
    expect(dimSpans.length).toBe(4);
    dimSpans.forEach((s) => expect(s.textContent).toBe('GRI'));
  });

  it('題幹未含共享 prefix 時 → 不 dim（避免誤殺）', () => {
    const noShareQuestion: QuizQuestion = {
      ...mockQuestion,
      // 題幹是溫室氣體，選項首字各不同，沒共享前綴
    };
    const { container } = render(
      <QuestionCard
        question={noShareQuestion}
        questionNumber={1}
        onSelectAnswer={vi.fn()}
      />
    );
    expect(container.querySelectorAll('.option-text__redundant').length).toBe(0);
  });
});

describe('答案依據（evidence）', () => {
  const withEvidence: QuizQuestion = {
    ...mockQuestion,
    evidence: {
      quote: 'emissions from mobile machinery for transportation purposes shall be excluded.',
      url: 'https://eur-lex.europa.eu/legal-content/en/TXT/?uri=CELEX%3A32025R2547',
    },
  };

  it('揭曉答案後顯示逐字引文與出處連結', () => {
    render(
      <QuestionCard
        question={withEvidence}
        questionNumber={1}
        showAnswer
        onSelectAnswer={vi.fn()}
      />
    );

    expect(screen.getByLabelText('答案依據')).toBeInTheDocument();
    expect(screen.getByText(/mobile machinery for transportation purposes/)).toBeInTheDocument();
    // 出處以可讀標籤呈現（prettifySourceUrl），而不是整條 URL
    const link = screen.getByRole('link', { name: /EU Reg/i });
    expect(link).toHaveAttribute(
      'href',
      'https://eur-lex.europa.eu/legal-content/en/TXT/?uri=CELEX%3A32025R2547'
    );
  });

  it('沒有引文的題目不會出現空的「答案依據」區塊', () => {
    render(
      <QuestionCard
        question={mockQuestion}
        questionNumber={1}
        showAnswer
        onSelectAnswer={vi.fn()}
      />
    );

    expect(screen.queryByLabelText('答案依據')).not.toBeInTheDocument();
  });

  it('還沒揭曉答案時不先劇透依據', () => {
    render(
      <QuestionCard
        question={withEvidence}
        questionNumber={1}
        onSelectAnswer={vi.fn()}
      />
    );

    expect(screen.queryByLabelText('答案依據')).not.toBeInTheDocument();
  });
});

describe('官方公告試題的標記', () => {
  const official: QuizQuestion = {
    ...mockQuestion,
    id: 'S_IPAS_115_01_L11-q001',
    sourceType: 'unique',
    officialExam: { session: '115-01', exam_date: '2026-05-16', subject: 'L11', question_number: 1 },
  };

  it('官方公告試題在題卡上標出是哪一次的官方公告試題', () => {
    render(<QuestionCard question={official} questionNumber={1} onSelectAnswer={vi.fn()} />);
    const tag = screen.getByText('115 年第一次官方公告試題');
    // 圖示只是裝飾：螢幕閱讀器念到的必須只有標籤文字，不能多念出圖示的英文名稱
    const icon = tag.querySelector('.material-icons');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
    const spoken = tag.cloneNode(true) as HTMLElement;
    spoken.querySelectorAll('[aria-hidden="true"]').forEach((n) => n.remove());
    expect(spoken.textContent?.trim()).toBe('115 年第一次官方公告試題');
  });

  it('標籤本身讀得到，而且沒有只在滑鼠懸停時才出現的說明', () => {
    render(<QuestionCard question={official} questionNumber={1} onSelectAnswer={vi.fn()} />);
    const tag = screen.getByText('115 年第一次官方公告試題');
    // getByText 找得到被 hidden／aria-hidden 藏起來的元素：這裡改問無障礙樹
    expect(isInaccessible(tag)).toBe(false);
    // 懸停說明只有滑鼠看得到（鍵盤、觸控、螢幕閱讀器都拿不到）：要說的話都寫在標籤文字裡
    expect(tag).not.toHaveAttribute('title');
  });

  // 這個功能最主要的畫面：作答後的題卡。只測 AnswerEvidence 元件時，題卡不把依據（或 official）傳下去也照樣綠
  it('作答後，題卡的答案依據寫出官方公告的參考答案與出處；作答前不出現', () => {
    const answered: QuizQuestion = {
      ...official,
      evidence: {
        quote: '官方公告試題的題幹？\n(A)甲；(B)乙；(C)丙；(D)丁',
        url: 'https://www.ipas.org.tw/official.pdf',
        official: { kind: 'exam', answer: 'C', reference: '115 年第一次公告試題第一科第 1 題' },
      },
    };
    const { rerender } = render(
      <QuestionCard question={answered} questionNumber={1} onSelectAnswer={vi.fn()} />
    );
    expect(screen.queryByText(/官方公告的參考答案/)).not.toBeInTheDocument();
    rerender(<QuestionCard question={answered} questionNumber={1} showAnswer onSelectAnswer={vi.fn()} />);
    const line = screen.getByText('官方公告的參考答案：(C)（115 年第一次公告試題第一科第 1 題）');
    expect(isInaccessible(line)).toBe(false);
  });

  it('參考樣題在題卡上標出是哪一版；主庫配對的那一題（gist）也一樣', () => {
    const sample: QuizQuestion = {
      ...mockQuestion,
      id: 'S_IPAS_SAMPLE_114_L12-q001',
      sourceType: 'unique',
      officialSample: { edition: '114', subject: 'L12', question_number: 1 },
    };
    for (const q of [sample, { ...sample, id: 'gist-287', sourceType: 'gist' as const }]) {
      const { unmount } = render(<QuestionCard question={q} questionNumber={1} onSelectAnswer={vi.fn()} />);
      const tag = screen.getByText('官方參考樣題（114 年版）');
      expect(isInaccessible(tag)).toBe(false);
      expect(tag.querySelector('.material-icons')).toHaveAttribute('aria-hidden', 'true');
      expect(screen.queryByText(/官方公告試題/), q.id).not.toBeInTheDocument();
      unmount();
    }
  });

  it('作答後，參考樣題的答案依據寫出 PDF 印的解答與出處', () => {
    const answered: QuizQuestion = {
      ...mockQuestion,
      id: 'S_IPAS_SAMPLE_114_L12-q001',
      sourceType: 'unique',
      officialSample: { edition: '114', subject: 'L12', question_number: 1 },
      evidence: {
        quote: '參考樣題的題幹？\n(A)甲；(B)乙；(C)丙；(D)丁\n解答：(B)',
        url: 'https://www.ipas.org.tw/sample.pdf',
        official: { kind: 'sample', answer: 'B', reference: '參考樣題（114 年版）第二科第 1 題' },
      },
    };
    render(<QuestionCard question={answered} questionNumber={1} showAnswer onSelectAnswer={vi.fn()} />);
    expect(isInaccessible(screen.getByText('參考樣題的解答：(B)（參考樣題（114 年版）第二科第 1 題）'))).toBe(false);
  });

  it('其他題目不標：共筆題與主題庫裡不是官方的題目', () => {
    const plainUnique: QuizQuestion = { ...mockQuestion, id: 'S_CHU_06-q001', sourceType: 'unique' };
    for (const q of [mockQuestion, plainUnique]) {
      const { unmount } = render(<QuestionCard question={q} questionNumber={1} onSelectAnswer={vi.fn()} />);
      expect(screen.queryByText(/官方公告試題|參考樣題/), q.id).not.toBeInTheDocument();
      unmount();
    }
  });
});
