/* ============================================================
   Singly Linked List Simulator — engine + operations
   Vanilla JS. Nodes are absolutely-positioned divs; every arrow
   (next links, head/current/newNode references, annotations) is
   redrawn each animation frame from live DOM positions, so arrows
   follow the nodes smoothly while CSS transitions move them.
   ============================================================ */

'use strict';

/* ---------------- constants & global state ---------------- */

const NODE_W = 120, NODE_H = 64, GAP = 50;
const PAD_X = 34, ROW_Y = 170, FLOAT_DY = 168;

let baseList = null;               // committed list: [{id, data}, …] — ids stay stable across ops
let speed = 1;
let teachMode = false;
let currentOpName = 'addFirst';

let op = null;        // { name, java, steps, resultList, committed }
let stepIdx = -1;
let playing = false;
let playTimer = null;

let idCounter = 0;
let renderedSnap = null;           // snapshot currently on screen
let linkFx = {};                   // fromId -> expiry timestamp (fresh link accent)
let ghostLinks = [];               // { from, to, until } fading removed links
let teachOpen = false;

const DUR = () => 900 / speed;
const PLAY_DELAY = () => 2600 / speed;

const $ = id => document.getElementById(id);
const stage = $('stage');
const linkLayer = $('linkLayer');

/* ---------------- snapshot model ----------------
   snap = {
     order:    [id,...]            nodes in the main row, left→right
     floating: { id: {anchor} }    detached nodes drawn below the row
     nodes:    { id: {data} }
     next:     { id: id|null }
     refs:     { head, current?, newNode? }   id | null
     fade:[ids] hi:[ids] isNew:[ids]
     annos:    [{id, text}]        below-node labels (current.next …)
     size, sizeFlash, showIndex, vars:{name:value}
   } ------------------------------------------------ */

function freshSnap(items) {
  const snap = {
    order: [], floating: {}, nodes: {}, next: {},
    refs: { head: null },
    fade: [], hi: [], isNew: [], annos: [],
    size: items.length, sizeFlash: false, showIndex: false, vars: {}
  };
  let prev = null;
  for (const it of items) {
    snap.order.push(it.id);
    snap.nodes[it.id] = { data: it.data };
    if (prev) snap.next[prev] = it.id;
    prev = it.id;
  }
  if (prev) snap.next[prev] = null;
  snap.refs.head = snap.order[0] ?? null;
  return snap;
}

const clone = s => JSON.parse(JSON.stringify(s));

/* Ctx builds the step list for one operation by mutating a live
   snapshot and pushing deep-cloned frames of it. */
class Ctx {
  constructor(values) { this.snap = freshSnap(values); this.steps = []; }
  data(id) { return this.snap.nodes[id].data; }
  values() { return this.snap.order.map(id => ({ id, data: this.snap.nodes[id].data })); }
  clearFx() { this.snap.hi = []; this.snap.annos = []; this.snap.sizeFlash = false; }
  newFloating(data, anchor) {
    const id = 'n' + (++idCounter);
    this.snap.nodes[id] = { data };
    this.snap.floating[id] = { anchor };
    this.snap.next[id] = null;
    return id;
  }
  placeInOrder(id, idx) {
    delete this.snap.floating[id];
    this.snap.order.splice(idx, 0, id);
  }
  removeNode(id) {
    const s = this.snap;
    s.order = s.order.filter(x => x !== id);
    delete s.floating[id];
    delete s.next[id];
    delete s.nodes[id];
    s.fade = s.fade.filter(x => x !== id);
  }
  push(line, stmt, means, why, q, a, qPre) {
    this.steps.push({ line, stmt, means, why, q: q || null, a: a || null, qPre: !!qPre, snap: clone(this.snap) });
  }
}

/* ---------------- layout ---------------- */

function layout(snap) {
  const pos = {};
  snap.order.forEach((id, i) => { pos[id] = { x: PAD_X + i * (NODE_W + GAP), y: ROW_Y }; });
  for (const id in snap.floating) {
    pos[id] = { x: PAD_X + snap.floating[id].anchor * (NODE_W + GAP), y: ROW_Y + FLOAT_DY };
  }
  const nullX = PAD_X + snap.order.length * (NODE_W + GAP);
  return { pos, nullX };
}

/* ---------------- DOM rendering of a snapshot ---------------- */

function renderState(snap) {
  const prev = renderedSnap;
  const { pos, nullX } = layout(snap);

  // detect link changes for fresh/ghost arrow effects
  if (prev) {
    const now = performance.now();
    for (const id in snap.next) {
      const oldT = prev.next && id in prev.next ? prev.next[id] : undefined;
      const newT = snap.next[id];
      if (oldT !== undefined && oldT !== newT) {
        if (oldT !== null) ghostLinks.push({ from: id, to: oldT, until: now + DUR() });
        if (newT !== null) linkFx[id] = now + DUR() * 1.4;
      } else if (oldT === undefined && newT !== null) {
        linkFx[id] = now + DUR() * 1.4;
      }
    }
  }

  // ----- nodes -----
  const live = new Set([...snap.order, ...Object.keys(snap.floating)]);
  // remove elements for nodes no longer in the snapshot
  stage.querySelectorAll('.node').forEach(el => {
    const id = el.dataset.id;
    if (!live.has(id)) {
      el.classList.add('bye');
      setTimeout(() => el.remove(), 450);
    }
  });
  live.forEach(id => {
    let el = stage.querySelector(`.node[data-id="${id}"]`);
    const fresh = !el;
    if (fresh) {
      el = document.createElement('div');
      el.className = 'node';
      el.dataset.id = id;
      el.innerHTML = `<span class="idx hidden"></span>
        <div class="cell data"></div><div class="cell nextf"></div>`;
      const p = pos[id];
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.opacity = '0';
      stage.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = ''; });
    }
    el.querySelector('.data').textContent = snap.nodes[id].data;
    const nf = el.querySelector('.nextf');
    const isNull = snap.next[id] === null;
    nf.textContent = isNull ? 'null' : '•';
    nf.classList.toggle('isnull', isNull);
    const idxEl = el.querySelector('.idx');
    const rowIdx = snap.order.indexOf(id);
    if (snap.showIndex && rowIdx >= 0) {
      idxEl.textContent = rowIdx;
      idxEl.classList.remove('hidden');
    } else idxEl.classList.add('hidden');
    el.classList.toggle('hi', snap.hi.includes(id));
    el.classList.toggle('isnew', snap.isNew.includes(id));
    el.classList.toggle('fade', snap.fade.includes(id));
    if (!fresh) {
      const p = pos[id];
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
    }
  });

  // ----- reference labels (head / current / newNode) -----
  ['head', 'current', 'newNode'].forEach(name => {
    let lb = stage.querySelector(`.ref-label.r-${name}`);
    const has = name in snap.refs;
    const target = has ? snap.refs[name] : undefined;
    if (!has || (name !== 'head' && target === null)) {
      if (lb) { lb.style.opacity = '0'; setTimeout(() => lb.remove(), 400); }
      return;
    }
    if (!lb) {
      lb = document.createElement('div');
      lb.className = `ref-label r-${name}`;
      stage.appendChild(lb);
    }
    if (target === null) {           // head == null (empty list)
      lb.textContent = name + ' = null';
      lb.classList.add('isnull');
      lb.dataset.target = '';
      lb.style.left = PAD_X + 'px';
      lb.style.top = (ROW_Y - 64) + 'px';
      lb.style.opacity = '1';
      return;
    }
    lb.classList.remove('isnull');
    lb.textContent = name;
    lb.dataset.target = target;
    // stack multiple labels that point at the same node
    const stack = ['head', 'current', 'newNode'].filter(n =>
      n in snap.refs && snap.refs[n] === target);
    const level = stack.indexOf(name);
    const p = pos[target];
    lb.style.left = (p.x + NODE_W / 2 - 30) + 'px';
    lb.style.top = (p.y - 60 - level * 36) + 'px';
    lb.style.opacity = '1';
  });

  // ----- annotations (current.next / current.next.next) -----
  stage.querySelectorAll('.anno-label').forEach(el => el.remove());
  snap.annos.forEach(an => {
    if (!an.id || !pos[an.id]) return;
    const el = document.createElement('div');
    el.className = 'anno-label';
    el.textContent = an.text;
    el.dataset.target = an.id;
    const p = pos[an.id];
    const below = an.id in snap.floating ? 0 : (Object.keys(snap.floating).length ? FLOAT_DY + 30 : 0);
    el.style.left = (p.x + 8) + 'px';
    el.style.top = (p.y + NODE_H + 44 + below * 0) + 'px';
    stage.appendChild(el);
  });

  // ----- stage width, size badge, variables -----
  stage.style.minWidth = (nullX + 20) + 'px';
  const badge = $('sizeBadge');
  badge.textContent = snap.size;
  const badgeWrap = badge.parentElement;
  badgeWrap.classList.remove('flash');
  if (snap.sizeFlash) { void badgeWrap.offsetWidth; badgeWrap.classList.add('flash'); }

  renderVars(snap);
  renderedSnap = snap;
}

/* ---------------- variable panel ---------------- */

function renderVars(snap) {
  const rows = [];
  const refStr = name => {
    if (!(name in snap.refs)) return { v: '—', none: true };
    const id = snap.refs[name];
    if (id === null) return { v: 'null', none: false };
    return { v: `Node(${snap.nodes[id] ? snap.nodes[id].data : '?'})`, none: false };
  };
  for (const name of ['head', 'current', 'newNode']) {
    const r = refStr(name);
    rows.push({ name, cls: 'v-' + name, val: (r.none ? '—' : '→ ' + r.v), none: r.none });
  }
  rows.push({ name: 'size', cls: '', val: '= ' + snap.size, none: false });
  for (const k in snap.vars) {
    rows.push({ name: k, cls: '', val: '= ' + snap.vars[k], none: false });
  }
  const tbl = $('varTable');
  const prevVals = tbl.dataset.prev ? JSON.parse(tbl.dataset.prev) : {};
  tbl.innerHTML = rows.map(r =>
    `<tr class="${r.cls}${prevVals[r.name] !== undefined && prevVals[r.name] !== r.val ? ' changed' : ''}">
       <td class="vname">${r.name}</td>
       <td class="vval${r.none ? ' none' : ''}">${r.val}</td></tr>`).join('');
  const cur = {};
  rows.forEach(r => cur[r.name] = r.val);
  tbl.dataset.prev = JSON.stringify(cur);
}

/* ---------------- arrow drawing (every frame) ---------------- */

function stageRect(el) {
  const s = stage.getBoundingClientRect();
  const r = el.getBoundingClientRect();
  return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
}
const nodeEl = id => stage.querySelector(`.node[data-id="${id}"]`);

function linkPath(fromEl, toEl) {
  const a = stageRect(fromEl), b = stageRect(toEl);
  const sx = a.x + a.w - 23, sy = a.y + a.h / 2;   // centre of the next-field dot
  const tx = b.x - 3, ty = b.y + b.h / 2;
  const sameRow = Math.abs(sy - ty) < 8;
  if (sameRow && tx > sx && tx - sx < GAP + 58) {
    return `M ${sx} ${sy} L ${tx} ${ty}`;            // adjacent: straight
  }
  if (sameRow && tx > sx) {                          // skipping node(s): arc above
    return `M ${sx} ${sy - 8} C ${sx + 60} ${sy - 72}, ${tx - 60} ${ty - 72}, ${tx + 1} ${ty - 8}`;
  }
  if (ty < sy - 40) {                                // target on the row above
    const ex = b.x + b.w * 0.3, ey = b.y + b.h + 3;
    return `M ${sx} ${sy} C ${sx + 55} ${sy}, ${ex} ${ey + 55}, ${ex} ${ey}`;
  }
  if (ty > sy + 40) {                                // target on the row below
    const ex = b.x + b.w * 0.3, ey = b.y - 3;
    return `M ${sx} ${sy} C ${sx + 55} ${sy}, ${ex} ${ey - 55}, ${ex} ${ey}`;
  }
  const dx = Math.max(46, Math.abs(tx - sx) / 2);
  return `M ${sx} ${sy} C ${sx + dx} ${sy}, ${tx - dx} ${ty}, ${tx} ${ty}`;
}

function refPath(labelEl, targetEl) {
  const a = stageRect(labelEl), b = stageRect(targetEl);
  const sx = a.x + a.w / 2, sy = a.y + a.h;
  const tx = b.x + b.w / 2, ty = b.y - 4;
  if (Math.abs(sx - tx) < 8) return `M ${sx} ${sy} L ${tx} ${ty}`;
  return `M ${sx} ${sy} C ${sx} ${sy + 26}, ${tx} ${ty - 26}, ${tx} ${ty}`;
}

function annoPath(labelEl, targetEl) {
  const a = stageRect(labelEl), b = stageRect(targetEl);
  const sx = a.x + a.w / 2, sy = a.y;
  const tx = b.x + b.w / 2, ty = b.y + b.h + 4;
  return `M ${sx} ${sy} C ${sx} ${sy - 20}, ${tx} ${ty + 20}, ${tx} ${ty}`;
}

function addPath(d, stroke, width, marker, opts = {}) {
  const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  p.setAttribute('d', d);
  p.setAttribute('fill', 'none');
  p.setAttribute('stroke', stroke);
  p.setAttribute('stroke-width', width);
  p.setAttribute('marker-end', `url(#${marker})`);
  if (opts.dash) p.setAttribute('stroke-dasharray', opts.dash);
  if (opts.opacity !== undefined) p.setAttribute('opacity', opts.opacity);
  linkLayer.appendChild(p);
}

function drawFrame() {
  linkLayer.innerHTML = '';
  const snap = renderedSnap;
  if (snap) {
    const now = performance.now();

    // ghost (removed) links, fading out
    ghostLinks = ghostLinks.filter(g => g.until > now);
    for (const g of ghostLinks) {
      const fe = nodeEl(g.from), te = nodeEl(g.to);
      if (fe && te) {
        const alpha = Math.max(0, (g.until - now) / DUR()) * 0.6;
        addPath(linkPath(fe, te), '#94a3b8', 3, 'ah-link', { opacity: alpha, dash: '7 6' });
      }
    }

    // next links — a null reference gets NO arrow: null points to nothing,
    // and the next field itself already displays "null"
    for (const from in snap.next) {
      const to = snap.next[from];
      if (to === null) continue;
      const fe = nodeEl(from);
      if (!fe) continue;
      const te = nodeEl(to);
      if (!te) continue;
      const fresh = linkFx[from] && linkFx[from] > now;
      if (linkFx[from] && linkFx[from] <= now) delete linkFx[from];
      addPath(linkPath(fe, te),
        fresh ? '#7c3aed' : '#64748b',
        fresh ? 4.5 : 3.5,
        fresh ? 'ah-fresh' : 'ah-link');
    }

    // reference arrows
    stage.querySelectorAll('.ref-label').forEach(lb => {
      const t = lb.dataset.target;
      if (!t) return;
      const te = nodeEl(t);
      if (!te || lb.style.opacity === '0') return;
      const color = lb.classList.contains('r-head') ? '#2563eb'
        : lb.classList.contains('r-current') ? '#d97706' : '#16a34a';
      const marker = lb.classList.contains('r-head') ? 'ah-head'
        : lb.classList.contains('r-current') ? 'ah-current' : 'ah-new';
      addPath(refPath(lb, te), color, 3.5, marker);
    });

    // annotation arrows (dashed, from below)
    stage.querySelectorAll('.anno-label').forEach(lb => {
      const te = nodeEl(lb.dataset.target);
      if (te) addPath(annoPath(lb, te), '#475569', 2.5, 'ah-anno', { dash: '6 5' });
    });
  }
  requestAnimationFrame(drawFrame);
}
requestAnimationFrame(drawFrame);

/* ---------------- code pane ---------------- */

function hlJava(line) {
  let s = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  s = s.replace(/\b(public|void|int|new|if|else|while|for|return|throw|null)\b/g,
    '<span class="kw">$1</span>');
  s = s.replace(/\b(Node|IndexOutOfBoundsException|NoSuchElementException)\b/g,
    '<span class="type">$1</span>');
  s = s.replace(/\b(\d+)\b/g, '<span class="num">$1</span>');
  return s;
}

function renderCode(java, activeLine, doneSet, pending) {
  const view = $('codeView');
  view.innerHTML = java.map((ln, i) => {
    const cls = ['code-line'];
    if (i === activeLine) { cls.push('active'); if (pending) cls.push('pending'); }
    else if (doneSet && doneSet.has(i)) cls.push('done');
    return `<span class="${cls.join(' ')}" data-ln="${i}">${hlJava(ln) || '&nbsp;'}</span>`;
  }).join('');
  const act = view.querySelector('.code-line.active');
  if (act) act.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

/* ================= Java source per operation ================= */

const JAVA = {
  addFirst: [
    'public void addFirst(int data) {',
    '    Node newNode = new Node(data);',
    '    newNode.next = head;',
    '    head = newNode;',
    '    size++;',
    '}'
  ],
  addLast: [
    'public void addLast(int data) {',
    '    Node newNode = new Node(data);',
    '    if (head == null) {',
    '        head = newNode;',
    '        size++;',
    '        return;',
    '    }',
    '    Node current = head;',
    '    while (current.next != null) {',
    '        current = current.next;',
    '    }',
    '    current.next = newNode;',
    '    size++;',
    '}'
  ],
  addAt: [
    'public void addAt(int index, int data) {',
    '    if (index < 0 || index > size) {',
    '        throw new IndexOutOfBoundsException();',
    '    }',
    '    if (index == 0) {',
    '        addFirst(data);',
    '        return;',
    '    }',
    '    Node newNode = new Node(data);',
    '    Node current = head;',
    '    for (int i = 0; i < index - 1; i++) {',
    '        current = current.next;',
    '    }',
    '    newNode.next = current.next;',
    '    current.next = newNode;',
    '    size++;',
    '}'
  ],
  deleteFirst: [
    'public void deleteFirst() {',
    '    if (head == null) {',
    '        throw new NoSuchElementException();',
    '    }',
    '    head = head.next;',
    '    size--;',
    '}'
  ],
  deleteLast: [
    'public void deleteLast() {',
    '    if (head == null) {',
    '        throw new NoSuchElementException();',
    '    }',
    '    if (head.next == null) {',
    '        head = null;',
    '        size--;',
    '        return;',
    '    }',
    '    Node current = head;',
    '    while (current.next.next != null) {',
    '        current = current.next;',
    '    }',
    '    current.next = null;',
    '    size--;',
    '}'
  ],
  deleteAt: [
    'public void deleteAt(int index) {',
    '    if (index < 0 || index >= size) {',
    '        throw new IndexOutOfBoundsException();',
    '    }',
    '    if (index == 0) {',
    '        deleteFirst();',
    '        return;',
    '    }',
    '    Node current = head;',
    '    for (int i = 0; i < index - 1; i++) {',
    '        current = current.next;',
    '    }',
    '    current.next = current.next.next;',
    '    size--;',
    '}'
  ]
};

/* ================= operation step builders ================= */

function buildAddFirst(data) {
  const c = new Ctx(baseList);
  const oldHead = c.snap.refs.head;
  c.snap.vars = { data };
  c.push(0, `addFirst(${data})`,
    `نستدعي <b>addFirst(${data})</b> على القائمة المرتبطة (Linked List).`,
    'لاحظ كيف تُضاف عقدة (Node) إلى المقدمة دون تحريك أي عقدة موجودة.');

  const nn = c.newFloating(data, 0);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `ننشئ عقدة جديدة تحتوي على ${data}. حقل next فيها يبدأ بقيمة null.`,
    'كل عملية إضافة تبدأ بإنشاء كائن العقدة في الذاكرة، وهي غير متصلة بالقائمة بعد.',
    'عند إنشاء هذه العقدة، إلى ماذا سيشير حقل next فيها؟',
    'null — العقدة الجديدة تمامًا لا تشير إلى أي شيء بعد.', true);

  c.clearFx();
  c.snap.next[nn] = oldHead;
  if (oldHead) c.snap.hi = [oldHead];
  c.push(2, 'newNode.next = head;',
    'أصبح newNode.next يشير الآن إلى نفس العقدة التي يشير إليها المرجع (Reference) head.',
    'نربط العقدة الجديدة بالقائمة قبل تحريك head، حتى لا نفقد أي عقدة أبدًا.',
    'إلى أي عقدة سيشير newNode.next بعد هذه الجملة؟',
    oldHead ? `Node(${c.data(oldHead)}) — العقدة الأولى الحالية.` : 'null — القائمة فارغة، لذا head يساوي null.', true);

  c.clearFx();
  c.snap.refs.head = nn;
  c.placeInOrder(nn, 0);
  c.push(3, 'head = newNode;',
    'يُحدَّث head ليشير إلى العقدة الأولى الجديدة.',
    'أصبحت القائمة الآن تبدأ رسميًا من العقدة الجديدة.',
    'هل ستُحرَّك أي عقدة موجودة في الذاكرة بسبب هذه الجملة؟',
    'لا — يتغير المرجع head فقط. عقد القائمة المرتبطة لا تتحرك أبدًا.', true);

  c.clearFx();
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(4, 'size++;',
    `يُزاد عداد الحجم: ${c.snap.size - 1} → ${c.snap.size}.`,
    'إبقاء size محدَّثًا يجعل الاستعلام عن الحجم بزمن O(1).');

  return { name: 'addFirst', java: JAVA.addFirst, steps: c.steps, resultList: c.values() };
}

function buildAddLast(data) {
  const c = new Ctx(baseList);
  c.snap.vars = { data };
  const empty = c.snap.order.length === 0;
  c.push(0, `addLast(${data})`,
    `نستدعي <b>addLast(${data})</b>.`,
    'يجب أن تصبح العقدة (Node) الجديدة هي الأخيرة، لذا نمشي أولًا حتى نهاية القائمة المرتبطة (Linked List).');

  const nn = c.newFloating(data, empty ? 0 : c.snap.order.length - 0.35);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `ننشئ عقدة جديدة تحتوي على ${data}، مع next = null.`,
    'العقدة الأخيرة دائمًا حقل next فيها يساوي null — وهذا متحقق أصلًا في العقدة الجديدة.');

  if (empty) {
    c.clearFx();
    c.push(2, 'if (head == null)',
      'head يساوي null — القائمة فارغة، لذا تصبح العقدة الجديدة ببساطة هي العقدة الأولى.',
      'القائمة الفارغة حالة خاصة: لا توجد عقدة أخيرة نربط بها.');
    c.snap.refs.head = nn; c.placeInOrder(nn, 0);
    c.push(3, 'head = newNode;',
      'أصبح head يشير الآن إلى العقدة الجديدة.',
      'مع وجود عقدة واحدة، تكون هي العقدة الأولى والأخيرة معًا.');
    c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(4, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');
    c.clearFx();
    c.push(5, 'return;', 'تنتهي الدالة — لم نحتج إلى أي اجتياز (Traversal).', '');
    return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
  }

  c.clearFx();
  c.push(2, 'if (head == null)',
    'head ليس null، لذا نتخطى هذه الكتلة.',
    'الحالة الخاصة تنطبق فقط على القائمة الفارغة.');

  let cur = c.snap.refs.head;
  c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(7, 'Node current = head;',
    'مرجع الاجتياز current يبدأ عند العقدة الأولى.',
    'سيمشي current على طول القائمة. إنه مجرد مرجع (Reference) — العقد نفسها لا تتحرك أبدًا.',
    'إلى أي عقدة يشير current الآن؟',
    `Node(${c.data(cur)}) — نفس العقدة التي يشير إليها head.`);

  let first = true;
  while (c.snap.next[cur] !== null) {
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.hi = [cur];
    c.push(8, 'while (current.next != null)',
      `current.next هو Node(${c.data(nxt)})، وليس null — ندخل الحلقة.`,
      'نواصل المشي حتى يقف current على العقدة الأخيرة.');
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(9, 'current = current.next;',
      first ? 'يتقدم current إلى العقدة التي يشير إليها حقل next الخاص به.'
            : `يتقدم current إلى Node(${c.data(cur)}).`,
      'المرجع current هو الذي يتحرك — وليس العقد.',
      first ? 'إلى أي عقدة سيشير current بعد هذه الجملة؟' : null,
      first ? `Node(${c.data(cur)}).` : null, first);
    first = false;
  }

  c.clearFx(); c.snap.hi = [cur];
  c.push(8, 'while (current.next != null)',
    `current.next يساوي null — وصل current إلى العقدة الأخيرة Node(${c.data(cur)}). تتوقف الحلقة.`,
    'العقدة الأخيرة هي العقدة الوحيدة التي حقل next فيها يساوي null.',
    'لماذا تتوقف الحلقة هنا؟',
    `لأن Node(${c.data(cur)}).next يساوي null — current يقف على العقدة الأخيرة.`);

  c.clearFx();
  c.snap.next[cur] = nn; c.snap.hi = [cur];
  c.push(11, 'current.next = newNode;',
    `أصبحت العقدة الأخيرة Node(${c.data(cur)}) تشير الآن إلى العقدة الجديدة.`,
    'هذا التغيير الوحيد في المرجع يربط العقدة الجديدة بنهاية القائمة.');

  c.clearFx();
  c.placeInOrder(nn, c.snap.order.length);
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(12, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
}

function buildAddAt(index, data) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index, data };
  c.push(0, `addAt(${index}, ${data})`,
    `ندرج ${data} عند الفهرس (index) ${index}. تظهر الفهارس فوق كل عقدة (Node).`,
    `يجب أن نصل إلى العقدة التي قبل الموضع ${index}، ثم نعيد ربط مرجعين (Reference) اثنين بالضبط.`);
  c.push(1, 'if (index < 0 || index > size)',
    `index = ${index} يقع ضمن المدى 0 … ${c.snap.size} — لا يُرمى أي استثناء.`,
    'يتم التحقق من الحدود دائمًا قبل لمس القائمة.');

  if (index === 0) {
    const oldHead = c.snap.refs.head;
    c.push(4, 'if (index == 0)',
      'index يساوي 0 — الإدراج في المقدمة هو بالضبط ما تفعله addFirst.',
      'نعيد استخدام addFirst بدلًا من تكرار منطقها.');
    const nn = c.newFloating(data, 0);
    c.snap.refs.newNode = nn; c.snap.isNew = [nn];
    c.push(5, 'addFirst(data);',
      `داخل addFirst: تُنشأ عقدة جديدة تحتوي على ${data}.`, '');
    c.snap.next[nn] = oldHead;
    c.push(5, 'addFirst(data);',
      'داخل addFirst: newNode.next = head — تُربط العقدة الجديدة بالعقدة الأولى القديمة.', '');
    c.snap.refs.head = nn; c.placeInOrder(nn, 0);
    c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(5, 'addFirst(data);',
      'داخل addFirst: head = newNode; size++. أصبحت العقدة الجديدة هي الأولى الآن.', '');
    c.clearFx();
    c.push(6, 'return;', 'انتهت addAt.', '');
    return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (index == 0)', 'index لا يساوي 0 — نتخطى الحالة الخاصة.', '');

  const nn = c.newFloating(data, index - 0.5);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(8, `Node newNode = new Node(${data});`,
    `ننشئ العقدة الجديدة التي تحتوي على ${data} (مع next = null).`,
    'تُنشأ “جانبًا” — غير متصلة بأي شيء بعد.');

  let cur = c.snap.refs.head;
  c.clearFx(); c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(9, 'Node current = head;',
    'يبدأ current عند العقدة الأولى (الفهرس 0).',
    `يجب أن يتوقف current على العقدة التي قبل موضع الإدراج — أي الفهرس ${index - 1}.`);

  for (let i = 0; i < index - 1; i++) {
    c.clearFx(); c.snap.vars.i = i; c.snap.hi = [cur];
    c.push(10, 'for (int i = 0; i < index - 1; i++)',
      `i = ${i}، وهو أقل من ${index - 1} — نواصل التحرك.`,
      `تستمر الحلقة حتى يصل current إلى الفهرس ${index - 1}.`);
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(11, 'current = current.next;',
      `ينتقل current إلى Node(${c.data(cur)}) عند الفهرس ${i + 1}.`,
      'المرجع فقط هو الذي يتحرك — لا تغير أي عقدة موضعها.');
  }
  c.clearFx(); c.snap.vars.i = index - 1; c.snap.hi = [cur];
  c.push(10, 'for (int i = 0; i < index - 1; i++)',
    `i = ${index - 1} — تتوقف الحلقة. current عند الفهرس ${index - 1}، أي العقدة التي قبل موضع الإدراج.`,
    'التوقف قبل الموضع بعقدة واحدة أمر أساسي: فحقل next لتلك العقدة هو الذي يجب أن نغيره.');

  const after = c.snap.next[cur];
  c.clearFx();
  if (after) { c.snap.annos = [{ id: after, text: 'current.next' }]; c.snap.hi = [after]; }
  c.snap.next[nn] = after;
  c.push(13, 'newNode.next = current.next;',
    after ? `أصبح newNode يشير الآن إلى Node(${c.data(after)}) — العقدة التي تلي current حاليًا.`
          : 'current.next يساوي null (نحن ندرج في النهاية)، لذا يبقى newNode.next بقيمة null.',
    'نحفظ الاتصال ببقية القائمة قبل لمس current.next. تنفيذ هاتين الجملتين بالترتيب المعاكس سيفقدنا كل عقدة بعد current!',
    'لماذا يجب أن تأتي هذه الجملة قبل current.next = newNode؟',
    after ? `لو غُيِّر current.next أولًا، لأصبحت Node(${c.data(after)}) وكل ما بعدها غير قابلة للوصول.`
          : 'بشكل عام، تغيير current.next أولًا سيضيع بقية القائمة.', true);

  c.clearFx();
  c.snap.next[cur] = nn; c.snap.hi = [cur];
  c.push(14, 'current.next = newNode;',
    `أصبحت Node(${c.data(cur)}) تشير الآن إلى العقدة الجديدة. السلسلة تُقرأ ${c.data(cur)} → ${data}${after ? ' → ' + c.data(after) : ''}.`,
    `كلا الرابطين صحيحان — أُدرجت العقدة الجديدة عند الموضع ${index}.`);

  c.clearFx();
  c.placeInOrder(nn, index);
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = []; delete c.snap.vars.i;
  c.push(15, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
}

function buildDeleteFirst() {
  const c = new Ctx(baseList);
  c.push(0, 'deleteFirst()',
    'نستدعي <b>deleteFirst()</b>.',
    'تُحذف العقدة (Node) الأولى بتغيير مرجع (Reference) واحد فقط — لا تُزاح أي عقدة.');

  if (c.snap.order.length === 0) {
    c.push(1, 'if (head == null)', 'head يساوي null — القائمة فارغة.', 'لا يوجد شيء لحذفه.');
    c.push(2, 'throw new NoSuchElementException();',
      'يُرمى استثناء: لا يمكنك الحذف من قائمة فارغة.',
      'الفشل المبكر هنا يمنع حدوث NullPointerException لاحقًا.');
    return { name: 'deleteFirst', java: JAVA.deleteFirst, steps: c.steps, resultList: c.values() };
  }

  c.push(1, 'if (head == null)', 'head ليس null — القائمة تحتوي على عقدة واحدة على الأقل. نكمل.', '');

  const old = c.snap.refs.head;
  const second = c.snap.next[old];
  c.snap.hi = second ? [old, second] : [old];
  if (second) c.snap.annos = [{ id: second, text: 'head.next' }];
  c.push(4, 'head = head.next;',
    second ? `أولًا، نحدد المرجعين المعنيين: head هو Node(${c.data(old)}) و head.next هو Node(${c.data(second)}).`
           : 'head.next يساوي null — بعد هذه الجملة ستصبح القائمة فارغة.',
    'قبل التنفيذ، كن واضحًا بشأن المكان الذي سينتقل إليه head.',
    'إلى أين سيشير head بعد تنفيذ هذه الجملة؟',
    second ? `Node(${c.data(second)}) — تصبح العقدة الثانية هي الأولى.` : 'null — تصبح القائمة فارغة.');

  c.clearFx();
  c.snap.refs.head = second ?? null;
  c.snap.fade = [old];
  c.push(4, 'head = head.next;',
    `أصبح head يشير الآن إلى ${second ? `Node(${c.data(second)})` : 'null'}. لم تُزح أي عقدة فعليًا — غيّرنا مرجع head فقط.`,
    `العقدة الأولى القديمة Node(${c.data(old)}) لم تعد قابلة للوصول من head.`);

  c.clearFx();
  c.removeNode(old);
  c.snap.size--; c.snap.sizeFlash = true;
  c.push(5, 'size--;',
    `الحجم: ${c.snap.size + 1} → ${c.snap.size}. العقدة غير القابلة للوصول يستعيدها جامع المهملات (Garbage Collector) في جافا.`,
    'في جافا لا نحرر الذاكرة يدويًا أبدًا.');

  return { name: 'deleteFirst', java: JAVA.deleteFirst, steps: c.steps, resultList: c.values() };
}

function buildDeleteLast() {
  const c = new Ctx(baseList);
  c.push(0, 'deleteLast()',
    'نستدعي <b>deleteLast()</b>.',
    'يجب أن نمشي إلى العقدة (Node) قبل الأخيرة — فهي التي يجب أن يصبح حقل next فيها null.');

  if (c.snap.order.length === 0) {
    c.push(1, 'if (head == null)', 'head يساوي null — القائمة فارغة.', 'لا يوجد شيء لحذفه.');
    c.push(2, 'throw new NoSuchElementException();',
      'يُرمى استثناء: لا يمكنك الحذف من قائمة فارغة.', '');
    return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
  }

  c.push(1, 'if (head == null)', 'head ليس null — نكمل.', '');

  if (c.snap.order.length === 1) {
    const only = c.snap.order[0];
    c.snap.hi = [only];
    c.push(4, 'if (head.next == null)',
      'توجد عقدة واحدة بالضبط، لذا head.next يساوي null.',
      'قائمة العقدة الواحدة لا تحتوي على عقدة قبل أخيرة — هذه حالة خاصة.');
    c.clearFx(); c.snap.refs.head = null; c.snap.fade = [only];
    c.push(5, 'head = null;', 'لم يعد head يشير إلى العقدة — أصبحت القائمة فارغة الآن.', '');
    c.clearFx(); c.removeNode(only); c.snap.size--; c.snap.sizeFlash = true;
    c.push(6, 'size--;', 'الحجم: 1 → 0.', '');
    c.push(7, 'return;', 'تنتهي الدالة.', '');
    return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (head.next == null)', 'القائمة تحتوي على أكثر من عقدة — نتخطى الحالة الخاصة.', '');

  let cur = c.snap.refs.head;
  c.snap.refs.current = cur; c.snap.hi = [cur];
  const secondLast = c.snap.order[c.snap.order.length - 2];
  c.push(9, 'Node current = head;',
    'يبدأ current عند العقدة الأولى.',
    'يجب أن يتوقف current عند العقدة قبل الأخيرة.',
    'عند أي عقدة يجب أن يتوقف current، ولماذا؟',
    `Node(${c.data(secondLast)}) — العقدة قبل الأخيرة، لأن حقل next فيها يجب أن يُجعل null.`);

  while (true) {
    const nxt = c.snap.next[cur];
    const nxt2 = nxt !== null ? c.snap.next[nxt] : null;
    c.clearFx(); c.snap.hi = [cur];
    if (nxt2 !== null) {
      c.snap.annos = [{ id: nxt2, text: 'current.next.next' }];
      c.push(10, 'while (current.next.next != null)',
        `current.next.next هو Node(${c.data(nxt2)})، وليس null — نواصل.`,
        'ننظر عقدتين إلى الأمام حتى نتوقف قبل النهاية بعقدة واحدة.');
      c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
      c.push(11, 'current = current.next;',
        `ينتقل current إلى Node(${c.data(cur)}).`,
        'المرجع (Reference) فقط هو الذي يتحرك — تبقى العقد في مكانها.');
    } else {
      c.push(10, 'while (current.next.next != null)',
        `current.next.next يساوي null — current عند العقدة قبل الأخيرة Node(${c.data(cur)}). نخرج من الحلقة.`,
        'خطوة إضافية واحدة ستتجاوز الهدف: نحتاج العقدة التي قبل الأخيرة.');
      break;
    }
  }

  const last = c.snap.next[cur];
  c.clearFx();
  c.snap.next[cur] = null; c.snap.hi = [cur]; c.snap.fade = [last];
  c.push(13, 'current.next = null;',
    `أُزيل الرابط من Node(${c.data(cur)}) إلى Node(${c.data(last)}). أصبحت Node(${c.data(cur)}) الآن هي العقدة الأخيرة.`,
    `Node(${c.data(last)}) غير قابلة للوصول — قطع هذا المرجع الوحيد هو كل ما يعنيه “الحذف”.`,
    'ماذا يحدث للعقدة الأخيرة القديمة الآن؟',
    'لم يعد أي شيء يشير إليها، لذا يستعيدها جامع المهملات (Garbage Collector).');

  c.clearFx();
  c.removeNode(last);
  c.snap.size--; c.snap.sizeFlash = true;
  c.push(14, 'size--;', `الحجم: ${c.snap.size + 1} → ${c.snap.size}.`, '');

  return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
}

function buildDeleteAt(index) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index };
  c.push(0, `deleteAt(${index})`,
    `نحذف العقدة (Node) عند الفهرس (index) ${index}.`,
    `يجب أن نصل إلى العقدة التي قبل الفهرس ${index} ونجعلها تتخطى العقدة المستهدفة.`);
  c.push(1, 'if (index < 0 || index >= size)',
    `index = ${index} يقع ضمن المدى 0 … ${c.snap.size - 1} — لا يُرمى أي استثناء.`,
    'في الحذف يجب أن يكون الفهرس أقل تمامًا من size.');

  if (index === 0) {
    const old = c.snap.refs.head;
    const second = c.snap.next[old];
    c.push(4, 'if (index == 0)',
      'index يساوي 0 — حذف العقدة الأولى هو بالضبط ما تفعله deleteFirst.',
      'نعيد استخدام deleteFirst بدلًا من تكرار الكود.');
    c.snap.hi = [old];
    c.push(5, 'deleteFirst();', 'داخل deleteFirst: على وشك تنفيذ head = head.next.', '');
    c.snap.refs.head = second ?? null; c.snap.fade = [old]; c.snap.hi = [];
    c.push(5, 'deleteFirst();',
      `أصبح head يشير الآن إلى ${second ? `Node(${c.data(second)})` : 'null'} — العقدة الأولى القديمة غير قابلة للوصول.`, '');
    c.removeNode(old); c.snap.size--; c.snap.sizeFlash = true;
    c.push(5, 'deleteFirst();', 'داخل deleteFirst: يُنفَّذ size--.', '');
    c.clearFx();
    c.push(6, 'return;', 'انتهت deleteAt.', '');
    return { name: 'deleteAt', java: JAVA.deleteAt, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (index == 0)', 'index لا يساوي 0 — نتخطى الحالة الخاصة.', '');

  let cur = c.snap.refs.head;
  c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(8, 'Node current = head;',
    'يبدأ current عند الفهرس 0.',
    `يجب أن يتوقف current عند الفهرس ${index - 1} — العقدة التي قبل العقدة التي سنحذفها.`);

  for (let i = 0; i < index - 1; i++) {
    c.clearFx(); c.snap.vars.i = i; c.snap.hi = [cur];
    c.push(9, 'for (int i = 0; i < index - 1; i++)',
      `i = ${i}، وهو أقل من ${index - 1} — نواصل التحرك.`, '');
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(10, 'current = current.next;',
      `ينتقل current إلى Node(${c.data(cur)}) عند الفهرس ${i + 1}.`,
      'المرجع (Reference) فقط هو الذي يتحرك.');
  }
  c.clearFx(); c.snap.vars.i = index - 1; c.snap.hi = [cur];
  c.push(9, 'for (int i = 0; i < index - 1; i++)',
    `i = ${index - 1} — تتوقف الحلقة. current عند الفهرس ${index - 1}، أي قبل العقدة المستهدفة مباشرة.`,
    'نتوقف قبل الهدف بعقدة واحدة حتى نتمكن من إعادة توصيل حقل next لتلك العقدة.');

  const victim = c.snap.next[cur];
  const after = c.snap.next[victim];
  c.clearFx(); c.snap.hi = [cur];
  c.snap.annos = [{ id: victim, text: 'current.next' }];
  if (after) c.snap.annos.push({ id: after, text: 'current.next.next' });
  c.push(12, 'current.next = current.next.next;',
    `نحدد المراجع أولًا: current.next هو Node(${c.data(victim)}) — العقدة المستهدفة — و current.next.next هو ${after ? `Node(${c.data(after)})` : 'null'}.`,
    'نقرأ كلا المرجعين قبل تغيير أي شيء.',
    'إلى أي عقدة سيشير current.next بعد هذه الجملة؟',
    after ? `Node(${c.data(after)}) — تُتخطى العقدة المستهدفة.` : 'null — كانت العقدة المستهدفة هي الأخيرة.');

  c.clearFx();
  c.snap.next[cur] = after ?? null;
  c.snap.hi = [cur]; c.snap.fade = [victim];
  c.push(12, 'current.next = current.next.next;',
    `أصبحت Node(${c.data(cur)}) تشير الآن مباشرة إلى ${after ? `Node(${c.data(after)})` : 'null'}. تُتخطى Node(${c.data(victim)}) لأن Node(${c.data(cur)}) لم تعد تشير إليها.`,
    'تغيير مرجع واحد يزيل العقدة من السلسلة — لا شيء يُزاح.');

  c.clearFx();
  c.removeNode(victim);
  c.snap.size--; c.snap.sizeFlash = true; delete c.snap.vars.i;
  c.push(13, 'size--;',
    `الحجم: ${c.snap.size + 1} → ${c.snap.size}. يستعيد جامع المهملات (Garbage Collector) العقدة المتخطاة.`, '');

  return { name: 'deleteAt', java: JAVA.deleteAt, steps: c.steps, resultList: c.values() };
}

/* ================= UI wiring ================= */

const OPS = {
  addFirst:    { title: 'الإضافة في البداية (Add First)',          data: true,  index: false, defData: 5,
                 build: a => buildAddFirst(a.data) },
  addLast:     { title: 'الإضافة في النهاية (Add Last)',           data: true,  index: false, defData: 60,
                 build: a => buildAddLast(a.data) },
  addAt:       { title: 'الإضافة عند موضع (Add at Position)',    data: true,  index: true,  defData: 30, defIndex: 2,
                 build: a => buildAddAt(a.index, a.data) },
  deleteFirst: { title: 'حذف الأول (Delete First)',       data: false, index: false,
                 build: () => buildDeleteFirst() },
  deleteLast:  { title: 'حذف الأخير (Delete Last)',        data: false, index: false,
                 build: () => buildDeleteLast() },
  deleteAt:    { title: 'الحذف عند موضع (Delete at Position)', data: false, index: true,  defIndex: 2,
                 build: a => buildDeleteAt(a.index) }
};

const mkItems = vals => vals.map(v => ({ id: 'n' + (++idCounter), data: v }));

/* Debugger model: the highlighted statement has NOT executed yet.
   Each click executes the previously highlighted statement (its
   effect animates) and moves the highlight to the next statement.
   So step k shows the snapshot AFTER statement k-1 while statement
   k is highlighted for discussion. A final step shows the last
   statement's effect with no highlight.
   Questions: a qPre question is asked while its own statement is
   highlighted (predict); a plain question is asked one click later,
   when its statement's effect has just become visible. */
function expandSteps(steps) {
  const out = [];
  const s0 = steps[0];
  out.push({ line: s0.line, stmt: s0.stmt, means: s0.means, why: s0.why,
             q: null, a: null, phase: 'intro', snap: clone(s0.snap) });
  for (let k = 1; k < steps.length; k++) {
    const cur = steps[k], prev = steps[k - 1];
    let q = null, a = null;
    if (cur.qPre && cur.q) { q = cur.q; a = cur.a; }
    else if (prev.q && !prev.qPre) { q = prev.q; a = prev.a; }
    out.push({ line: cur.line, stmt: cur.stmt, means: cur.means, why: cur.why,
               q, a, phase: 'pending', snap: clone(prev.snap) });
  }
  const last = steps[steps.length - 1];
  out.push({ line: null, stmt: '—',
             means: 'اكتملت العملية — هذه هي الحالة النهائية للقائمة.',
             why: '',
             q: (last.q && !last.qPre) ? last.q : null,
             a: (last.q && !last.qPre) ? last.a : null,
             phase: 'done', snap: clone(last.snap) });
  return out;
}

function showMsg(text, ok) {
  const m = $('message');
  m.textContent = text;
  m.classList.toggle('ok', !!ok);
}
const hideMsg = () => showMsg('');

/* ----- teaching card ----- */
function showTeach(q, a) {
  teachOpen = true;
  $('teachQ').textContent = q;
  $('teachA').textContent = a || '';
  $('teachA').classList.add('hidden');
  $('teachCard').classList.remove('hidden');
}
function hideTeach() {
  teachOpen = false;
  $('teachCard').classList.add('hidden');
}
$('revealBtn').addEventListener('click', () => $('teachA').classList.remove('hidden'));

/* ----- step application ----- */
function applyStep(i) {
  const st = op.steps[i];
  renderState(clone(st.snap));

  const done = new Set();
  for (let k = 0; k < i; k++) {
    const l = op.steps[k].line;
    if (l !== null && l !== undefined) done.add(l);
  }
  done.delete(st.line);
  renderCode(op.java, st.line, done, st.phase === 'pending');

  $('exStmt').textContent = st.stmt;
  $('exMeans').innerHTML = st.means;
  $('exWhy').textContent = st.why || '';
  $('exWhyRow').style.visibility = st.why ? 'visible' : 'hidden';
  const status = $('exStatus');
  if (st.phase === 'pending') { status.textContent = 'لم تُنفَّذ بعد'; status.className = 'ex-status pending'; }
  else if (st.phase === 'done') { status.textContent = 'اكتملت'; status.className = 'ex-status done'; }
  else { status.className = 'ex-status hidden'; }

  hideTeach();
  if (teachMode && st.q && i > 0) showTeach(st.q, st.a);

  $('stepIndicator').textContent = `الخطوة ${i} / ${op.steps.length - 1}`;

  if (i === op.steps.length - 1 && !op.committed) {
    op.committed = true;
    baseList = op.resultList.map(x => ({ ...x }));
  }
  updateButtons();
}

function goTo(i) {
  stepIdx = i;
  applyStep(i);
}

function updateButtons() {
  const hasOp = !!op;
  const atEnd = hasOp && stepIdx >= op.steps.length - 1;
  $('prevBtn').disabled = !hasOp || stepIdx <= 0;
  $('nextBtn').disabled = !hasOp || atEnd;
  $('playBtn').disabled = !hasOp || atEnd;
  $('restartBtn').disabled = !hasOp;
}

/* ----- start ----- */
function start() {
  const cfg = OPS[currentOpName];
  hideMsg();
  const size = baseList.length;
  let data = null, idx = null;

  if (cfg.data) {
    data = parseInt($('dataInput').value, 10);
    if (Number.isNaN(data)) { showMsg('الرجاء إدخال قيمة عدد صحيح في حقل البيانات (Data).'); return; }
  }
  if (cfg.index) {
    idx = parseInt($('indexInput').value, 10);
    if (Number.isNaN(idx)) { showMsg('الرجاء إدخال عدد صحيح في حقل الفهرس (Index).'); return; }
    if (currentOpName === 'addAt' && (idx < 0 || idx > size)) {
      showMsg(`فهرس غير صالح ${idx}: للإدراج يجب أن يكون الفهرس (index) بين 0 و ${size} (الحجم الحالي). ` +
        `الفهرس ${size} يعني “الإدراج في النهاية”؛ وأي فهرس أكبر سيترك فجوة في القائمة.`);
      return;
    }
    if (currentOpName === 'deleteAt') {
      if (size === 0) { showMsg('القائمة فارغة — لا يوجد شيء لحذفه.'); return; }
      if (idx < 0 || idx >= size) {
        showMsg(`فهرس غير صالح ${idx}: للحذف يجب أن يكون الفهرس (index) بين 0 و ${size - 1} (أي size − 1). ` +
          `لا توجد عقدة عند الموضع ${idx}.`);
        return;
      }
    }
  }

  setPlaying(false);
  op = cfg.build({ data, index: idx });
  op.steps = expandSteps(op.steps);
  op.committed = false;
  goTo(0);
}

/* ----- play / pause ----- */
function nextDelay() {
  return PLAY_DELAY();
}
function setPlaying(on) {
  playing = on;
  clearTimeout(playTimer);
  $('playBtn').innerHTML = on ? '&#10074;&#10074; إيقاف مؤقت' : '&#9654; تشغيل';
  if (on) playTimer = setTimeout(tick, nextDelay());
}
function tick() {
  if (!playing) return;
  if (!op || stepIdx >= op.steps.length - 1) { setPlaying(false); return; }
  goTo(stepIdx + 1);
  if (teachOpen || stepIdx >= op.steps.length - 1) { setPlaying(false); return; }
  playTimer = setTimeout(tick, nextDelay());
}

/* ----- idle view (no animation running) ----- */
function idleRender() {
  const cfg = OPS[currentOpName];
  const snap = freshSnap(baseList);
  snap.showIndex = currentOpName === 'addAt' || currentOpName === 'deleteAt';
  renderState(snap);
  renderCode(JAVA[currentOpName], null, null);
  $('codeTitle').textContent = 'جافا (Java) — ' + cfg.title;
  $('exStmt').textContent = '—';
  $('exMeans').innerHTML = `اضغط <b>ابدأ المحاكاة</b> لتنفيذ <b>${cfg.title}</b> جملة واحدة في كل مرة.`;
  $('exWhy').textContent = '';
  $('exWhyRow').style.visibility = 'hidden';
  $('stepIndicator').textContent = 'جاهز';
  updateButtons();
}

/* ----- operation / tab selection ----- */
function selectOp(name) {
  currentOpName = name;
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.op === name));
  setPlaying(false);
  hideTeach();
  hideMsg();
  op = null;
  stepIdx = -1;

  const cfg = OPS[name];
  $('dataField').classList.toggle('hidden', !cfg.data);
  $('indexField').classList.toggle('hidden', !cfg.index);
  if (cfg.data && cfg.defData !== undefined) $('dataInput').value = cfg.defData;
  if (cfg.index && cfg.defIndex !== undefined) $('indexInput').value = cfg.defIndex;

  idleRender();
}

/* ----- event bindings ----- */
$('tabs').addEventListener('click', e => {
  const btn = e.target.closest('.tab');
  if (btn) selectOp(btn.dataset.op);
});

$('startBtn').addEventListener('click', start);

$('nextBtn').addEventListener('click', () => {
  if (!op || stepIdx >= op.steps.length - 1) return;
  setPlaying(false);
  goTo(stepIdx + 1);
});
$('prevBtn').addEventListener('click', () => {
  if (!op || stepIdx <= 0) return;
  setPlaying(false);
  goTo(stepIdx - 1);
});
$('playBtn').addEventListener('click', () => {
  if (!op) return;
  if (playing) { setPlaying(false); return; }
  if (teachOpen) hideTeach();
  setPlaying(true);
});
$('restartBtn').addEventListener('click', () => {
  if (!op) return;
  setPlaying(false);
  goTo(0);
});
$('resetBtn').addEventListener('click', () => {
  setPlaying(false);
  baseList = mkItems([10, 20, 40, 50]);
  op = null;
  stepIdx = -1;
  hideMsg();
  showMsg('أُعيد ضبط القائمة إلى 10 → 20 → 40 → 50.', true);
  idleRender();
});

$('teachBtn').addEventListener('click', () => {
  teachMode = !teachMode;
  const b = $('teachBtn');
  b.textContent = 'وضع التدريس: ' + (teachMode ? 'مفعّل' : 'متوقف');
  b.classList.toggle('on', teachMode);
  b.setAttribute('aria-pressed', String(teachMode));
  if (!teachMode) hideTeach();
  showMsg(teachMode
    ? 'وضع التدريس مفعّل — ستظهر أسئلة عند الخطوات المهمة؛ وتبقى الإجابات مخفية حتى تضغط زر أظهر الإجابة.'
    : 'وضع التدريس متوقف — تعمل المحاكاة دون أسئلة صفية.', true);
});
$('teachHelpBtn').addEventListener('click', e => {
  e.stopPropagation();
  $('teachHelp').classList.toggle('hidden');
});
document.addEventListener('click', e => {
  if (!e.target.closest('.teach-wrap')) $('teachHelp').classList.add('hidden');
});

document.querySelectorAll('.speed').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.speed').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    speed = parseFloat(btn.dataset.speed);
    document.documentElement.style.setProperty('--dur', DUR() + 'ms');
  });
});

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowRight') { e.preventDefault(); $('nextBtn').click(); }
  if (e.key === 'ArrowLeft')  { e.preventDefault(); $('prevBtn').click(); }
  if (e.key === ' ')          { e.preventDefault(); $('playBtn').click(); }
});

/* ----- init ----- */
baseList = mkItems([10, 20, 40, 50]);
document.documentElement.style.setProperty('--dur', DUR() + 'ms');
selectOp('addFirst');
