// 考科標籤：未分類就顯示「待分類」，不要冒充考科二。
//
// 這支存在的原因：先前 UI 一律寫 `subject === '考科1' ? '考科一' : '考科二'`，
// 於是所有 null 與無法辨識的值都被顯示成考科二 —— 而練習池 154 題裡有 83 題是 null。
import type { ExamSubject } from '../types/quiz';

export function subjectLabel(subject: ExamSubject | null | undefined): string {
  if (subject === '考科1') return '考科一';
  if (subject === '考科2') return '考科二';
  return '待分類';
}

export function subjectClass(subject: ExamSubject | null | undefined): string {
  if (subject === '考科1') return 'subject-1';
  if (subject === '考科2') return 'subject-2';
  return 'subject-unmapped';
}
