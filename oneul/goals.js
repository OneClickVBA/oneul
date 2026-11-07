import { db, getMeta, setMeta } from './db.js';

// One queue for every mounted goals screen. Never put ctx callbacks inside it:
// navigation callbacks may themselves call flushGoalWrites().
let writes = Promise.resolve();
const writeErrors = [];
const undoTickets = new Set();
const sessions = new WeakMap();
const SELECTED_KEY = 'oneul.goals.selected';
const enqueue = action => {
  const result = writes.then(action);
  writes = result.catch(error => { writeErrors.push(error); });
  return result;
};

/** Drain even writes added while waiting; reject if any queued save failed.
 * Call before navigation, export or import. Invalidates outstanding undo offers
 * so a toast from before an import cannot resurrect old records afterwards.
 */
export async function flushGoalWrites() {
  undoTickets.clear();
  let checkpoint;
  do { checkpoint = writes; await checkpoint; } while (checkpoint !== writes);
  // A delete finishing during the drain may have just offered a new undo.
  undoTickets.clear();
  if (writeErrors.length) {
    throw new AggregateError(writeErrors.splice(0), '일부 목표 변경을 저장하지 못했어요. 입력을 확인하고 다시 시도해 주세요.');
  }
}

const el = (tag, className = '', text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
const ordered = rows => [...rows].sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || a.id - b.id);
const nextOrder = rows => rows.reduce((n, row) => Math.max(n, Number(row.order) || 0), -1) + 1;
const statusNames = { active: '진행 중', done: '완료', paused: '일시 정지' };

/** Only this host's descendants receive listeners; app.js is deliberately not imported. */
export async function renderGoals(host, ctx) {
  sessions.get(host)?.dispose();
  const abort = new AbortController();
  const timers = new Set();
  let alive = true;
  const session = { dispose() {
    alive = false;
    abort.abort();
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
  } };
  sessions.set(host, session);
  const root = el('main', 'wrap goals-screen');
  root.inert = true;
  host.replaceChildren(root);
  const live = () => alive && root.parentNode === host;
  const report = error => ctx.toast(error?.message || '저장하지 못했어요. 다시 시도해 주세요.');
  const listen = (node, type, fn) => node.addEventListener(type, event => {
    if (!live()) return;
    // fn runs synchronously until its first await: input values must be
    // captured here, not in a deferred Promise.then event wrapper.
    try { Promise.resolve(fn(event)).catch(report); } catch (error) { report(error); }
  }, { signal: abort.signal });
  const button = (label, action, className = 'btn', name = 'control') => {
    const node = el('button', className, label);
    node.type = 'button';
    node.dataset.gaction = name;
    if (action) listen(node, 'click', action);
    return node;
  };
  const changed = async () => { if (ctx.changed) await ctx.changed(); };
  const save = async action => {
    await enqueue(action);
    await changed();
  };
  const field = (parent, label, value, onInput, type = 'text') => {
    const wrap = el('label', 'g-field');
    wrap.append(el('span', 'g-field-label', label));
    const input = el(type === 'textarea' ? 'textarea' : 'input', 'field');
    if (type !== 'textarea') input.type = type;
    else input.rows = 2;
    input.value = value ?? '';
    input.dataset.gaction = 'edit';
    if (onInput) listen(input, 'input', () => {
      const value = input.value;
      return onInput(value, input);
    });
    wrap.append(input);
    parent.append(wrap);
    return input;
  };
  // No temporary database rows: Escape and clearing an add field discard its draft.
  const composer = (parent, label, placeholder, create) => {
    const form = el('form', 'g-composer');
    const input = field(form, label, '', null);
    input.placeholder = placeholder;
    input.required = true;
    const add = button('+', null, 'btn primary g-add', 'add');
    add.type = 'submit';
    add.setAttribute('aria-label', `${label} 추가`);
    add.disabled = true;
    let busy = false;
    const availability = () => { add.disabled = busy || !input.value.trim(); };
    listen(input, 'input', availability);
    listen(input, 'keydown', event => {
      if (event.key === 'Escape') { input.value = ''; availability(); }
      if (event.key === 'Enter' && event.isComposing) event.preventDefault();
    });
    listen(form, 'submit', async event => {
      event.preventDefault();
      const title = input.value.trim();
      if (busy || !title) return;
      busy = true; input.readOnly = true; availability();
      try {
        await create(title);
        input.value = '';
      } finally {
        busy = false; input.readOnly = false; availability();
        if (live() && input.isConnected) input.focus();
      }
    });
    form.append(add);
    parent.append(form);
    return input;
  };
  const longDelete = (parent, label, remove) => {
    const control = button('삭제 · 길게', null, 'btn g-delete', 'delete');
    control.setAttribute('aria-label', `${label}: 1초간 누르거나 Delete 키`);
    control.title = '1초간 누르거나 Delete 키로 삭제 · 3초 안에 되돌리기';
    let timer, start, busy = false, suppressClick = false;
    const cancel = () => {
      clearTimeout(timer); timers.delete(timer); timer = null; start = null;
      control.classList.remove('g-holding');
    };
    const fire = async () => {
      cancel();
      if (busy || !live() || !control.isConnected) return;
      suppressClick = true;
      busy = true; control.disabled = true;
      try { await remove(); }
      finally { busy = false; control.disabled = false; }
    };
    listen(control, 'pointerdown', event => {
      if (event.button !== 0 || busy) return;
      suppressClick = false;
      cancel(); start = [event.clientX, event.clientY];
      control.setPointerCapture?.(event.pointerId);
      control.classList.add('g-holding');
      timer = setTimeout(() => { if (live()) fire().catch(report); else cancel(); }, 1000);
      timers.add(timer);
    });
    listen(control, 'pointermove', event => {
      if (start && Math.hypot(event.clientX - start[0], event.clientY - start[1]) > 10) cancel();
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'blur']) listen(control, type, cancel);
    listen(control, 'contextmenu', event => event.preventDefault());
    listen(control, 'keydown', event => {
      if (event.key === 'Delete' && !event.repeat) { event.preventDefault(); return fire(); }
      if (event.key === 'Escape') cancel();
    });
    listen(control, 'click', () => {
      if (suppressClick) { suppressClick = false; return; }
      ctx.toast('삭제하려면 1초간 누르거나 Delete 키를 눌러 주세요.');
    });
    parent.append(control);
    return control;
  };
  const offerUndo = (message, restore) => {
    const ticket = {};
    undoTickets.add(ticket);
    const expires = Date.now() + 3000;
    const timer = setTimeout(() => { undoTickets.delete(ticket); timers.delete(timer); }, 3000);
    timers.add(timer);
    ctx.toast(message, async () => {
      if (!undoTickets.has(ticket) || Date.now() >= expires) {
        ctx.toast('되돌릴 수 있는 3초가 지났어요.'); return;
      }
      undoTickets.delete(ticket);
      clearTimeout(timer); timers.delete(timer);
      // Queue immediately, before yielding, so a concurrent flush includes undo.
      const result = enqueue(restore);
      try { await result; await changed(); }
      catch (error) { report(error); }
    });
  };

  const brand = el('header', 'brand g-brand');
  const wordmark = el('div', 'wordmark', '오늘');
  wordmark.append(el('small', '', 'oneul'));
  const nav = el('nav', 'g-tabs');
  nav.setAttribute('aria-label', '주요 화면');
  nav.append(button('오늘', async () => { await flushGoalWrites(); await ctx.returnToday(); }, 'btn', 'today'));
  const currentTab = button('목표', null, 'btn primary', 'goals');
  currentTab.setAttribute('aria-current', 'page');
  nav.append(currentTab);
  const settings = button('설정', async () => { await flushGoalWrites(); await ctx.openSettings(); }, 'btn', 'settings');
  brand.append(wordmark, nav, settings);
  root.append(brand);
  const heading = el('header', 'g-heading');
  heading.append(el('h1', '', '목표를 작은 걸음으로'), el('p', 'muted', '목표 하나, 중간 이정표, 지금 할 수 있는 일.'));
  root.append(heading);
  const layout = el('div', 'g-layout');
  const sidebar = el('aside', 'card g-sidebar');
  sidebar.setAttribute('aria-label', '모든 목표');
  sidebar.append(el('h2', 'section-title', '나의 목표'));
  const goalList = el('div', 'g-goal-list');
  sidebar.append(goalList);
  const detail = el('section', 'g-detail');
  detail.setAttribute('aria-label', '선택한 목표의 작은 걸음');
  layout.append(sidebar, detail); root.append(layout);
  const feedback = el('p', 'muted g-feedback');
  feedback.setAttribute('role', 'status'); root.append(feedback);

  let goals = [], milestones = [], tasks = [], selected = null;
  let selectionVersion = 0;
  const goalButtons = new Map();
  let progress;
  const progressText = goalId => {
    const ids = new Set(milestones.filter(row => row.goalId === goalId).map(row => row.id));
    const included = tasks.filter(row => ids.has(row.milestoneId) && row.status !== 'dropped');
    return `${included.filter(row => row.status === 'done').length} / ${included.length}`;
  };
  const updateProgress = () => {
    for (const [id, refs] of goalButtons) refs.count.textContent = `${progressText(id)} 완료`;
    if (progress) progress.textContent = `${progressText(selected)} 완료 · 그만둔 일 제외`;
  };
  const touch = (id, date) => enqueue(async () => {
    await db.transaction('rw', db.goal, db.goalTouch, db.meta, async () => {
      if (!await db.goal.get(id)) return;
      await db.goalTouch.put({ date, goalId: id });
      await setMeta(SELECTED_KEY, id);
    });
  });
  const selectGoal = async id => {
    const date = ctx.today(); // Capture the app's local day before waiting.
    selected = id; selectionVersion++;
    for (const [key, refs] of goalButtons) refs.button.setAttribute('aria-pressed', String(key === id));
    showDetail();
    await touch(id, date);
    await changed();
  };
  const showGoals = () => {
    goalList.replaceChildren(); goalButtons.clear();
    if (!goals.length) goalList.append(el('p', 'muted', '아직 목표가 없어요. 이루고 싶은 것 하나를 적어 보세요.'));
    for (const goal of goals) {
      const choice = button('', () => selectGoal(goal.id), 'g-goal-choice', 'select-goal');
      choice.setAttribute('aria-pressed', String(selected === goal.id));
      const chip = el('span', `g-status g-status-${goal.status}`, statusNames[goal.status] || '일시 정지');
      const count = el('span', 'muted', `${progressText(goal.id)} 완료`);
      choice.append(chip, el('strong', '', goal.title || '제목 없는 목표'), count);
      goalList.append(choice); goalButtons.set(goal.id, { button: choice, count });
    }
  };

  const patch = (table, row, key, value) => {
    row[key] = value;
    return save(async () => {
      if (!await db[table].update(row.id, { [key]: value })) throw new Error('항목이 없어 저장하지 못했어요. 화면을 다시 열어 주세요.');
    });
  };
  const showDetail = () => {
    detail.replaceChildren(); progress = null;
    const goal = goals.find(row => row.id === selected);
    if (!goal) {
      const empty = el('div', 'card g-empty');
      empty.append(el('h2', '', '작게 시작해도 괜찮아요'), el('p', 'muted', '목표를 만들거나 선택하면 마일스톤과 할 일을 나눌 수 있어요.'));
      detail.append(empty); return;
    }
    const version = selectionVersion;
    const visible = () => live() && version === selectionVersion;
    const overview = el('header', 'card g-overview');
    overview.append(el('span', `g-status g-status-${goal.status}`, statusNames[goal.status] || '일시 정지'), el('h2', '', goal.title || '제목 없는 목표'));
    overview.append(el('p', 'g-why', goal.why || '이 목표가 중요한 이유를 설정에서 적어 보세요.'));
    overview.append(el('p', 'muted', goal.deadline ? `마감일 · ${goal.deadline}` : '마감일을 정하지 않았어요.'));
    progress = el('p', 'g-progress', `${progressText(selected)} 완료 · 그만둔 일 제외`);
    overview.append(progress); detail.append(overview);
    const sectionHeading = el('div', 'g-section-heading');
    sectionHeading.append(el('h3', 'section-title', '마일스톤'), el('span', 'muted', '입력하면 자동 저장돼요'));
    detail.append(sectionHeading);
    const list = el('div', 'g-milestones'); detail.append(list);
    const views = new Map();
    const refreshOrder = focus => {
      const rows = ordered(milestones.filter(row => row.goalId === goal.id));
      for (const [index, row] of rows.entries()) {
        const view = views.get(row.id);
        if (!view) continue;
        list.append(view.card); // Move existing nodes, never rebuild typed inputs.
        view.up.disabled = index === 0; view.down.disabled = index === rows.length - 1;
      }
      if (!rows.length && !list.querySelector('.g-milestone-empty')) list.append(el('p', 'muted g-milestone-empty', '첫 번째 마일스톤을 적어 보세요.'));
      if (rows.length) list.querySelector('.g-milestone-empty')?.remove();
      if (focus) views.get(focus.id)?.[focus.direction]?.focus();
    };
    const move = async (id, offset) => {
      await enqueue(async () => {
        await db.transaction('rw', db.milestone, async () => {
          const rows = ordered(await db.milestone.where('goalId').equals(goal.id).toArray());
          const index = rows.findIndex(row => row.id === id), target = index + offset;
          if (index < 0 || target < 0 || target >= rows.length) return;
          [rows[index], rows[target]] = [rows[target], rows[index]];
          for (const [order, row] of rows.entries()) await db.milestone.update(row.id, { order });
          for (const [order, row] of rows.entries()) {
            const local = milestones.find(item => item.id === row.id);
            if (local) local.order = order;
          }
        });
      });
      if (visible()) refreshOrder({ id, direction: offset < 0 ? 'up' : 'down' });
      await changed();
    };
    const mountMilestone = milestone => {
      const card = el('article', 'card g-milestone');
      card.dataset.milestoneId = String(milestone.id);
      const tools = el('div', 'g-milestone-tools');
      const up = button('↑', () => move(milestone.id, -1), 'btn g-move', 'move-up');
      const down = button('↓', () => move(milestone.id, 1), 'btn g-move', 'move-down');
      up.setAttribute('aria-label', '마일스톤 위로 이동'); down.setAttribute('aria-label', '마일스톤 아래로 이동');
      tools.append(up, down);
      longDelete(tools, '마일스톤과 연결된 할 일 삭제', async () => {
        let snapshot, children;
        await enqueue(async () => {
          await db.transaction('rw', db.milestone, db.task, async () => {
            snapshot = await db.milestone.get(milestone.id);
            if (!snapshot) return;
            children = await db.task.where('milestoneId').equals(milestone.id).toArray();
            await db.task.where('milestoneId').equals(milestone.id).delete();
            await db.milestone.delete(milestone.id);
          });
        });
        if (!snapshot) return;
        milestones = milestones.filter(row => row.id !== milestone.id);
        tasks = tasks.filter(row => row.milestoneId !== milestone.id);
        if (visible()) { card.remove(); views.delete(milestone.id); refreshOrder(); addMilestone.focus(); }
        updateProgress();
        offerUndo('마일스톤과 할 일을 지웠어요. 3초 안에 되돌릴 수 있어요.', async () => {
          await db.transaction('rw', db.goal, db.milestone, db.task, async () => {
            if (!await db.goal.get(snapshot.goalId)) throw new Error('연결된 목표가 없어 복원할 수 없어요.');
            if (await db.milestone.get(snapshot.id)) throw new Error('같은 번호의 마일스톤이 있어 복원하지 않았어요.');
            for (const task of children) if (await db.task.get(task.id)) throw new Error('같은 번호의 할 일이 있어 복원하지 않았어요.');
            await db.milestone.add(snapshot);
            if (children.length) await db.task.bulkAdd(children);
          });
          milestones.push(snapshot); tasks.push(...children);
          if (visible()) { mountMilestone(snapshot); refreshOrder(); }
          else if (live()) showDetail();
          updateProgress();
        });
        await changed();
      });
      card.append(tools);
      field(card, '마일스톤 제목', milestone.title, value => patch('milestone', milestone, 'title', value));
      field(card, '마일스톤 마감일', milestone.deadline, value => patch('milestone', milestone, 'deadline', value), 'date');
      const taskList = el('div', 'g-task-list');
      const dropped = el('details', 'g-dropped');
      const summary = el('summary');
      const droppedList = el('div', 'g-dropped-list');
      dropped.append(summary, droppedList);
      card.append(taskList, dropped);
      const taskViews = new Map();
      const refreshTasks = () => {
        const rows = ordered(tasks.filter(row => row.milestoneId === milestone.id));
        for (const task of rows) {
          const view = taskViews.get(task.id);
          if (view) (task.status === 'dropped' ? droppedList : taskList).append(view);
        }
        const count = rows.filter(row => row.status === 'dropped').length;
        summary.textContent = `그만둔 일 ${count}개`; dropped.hidden = count === 0;
        updateProgress();
      };
      const mountTask = task => {
        const item = el('div', 'g-task'); item.dataset.taskId = String(task.id);
        const top = el('div', 'g-task-top');
        const checkLabel = el('label', 'g-check');
        const check = el('input'); check.type = 'checkbox'; check.checked = task.status === 'done';
        check.dataset.gaction = 'toggle-task'; check.setAttribute('aria-label', '할 일 완료');
        checkLabel.append(check, el('span', '', '완료'));
        const stateLabel = el('span', 'muted');
        top.append(checkLabel, stateLabel);
        const dropButton = button('그만두기', () => {
          editor.hidden = !editor.hidden;
          dropButton.setAttribute('aria-expanded', String(!editor.hidden));
          if (!editor.hidden) reason.focus();
        }, 'btn', 'open-drop');
        dropButton.setAttribute('aria-expanded', 'false'); top.append(dropButton);
        const restore = button('다시 시작', async () => {
          await enqueue(async () => {
            if (!await db.task.update(task.id, { status: 'todo', dropReason: '' })) throw new Error('할 일이 없어 복원할 수 없어요.');
          });
          task.status = 'todo'; task.dropReason = ''; reason.value = ''; confirm.disabled = true;
          updateState(); refreshTasks(); await changed();
        }, 'btn', 'restore-task'); top.append(restore);
        longDelete(top, '할 일 완전히 삭제', async () => {
          let snapshot;
          await enqueue(async () => {
            await db.transaction('rw', db.task, async () => {
              snapshot = await db.task.get(task.id);
              if (snapshot) await db.task.delete(task.id);
            });
          });
          if (!snapshot) return;
          tasks = tasks.filter(row => row.id !== task.id);
          item.remove(); taskViews.delete(task.id); refreshTasks();
          if (visible()) addTask.focus();
          offerUndo('할 일을 지웠어요. 3초 안에 되돌릴 수 있어요.', async () => {
            await db.transaction('rw', db.milestone, db.task, async () => {
              if (!await db.milestone.get(snapshot.milestoneId)) throw new Error('연결된 마일스톤이 없어 복원할 수 없어요.');
              if (await db.task.get(snapshot.id)) throw new Error('같은 번호의 할 일이 있어 복원하지 않았어요.');
              await db.task.add(snapshot);
            });
            tasks.push(snapshot);
            if (visible() && card.isConnected) { mountTask(snapshot); refreshTasks(); }
            else if (live()) showDetail();
            updateProgress();
          });
          await changed();
        });
        item.append(top);
        const title = field(item, '할 일', task.title, value => patch('task', task, 'title', value));
        const meta = el('div', 'g-task-meta');
        const priorityLabel = el('label', 'g-field'); priorityLabel.append(el('span', 'g-field-label', '우선순위'));
        const priority = el('select', 'field'); priority.dataset.gaction = 'priority';
        for (const [value, label] of [['high', '높음'], ['normal', '보통'], ['low', '낮음']]) {
          const option = el('option', '', label); option.value = value; priority.append(option);
        }
        priority.value = task.priority || 'normal';
        listen(priority, 'change', () => { const value = priority.value; return patch('task', task, 'priority', value); });
        priorityLabel.append(priority); meta.append(priorityLabel);
        const whenWhere = field(meta, '언제 · 어디서', task.whenWhere, value => patch('task', task, 'whenWhere', value));
        whenWhere.placeholder = '예: 저녁 식사 후, 책상에서'; item.append(meta);
        const editor = el('div', 'g-drop-editor'); editor.hidden = true;
        const reason = field(editor, '지금 안다면 다시 시작할까?', '', null, 'textarea');
        reason.placeholder = '그만두려는 이유를 적어 주세요.';
        const actions = el('div', 'g-drop-actions');
        const confirm = button('그만두기', async () => {
          const dropReason = reason.value.trim();
          if (!dropReason) return;
          confirm.disabled = true;
          try {
            await enqueue(async () => {
              if (!await db.task.update(task.id, { status: 'dropped', dropReason })) throw new Error('할 일이 없어 변경하지 못했어요.');
            });
            task.status = 'dropped'; task.dropReason = dropReason;
            editor.hidden = true; dropButton.setAttribute('aria-expanded', 'false');
            updateState(); refreshTasks(); if (visible()) addTask.focus();
            await changed();
          } finally { confirm.disabled = !reason.value.trim(); }
        }, 'btn primary', 'confirm-drop'); confirm.disabled = true;
        listen(reason, 'input', () => { confirm.disabled = !reason.value.trim(); });
        listen(reason, 'keydown', event => { if (event.key === 'Escape') { editor.hidden = true; dropButton.setAttribute('aria-expanded', 'false'); dropButton.focus(); } });
        actions.append(button('취소', () => { editor.hidden = true; dropButton.setAttribute('aria-expanded', 'false'); dropButton.focus(); }, 'btn', 'cancel-drop'), confirm);
        editor.append(actions); item.append(editor);
        const reasonText = el('p', 'g-drop-reason'); item.append(reasonText);
        const updateState = () => {
          const isDropped = task.status === 'dropped';
          check.checked = task.status === 'done'; check.disabled = isDropped;
          stateLabel.textContent = isDropped ? '그만둠' : check.checked ? '완료했어요' : '진행할 일';
          item.classList.toggle('g-task-done', check.checked);
          title.disabled = priority.disabled = whenWhere.disabled = isDropped;
          dropButton.hidden = isDropped; restore.hidden = !isDropped;
          reasonText.hidden = !isDropped;
          reasonText.textContent = isDropped ? `그만둔 이유 · ${task.dropReason || '기록된 이유가 없어요.'}` : '';
        };
        listen(check, 'change', async () => {
          const status = check.checked ? 'done' : 'todo';
          task.status = status; updateState(); updateProgress();
          await save(async () => {
            if (!await db.task.update(task.id, { status })) throw new Error('할 일이 없어 변경하지 못했어요.');
          });
        });
        updateState(); taskViews.set(task.id, item);
      };
      for (const task of ordered(tasks.filter(row => row.milestoneId === milestone.id))) mountTask(task);
      const addTask = composer(card, '할 일', '다음에 할 수 있는 작은 행동', async title => {
        let row;
        await enqueue(async () => {
          await db.transaction('rw', db.goal, db.milestone, db.task, async () => {
            if (!await db.goal.get(goal.id) || !await db.milestone.get(milestone.id)) throw new Error('연결된 목표나 마일스톤이 없어요.');
            const existing = await db.task.where('milestoneId').equals(milestone.id).toArray();
            row = { milestoneId: milestone.id, title, priority: 'normal', whenWhere: '', status: 'todo', order: nextOrder(existing), createdAt: Date.now() };
            row.id = await db.task.add(row);
          });
        });
        tasks.push(row);
        if (visible() && card.isConnected) { mountTask(row); refreshTasks(); }
        updateProgress(); await changed();
      });
      views.set(milestone.id, { card, up, down }); list.append(card); refreshTasks();
    };
    for (const milestone of ordered(milestones.filter(row => row.goalId === goal.id))) mountMilestone(milestone);
    const addMilestone = composer(detail, '마일스톤', '목표까지의 첫 번째 이정표', async title => {
      let row;
      await enqueue(async () => {
        await db.transaction('rw', db.goal, db.milestone, async () => {
          if (!await db.goal.get(goal.id)) throw new Error('연결된 목표가 없어요.');
          const existing = await db.milestone.where('goalId').equals(goal.id).toArray();
          row = { goalId: goal.id, title, deadline: '', order: nextOrder(existing), createdAt: Date.now() };
          row.id = await db.milestone.add(row);
        });
      });
      milestones.push(row);
      if (visible()) { mountMilestone(row); refreshOrder(); }
      await changed();
    });
    refreshOrder();
  };

  composer(sidebar, '새 목표', '이루고 싶은 목표 하나', async title => {
    const date = ctx.today();
    let row;
    await enqueue(async () => {
      await db.transaction('rw', db.goal, db.goalTouch, db.meta, async () => {
        const active = await db.goal.where('status').equals('active').count();
        row = { title, why: '', deadline: '', want: 5, status: active >= 3 ? 'paused' : 'active', f24h: false, fTop10: false, fIncome2x: false, createdAt: Date.now() };
        row.id = await db.goal.add(row);
        await db.goalTouch.put({ date, goalId: row.id }); await setMeta(SELECTED_KEY, row.id);
      });
    });
    goals.push(row); selected = row.id; selectionVersion++;
    if (live()) { showGoals(); showDetail(); }
    if (row.status === 'paused') ctx.toast('진행 중인 목표가 3개라 일시 정지 상태로 만들었어요.');
    await changed();
  });
  sidebar.append(el('p', 'muted g-settings-note', '이유·마감일·상태는 설정에서 바꿀 수 있어요.'));
  sidebar.append(button('목표 설정 열기', async () => { await flushGoalWrites(); await ctx.openSettings(); }, 'btn', 'goal-settings'));
  root.append(el('p', 'muted g-help', '삭제는 삭제 버튼을 1초간 누르거나 버튼에 초점을 두고 Delete 키를 누르세요. 3초 안에 되돌릴 수 있어요.'));
  try {
    // Serialize the initial snapshot after any previous screen's pending edits.
    await enqueue(async () => {
      await db.transaction('r', db.goal, db.milestone, db.task, db.meta, async () => {
        [goals, milestones, tasks, selected] = await Promise.all([
          db.goal.toArray(), db.milestone.toArray(), db.task.toArray(), getMeta(SELECTED_KEY, null),
        ]);
      });
    });
    if (!live()) return;
    if (!goals.some(row => row.id === selected)) selected = goals.find(row => row.status === 'active')?.id ?? goals[0]?.id ?? null;
    showGoals(); showDetail();
    if (selected !== null) await touch(selected, ctx.today());
  } catch (error) {
    if (live()) feedback.textContent = '목표를 불러오지 못했어요. 화면을 다시 열어 주세요.';
    report(error);
  } finally {
    if (live()) root.inert = false;
  }
}
