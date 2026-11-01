// 問題回報與討論分開：回報開 GitHub issue（.github/ISSUE_TEMPLATE 的範本），討論留在 GitHub Discussions。
// 這裡守三件事：範本合乎 GitHub issue forms 的規則、程式預填的欄位在範本裡真的有，以及沒有地方還把回報導到
// Discussion #1（原本的「Bug & 功能回報區」）。GitHub 遇到不合規則的範本不會報錯給我們，只會在範本選單裡少一個
// 範本；預填的欄位 id 打錯也一樣安靜，表單照常開，只是那一欄是空的。
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, matchesGlob, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import { REPO_URL } from './data/app-meta';
import {
  buildBugReportUrl,
  buildFeedbackUrl,
  DISCUSSIONS_URL,
  REPORT_URL,
  type QuestionFeedbackContext,
} from './utils/feedback-url';

const root = resolve(__dirname, '..', '..');
const templateDir = join(root, '.github', 'ISSUE_TEMPLATE');
// GitHub 照 YAML 1.1 讀範本：沒加引號的 yes、no、on、off 是布林值（1.2 讀成字串）。照 1.1 讀，看到的才是 GitHub 看到的值
const parseTemplate = (text: string): unknown => parse(text, { version: '1.1' });
const readYaml = (file: string): unknown => parseTemplate(readFileSync(join(templateDir, file), 'utf8'));

// repo 現有的標籤與 Discussions 分類（2026-11-01）。GitHub 遇到不存在的標籤不會報錯，issue 只是少了那個標籤；
// 分類寫錯則是連到 404。新增標籤或分類之後，照下面兩個命令的輸出更新：
//   gh label list --limit 200 --json name --jq '.[].name'
//   gh api graphql -f query='query{repository(owner:"thc1006",name:"ipas-net-zero-quiz"){discussionCategories(first:50){nodes{slug}}}}' --jq '.data.repository.discussionCategories.nodes[].slug'
const REPO_LABELS = new Set([
  'bug',
  'content-currency',
  'data-maintenance',
  'documentation',
  'duplicate',
  'enhancement',
  'good first issue',
  'help wanted',
  'invalid',
  'law-drift',
  'question',
  'question-feedback',
  'quiz-app',
  'quiz-app:ci',
  'quiz-app:config',
  'quiz-app:data',
  'quiz-app:frontend',
  'quiz-app:tests',
  'time-sensitive',
  'wontfix',
]);
const DISCUSSION_CATEGORIES = new Set(['announcements', 'general', 'ideas', 'polls', 'q-a', 'show-and-tell']);

type Item = Record<string, unknown> & { type?: unknown; id?: unknown; attributes?: Record<string, unknown> };
const forms = Object.fromEntries(
  readdirSync(templateDir)
    .filter((file) => /\.ya?ml$/.test(file) && file !== 'config.yml')
    .map((file) => [file, readYaml(file) as Record<string, unknown>])
);

// GitHub 文件「Syntax for issue forms」「Syntax for GitHub's form schema」與「Common validation errors when creating
// issue forms」列的規則。每一種欄位可以有哪些 attributes 與 validations、值是什麼型別，照「form schema」那一頁的表
const TOP_KEYS = new Set(['name', 'description', 'title', 'labels', 'assignees', 'projects', 'type', 'body']);
const ITEM_KEYS = new Set(['type', 'id', 'attributes', 'validations']);
type Kind = 'string' | 'boolean' | 'integer' | 'array';
/** [型別, 是否必填] */
type Spec = { attributes: Record<string, [Kind, boolean]>; validations: Record<string, Kind> };
const LABEL: [Kind, boolean] = ['string', true];
const TEXT: [Kind, boolean] = ['string', false];
const SPECS: Record<string, Spec> = {
  markdown: { attributes: { value: ['string', true] }, validations: {} },
  textarea: {
    attributes: { label: LABEL, description: TEXT, placeholder: TEXT, value: TEXT, render: TEXT },
    validations: { required: 'boolean', min_length: 'integer' },
  },
  input: {
    attributes: { label: LABEL, description: TEXT, placeholder: TEXT, value: TEXT },
    validations: { required: 'boolean', min_length: 'integer' },
  },
  dropdown: {
    attributes: { label: LABEL, description: TEXT, multiple: ['boolean', false], options: ['array', true], default: ['integer', false] },
    validations: { required: 'boolean' },
  },
  checkboxes: { attributes: { label: LABEL, description: TEXT, options: ['array', true] }, validations: { required: 'boolean' } },
  upload: { attributes: { label: LABEL, description: TEXT }, validations: { required: 'boolean', accept: 'string' } },
};
const ID = /^[A-Za-z0-9_-]+$/;
const nonEmpty = (v: unknown): boolean => typeof v === 'string' && v.trim() !== '';
/** 字串不能是空的或只有空白（GitHub 的「key must be a string」） */
const isKind = (kind: Kind, v: unknown): boolean =>
  kind === 'string'
    ? nonEmpty(v)
    : kind === 'boolean'
      ? typeof v === 'boolean'
      : kind === 'integer'
        ? Number.isInteger(v)
        : Array.isArray(v) && v.length > 0;
const isMap = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** 一份 issue form 違反的規則（空陣列是合格） */
function formProblems(form: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const key of Object.keys(form)) if (!TOP_KEYS.has(key)) problems.push(`不認得的頂層欄位 ${key}`);
  if (!nonEmpty(form.name)) problems.push('name 要是非空字串');
  if (!nonEmpty(form.description)) problems.push('description 要是非空字串');
  const labels = form.labels;
  if (labels !== undefined) {
    if (!Array.isArray(labels) || labels.length === 0 || !labels.every(nonEmpty)) {
      problems.push('labels 要是非空字串組成的陣列');
    } else if (new Set(labels).size !== labels.length) {
      problems.push('labels 重複');
    }
  }
  const body = form.body;
  if (!Array.isArray(body) || body.length === 0) return [...problems, 'body 不能是空的'];
  const ids: string[] = [];
  const fieldLabels: string[] = [];
  (body as Item[]).forEach((item, i) => {
    const at = `body[${i}]`;
    for (const key of Object.keys(item)) if (!ITEM_KEYS.has(key)) problems.push(`${at} 不認得的欄位 ${key}`);
    const spec = SPECS[item.type as string];
    if (!spec) {
      problems.push(`${at} type 不對：${String(item.type)}`);
      return;
    }
    const attributes = item.attributes;
    if (!isMap(attributes)) {
      problems.push(`${at} 要有 attributes`);
      return;
    }
    for (const [key, value] of Object.entries(attributes)) {
      const rule = spec.attributes[key];
      if (!rule) problems.push(`${at} ${item.type} 不能有 attributes.${key}`);
      else if (!isKind(rule[0], value)) problems.push(`${at} attributes.${key} 要是 ${rule[0]}`);
    }
    for (const [key, [, required]] of Object.entries(spec.attributes)) {
      if (required && !(key in attributes)) problems.push(`${at} 缺少 attributes.${key}`);
    }
    if (item.validations !== undefined) {
      if (item.type === 'markdown' || !isMap(item.validations)) problems.push(`${at} ${item.type} 不能有這樣的 validations`);
      else {
        for (const [key, value] of Object.entries(item.validations)) {
          const kind = spec.validations[key];
          if (!kind) problems.push(`${at} ${item.type} 不能有 validations.${key}`);
          else if (!isKind(kind, value)) problems.push(`${at} validations.${key} 要是 ${kind}`);
        }
      }
    }
    if (item.type === 'markdown') {
      if (item.id !== undefined) problems.push(`${at} markdown 不能有 id`);
      return;
    }
    if (typeof item.id !== 'string' || !ID.test(item.id)) problems.push(`${at} id 只能有英數字、- 與 _`);
    else ids.push(item.id);
    if (nonEmpty(attributes.label)) fieldLabels.push(attributes.label as string);
    const options = attributes.options;
    if (item.type === 'dropdown' && Array.isArray(options)) {
      if (!options.every(nonEmpty)) problems.push(`${at} dropdown 的 options 要是非空字串`);
      else {
        if (new Set(options).size !== options.length) problems.push(`${at} options 重複`);
        // 選填的 dropdown，GitHub 會自己加一個 None；有 default 時也不能有 n/a
        const reserved = attributes.default === undefined ? ['none'] : ['none', 'n/a'];
        if (options.some((o: string) => reserved.includes(o.trim().toLowerCase()))) problems.push(`${at} options 不能有 None`);
      }
      const def = attributes.default;
      if (Number.isInteger(def) && ((def as number) < 0 || (def as number) >= options.length)) {
        problems.push(`${at} default 要是 options 的索引（0 到 ${options.length - 1}）`);
      }
    }
    if (item.type === 'checkboxes' && Array.isArray(options)) {
      options.forEach((option: unknown, j) => {
        const ok =
          isMap(option) &&
          nonEmpty(option.label) &&
          Object.keys(option).every((k) => k === 'label' || (k === 'required' && typeof option.required === 'boolean'));
        if (!ok) problems.push(`${at} options[${j}] 只能有 label（字串）與 required（布林）`);
      });
    }
  });
  if (ids.length === 0) problems.push('body 至少要有一個不是 markdown 的欄位');
  if (new Set(ids).size !== ids.length) problems.push(`id 重複：${ids.join(', ')}`);
  if (new Set(fieldLabels).size !== fieldLabels.length) problems.push(`label 重複：${fieldLabels.join(', ')}`);
  return problems;
}

/** 範本裡可以用網址預填的欄位：GitHub 只預填文字欄位（input、textarea） */
function textFieldIds(form: Record<string, unknown>): string[] {
  return (form.body as Item[])
    .filter((item) => item.type === 'input' || item.type === 'textarea')
    .map((item) => item.id as string);
}

/** 預填網址帶的每一個欄位，在它指定的範本裡都是文字欄位 */
function prefillProblems(url: string): string[] {
  const params = new URL(url).searchParams;
  const template = params.get('template');
  const form = template ? forms[template] : undefined;
  if (!form) return [`找不到範本 ${template}`];
  const fields = textFieldIds(form);
  return [...params.keys()]
    .filter((key) => key !== 'template' && !fields.includes(key))
    .map((key) => `${template} 沒有文字欄位 ${key}`);
}

const bugUrl = buildBugReportUrl({ errorMessage: 'kaboom' });
const questionUrl = buildFeedbackUrl({ questionId: 'gist-1', stem: '題幹', fromPage: 'quiz' });

describe('issue 範本', () => {
  it('題目回報與網站問題兩份範本都在（這一組檢查不是在空轉）', () => {
    expect(Object.keys(forms).sort()).toEqual(['question-feedback.yml', 'site-bug.yml']);
  });

  it.each(Object.keys(forms))('%s 合乎 issue forms 的規則', (file) => {
    expect(formProblems(forms[file])).toEqual([]);
  });

  it('規則檢查抓得到違規的範本', () => {
    const good = forms['site-bug.yml'];
    const body = good.body as Item[];
    const field = body.find((item) => item.type === 'input')!;
    const dropdown = body.find((item) => item.type === 'dropdown')!;
    const textarea = body.find((item) => item.type === 'textarea')!;
    const markdown = body.find((item) => item.type === 'markdown')!;
    /** 把 body 裡的 target 換成 target 加上 patch 的版本 */
    const withItem = (items: Item[], target: Item, patch: Record<string, unknown>): Item[] =>
      items.map((item) => (item === target ? { ...item, ...patch } : item));
    const cases: [string, Record<string, unknown>][] = [
      ['id 重複', { ...good, body: [...body, { ...field, attributes: { label: '另一欄' } }] }],
      ['label 重複', { ...good, body: [...body, { ...field, id: 'another' }] }],
      ['id 只能有', { ...good, body: [...body, { ...field, id: '網站', attributes: { label: '另一欄' } }] }],
      ['不認得的頂層欄位', { ...good, input: 'x' }],
      ['labels 要是', { ...good, labels: [] }],
      ['labels 重複', { ...good, labels: ['bug', 'bug'] }],
      ['name 要是', { ...good, name: ' ' }],
      ['不能有 None', { ...good, body: body.map((it) => (it === dropdown ? { ...it, attributes: { ...it.attributes, options: ['None', '其他'] } } : it)) }],
      ['body 至少要有', { ...good, body: body.filter((item) => item.type === 'markdown') }],
      ['type 不對', { ...good, body: [...body, { type: 'select', id: 'x', attributes: { label: 'x' } }] }],
      // 以下是複審的突變：GitHub 不收，原本的檢查照樣綠
      ['input 不能有 attributes.render', { ...good, body: withItem(body, field, { attributes: { ...field.attributes, render: 'text' } }) }],
      ['markdown 不能有這樣的 validations', { ...good, body: withItem(body, markdown, { validations: { required: true } }) }],
      ['validations.required 要是 boolean', { ...good, body: withItem(body, textarea, { validations: { required: 'yes please' } }) }],
      ['textarea 不能有 attributes.rows', { ...good, body: withItem(body, textarea, { attributes: { ...textarea.attributes, rows: 5 } }) }],
      ['default 要是 options 的索引', { ...good, body: withItem(body, dropdown, { attributes: { ...dropdown.attributes, default: 9 } }) }],
      ['default 要是 options 的索引', { ...good, body: withItem(body, dropdown, { attributes: { ...dropdown.attributes, default: -1 } }) }],
      ['attributes.default 要是 integer', { ...good, body: withItem(body, dropdown, { attributes: { ...dropdown.attributes, default: '1' } }) }],
      ['input 不能有 validations.accept', { ...good, body: withItem(body, field, { validations: { accept: '.png' } }) }],
      ['markdown 不能有 id', { ...good, body: withItem(body, markdown, { id: 'intro' }) }],
      ['缺少 attributes.label', { ...good, body: withItem(body, field, { attributes: { description: 'x' } }) }],
      ['attributes.label 要是 string', { ...good, body: withItem(body, field, { attributes: { label: 3 } }) }],
      ['options[0] 只能有', { ...good, body: [...body, { type: 'checkboxes', id: 'agree', attributes: { label: '同意', options: ['x'] } }] }],
    ];
    for (const [expected, form] of cases) {
      expect(formProblems(form).join('\n'), expected).toContain(expected);
    }
  });

  it('照 YAML 1.1 讀：沒加引號的 yes、no 是布林值，GitHub 不收這樣的 dropdown 選項', () => {
    const text = [
      'name: 測試',
      'description: 測試',
      'body:',
      '  - type: dropdown',
      '    id: reproducible',
      '    attributes:',
      '      label: 可以重現嗎',
      '      options:',
      '        - yes',
      '        - no',
    ].join('\n');
    // 照 YAML 1.2 讀會是兩個字串，檢查就放過了
    expect(formProblems(parse(text) as Record<string, unknown>)).toEqual([]);
    expect(formProblems(parseTemplate(text) as Record<string, unknown>)).toEqual([
      'body[0] dropdown 的 options 要是非空字串',
    ]);
  });

  it('標籤是 repo 現有的標籤：網站問題標 bug 與 quiz-app:frontend，題目回報標 question-feedback 與 quiz-app:data', () => {
    const labels = Object.fromEntries(Object.entries(forms).map(([file, form]) => [file, form.labels]));
    expect(labels).toEqual({
      'question-feedback.yml': ['question-feedback', 'quiz-app:data'],
      'site-bug.yml': ['bug', 'quiz-app:frontend'],
    });
    for (const label of Object.values(labels).flat()) expect(REPO_LABELS, String(label)).toContain(label);
  });

  it('教使用者選什麼的地方，只寫得出真的有的範本、選項與欄位：README 的回報段落、範本的說明與 markdown', () => {
    const names = Object.values(forms).map((form) => String(form.name));
    for (const form of Object.values(forms)) expect(form.title).toBe(`[${String(form.name)}] `);
    const options = (form: Record<string, unknown>): string[] =>
      (form.body as Item[]).flatMap((item) => (item.type === 'dropdown' ? (item.attributes?.options as string[]) : []));
    // README：權利人那一段到「回報問題與討論」一節結束。只能寫範本名稱與 dropdown 的選項（回報類型選「其他」）
    const readme = readFileSync(join(root, 'README.md'), 'utf8');
    const from = readme.indexOf('若您是權利人');
    const heading = readme.indexOf('\n## 回報問題與討論\n');
    expect(from, '找不到權利人那一段').toBeGreaterThan(-1);
    expect(heading, '找不到回報問題與討論').toBeGreaterThan(from);
    const next = readme.indexOf('\n## ', heading + 1);
    const section = readme.slice(from, next === -1 ? undefined : next);
    const readmeQuoted = quotedIn(section);
    const allowed = new Set([...names, ...Object.values(forms).flatMap(options)]);
    for (const name of names) expect(readmeQuoted, `README 沒告訴使用者選「${name}」`).toContain(name);
    expect(readmeQuoted.filter((quoted) => !allowed.has(quoted))).toEqual([]);
    // 範本的 description 與 markdown：另外可以寫自己的欄位名稱（label 去掉後面的括號說明）
    for (const [file, form] of Object.entries(forms)) {
      const body = form.body as Item[];
      const labels = body.map((item) => String(item.attributes?.label ?? '').replace(/（[^）]*）$/, '')).filter(Boolean);
      const own = new Set([...names, ...options(form), ...labels]);
      const texts = [form.description, ...body.filter((item) => item.type === 'markdown').map((item) => item.attributes?.value)];
      const quoted = texts.flatMap((text) => quotedIn(String(text)));
      expect(quoted.filter((q) => !own.has(q)), file).toEqual([]);
      // 欄位的 description 也會寫畫面上的名稱（設定頁的「關於」），只看叫人選或用什麼的地方：選「其他」、用「題目回報」
      const picked = body.flatMap((item) => quotedIn(String(item.attributes?.description ?? ''), String.raw`[選用]`));
      expect(picked.filter((q) => !own.has(q)), `${file} 欄位的 description`).toEqual([]);
    }
  });

  it('名稱檢查認得每一種引號，欄位的 description 只看選或用後面的名稱', () => {
    expect(quotedIn('選「甲」或『乙』，或 "丙" 與“丁”')).toEqual(['甲', '乙', '丙', '丁']);
    expect(quotedIn('設定頁的「關於」，若選「其它」或用『題目錯誤回報』', String.raw`[選用]`)).toEqual(['其它', '題目錯誤回報']);
  });

  it('題目回報的「從哪個頁面回報」，說明與範例寫的是程式會帶入的值', () => {
    // 少列或多列 fromPage 的值，tsc 會報錯
    const fromPages = { quiz: true, result: true } satisfies Record<QuestionFeedbackContext['fromPage'], true>;
    const field = (forms['question-feedback.yml'].body as Item[]).find((item) => item.id === 'from_page');
    expect(field?.type).toBe('input');
    for (const fromPage of Object.keys(fromPages) as QuestionFeedbackContext['fromPage'][]) {
      const sent = new URL(buildFeedbackUrl({ questionId: 'gist-1', stem: '題幹', fromPage })).searchParams.get('from_page');
      expect(sent).toBe(fromPage);
      expect(field?.attributes?.description, fromPage).toContain(fromPage);
      expect(field?.attributes?.placeholder, fromPage).toContain(fromPage);
    }
  });

  it('程式預填的每一個欄位，在範本裡都是文字欄位', () => {
    expect(new URL(bugUrl).searchParams.has('error_message')).toBe(true);
    expect(prefillProblems(bugUrl)).toEqual([]);
    expect(prefillProblems(questionUrl)).toEqual([]);
  });

  it('預填檢查抓得到範本裡沒有的欄位', () => {
    const url = new URL(bugUrl);
    url.searchParams.set('page', '首頁'); // 有這個 id，但它是 dropdown
    url.searchParams.set('version', '1.0.0');
    expect(prefillProblems(url.href)).toEqual(['site-bug.yml 沒有文字欄位 page', 'site-bug.yml 沒有文字欄位 version']);
    url.searchParams.set('template', 'bug.yml');
    expect(prefillProblems(url.href)).toEqual(['找不到範本 bug.yml']);
  });

  it('範本裡的 GitHub 連結都指向這個 repo', () => {
    const links = readdirSync(templateDir).flatMap((file) =>
      [...readFileSync(join(templateDir, file), 'utf8').matchAll(/https:\/\/github\.com\/[^\s)"'>]*/g)].map(([link]) => link)
    );
    expect(links, '找不到任何 GitHub 連結：這條測試在空轉').toContain(DISCUSSIONS_URL);
    expect(links.filter((link) => !link.startsWith(`${REPO_URL}/`))).toEqual([]);
  });
});

describe('範本選單（config.yml）', () => {
  const config = readYaml('config.yml') as { blank_issues_enabled?: unknown; contact_links?: Record<string, unknown>[] };

  it('不開空白 issue：只能從範本開', () => {
    expect(config.blank_issues_enabled).toBe(false);
  });

  it('提問、讀書討論與功能建議導到討論區', () => {
    const links = config.contact_links ?? [];
    expect(links.map((link) => link.name)).toEqual(['使用問題', '讀書討論', '功能建議']);
    expect(links.length, '沒有任何 contact link').not.toBe(0);
    for (const link of links) {
      expect(Object.keys(link).sort()).toEqual(['about', 'name', 'url']);
      expect(nonEmpty(link.name) && nonEmpty(link.about), JSON.stringify(link)).toBe(true);
      expect(String(link.url).startsWith(DISCUSSIONS_URL), String(link.url)).toBe(true);
    }
    expect(Object.keys(config).sort()).toEqual(['blank_issues_enabled', 'contact_links']);
  });

  it('三個連結依序是討論區的 Q&A、General、Ideas，分類都存在', () => {
    const prefix = `${DISCUSSIONS_URL}/categories/`;
    const slugs = (config.contact_links ?? []).map((link) => {
      const url = String(link.url);
      expect(url.startsWith(prefix), url).toBe(true);
      return url.slice(prefix.length);
    });
    expect(slugs).toEqual(['q-a', 'general', 'ideas']);
    for (const slug of slugs) expect(DISCUSSION_CATEGORIES, slug).toContain(slug);
  });
});

/** 用引號括起來的名稱：「」、『』、""、“”。before 有給時，只取緊接在它後面的（例如選「其他」） */
function quotedIn(text: string, before = ''): string[] {
  const quote = String.raw`「([^」]+)」|『([^』]+)』|"([^"]+)"|“([^”]+)”`;
  return [...text.matchAll(new RegExp(before ? `${before}(?:${quote})` : quote, 'g'))].map((m) => m.slice(1).find(Boolean)!);
}

// 回報導到 Discussion #1 的寫法：/discussions/1 後面不能再接數字（/discussions/12 是另一串）
const DISCUSSION_ONE = new RegExp(String.raw`/discussions/1(?![0-9])`);

/** 告訴使用者去哪裡回報、去哪裡討論的檔案（相對 repo 根目錄） */
function reportingFiles(): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(join(root, dir), { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => relative(root, join(entry.parentPath, entry.name)).split('\\').join('/'));
  // src 只看程式與樣式，不看題庫 JSON：題目的出處可以是討論串裡的某一則留言（主題庫就有一題引用
  // discussions/1#discussioncomment-...），那是出處，不是回報入口。測試檔也不看（裡面有舊網址當測試資料）
  const src = walk('quiz-app/src').filter((file) => /\.(tsx?|css)$/.test(file) && !/\.test\.tsx?$/.test(file));
  const singles = ['README.md', 'quiz-app/index.html', 'quiz-app/package.json'];
  for (const file of singles) expect(statSync(join(root, file)).isFile(), file).toBe(true);
  return [...src, ...walk('quiz-app/public'), ...walk('.github/ISSUE_TEMPLATE'), ...singles];
}

/** README 裡的 Markdown 連結：[文字](網址) */
const readmeLinks = (): [string, string][] =>
  [...readFileSync(join(root, 'README.md'), 'utf8').matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)].map(([, text, href]) => [text, href]);

describe('回報不再導到 Discussion #1', () => {
  const files = reportingFiles();

  it('掃描範圍涵蓋所有回報入口（這條測試不是在空轉）', () => {
    for (const file of [
      'README.md',
      'quiz-app/package.json',
      'quiz-app/public/llms.txt',
      'quiz-app/src/App.tsx',
      'quiz-app/src/components/Header/Header.tsx',
      'quiz-app/src/pages/SettingsPage.tsx',
      'quiz-app/src/components/ErrorBoundary/ErrorBoundary.tsx',
      '.github/ISSUE_TEMPLATE/config.yml',
    ]) {
      expect(files).toContain(file);
    }
    expect(files.filter((file) => /\.test\.tsx?$|src\/data\/.*\.json$/.test(file))).toEqual([]);
  });

  it('改到這些檔案的 PR 會觸發 CI：quiz-app-ci.yml 的 paths 涵蓋每一個掃描的檔案', () => {
    // paths 漏列不會報錯，只會讓「只改範本或 README」的 PR 安靜地略過這支測試
    const ci = parse(readFileSync(join(root, '.github', 'workflows', 'quiz-app-ci.yml'), 'utf8')) as {
      on: Record<string, { paths?: string[] }>;
    };
    for (const event of ['pull_request', 'push']) {
      const paths = ci.on[event]?.paths ?? [];
      expect(paths.length, `${event} 沒有 paths：這條測試在空轉`).not.toBe(0);
      const uncovered = files.filter((file) => !paths.some((glob) => matchesGlob(file, glob)));
      expect(uncovered, `${event}.paths 沒有涵蓋`).toEqual([]);
    }
  });

  it('README 的回報連結開 issue 範本選單，討論連結開 Discussions', () => {
    const links = readmeLinks();
    expect(links).toContainEqual(['開 issue', REPORT_URL]);
    expect(links).toContainEqual(['Discussions', DISCUSSIONS_URL]);
    expect(links.filter(([text]) => text === '開 issue' || text === 'Discussions')).toHaveLength(2);
  });

  it('README 叫權利人選的回報類型「其他」，題目回報範本真的有這一項', () => {
    expect(readFileSync(join(root, 'README.md'), 'utf8')).toContain('回報類型選「其他」');
    const form = readYaml('question-feedback.yml') as {
      body: { id?: string; attributes: { label?: string; options?: string[] } }[];
    };
    const kinds = form.body.find((item) => item.attributes.label === '回報類型')?.attributes.options;
    expect(kinds).toContain('其他');
  });

  it('沒有任何檔案連到 Discussion #1', () => {
    const hits = files.filter((file) => DISCUSSION_ONE.test(readFileSync(join(root, file), 'utf8')));
    expect(hits).toEqual([]);
  });

  it('樣式比對抓得到 Discussion #1 的各種寫法，不會誤抓其他討論串', () => {
    for (const hit of ['/discussions/1', '/discussions/1)', '/discussions/1#top', '/discussions/1?x=1', '/discussions/1"']) {
      expect(DISCUSSION_ONE.test(`${REPO_URL}${hit}`), hit).toBe(true);
    }
    for (const miss of ['/discussions/12', '/discussions/categories/ideas', '/discussions', '/issues/1']) {
      expect(DISCUSSION_ONE.test(`${REPO_URL}${miss}`), miss).toBe(false);
    }
  });

  it('出貨的程式不寫死 repo 網址：一律從 app-meta 的 REPO_URL 組出來', () => {
    const literal = REPO_URL.replace(/^https:\/\//, '');
    const src = files.filter((file) => file.startsWith('quiz-app/src/') && /\.tsx?$/.test(file));
    expect(src).toContain('quiz-app/src/data/app-meta.ts');
    expect(src.filter((file) => readFileSync(join(root, file), 'utf8').includes(literal))).toEqual([]);
  });
});
