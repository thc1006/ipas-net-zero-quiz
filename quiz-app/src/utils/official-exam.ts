// 官方公告試題在畫面上的稱呼。official_exam 由 tools/import_official_exam.py 寫入題庫，
// 場次是「民國年-梯次」（115-01；梯次從 01 起算，schema 與 validator 都擋 00），
// 科目是 iPAS 的科目代號（L11 第一科、L12 第二科）。
// 匯入工具用同一套詞彙寫出每一題官方引文的 note；同目錄的 official-exam.test.ts 拿題庫逐題對帳兩邊。
import type { OfficialExam } from '../types/quiz';

const CHINESE_ORDINAL = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const SUBJECT_NAME: Record<string, string> = { L11: '第一科', L12: '第二科' };

function session(o: OfficialExam): string {
  const [year, round] = o.session.split('-');
  const n = Number(round);
  const ordinal = CHINESE_ORDINAL[n - 1];
  return ordinal ? `${year} 年第${ordinal}次` : `${year} 年第 ${n} 次`;
}

/** 題卡上的標籤：「115 年第一次官方公告試題」 */
export function officialExamLabel(o: OfficialExam): string {
  return `${session(o)}官方公告試題`;
}

/** 題目在那一份 PDF 上的位置：「第一科第 5 題」 */
export function officialExamPlace(o: OfficialExam): string {
  const subject = SUBJECT_NAME[o.subject];
  return subject
    ? `${subject}第 ${o.question_number} 題`
    : `${o.subject} 第 ${o.question_number} 題`;
}

/** 完整出處：「115 年第一次公告試題第一科第 5 題」 */
export function officialExamReference(o: OfficialExam): string {
  return `${session(o)}公告試題${officialExamPlace(o)}`;
}
