import { db, DOMAINS, getMeta, setMeta, exportData, validateBackup, importData } from './db.js';
let settingsWrites=Promise.resolve();
export async function flushSettingsWrites(){let p;do{p=settingsWrites;await p;}while(p!==settingsWrites);}

// Only modal content lives here; #overlay and theme CSS belong to main.
const SKINS = [
  ['sage', '세이지'], ['lavender', '라벤더'], ['peach', '피치'],
  ['sky', '스카이'], ['butter', '버터'], ['greige', '그레이지'],
];
const KINDS = [['text', '짧은 글'], ['number', '숫자'], ['chips', '선택 칩'], ['yesno', '예 / 아니오']];
const localStamp = (date = new Date()) => {
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
};
const node = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const domains = () => (Array.isArray(DOMAINS) ? DOMAINS : Object.entries(DOMAINS).map(([id, value]) =>
  typeof value === 'object' ? { id, ...value } : { id, label: value }
)).map(value => typeof value === 'string' ? { id: value, label: value } : {
  id: value.id ?? value.key ?? value.value,
  label: value.label ?? value.name ?? value.title ?? value.id ?? value.key,
}).filter(value => value.id != null);

export async function renderSettings(host, ctx) {
  let alive = true;
  const notify = message => ctx.toast(String(message));
  const report = error => notify(error?.message || '변경 내용을 저장하지 못했어요. 다시 시도해 주세요.');
  const guard = action => (...args) => Promise.resolve().then(() => action(...args)).catch(report);
  // Serialize changes: rapid toggles must not overtake earlier writes.
  const enqueue = action => {
    const result = settingsWrites.then(action);
    settingsWrites = result.catch(() => {});
    return result;
  };
  const listen = (element, event, action) => element.addEventListener(event, guard(action));
  const button = (text, action, className = 'btn') => {
    const element = node('button', className, text);
    element.type = 'button';
    if (action) listen(element, 'click', action);
    return element;
  };
  const section = (title, explanation) => {
    const group = node('section', 'settings-group stack');
    group.append(node('h3', 'section-title', title));
    if (explanation) group.append(node('p', 'muted', explanation));
    root.append(group);
    return group;
  };
  const field = (parent, label, value, onChange, type = 'text') => {
    const wrap = node('label', 'field stack');
    wrap.append(node('span', '', label));
    const input = node(type === 'textarea' ? 'textarea' : 'input', 'field');
    if (type !== 'textarea') input.type = type;
    if (type === 'checkbox') input.checked = Boolean(value);
    else input.value = value ?? '';
    if (type === 'textarea') input.rows = 2;
    listen(input, type==='checkbox'||type==='date'?'change':'input', async () => {
      const next = type === 'checkbox' ? input.checked : input.value;
      try { await enqueue(() => onChange(next)); }
      catch (error) {
        if (type === 'checkbox') input.checked = Boolean(value);
        else input.value = value ?? '';
        throw error;
      }
      value = next;
    });
    wrap.append(input);
    parent.append(wrap);
    return input;
  };
  const select = (parent, label, value, choices, onChange) => {
    const wrap = node('label', 'field stack');
    wrap.append(node('span', '', label));
    const input = node('select', 'field');
    for (const [key, title] of choices) {
      const option = node('option', '', title);
      option.value = String(key);
      input.append(option);
    }
    input.value = String(value ?? '');
    listen(input, 'change', async () => {
      const next = input.value;
      try { await enqueue(() => onChange(next)); }
      catch (error) { input.value = String(value ?? ''); throw error; }
      value = next;
    });
    wrap.append(input);
    parent.append(wrap);
    return input;
  };
  const longDelete = (parent, label, remove) => {
    const control = button(`${label} · 길게 누르기`, null, 'btn');
    control.setAttribute('aria-label', `${label}: 1초 동안 누르거나 스페이스 또는 엔터 키를 길게 누르세요`);
    control.style.touchAction = 'none';
    let timer;
    let start;
    let firing = false;
    const cancel = () => { clearTimeout(timer); timer = undefined; start = undefined; };
    const begin = () => {
      if (timer || firing) return;
      timer = setTimeout(guard(async () => {
        cancel();
        if (!alive || !control.isConnected) return;
        firing = true;
        control.disabled = true;
        try { await enqueue(remove); }
        finally { firing = false; control.disabled = false; }
      }), 1000);
    };
    control.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      start = [event.clientX, event.clientY];
      control.setPointerCapture?.(event.pointerId);
      begin();
    });
    control.addEventListener('pointermove', event => {
      if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 12) cancel();
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) control.addEventListener(event, cancel);
    control.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); if (!event.repeat) begin(); }
      if (event.key === 'Escape') cancel();
    });
    control.addEventListener('keyup', cancel);
    control.addEventListener('click', event => event.preventDefault());
    control.addEventListener('contextmenu', event => event.preventDefault());
    parent.append(control);
  };
  const refresh = async () => { await ctx.refresh(); };
  const root = node('div', 'stack');
  root.dataset.settings = '';
  host.replaceChildren(root);
  const titleRow = node('div', 'row');
  titleRow.append(node('h2', 'section-title', '설정'), button('닫기', () => { alive = false; ctx.close(); }, 'icon-btn'));
  root.append(titleRow);

  try {
    const [skin, darkMode, dayStart] = await Promise.all([
      getMeta('skin'), getMeta('darkMode'), getMeta('dayStartHour'),
    ]);
    const appearance = section('나에게 맞는 분위기');
    const skinGrid = node('div', 'skin-grid');
    skinGrid.style.display = 'grid';
    skinGrid.style.gridTemplateColumns = 'repeat(2, minmax(0, 1fr))';
    const skinButtons = [];
    for (const [id, label] of SKINS) {
      const option = button('', async () => {
        await enqueue(async () => {
          await setMeta('skin', id);
          await ctx.applyTheme();
          for (const item of skinButtons) item.setAttribute('aria-pressed', String(item.dataset.skin === id));
        });
      }, 'skin-option');
      option.dataset.skin = id;
      option.setAttribute('aria-label', `${label} 스킨`);
      option.setAttribute('aria-pressed', String((skin || SKINS[0][0]) === id));
      const hero = node('div', 'mini-hero');
      hero.setAttribute('aria-hidden', 'true');
      hero.append(node('span', '', '오늘의 작은 한 걸음'));
      const scores = node('div', 'mini-scores');
      scores.setAttribute('aria-hidden', 'true');
      for (const text of ['0', '1', '2', '3']) scores.append(node('span', '', text));
      option.append(hero, scores, node('span', '', label));
      skinButtons.push(option);
      skinGrid.append(option);
    }
    appearance.append(skinGrid);
    select(appearance, '화면 모드', darkMode || 'auto', [['auto', '기기 설정 따르기'], ['light', '밝게'], ['dark', '어둡게']], async value => {
      await setMeta('darkMode', value);
      await ctx.applyTheme();
    });

    const goalsSection = section('목표', '진행 중인 목표는 최대 3개예요. 새 목표는 일시 정지 초안으로 만들고, 삭제는 길게 눌러요.');
    const goalList = node('div', 'stack');
    goalsSection.append(goalList);
    const principleSection = section('하지 않을 일', '목표와 연결해 나만의 원칙을 만들어요. 활성 원칙은 더 많이 관리할 수 있고, 오늘 화면에는 최대 3개가 보여요.');
    const principleList = node('div', 'stack');
    principleSection.append(principleList);
    let goalRows = [];
    let principleRows = [];
    const goalChoices = () => [['', '연결할 목표 선택'], ...goalRows.map(goal => [goal.id, goal.title || '제목 없는 목표'])];
    const updateGoalLinks = () => {
      for (const input of principleList.querySelectorAll('select[data-goal-link]')) {
        const current = input.value;
        input.replaceChildren();
        for (const [id, title] of goalChoices()) {
          const option = node('option', '', title); option.value = String(id); input.append(option);
        }
        input.value = current;
      }
    };
    const renderGoals = async () => {
      goalRows = await db.goal.toArray();
      if (!alive || !root.isConnected) return;
      goalList.replaceChildren();
      if (!goalRows.length) goalList.append(node('p', 'muted', '아직 목표가 없어요. 작은 목표부터 만들어 보세요.'));
      for (const goal of goalRows) {
        const card = node('div', 'card stack');
        const update = async (key, value) => {
          await db.goal.update(goal.id, { [key]: value });
          goal[key] = value;
          if (key === 'title') updateGoalLinks();
          await refresh();
        };
        field(card, '목표 제목', goal.title, value => update('title', value));
        field(card, '왜 중요한가요?', goal.why, value => update('why', value), 'textarea');
        field(card, '마감일', goal.deadline, value => update('deadline', value), 'date');
        const wantInput=field(card, '원하는 정도 (0~10)', goal.want??5, value => update('want', Number(value)), 'range');
        wantInput.min='0'; wantInput.max='10'; wantInput.step='1';
        select(card, '상태', goal.status || 'paused', [['active', '진행 중'], ['done', '완료'], ['paused', '일시 정지']], async value => {
          if (value === 'active') {
            await db.transaction('rw', db.goal, async () => {
              const rows = await db.goal.toArray();
              if (rows.filter(row => row.status === 'active' && !sameId(row.id, goal.id)).length >= 3) throw new Error('진행 중인 목표는 최대 3개예요. 다른 목표를 먼저 일시 정지해 주세요.');
              await db.goal.update(goal.id, { status: value });
            });
            goal.status = value;
            await refresh();
          } else await update('status', value);
        });
        longDelete(card, '목표 삭제', async () => {
          const snapshot = await db.goal.get(goal.id);
          if (!snapshot) return;
          await ctx.removeWithUndo(async () => {
            // Inspect every non-meta table rather than assuming which tables hold goalId.
            const tables = db.tables.filter(table => table.name !== 'meta');
            await db.transaction('rw', tables, async () => {
              for (const table of tables) {
                if (table.name === 'goal') continue;
                const linked = await table.toCollection().filter(row => sameId(row.goalId, goal.id) ||
                  sameId(row.nextActionGoalId, goal.id) || sameId(row.oneThingGoalId, goal.id) ||
                  (Array.isArray(row.goalIds) && row.goalIds.some(id => sameId(id, goal.id)))).first();
                if (linked) throw new Error('연결된 기록이나 원칙이 있어 삭제할 수 없어요. 연결을 해제하거나 목표를 일시 정지해 주세요.');
              }
              await db.goal.delete(goal.id);
            });
            await renderGoals(); updateGoalLinks(); await refresh();
          }, async () => {
            await db.transaction('rw', db.goal, async () => {
              const rows = await db.goal.toArray();
              const restored = { ...snapshot };
              if (restored.status === 'active' && rows.filter(row => row.status === 'active' && !sameId(row.id, snapshot.id)).length >= 3) {
                restored.status = 'paused';
                notify('목표를 일시 정지 상태로 복원했어요. 진행 중인 목표는 최대 3개예요.');
              }
              await db.goal.put(restored);
            });
            await renderGoals(); updateGoalLinks(); await refresh();
          });
        });
        goalList.append(card);
      }
    };
    const renderPrinciples = async () => {
      principleRows = await db.notToDo.toArray();
      if (!alive || !root.isConnected) return;
      principleList.replaceChildren();
      if (!principleRows.length) principleList.append(node('p', 'muted', '아직 원칙이 없어요. 목표를 먼저 만든 다음 연결해 주세요.'));
      for (const principle of principleRows) {
        const card = node('div', 'card stack');
        const update = async (key, value) => {
          await db.notToDo.update(principle.id, { [key]: value });
          principle[key] = value;
          await refresh();
        };
        field(card, '하지 않을 일', principle.title, value => update('title', value));
        field(card, '만약 이런 상황이라면, 이렇게 할게요', principle.ifThen, value => update('ifThen', value), 'textarea');
        const choices = goalChoices();
        if (principle.goalId != null && !goalRows.some(goal => sameId(goal.id, principle.goalId))) choices.push([principle.goalId, '연결된 목표를 다시 선택해 주세요']);
        const link = select(card, '연결된 목표 · 필수', principle.goalId ?? '', choices, async value => {
          const goal = goalRows.find(row => sameId(row.id, value));
          if (!goal || !await db.goal.get(goal.id)) throw new Error('원칙에는 연결할 목표가 필요해요.');
          await update('goalId', goal.id);
        });
        link.required = true;
        link.dataset.goalLink = '';
        field(card, '활성', principle.active, async value => {
          if (value && (principle.goalId == null || !await db.goal.get(principle.goalId))) throw new Error('먼저 목표를 연결해 주세요.');
          await update('active', value);
        }, 'checkbox');
        longDelete(card, '원칙 삭제', async () => {
          const snapshot = await db.notToDo.get(principle.id);
          if (!snapshot) return;
          await ctx.removeWithUndo(async () => {
            await db.transaction('rw', db.notToDo, db.notToDoLog, async () => {
              if (await db.notToDoLog.where('notToDoId').equals(principle.id).count()) throw new Error('실천 기록이 있는 원칙은 삭제 대신 비활성화해 주세요.');
              await db.notToDo.delete(principle.id);
            });
            await renderPrinciples(); await refresh();
          }, async () => {
            if (!await db.goal.get(snapshot.goalId)) throw new Error('연결된 목표를 먼저 복원해야 이 원칙을 복원할 수 있어요.');
            await db.notToDo.put(snapshot); await renderPrinciples(); await refresh();
          });
        });
        principleList.append(card);
      }
    };
    goalsSection.append(button('목표 추가', () => enqueue(async () => {
      await db.goal.add({ title: '', why: '', deadline: '', want: 5, status: 'paused', f24h:false, fTop10:false, fIncome2x:false, createdAt:Date.now() });
      await renderGoals(); updateGoalLinks(); await refresh();
      goalList.lastElementChild?.querySelector('input')?.focus();
    })));
    principleSection.append(button('하지 않을 일 추가', () => enqueue(async () => {
      if (!goalRows.length) throw new Error('원칙과 연결할 목표를 먼저 만들어 주세요.');
      const goal = goalRows.find(row => row.status === 'active') || goalRows[0];
      await db.notToDo.add({ title: '', ifThen: '', goalId: goal.id, active: false, createdAt:Date.now() });
      await renderPrinciples(); await refresh();
      principleList.lastElementChild?.querySelector('input')?.focus();
    })));
    await renderGoals();
    await renderPrinciples();

    const questionsSection = section('영역별 질문', '영역을 펼쳐 수정하세요. 질문은 자동 저장되며, 손잡이나 위·아래 버튼으로 순서를 바꿀 수 있어요.');
    const questionGroups = node('div', 'stack');
    questionsSection.append(questionGroups);
    for (const domain of domains()) {
      const group = node('details', 'stack');
      group.append(node('summary', 'section-title', domain.label));
      const list = node('div', 'stack');
      group.append(list);
      questionGroups.append(group);
      let rows = [];
      let dragging = null;
      const reorder = async (sourceId, targetId, after = false) => {
        if (sameId(sourceId, targetId)) return;
        const fresh = (await db.question.toArray()).filter(row => sameId(row.domain, domain.id));
        fresh.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        const source = fresh.find(row => sameId(row.id, sourceId));
        if (!source) return;
        const next = fresh.filter(row => !sameId(row.id, sourceId));
        const targetIndex = next.findIndex(row => sameId(row.id, targetId));
        if (targetIndex < 0) return;
        next.splice(targetIndex + (after ? 1 : 0), 0, source);
        await db.transaction('rw', db.question, async () => {
          for (let index = 0; index < next.length; index++) await db.question.update(next[index].id, { order: index });
        });
        await renderQuestions(); await refresh();
        [...list.children].find(card => card.dataset.questionId === String(sourceId))?.querySelector('[data-move]')?.focus();
      };
      const renderQuestions = async () => {
        rows = (await db.question.toArray()).filter(row => sameId(row.domain, domain.id));
        rows.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
        if (!alive || !root.isConnected) return;
        list.replaceChildren();
        if (!rows.length) list.append(node('p', 'muted', '질문을 추가해 보세요.'));
        rows.forEach((question, index) => {
          const card = node('div', 'card stack');
          card.dataset.questionId = String(question.id);
          const controls = node('div', 'row');
          const handle = button('↕ 순서 이동', null, 'chip');
          handle.draggable = true;
          handle.style.minHeight = '44px';
          handle.setAttribute('aria-label', `${question.text || '질문'} 끌어서 순서 이동`);
          handle.addEventListener('dragstart', event => {
            dragging = question.id;
            event.dataTransfer?.setData('text/plain', String(question.id));
            if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
          });
          handle.addEventListener('dragend', () => { dragging = null; });
          card.addEventListener('dragover', event => {
            if (dragging != null) { event.preventDefault(); if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'; }
          });
          listen(card, 'drop', async event => {
            event.preventDefault();
            const source = dragging; dragging = null;
            if (source == null) return;
            const rect = card.getBoundingClientRect();
            await enqueue(() => reorder(source, question.id, event.clientY > rect.top + rect.height / 2));
          });
          controls.append(handle);
          for (const [offset, label] of [[-1, '위로'], [1, '아래로']]) {
            const move = button(label, () => enqueue(() => reorder(question.id, rows[index + offset]?.id, offset > 0)), 'icon-btn');
            move.style.minWidth = '44px'; move.style.minHeight = '44px';
            move.dataset.move = '';
            move.disabled = index + offset < 0 || index + offset >= rows.length;
            move.setAttribute('aria-label', `${question.text || '질문'} ${label} 이동`);
            controls.append(move);
          }
          card.append(controls);
          const update = async (key, value) => {
            if (key === 'text' && !value.trim()) throw new Error('질문 내용을 입력해 주세요.');
            const changes = { [key]: value };
            if (key === 'kind') changes.multi = false;
            await db.question.update(question.id, changes); Object.assign(question, changes); await refresh();
          };
          field(card, '질문', question.text, value => update('text', value));
          const kinds = [...KINDS];
          if (question.kind && !kinds.some(([kind]) => kind === question.kind)) kinds.push([question.kind, question.kind]);
           select(card, '응답 방식', question.kind || 'text', kinds, value => update('kind', value));
           field(card, '여러 개 선택 허용', !!question.multi, value=>update('multi',value), 'checkbox');
          field(card, '선택 항목 · 쉼표로 구분', Array.isArray(question.options) ? question.options.join(', ') : question.options || '', value =>
            update('options', [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))]));
          field(card, '질문 사용', question.active !== false, value => update('active', value), 'checkbox');
          longDelete(card, '질문 삭제', async () => {
            const snapshot = await db.question.get(question.id);
            if (!snapshot) return;
            await ctx.removeWithUndo(async () => {
              await db.question.delete(question.id); await renderQuestions(); await refresh();
            }, async () => {
              await db.question.put(snapshot); await renderQuestions(); await refresh();
            });
          });
          list.append(card);
        });
      };
      group.append(button('질문 추가', () => enqueue(async () => {
        const existing = (await db.question.toArray()).filter(row => sameId(row.domain, domain.id));
        const key = `custom-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
        await db.question.add({ domain: domain.id, key, text: '새 질문', kind: 'text', options: [], multi: false, active: true,
          order: existing.reduce((max, row) => Math.max(max, Number(row.order) || 0), -1) + 1 });
        await renderQuestions(); await refresh();
        list.lastElementChild?.querySelector('input')?.focus();
      })));
      await renderQuestions();
    }

    const daySection = section('하루의 시작', '선택한 시각에 새 하루가 시작돼요. 변경하면 오늘의 날짜와 기록 화면이 새로 계산돼요.');
    select(daySection, '하루 시작 시각', dayStart ?? 0, [[0, '자정 · 00:00'], [3, '새벽 3시 · 03:00'], [4, '새벽 4시 · 04:00']], async value => {
      await setMeta('dayStartHour', Number(value)); await refresh();
    });

    const backupSection = section('백업과 복원', '백업에는 목표와 기록이 담겨요. 가져오기는 현재 데이터를 모두 대체하므로 먼저 백업해 주세요.');
    const lastBackup = node('p', 'muted');
    const showLastBackup = async () => {
      const value = await getMeta('lastBackupAt');
      lastBackup.textContent = value ? `최근 백업 다운로드 요청: ${typeof value === 'number' ? localStamp(new Date(value)) : String(value)}` : '아직 백업한 적이 없어요.';
    };
    await showLastBackup(); backupSection.append(lastBackup);
    backupSection.append(button('JSON 백업 다운로드', () => enqueue(async () => {
      const data = await exportData();
      const backupAt=Date.now();
      data.tables.meta=data.tables.meta.filter(m=>m.key!=='lastBackupAt');
      data.tables.meta.push({key:'lastBackupAt',value:backupAt});
      const blob = data instanceof Blob ? data : new Blob([typeof data === 'string' ? data : JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = node('a');
      anchor.href = url;
      anchor.download = `oneul-backup-${localStamp().replace(/[: ]/g, '-')}.json`;
      anchor.hidden = true;
      document.body.append(anchor);
      try {
        anchor.click();
        await setMeta('lastBackupAt', backupAt);
        await refresh();
        await showLastBackup();
        notify('백업 다운로드를 요청했어요. 다운로드 폴더에서 파일을 확인해 주세요.');
      } finally { anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 60000); }
    })));
    const fileInput = node('input');
    fileInput.type = 'file'; fileInput.accept = '.json,application/json';
    fileInput.hidden = true;
    fileInput.setAttribute('aria-label', '복원할 JSON 백업 파일');
    const importButton = button('JSON 백업 가져오기', () => fileInput.click());
    let importing = false;
    listen(fileInput, 'change', async () => {
      const file = fileInput.files?.[0];
      if (!file || importing) return;
      importing = true; importButton.disabled = true; root.inert = true;
      try {
        // Finish edits before reading/validating and never confirm an invalid file.
        await flushSettingsWrites();
        const data = JSON.parse(await file.text());
        const validation = await validateBackup(data);
        if (validation === false || validation?.valid === false || validation?.ok === false) {
          throw new Error(validation?.error || validation?.errors?.join(', ') || '유효한 백업 파일이 아니에요.');
        }
        if (!window.confirm('현재의 모든 목표와 기록을 이 백업으로 대체할까요? 이 작업은 되돌릴 수 없어요.')) return;
        await enqueue(async () => {
          await ctx.beforeImport?.();
          await importData(data);
          await ctx.applyTheme(); await refresh();
        });
        notify('백업을 복원했어요.');
        if (alive && root.isConnected) { alive = false; await renderSettings(host, ctx); }
      } finally { fileInput.value = ''; importing = false; importButton.disabled = false; root.inert = false; }
    });
    backupSection.append(importButton, fileInput);

    const storageSection = section('브라우저 저장 상태', '영구 저장을 요청해도 브라우저가 거부할 수 있어요. 사이트 데이터 삭제나 기기 변경에 대비해 JSON 백업을 따로 보관해 주세요.');
    const storageStatus = node('p', 'muted');
    storageStatus.setAttribute('role', 'status');
    storageSection.append(storageStatus);
    const showStorage = async () => {
      const stored = await getMeta('persistence');
      if (navigator.storage?.persisted) {
        const persisted = await navigator.storage.persisted();
        storageStatus.textContent = persisted ? '현재 브라우저: 영구 저장 허용됨' : '현재 브라우저: 영구 저장이 허용되지 않았어요. 정기적으로 백업해 주세요.';
        await setMeta('persistence', persisted);
      } else {
        const previous = typeof stored === 'object' && stored !== null ? stored.granted ?? stored.persisted : stored;
        storageStatus.textContent = `이 브라우저는 영구 저장 상태 확인을 지원하지 않아요.${previous === true ? ' 이전에 저장된 상태: 허용됨.' : ''} 백업을 따로 보관해 주세요.`;
      }
    };
    try { await showStorage(); }
    catch (error) { storageStatus.textContent = '저장 상태를 확인하지 못했어요. 백업을 보관해 주세요.'; report(error); }
    const persistButton = button('영구 저장 다시 요청', async () => {
      if (!navigator.storage?.persist) { notify('이 브라우저는 영구 저장 요청을 지원하지 않아요. JSON 백업을 이용해 주세요.'); return; }
      persistButton.disabled = true;
      try {
        const granted = await navigator.storage.persist();
        await setMeta('persistence', granted); await showStorage();
        notify(granted ? '영구 저장이 허용됐어요. 백업도 계속 보관해 주세요.' : '브라우저가 요청을 허용하지 않았어요. JSON 백업은 계속 사용할 수 있어요.');
      } finally { persistButton.disabled = false; }
    });
    storageSection.append(persistButton);
  } catch (error) {
    report(error);
    root.append(node('p', 'muted', '설정을 불러오지 못했어요. 닫은 뒤 다시 열어 주세요.'));
  }
}
