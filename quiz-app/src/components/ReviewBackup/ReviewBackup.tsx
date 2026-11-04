// 設定頁的星號與待複習錯題：匯出、匯入、清除（Discussion #1）。
// 匯入先檢查、再顯示題數，確認後才合併；清除與「清除作答統計」共用確認對話框，兩邊互不影響。
import { useRef, useState } from 'react';
import { allQuestions, hasIdsOutsideMainBank } from '../../data/questions';
import { NOTICE_TEXT } from '../../hooks/useReview';
import { loadPracticePool } from '../../utils/practice-pool';
import {
  clearStars,
  clearWrong,
  getReviewSnapshot,
  mergeReview,
  previewMerge,
  type ReviewMergeCount,
} from '../../utils/review-storage';
import {
  buildReviewExport,
  countUnknownIds,
  readReviewImport,
  reviewExportFileName,
  type ReviewImportResult,
} from '../../utils/review-transfer';
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog';
import './ReviewBackup.css';

type ReviewBackupData = Extract<ReviewImportResult, { ok: true }>;

const countText = (r: { stars: object; wrong: object }): string =>
  `星號 ${Object.keys(r.stars).length} 題、待複習錯題 ${Object.keys(r.wrong).length} 題`;

const addedText = (c: ReviewMergeCount): string => `新增星號 ${c.stars} 題、待複習錯題 ${c.wrong} 題`;

const nothingAdded = (c: ReviewMergeCount): boolean => c.stars + c.wrong === 0;

const UNREADABLE = '讀不到這個瀏覽器裡的紀錄，瀏覽器可能封鎖了網站資料。';

/** 備份裡有幾題現在的題庫找不到。練習池載不到時不知道，回傳 null，不亂說 */
async function unknownCount(data: ReviewBackupData): Promise<number | null> {
  if (!hasIdsOutsideMainBank([...Object.keys(data.stars), ...Object.keys(data.wrong)])) return 0;
  try {
    const pool = await loadPracticePool();
    return countUnknownIds(data, new Set([...allQuestions, ...pool.items].map((q) => q.id)));
  } catch {
    return null;
  }
}

type Pending =
  | { kind: 'clear-stars' }
  | { kind: 'clear-wrong' }
  | { kind: 'import'; data: ReviewBackupData; adds: ReviewMergeCount; unknown: number | null };

function importBody({ data, adds, unknown }: Extract<Pending, { kind: 'import' }>): string {
  return [
    `備份裡有${countText(data)}`,
    nothingAdded(adds) ? '。備份裡的題目都已經在清單裡，不會新增。' : `，會${addedText(adds)}。`,
    '現有的紀錄不會被刪除，同一題留時間較新的。已經移出待複習的題目如果在備份裡，會回到待複習。',
    unknown ? `有 ${unknown} 題在目前的題庫找不到，會保留但不會出題。` : '',
  ].join('');
}

export function ReviewBackup() {
  const [message, setMessage] = useState('');
  const [pending, setPending] = useState<Pending | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLButtonElement>(null);

  const handleExport = () => {
    const now = new Date();
    // 重讀：另一個分頁剛寫的，這裡可能還沒收到 storage 事件，備份不能少那幾筆
    const current = getReviewSnapshot();
    // 讀不到不等於沒有：匯出一份空的備份還說「已匯出」，使用者會以為存好了
    if (current.access === 'unavailable') {
      setMessage(`沒有匯出：${UNREADABLE}`);
      return;
    }
    const blob = new Blob([buildReviewExport(current, now)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = reviewExportFileName(now);
    a.click();
    // 下載是非同步開始的，立刻 revoke 會讓 Safari 下載失敗
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMessage(`已匯出：${countText(current)}。`);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // 不清空的話，同一個檔案再選一次不會觸發 change
    if (!file) return;
    setMessage('');
    // 讀不到現有的紀錄就存不進去：確認對話框會把備份裡每一題都算成新增，按了確定才說沒有匯入
    if (getReviewSnapshot().access === 'unavailable') {
      setMessage(`沒有匯入：${UNREADABLE}`);
      return;
    }
    const result = await readReviewImport(file);
    if (!result.ok) {
      setMessage(`沒有匯入：${result.reason}`);
      return;
    }
    const unknown = await unknownCount(result);
    // 選檔視窗關掉後焦點不一定回到頁面上，對話框關閉時要回到匯入按鈕
    importRef.current?.focus();
    setPending({ kind: 'import', data: result, adds: previewMerge(result), unknown });
  };

  // 清除與匯入的結果都只在下面的狀態列說：不另外加星號的提示，螢幕閱讀器也只念這一列。
  // 寫入之前重讀：另一個分頁剛寫的新版資料或壞資料，這裡可能還沒收到 storage 事件
  const confirm = () => {
    if (!pending) return;
    setPending(null);
    const { access } = getReviewSnapshot();
    const notSaved =
      access === 'newer'
        ? '這份紀錄是新版網站寫入的，目前的版本只能讀取。'
        : '瀏覽器沒有存進去，可能封鎖了網站資料或儲存空間已滿。';
    // 讀不懂的紀錄在寫入時搬到另一個位置，清單從空的開始：寫進去了就要說
    const recovered = access === 'corrupt' ? NOTICE_TEXT.recovered : '';
    if (pending.kind === 'import') {
      const added = mergeReview(pending.data);
      if (!added) setMessage(`沒有匯入：${notSaved}`);
      else if (nothingAdded(added)) setMessage(`${recovered}沒有新增：備份裡的題目都已經在清單裡。`);
      else setMessage(`${recovered}已合併：${addedText(added)}。`);
    } else if (pending.kind === 'clear-stars') {
      setMessage(clearStars() ? `${recovered}已清除星號。` : `沒有清除：${notSaved}`);
    } else {
      setMessage(clearWrong() ? `${recovered}已清除待複習錯題。` : `沒有清除：${notSaved}`);
    }
  };

  return (
    <>
      <section className="settings-section card">
        <h2>星號與待複習錯題</h2>
        <p className="setting-desc">
          資料只存在這個瀏覽器，不會上傳。瀏覽器可能清掉網站資料，換裝置也帶不走，匯出的檔案就是備份。
        </p>

        <div className="setting-item">
          <div className="setting-info">
            <span className="material-icons">save_alt</span>
            <div>
              <p className="setting-title">備份</p>
              <p className="setting-desc">匯入是合併：現有的紀錄不會被刪除，同一題留時間較新的。</p>
            </div>
          </div>
          <div className="review-backup__actions">
            <button type="button" className="btn btn-secondary" onClick={handleExport}>
              <span className="material-icons" aria-hidden="true">download</span>
              匯出備份
            </button>
            <button
              ref={importRef}
              type="button"
              className="btn btn-secondary"
              onClick={() => fileRef.current?.click()}
            >
              <span className="material-icons" aria-hidden="true">upload</span>
              匯入備份
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              aria-label="選擇備份檔"
              hidden
              onChange={handleFile}
            />
          </div>
        </div>

        <div className="setting-item">
          <div className="setting-info">
            <span className="material-icons">delete_sweep</span>
            <div>
              <p className="setting-title">清除</p>
              <p className="setting-desc">不影響作答統計。</p>
            </div>
          </div>
          <div className="review-backup__actions">
            <button type="button" className="btn btn-secondary" onClick={() => setPending({ kind: 'clear-stars' })}>
              清除星號
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => setPending({ kind: 'clear-wrong' })}>
              清除待複習錯題
            </button>
          </div>
        </div>

        <p className="review-backup__status" role="status" aria-live="polite" aria-atomic="true">
          {message}
        </p>
      </section>

      {pending?.kind === 'import' && (
        <ConfirmDialog
          title="合併這份備份？"
          confirmLabel="確定合併"
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        >
          {importBody(pending)}
        </ConfirmDialog>
      )}
      {pending?.kind === 'clear-stars' && (
        <ConfirmDialog
          title="清除星號？"
          confirmLabel="確定清除"
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        >
          所有星號都會刪除，此動作無法復原。
        </ConfirmDialog>
      )}
      {pending?.kind === 'clear-wrong' && (
        <ConfirmDialog
          title="清除待複習錯題？"
          confirmLabel="確定清除"
          onConfirm={confirm}
          onCancel={() => setPending(null)}
        >
          待複習清單會清空，此動作無法復原，之後答錯的題目才會再列入。
        </ConfirmDialog>
      )}
    </>
  );
}

export default ReviewBackup;
