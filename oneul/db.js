import Dexie from './vendor/dexie.mjs';

/**
 * Offline data contract, backup format v2:
 * { format: 'oneul', version: 2, exportedAt: <epoch milliseconds>, tables: {
 *   checkin: [], dailyLog: [], journal: [], goal: [], milestone: [], task: [],
 *   goalTouch: [], notToDo: [], notToDoLog: [], weekly: [], question: [], meta: []
 * } }
 * All tables are required, including empty ones. IDs are positive safe integers;
 * dates are real YYYY-MM-DD local calendar dates; scores are optional, 0–3.
 * Optional fields may be absent or null. Unknown JSON fields are retained.
 * Import is a complete, atomic replacement, not a merge. No browser DOM APIs.
 */
export const DOMAINS = Object.freeze([
  '건강', '마음', '영적', '공부·기술', '대인관계', '업무', '돈', '취미',
]);
export const ICONS = Object.freeze({
  건강: 'heart-pulse', 마음: 'smile', 영적: 'sun', '공부·기술': 'book-open',
  대인관계: 'users', 업무: 'briefcase', 돈: 'wallet', 취미: 'palette',
});
export const BLOCKER_TYPES = Object.freeze(['시간', '에너지', '사람', '돈', '습관', '감정', '두려움', '모름']);

const SCHEMA = Object.freeze({
  checkin: '[date+domain],date,domain',
  dailyLog: 'date',
  journal: 'date',
  goal: '++id,status',
  milestone: '++id,goalId',
  task: '++id,milestoneId',
  goalTouch: '[date+goalId],date,goalId',
  notToDo: '++id,goalId',
  notToDoLog: '[date+notToDoId],date,notToDoId',
  weekly: 'weekStart',
  question: '++id,domain,order',
  meta: 'key',
});
const TABLES = Object.freeze(Object.keys(SCHEMA));
const SEED_KEY = 'oneul.defaultQuestions.v2';
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
const record = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype ||
  Object.getPrototypeOf(value) === null);
const present = value => value !== undefined && value !== null;
const pad = n => String(n).padStart(2, '0');

function dateKey(date) {
  const year = date.getFullYear();
  if (!Number.isFinite(date.getTime()) || year < 1 || year > 9999) {
    throw new RangeError('날짜는 0001년부터 9999년 사이여야 합니다.');
  }
  return `${String(year).padStart(4, '0')}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseDate(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    throw new RangeError(`올바른 날짜 형식이 아닙니다: ${String(key)} (YYYY-MM-DD)`);
  }
  const [y, m, d] = key.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(y, m - 1, d);
  date.setHours(12, 0, 0, 0);
  if (y < 1 || date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
    throw new RangeError(`존재하지 않는 날짜입니다: ${key}`);
  }
  return date;
}

/** Local calendar date after subtracting hour local wall-clock hours (day boundary). */
export function localDate(date = new Date(), hour = 0) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('유효한 Date 객체가 필요합니다.');
  }
  if (!Number.isFinite(hour)) throw new TypeError('기준 시간은 유한한 숫자여야 합니다.');
  const copy = new Date(date.getTime());
  // setHours truncates fractional hours, so convert to minutes explicitly.
  copy.setMinutes(copy.getMinutes() - hour * 60);
  return dateKey(copy);
}

export function shiftDate(key, days) {
  if (!Number.isSafeInteger(days)) throw new TypeError('이동 일수는 안전한 정수여야 합니다.');
  const date = parseDate(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function shiftMonth(key, delta) {
  if (!Number.isSafeInteger(delta)) throw new TypeError('이동 개월 수는 안전한 정수여야 합니다.');
  const date = parseDate(key);
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + delta);
  const end = new Date(date.getTime());
  end.setMonth(end.getMonth() + 1, 0);
  date.setDate(Math.min(day, end.getDate()));
  return dateKey(date);
}

/** b minus a in calendar days; independent of 23/25-hour DST days. */
export function dayDiff(a, b) {
  const ordinal = key => {
    const local = parseDate(key);
    const utc = new Date(0);
    utc.setUTCFullYear(local.getFullYear(), local.getMonth(), local.getDate());
    utc.setUTCHours(0, 0, 0, 0);
    return utc.getTime() / 86400000;
  };
  return ordinal(b) - ordinal(a);
}

const q = (domain, key, text, kind = 'text', options = [], multi = false) =>
  ({ domain, key, text, kind, options, multi, active: true });
// Semantic keys are stable within a domain; numeric IDs are allocated by Dexie.
const DEFAULT_QUESTIONS = [
  q('건강', 'pain', '아픈 곳·불편한 곳?', 'chips', ['없음', '머리', '목·어깨', '허리', '위장', '무릎·관절', '피로']),
  q('건강', 'cause', '원인으로 짐작되는 건?', 'chips', ['수면 부족', '과식·야식', '운동 부족', '스트레스', '자세', '술', '모름']),
  q('건강', 'measure', '조치는?', 'chips', ['쉬기', '스트레칭', '병원·약', '운동', '일찍 자기']),
  q('건강', 'sleep', '어젯밤 수면', 'chips', ['5↓', '6', '7', '8↑']),
  q('건강', 'movement', '오늘 움직임', 'chips', ['없음', '걷기', '운동']),
  q('마음', 'emotion', '지금 내 마음은?', 'chips', ['평안', '기쁨', '감사', '설렘', '불안', '짜증', '서운함', '슬픔', '지침', '외로움'], true),
  q('마음', 'stress', '스트레스 정도', 'chips', ['낮음', '보통', '높음', '터지기 직전']),
  q('마음', 'cause', '무엇 때문에?', 'chips', ['일', '사람', '돈', '건강', '미래 걱정', '나 자신', '모름']),
  q('마음', 'control', '그중 내가 통제할 수 있는 부분은?', 'chips', ['전부', '일부', '없음 → 맡겨 드리기']),
  q('마음', 'lastword', '지금 나에게 해 주고 싶은 한마디'),
  q('영적', 'jesus', '오늘 그 상황에서 예수님이라면 어떻게 하셨을까?'),
  q('영적', 'reflect', '오늘 하루를 들고 하나님 앞에 선다면, 부끄러운 것은? 감사한 것은?'),
  q('영적', 'prayer', '말씀·기도', 'chips', ['했음', '짧게', '못함']),
  q('영적', 'verse', '오늘 붙잡은 말씀 한 구절'),
  q('영적', 'surrender', '맡겨 드릴 것 (내가 통제할 수 없는 것)'),
  q('공부·기술', 'learned', '오늘 배운 것 한 줄'),
  q('공부·기술', 'skill', '목표에 필요한 기술 중 지금 가장 부족한 하나는?'),
  q('공부·기술', 'applied', '배운 걸 실제로 써먹었나?', 'yesno', ['예', '아니오']),
  q('공부·기술', 'time', '투자한 시간', 'chips', ['0', '15분', '30분', '1시간', '2시간↑']),
  q('대인관계', 'person', '오늘 마음 쓰인 사람'),
  q('대인관계', 'tag', '관계 태그', 'chips', ['가족', '회사', '친구', '교회']),
  q('대인관계', 'listening', '먼저 이해하려고 들었나, 내 말부터 했나?', 'chips', ['먼저 들음', '반반', '내 말부터']),
  q('대인관계', 'action', '막힌 관계에서 내가 할 수 있는 한 가지는?'),
  q('대인관계', 'praise', '감사·칭찬을 전한 사람'),
  q('업무', 'value', '가장 가치 있는 일에 시간을 썼나?', 'chips', ['예', '일부', '아니오']),
  q('업무', 'timewaste', '시간을 가장 많이 잡아먹은 것은?'),
  q('업무', 'delegate', '그만두거나 넘길 수 있는 일은?'),
  q('업무', 'tomorrow', '내일 출근하면 맨 먼저 할 일'),
  q('돈', 'amount', '오늘 쓴 돈 (금액, 선택)', 'number'),
  q('돈', 'spending', '지출의 성격', 'chips', ['필요', '원함', '충동']),
  q('돈', 'income', '수입이나 자산을 늘리려고 한 행동은?'),
  q('돈', 'worry', '돈 걱정 하나와, 그중 내가 통제할 수 있는 부분은?'),
  q('돈', 'principle', '이번 달 지키기로 한 원칙을 지켰나?', 'yesno', ['예', '아니오']),
  q('취미', 'activity', '무엇을 했나?', 'chips', []),
  q('취미', 'after', '하고 나서', 'chips', ['충전됨', '그대로', '더 지침']),
  q('취미', 'rest', '회복이었나, 도피였나?', 'chips', ['회복', '도피']),
].map((question, index, all) => ({
  ...question,
  order: all.slice(0, index).filter(previous => previous.domain === question.domain).length,
  ...(question.domain === '취미' && question.key === 'activity' ? { allowCustom: true } : {}),
}));

function joinText(a, b) {
  if (!present(a) || a === '') return b;
  if (!present(b) || b === '' || a === b) return a;
  return `${a}\n\n${b}`;
}

/** Highest score wins; a current-domain row wins ties. Never discard answers. */
function mergeCheckins(rows, domain) {
  const ranked = [...rows].sort((a, b) =>
    (Number.isFinite(b.score) ? b.score : -Infinity) -
      (Number.isFinite(a.score) ? a.score : -Infinity) ||
    Number(b.domain === domain) - Number(a.domain === domain) ||
    String(a.domain).localeCompare(String(b.domain), 'ko'));
  const winner = ranked[0];
  const merged = { ...winner, domain };
  const answers = Object.create(null);
  // Lower-priority answers fill missing keys; the winning answer keeps its key.
  for (const row of [...ranked].reverse()) {
    if (record(row.answers)) {
      for (const [key, value] of Object.entries(row.answers)) answers[key] = value;
    }
  }
  if (ranked.some(row => present(row.answers))) {
    merged.answers = { ...answers };
  }
  for (const field of ['memo', 'notes']) {
    const values = [...new Set(ranked.map(row => row[field]).filter(value => present(value) && value !== ''))];
    if (values.length) merged[field] = values.reduce(joinText);
  }
  if (rows.length > 1) {
    // Full snapshots retain conflicting answers, actions, flags and unknown fields.
    // They are JSON backup data, not additional checkin records.
    merged.migrationSources = rows.map(row => ({ ...row }));
    merged.archived = rows.every(row => row.archived === true);
  }
  return merged;
}

async function migrateV2(tx) {
  const checkins = await tx.table('checkin').toArray();
  const groups = new Map();
  for (const row of checkins) {
    if (row.domain === '몸상태') {
      await tx.table('checkin').put({ ...row, archived: true });
      continue;
    }
    const target = ['관계-회사', '관계-가족', '대인관계'].includes(row.domain)
      ? '대인관계' : ['공부', '공부·기술'].includes(row.domain) ? '공부·기술' : null;
    if (!target) continue;
    const key = JSON.stringify([row.date, target]);
    if (!groups.has(key)) groups.set(key, { target, rows: [] });
    groups.get(key).rows.push(row);
  }
  for (const { target, rows } of groups.values()) {
    if (!rows.some(row => row.domain !== target)) continue;
    await tx.table('checkin').bulkDelete(rows.map(row => [row.date, row.domain]));
    await tx.table('checkin').put(mergeCheckins(rows, target));
  }
  await tx.table('question').toCollection().modify(question => {
    if (['관계-회사', '관계-가족'].includes(question.domain)) question.domain = '대인관계';
    if (question.domain === '공부') question.domain = '공부·기술';
    if (question.domain === '몸상태') {
      question.active = false;
      question.archived = true;
    }
    // Old custom questions may predate semantic keys and explicit flags.
    if (!question.key) question.key = `legacy-${question.id}`;
    if (!Array.isArray(question.options)) question.options = [];
    if (!Number.isSafeInteger(question.order) || question.order < 0) question.order = 0;
    if (typeof question.active !== 'boolean') question.active = true;
    if (typeof question.multi !== 'boolean') question.multi = question.kind === 'multi';
  });
}

export const db = new Dexie('oneul');
db.version(1).stores(SCHEMA);
db.version(2).stores(SCHEMA).upgrade(migrateV2);

/** Atomic once-only seeding. Existing questions/edits are never overwritten. */
export async function initDB() {
  await db.open();
  await db.transaction('rw', db.question, db.meta, async () => {
    if ((await db.meta.get(SEED_KEY))?.value === true) return;
    const existing = await db.question.toArray();
    const semanticKeys = new Set(existing.map(row => JSON.stringify([row.domain, row.key])));
    const missing = DEFAULT_QUESTIONS.filter(row => !semanticKeys.has(JSON.stringify([row.domain, row.key])));
    if (missing.length) await db.question.bulkAdd(missing.map(row => ({ ...row, options: [...row.options] })));
    await db.meta.put({ key: SEED_KEY, value: true });
  });
  return db;
}

export async function getMeta(key, fallback) {
  const row = await db.meta.get(key);
  return row && own(row, 'value') ? row.value : fallback;
}

export async function setMeta(key, value) {
  if (typeof key !== 'string' || !key.trim()) throw new TypeError('설정 키는 비어 있지 않은 문자열이어야 합니다.');
  jsonValue(value, `설정[${key}]`);
  await db.meta.put({ key, value });
}

export async function exportData() {
  return db.transaction('r', TABLES.map(name => db.table(name)), async () => {
    const tables = {};
    for (const name of TABLES) tables[name] = await db.table(name).toArray();
    return { format: 'oneul', version: 2, exportedAt: Date.now(), tables };
  });
}

function fail(path, message) {
  throw new TypeError(`백업 오류 · ${path}: ${message}`);
}

function jsonValue(value, path, ancestors = new Set(), depth = 0) {
  if (depth > 100) fail(path, '중첩 깊이가 100단계를 넘습니다.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (typeof value !== 'object' || (!Array.isArray(value) && !record(value))) {
    fail(path, '유한한 숫자, 문자열, 참/거짓, null, 배열 또는 일반 객체만 저장할 수 있습니다.');
  }
  if (ancestors.has(value)) fail(path, '순환 참조는 저장할 수 없습니다.');
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      if (!own(value, i)) fail(`${path}[${i}]`, '비어 있는 배열 요소는 허용하지 않습니다.');
      jsonValue(value[i], `${path}[${i}]`, ancestors, depth + 1);
    }
  } else {
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) fail(path, `안전하지 않은 속성 이름입니다: ${key}`);
      jsonValue(item, `${path}.${key}`, ancestors, depth + 1);
    }
  }
  ancestors.delete(value);
}

function string(value, path, required = false) {
  if (!present(value) && !required) return;
  if (typeof value !== 'string' || (required && !value.trim())) {
    fail(path, required ? '비어 있지 않은 문자열이 필요합니다.' : '문자열이어야 합니다.');
  }
}
function boolean(value, path) {
  if (present(value) && typeof value !== 'boolean') fail(path, '참 또는 거짓이어야 합니다.');
}
function id(value, path, required = true) {
  if (!present(value) && !required) return;
  if (!Number.isSafeInteger(value) || value <= 0) fail(path, '양의 안전한 정수 ID가 필요합니다.');
}
function date(value, path, required = true) {
  if (!present(value) && !required) return;
  try { parseDate(value); } catch (error) { fail(path, error.message); }
}
function strings(value, path) {
  if (!present(value)) return;
  if (!Array.isArray(value)) fail(path, '문자열 배열이어야 합니다.');
  value.forEach((item, i) => string(item, `${path}[${i}]`, true));
}
function enumValue(value, values, path, required = false) {
  if (!present(value) && !required) return;
  if (!values.includes(value)) fail(path, `허용 값: ${values.join(', ')}`);
}
function domain(value, path, row) {
  // Archived body-state rows are deliberately kept for historical access.
  if (value === '몸상태' && row.archived === true) return;
  enumValue(value, DOMAINS, path, true);
}

/** Synchronous, non-mutating; returns true or throws a path-specific Korean error. */
export function validateBackup(obj) {
  if (!record(obj)) fail('파일', '백업의 최상위 값은 객체여야 합니다.');
  if (obj.format !== 'oneul') fail('format', '오늘 앱의 백업(format: oneul)이 아닙니다.');
  if (obj.version !== 2) fail('version', '지원하는 백업 버전은 2입니다.');
  if (!Number.isSafeInteger(obj.exportedAt) || obj.exportedAt < 0) {
    fail('exportedAt', '0 이상의 정수 밀리초 시간이 필요합니다.');
  }
  if (!record(obj.tables)) fail('tables', '테이블을 담은 객체가 필요합니다.');
  for (const name of Object.keys(obj.tables)) {
    if (!TABLES.includes(name)) fail(`tables.${name}`, '알 수 없는 테이블입니다.');
  }
  for (const name of TABLES) {
    if (!own(obj.tables, name) || !Array.isArray(obj.tables[name])) {
      fail(`tables.${name}`, '필수 테이블이며 배열이어야 합니다. 빈 테이블은 []로 표시하세요.');
    }
  }
  jsonValue(obj, '백업');
  const tables = obj.tables;
  const ids = {};
  const numeric = ['goal', 'milestone', 'task', 'notToDo', 'question'];
  const statuses = ['active', 'paused', 'completed', 'done', 'archived', 'cancelled', 'canceled', 'dropped', 'planned', 'pending', 'todo', 'in_progress', 'someday'];
  for (const name of TABLES) {
    const seen = new Set();
    ids[name] = seen;
    tables[name].forEach((row, index) => {
      const path = `tables.${name}[${index}]`;
      if (!record(row)) fail(path, '각 행은 객체여야 합니다.');
      let key;
      if (numeric.includes(name)) {
        id(row.id, `${path}.id`);
        key = row.id;
      } else if (name === 'meta') {
        string(row.key, `${path}.key`, true);
        if (!own(row, 'value')) fail(`${path}.value`, '설정 값이 필요합니다.');
        key = row.key;
      } else if (name === 'weekly') {
        date(row.weekStart, `${path}.weekStart`);
        key = row.weekStart;
      } else {
        date(row.date, `${path}.date`);
        if (name === 'checkin') {
          domain(row.domain, `${path}.domain`, row);
          key = JSON.stringify([row.date, row.domain]);
        } else if (name === 'goalTouch' || name === 'notToDoLog') {
          const field = name === 'goalTouch' ? 'goalId' : 'notToDoId';
          id(row[field], `${path}.${field}`);
          key = JSON.stringify([row.date, row[field]]);
        } else key = row.date;
      }
      if (seen.has(key)) fail(path, `기본 키가 중복됩니다: ${String(key)}`);
      seen.add(key);
      // Shared optional fields are checked even on extensible rows.
      for (const field of ['done', 'completed', 'active', 'archived', 'nextActionDone', 'blockerResolved', 'frogDone', 'multi', 'allowCustom']) {
        boolean(row[field], `${path}.${field}`);
      }
      for (const field of ['title', 'text', 'memo', 'notes', 'nextAction', 'blocker', 'oneThing', 'content', 'reflection']) {
        string(row[field], `${path}.${field}`);
      }
      for (const field of ['startDate', 'endDate', 'dueDate', 'targetDate', 'completedDate']) {
        date(row[field], `${path}.${field}`, false);
      }
      enumValue(row.status, statuses, `${path}.status`);
      if (present(row.score) && (!Number.isInteger(row.score) || row.score < 0 || row.score > 3)) {
        fail(`${path}.score`, '점수는 0 이상 3 이하의 유한한 숫자여야 합니다.');
      }
      if (name === 'checkin') {
        if (present(row.answers) && !record(row.answers)) fail(`${path}.answers`, '의미 키 또는 질문 ID를 키로 사용하는 객체여야 합니다.');
        for (const [key, value] of Object.entries(row.answers || {})) {
          const scalar = item => item === null || ['string', 'boolean'].includes(typeof item) ||
            (typeof item === 'number' && Number.isFinite(item));
          if (!key.trim() || !(scalar(value) || (Array.isArray(value) && value.every(scalar)))) {
            fail(`${path}.answers.${key}`, '답변은 문자열, 숫자, 참/거짓, null 또는 이 값들의 배열이어야 합니다.');
          }
        }
        enumValue(row.blockerType, BLOCKER_TYPES, `${path}.blockerType`);
      }
      if(name==='goal') {
        enumValue(row.status,['active','done','paused'],`${path}.status`,true);
        string(row.why,`${path}.why`);
        if(row.deadline)date(row.deadline,`${path}.deadline`);
        if(present(row.want)&&(!Number.isInteger(row.want)||row.want<0||row.want>10))fail(`${path}.want`,'원하는 정도는 0~10 정수여야 합니다.');
        for(const field of ['f24h','fTop10','fIncome2x'])boolean(row[field],`${path}.${field}`);
      }
      if(name==='milestone'){
        if(row.deadline)date(row.deadline,`${path}.deadline`);
        if(present(row.order)&&(!Number.isSafeInteger(row.order)||row.order<0))fail(`${path}.order`,'마일스톤 순서는 0 이상의 정수여야 합니다.');
      }
      if(name==='task'){
        string(row.whenWhere,`${path}.whenWhere`);
        string(row.dropReason,`${path}.dropReason`);
        if(row.status==='dropped'&&(!row.dropReason||!row.dropReason.trim()))fail(`${path}.dropReason`,'버리는 이유를 입력해야 합니다.');
      }
      if(name==='journal'){if(typeof row.body!=='string')fail(`${path}.body`,'본문은 문자열이어야 합니다.');}
      if(name==='notToDoLog')boolean(row.kept,`${path}.kept`);
      if(name==='meta'&&row.key==='dayStartHour'&&![0,3,4].includes(row.value))fail(`${path}.value`,'하루 시작 시각은 0, 3, 4 중 하나여야 합니다.');
      if(name==='meta'&&row.key==='skin'&&!['sage','lavender','peach','sky','butter','greige'].includes(row.value))fail(`${path}.value`,'지원하지 않는 스킨입니다.');
      if(name==='meta'&&row.key==='darkMode'&&!['auto','light','dark'].includes(row.value))fail(`${path}.value`,'지원하지 않는 화면 모드입니다.');
      if (name === 'dailyLog') {
        strings(row.gratitude, `${path}.gratitude`);
        strings(row.wins, `${path}.wins`);
        if (present(row.discard)) {
          if (!Array.isArray(row.discard)) fail(`${path}.discard`, '배열이어야 합니다.');
          row.discard.forEach((item, i) => {
            const p = `${path}.discard[${i}]`;
            if (!record(item)) fail(p, '객체여야 합니다.');
            string(item.text, `${p}.text`, true);
            enumValue(item.type, ['stop'], `${p}.type`, true);
          });
        }
      }
      if (name === 'question') {
        domain(row.domain, `${path}.domain`, row);
        string(row.key, `${path}.key`, true);
        string(row.text, `${path}.text`, true);
        enumValue(row.kind, ['text', 'textarea', 'chips', 'yesno', 'number', 'select', 'multi', 'scale'], `${path}.kind`, true);
        if (!Array.isArray(row.options)) fail(`${path}.options`, '선택지는 배열이어야 합니다.');
        strings(row.options, `${path}.options`);
        if (new Set(row.options).size !== row.options.length) fail(`${path}.options`, '중복된 선택지가 있습니다.');
        if (!Number.isSafeInteger(row.order) || row.order < 0) fail(`${path}.order`, '0 이상의 안전한 정수가 필요합니다.');
        if (typeof row.active !== 'boolean') fail(`${path}.active`, '질문의 활성 여부는 참 또는 거짓이어야 합니다.');
        if (typeof row.multi !== 'boolean') fail(`${path}.multi`, '복수 선택 여부는 참 또는 거짓이어야 합니다.');
      }
    });
  }
  const fk = (row, field, target, path, required = false) => {
    if (!present(row[field]) && !required) return;
    id(row[field], `${path}.${field}`);
    if (!ids[target].has(row[field])) fail(`${path}.${field}`, `${target} 테이블에 ID ${row[field]}이(가) 없습니다.`);
  };
  for (const name of TABLES) {
    tables[name].forEach((row, i) => {
      const path = `tables.${name}[${i}]`;
      if (name === 'milestone') fk(row, 'goalId', 'goal', path, true);
      if (name === 'task') fk(row, 'milestoneId', 'milestone', path, true);
      if (['task', 'notToDo'].includes(name)) fk(row, 'goalId', 'goal', path);
      if (name === 'goalTouch') fk(row, 'goalId', 'goal', path, true);
      if (name === 'notToDoLog') fk(row, 'notToDoId', 'notToDo', path, true);
      if (name === 'checkin') fk(row, 'nextActionGoalId', 'goal', path);
      if (name === 'dailyLog') fk(row, 'oneThingGoalId', 'goal', path);
    });
  }
  if(tables.goal.filter(g=>g.status==='active').length>3)fail('tables.goal','진행 중인 목표는 최대 3개입니다.');
  return true;
}

/** Validate before touching data, then replace every table in one transaction. */
export async function importData(obj) {
  validateBackup(obj);
  // Detach from the caller before the first await: later edits cannot change
  // the validated payload while opening or waiting for an IndexedDB lock.
  const snapshot = JSON.parse(JSON.stringify(obj));
  await db.open();
  await db.transaction('rw', TABLES.map(name => db.table(name)), async () => {
    for (const name of TABLES) await db.table(name).clear();
    for (const name of TABLES) {
      if (snapshot.tables[name].length) await db.table(name).bulkPut(snapshot.tables[name]);
    }
  });
  return db;
}
