// Run: node --test oneul/db.test.mjs
// Requires fake-indexeddb in ../tooling/node_modules (or a normal installation).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../tooling/package.json', import.meta.url));
require('fake-indexeddb/auto');
const {
  DOMAINS, ICONS, BLOCKER_TYPES, db, localDate, shiftDate, shiftMonth, dayDiff,
  initDB, getMeta, setMeta, exportData, validateBackup, importData,
} = await import('./db.js');
const { default: Dexie } = await import('./vendor/dexie.mjs');

test('exact Lucide names and blocker types', () => {
  assert.deepEqual(ICONS, {
    건강: 'heart-pulse', 마음: 'smile', 영적: 'sun', '공부·기술': 'book-open',
    대인관계: 'users', 업무: 'briefcase', 돈: 'wallet', 취미: 'palette',
  });
  assert.deepEqual(BLOCKER_TYPES, ['시간', '에너지', '사람', '돈', '습관', '감정', '두려움', '모름']);
});

// Independent contract fixture: exact text, kind, options and multi for all defaults.
const EXPECTED_QUESTIONS = {
  건강: [
    ['pain', '아픈 곳·불편한 곳?', 'chips', ['없음', '머리', '목·어깨', '허리', '위장', '무릎·관절', '피로']],
    ['cause', '원인으로 짐작되는 건?', 'chips', ['수면 부족', '과식·야식', '운동 부족', '스트레스', '자세', '술', '모름']],
    ['measure', '조치는?', 'chips', ['쉬기', '스트레칭', '병원·약', '운동', '일찍 자기']],
    ['sleep', '어젯밤 수면', 'chips', ['5↓', '6', '7', '8↑']],
    ['movement', '오늘 움직임', 'chips', ['없음', '걷기', '운동']],
  ],
  마음: [
    ['emotion', '지금 내 마음은?', 'chips', ['평안', '기쁨', '감사', '설렘', '불안', '짜증', '서운함', '슬픔', '지침', '외로움'], true],
    ['stress', '스트레스 정도', 'chips', ['낮음', '보통', '높음', '터지기 직전']],
    ['cause', '무엇 때문에?', 'chips', ['일', '사람', '돈', '건강', '미래 걱정', '나 자신', '모름']],
    ['control', '그중 내가 통제할 수 있는 부분은?', 'chips', ['전부', '일부', '없음 → 맡겨 드리기']],
    ['lastword', '지금 나에게 해 주고 싶은 한마디', 'text', []],
  ],
  영적: [
    ['jesus', '오늘 그 상황에서 예수님이라면 어떻게 하셨을까?', 'text', []],
    ['reflect', '오늘 하루를 들고 하나님 앞에 선다면, 부끄러운 것은? 감사한 것은?', 'text', []],
    ['prayer', '말씀·기도', 'chips', ['했음', '짧게', '못함']],
    ['verse', '오늘 붙잡은 말씀 한 구절', 'text', []],
    ['surrender', '맡겨 드릴 것 (내가 통제할 수 없는 것)', 'text', []],
  ],
  '공부·기술': [
    ['learned', '오늘 배운 것 한 줄', 'text', []],
    ['skill', '목표에 필요한 기술 중 지금 가장 부족한 하나는?', 'text', []],
    ['applied', '배운 걸 실제로 써먹었나?', 'yesno', ['예', '아니오']],
    ['time', '투자한 시간', 'chips', ['0', '15분', '30분', '1시간', '2시간↑']],
  ],
  대인관계: [
    ['person', '오늘 마음 쓰인 사람', 'text', []],
    ['tag', '관계 태그', 'chips', ['가족', '회사', '친구', '교회']],
    ['listening', '먼저 이해하려고 들었나, 내 말부터 했나?', 'chips', ['먼저 들음', '반반', '내 말부터']],
    ['action', '막힌 관계에서 내가 할 수 있는 한 가지는?', 'text', []],
    ['praise', '감사·칭찬을 전한 사람', 'text', []],
  ],
  업무: [
    ['value', '가장 가치 있는 일에 시간을 썼나?', 'chips', ['예', '일부', '아니오']],
    ['timewaste', '시간을 가장 많이 잡아먹은 것은?', 'text', []],
    ['delegate', '그만두거나 넘길 수 있는 일은?', 'text', []],
    ['tomorrow', '내일 출근하면 맨 먼저 할 일', 'text', []],
  ],
  돈: [
    ['amount', '오늘 쓴 돈 (금액, 선택)', 'number', []],
    ['spending', '지출의 성격', 'chips', ['필요', '원함', '충동']],
    ['income', '수입이나 자산을 늘리려고 한 행동은?', 'text', []],
    ['worry', '돈 걱정 하나와, 그중 내가 통제할 수 있는 부분은?', 'text', []],
    ['principle', '이번 달 지키기로 한 원칙을 지켰나?', 'yesno', ['예', '아니오']],
  ],
  취미: [
    ['activity', '무엇을 했나?', 'chips', []],
    ['after', '하고 나서', 'chips', ['충전됨', '그대로', '더 지침']],
    ['rest', '회복이었나, 도피였나?', 'chips', ['회복', '도피']],
  ],
};

test('local date helpers, leap days, clamping, DST and immutability', () => {
  const input = new Date(2026, 0, 1, 2, 15);
  assert.equal(localDate(input, 4), '2025-12-31');
  assert.equal(input.getHours(), 2);
  assert.equal(shiftDate('2024-02-28', 1), '2024-02-29');
  assert.equal(shiftDate('2024-02-29', 1), '2024-03-01');
  assert.equal(shiftMonth('2024-01-31', 1), '2024-02-29');
  assert.equal(shiftMonth('2025-03-31', -1), '2025-02-28');
  assert.equal(shiftMonth('2024-02-29', 12), '2025-02-28');
  assert.equal(dayDiff('2026-03-07', '2026-03-10'), 3);
  assert.equal(dayDiff('2026-11-02', '2026-10-31'), -2);
  assert.equal(shiftDate('0001-01-01', 1), '0001-01-02');
  assert.throws(() => shiftDate('2025-02-29', 1), /존재하지/);
  assert.throws(() => shiftMonth('2026-01-01', 0.5), /정수/);
});

test('migration, once-only seed, backup checks and atomic replacement', async () => {
  await Dexie.delete('oneul');
  const old = new Dexie('oneul');
  old.version(1).stores({
    checkin: '[date+domain],date,domain', dailyLog: 'date', journal: 'date',
    goal: '++id,status', milestone: '++id,goalId', task: '++id,milestoneId',
    goalTouch: '[date+goalId],date,goalId', notToDo: '++id,goalId',
    notToDoLog: '[date+notToDoId],date,notToDoId', weekly: 'weekStart',
    question: '++id,domain,order', meta: 'key',
  });
  await old.open();
  await old.checkin.bulkPut([
    { date: '2026-01-01', domain: '관계-회사', score: 1, memo: '회사 메모', answers: { person: '동료', action: '감사' } },
    { date: '2026-01-01', domain: '관계-가족', score: 3, notes: '가족 기록', answers: { person: '가족', listening: '경청' } },
    { date: '2026-01-01', domain: '대인관계', score: 2, memo: '기존 메모', answers: { praise: '고마워' } },
    { date: '2026-01-01', domain: '몸상태', score: 0, answers: { pain: '허리' } },
    { date: '2026-01-02', domain: '공부', score: 2, answers: { learned: '옛 배움' } },
    { date: '2026-01-02', domain: '공부·기술', score: 2, answers: { learned: '새 배움' } },
    { date: '2026-01-03', domain: '관계-회사', answers: { person: '한 사람' } },
  ]);
  await old.question.add({ domain: '몸상태', text: '옛 질문', kind: 'text', order: 0 });
  old.close();
  try {
    assert.equal(await initDB(), db);
    const relation = await db.checkin.get(['2026-01-01', '대인관계']);
    assert.equal(relation.score, 3);
    assert.equal(relation.answers.person, '가족');
    assert.equal(relation.answers.action, '감사');
    assert.equal(relation.answers.praise, '고마워');
    assert.match(relation.memo, /회사 메모/);
    assert.match(relation.memo, /기존 메모/);
    assert.equal(relation.notes, '가족 기록');
    assert.equal(relation.migrationSources.length, 3);
    assert.equal((await db.checkin.get(['2026-01-01', '몸상태'])).archived, true);
    assert.equal(await db.checkin.get(['2026-01-01', '관계-회사']), undefined);
    assert.equal((await db.checkin.get(['2026-01-02', '공부·기술'])).answers.learned, '새 배움');
    assert.equal((await db.checkin.get(['2026-01-03', '대인관계'])).answers.person, '한 사람');
    const questions = await db.question.toArray();
    assert.equal(questions.length, 37);
    const active = questions.filter(row => row.active);
    assert.equal(active.length, 36);
    for (const domain of DOMAINS) {
      const actual = active.filter(row => row.domain === domain).sort((a, b) => a.order - b.order);
      assert.deepEqual(actual.map(({ key, text, kind, options, multi }) =>
        [key, text, kind, options, multi]), EXPECTED_QUESTIONS[domain].map(
        ([key, text, kind, options, multi = false]) => [key, text, kind, options, multi]), domain);
    }
    assert.deepEqual(DOMAINS.map(domain => active.filter(row => row.domain === domain).length), [5, 5, 5, 4, 5, 4, 5, 3]);
    assert.ok(active.find(row => row.domain === '마음' && row.key === 'emotion').multi);
    assert.ok(active.find(row => row.domain === '영적' && row.key === 'surrender'));
    assert.ok(active.find(row => row.domain === '취미' && row.key === 'activity').allowCustom);
    const deletedId = active[0].id;
    await db.question.delete(deletedId);
    await Promise.all([initDB(), initDB()]);
    assert.equal(await db.question.count(), 36);
    await setMeta('test', { nested: [false, 0, ''] });
    assert.deepEqual(await getMeta('test'), { nested: [false, 0, ''] });
    await setMeta('null', null);
    assert.equal(await getMeta('null', 'fallback'), null);
    assert.equal(await getMeta('missing', 17), 17);
    await db.goal.put({ id: 1, status: 'active', title: '목표' });
    await db.milestone.put({ id: 1, goalId: 1 });
    await db.task.put({ id: 1, milestoneId: 1, done: false });
    await db.notToDo.put({ id: 1, goalId: 1, text: '미루기' });
    await db.notToDoLog.put({ date: '2026-01-01', notToDoId: 1, done: true });
    const backup = await exportData();
    assert.equal(backup.format, 'oneul');
    assert.equal(Object.keys(backup.tables).length, 12);
    assert.equal(validateBackup(backup), true);
    {const copy=structuredClone(backup);copy.tables.journal.push({date:'2026-11-07',body:''});assert.equal(validateBackup(copy),true);}
    const invalid = (mutate, pattern) => {
      const copy = structuredClone(backup);
      mutate(copy);
      assert.throws(() => validateBackup(copy), pattern);
      return copy;
    };
    invalid(b => { b.tables.goal = {}; }, /goal.*배열/);
    invalid(b => { b.tables.goal.push(b.tables.goal[0]); }, /중복/);
    invalid(b => { b.tables.task[0].milestoneId = 999; }, /milestone.*없습니다/);
    invalid(b => { b.tables.task[0].done = 1; }, /done.*참 또는 거짓/);
    invalid(b => { b.tables.task[0].status = 'dropped'; b.tables.task[0].dropReason=' '; }, /dropReason/);
    invalid(b => { b.tables.milestone[0].order = -1; }, /order/);
    {const copy=structuredClone(backup);copy.tables.task[0].status='dropped';copy.tables.task[0].dropReason='지금 목표에 필요하지 않음';assert.equal(validateBackup(copy),true);}
    invalid(b => { b.tables.checkin[0].score = 4; }, /score.*0 이상 3 이하/);
    invalid(b => { b.tables.checkin[0].score = -1; }, /score/);
    for (const score of [0, 1, 2, 3]) {
      const copy = structuredClone(backup);
      copy.tables.checkin[0].score = score;
      assert.equal(validateBackup(copy), true);
    }
    invalid(b => { b.tables.checkin[0].date = '2026-02-30'; }, /존재하지/);
    invalid(b => { b.tables.question[0].multi = 'yes'; }, /multi/);
    invalid(b => { b.tables.question[0].options = 'bad'; }, /options/);
    invalid(b => { b.tables.goal[0].status = 'nonsense'; }, /status/);
    invalid(b => { b.tables.checkin[0].blockerType = 'nonsense'; }, /blockerType/);
    invalid(b => { b.tables.checkin[0].answers = { person: {} }; }, /answers/);
    const bad = invalid(b => { delete b.tables.meta; }, /meta/);
    await assert.rejects(importData(bad), /meta/);
    assert.equal(await db.question.count(), 36);
    await db.goal.put({ id: 9, title: '제거 대상', status: 'done' });
    await importData(backup);
    assert.equal(await db.goal.get(9), undefined);
    assert.deepEqual((await exportData()).tables, backup.tables);
    assert.ok(BLOCKER_TYPES.length > 0);
    // A failure after clear() must roll back all deletions.
    const hook = () => { throw new Error('forced-write-failure'); };
    db.question.hook('creating', hook);
    await assert.rejects(importData(backup), /forced-write-failure/);
    db.question.hook('creating').unsubscribe(hook);
    assert.deepEqual((await exportData()).tables, backup.tables);
  } finally {
    db.close();
    await Dexie.delete('oneul');
  }
});
