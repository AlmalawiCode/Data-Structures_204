/* ============================================================
   Doubly Linked List Simulator — engine + operations
   Vanilla JS. Nodes are drawn as VERTICAL boxes:
       next  (top cell)  |  data (middle)  |  prev (bottom cell)
   so forward (next) arrows leave the top cell and travel on the
   upper lane, backward (prev) arrows leave the bottom cell and
   travel on the lower lane. All arrows are redrawn each frame
   from live DOM positions so they follow CSS transitions.
   Debugger stepping: the highlighted statement has NOT executed
   yet; each click animates the previous statement's effect.
   ============================================================ */

'use strict';

/* ---------------- constants & global state ---------------- */

const NODE_W = 108, NODE_H = 112, GAP = 66;
const PAD_X = 34, ROW_Y = 170, FLOAT_DY = 164;
/* Link arrows are anchored to the real DOM cells, not to fixed offsets:
   a next arrow starts at the source node's next POINTER and lands on the
   target's next cell; a prev arrow starts at the prev POINTER and lands on
   the target's prev cell. See fPath() / bPath(). */
const nextDot  = el => el.querySelector('.nextf .fval');
const prevDot  = el => el.querySelector('.prevf .fval');
const nextCell = el => el.querySelector('.nextf');
const prevCell = el => el.querySelector('.prevf');

let baseList = null;               // committed list: [{id, data}, …] — ids stay stable across ops
let speed = 1;
let teachMode = false;
let currentOpName = 'addFirst';

let op = null;
let stepIdx = -1;
let playing = false;
let playTimer = null;

let idCounter = 0;
let renderedSnap = null;
let linkFx = {};                   // 'n:id' / 'p:id' -> expiry timestamp (fresh link accent)
let ghostLinks = [];               // { kind:'n'|'p', from, to, until }
let teachOpen = false;

const DUR = () => 900 / speed;
const PLAY_DELAY = () => 2600 / speed;

const $ = id => document.getElementById(id);
const stage = $('stage');
const linkLayer = $('linkLayer');

/* ---------------- snapshot model ----------------
   snap = { order, floating, nodes, next, prev,
            refs:{head, tail, current?, newNode?},
            fade, hi, isNew, annos, size, sizeFlash,
            showIndex, vars } ------------------------ */

function freshSnap(items) {
  const snap = {
    order: [], floating: {}, nodes: {}, next: {}, prev: {},
    refs: { head: null, tail: null },
    fade: [], hi: [], isNew: [], annos: [],
    size: items.length, sizeFlash: false, showIndex: false, vars: {}
  };
  let last = null;
  for (const it of items) {
    snap.order.push(it.id);
    snap.nodes[it.id] = { data: it.data };
    snap.prev[it.id] = last;
    if (last) snap.next[last] = it.id;
    last = it.id;
  }
  if (last) snap.next[last] = null;
  snap.refs.head = snap.order[0] ?? null;
  snap.refs.tail = last;
  return snap;
}

const clone = s => JSON.parse(JSON.stringify(s));

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
    this.snap.prev[id] = null;
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
    delete s.prev[id];
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
  const endX = PAD_X + snap.order.length * (NODE_W + GAP);
  return { pos, endX };
}

/* ---------------- DOM rendering of a snapshot ---------------- */

const REF_NAMES = ['head', 'tail', 'current', 'newNode'];

function renderState(snap) {
  const before = renderedSnap;
  const { pos, endX } = layout(snap);

  // detect link changes for fresh/ghost arrow effects (both directions)
  if (before) {
    const now = performance.now();
    for (const [kind, map, oldMap] of [['n', snap.next, before.next], ['p', snap.prev, before.prev]]) {
      for (const id in map) {
        const oldT = oldMap && id in oldMap ? oldMap[id] : undefined;
        const newT = map[id];
        if (oldT !== undefined && oldT !== newT) {
          if (oldT !== null) ghostLinks.push({ kind, from: id, to: oldT, until: now + DUR() });
          if (newT !== null) linkFx[kind + ':' + id] = now + DUR() * 1.4;
        } else if (oldT === undefined && newT !== null) {
          linkFx[kind + ':' + id] = now + DUR() * 1.4;
        }
      }
    }
  }

  // ----- nodes -----
  const live = new Set([...snap.order, ...Object.keys(snap.floating)]);
  stage.querySelectorAll('.node').forEach(el => {
    if (!live.has(el.dataset.id)) {
      el.classList.add('bye');
      setTimeout(() => el.remove(), 450);
    }
  });
  live.forEach(id => {
    let el = stage.querySelector(`.node[data-id="${id}"]`);
    const isFresh = !el;
    if (isFresh) {
      el = document.createElement('div');
      el.className = 'node';
      el.dataset.id = id;
      el.innerHTML = `<span class="idx hidden"></span>
        <div class="cell nextf"><span class="fname">next</span><span class="fval"></span></div>
        <div class="cell data"></div>
        <div class="cell prevf"><span class="fname">prev</span><span class="fval"></span></div>`;
      const p = pos[id];
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.opacity = '0';
      stage.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = ''; });
    }
    el.querySelector('.data').textContent = snap.nodes[id].data;
    const nf = el.querySelector('.nextf');
    const pf = el.querySelector('.prevf');
    const nNull = snap.next[id] === null, pNull = snap.prev[id] === null;
    nf.querySelector('.fval').textContent = nNull ? 'null' : '\u25CF';
    nf.classList.toggle('isnull', nNull);
    pf.querySelector('.fval').textContent = pNull ? 'null' : '\u25CF';
    pf.classList.toggle('isnull', pNull);
    const idxEl = el.querySelector('.idx');
    const rowIdx = snap.order.indexOf(id);
    if (snap.showIndex && rowIdx >= 0) {
      idxEl.textContent = rowIdx;
      idxEl.classList.remove('hidden');
    } else idxEl.classList.add('hidden');
    el.classList.toggle('hi', snap.hi.includes(id));
    el.classList.toggle('isnew', snap.isNew.includes(id));
    el.classList.toggle('fade', snap.fade.includes(id));
    if (!isFresh) {
      const p = pos[id];
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
    }
  });

  // ----- reference labels (head / tail / current / newNode) -----
  const nullRefLevels = {};
  let nullCount = 0;
  REF_NAMES.forEach(name => {
    if ((name === 'head' || name === 'tail') && name in snap.refs && snap.refs[name] === null) {
      nullRefLevels[name] = nullCount++;
    }
  });
  REF_NAMES.forEach(name => {
    let lb = stage.querySelector(`.ref-label.r-${name}`);
    const has = name in snap.refs;
    const target = has ? snap.refs[name] : undefined;
    const isNullHT = (name === 'head' || name === 'tail') && target === null;
    if (!has || (target === null && !isNullHT) || (target && !pos[target])) {
      if (lb) { lb.style.opacity = '0'; setTimeout(() => lb.remove(), 400); }
      return;
    }
    if (!lb) {
      lb = document.createElement('div');
      lb.className = `ref-label r-${name}`;
      stage.appendChild(lb);
    }
    if (isNullHT) {
      lb.textContent = name + ' = null';
      lb.classList.add('isnull');
      lb.dataset.target = '';
      lb.style.left = (PAD_X + NODE_W / 2) + 'px';
      lb.style.top = (ROW_Y - 64 - nullRefLevels[name] * 36) + 'px';
      lb.style.opacity = '1';
      return;
    }
    lb.classList.remove('isnull');
    lb.textContent = name;
    lb.dataset.target = target;
    const stack = REF_NAMES.filter(n => n in snap.refs && snap.refs[n] === target);
    const level = stack.indexOf(name);
    const p = pos[target];
    const isFloating = !!snap.floating[target];
    lb.style.left = (p.x + NODE_W / 2) + 'px';      // .ref-label is translateX(-50%)
    lb.style.top = (isFloating ? p.y + NODE_H + 22 + level * 36
                               : p.y - 60 - level * 36) + 'px';
    lb.style.opacity = '1';
  });

  // ----- annotations -----
  stage.querySelectorAll('.anno-label').forEach(el => el.remove());
  snap.annos.forEach((an, i) => {
    if (!an.id || !pos[an.id]) return;
    const el = document.createElement('div');
    el.className = 'anno-label';
    el.textContent = an.text;
    el.dataset.target = an.id;
    const p = pos[an.id];
    el.style.left = (p.x + 8) + 'px';
    el.style.top = (p.y + NODE_H + 16) + 'px';
    stage.appendChild(el);
  });

  // ----- stage width, size badge, variables -----
  stage.style.minWidth = (endX + 20) + 'px';
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
  for (const name of REF_NAMES) {
    if (!(name in snap.refs)) continue;   // debugger style: only show a variable once it has been created
    const r = refStr(name);
    rows.push({ name, cls: 'v-' + name, val: '→ ' + r.v, none: false });
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

/* forward (next) link — upper lane.
   Starts ON the source node's next pointer (the dot in the NEXT cell) and
   lands ON the target node's NEXT cell, never on the middle of the box. */
function fPath(fromEl, toEl) {
  const a = stageRect(nextDot(fromEl)), b = stageRect(nextCell(toEl));
  const sx = a.x + a.w + 3, sy = a.y + a.h / 2;
  const tx = b.x - 4,       ty = b.y + b.h / 2;
  const sameLane = Math.abs(sy - ty) < 8;
  if (sameLane && tx > sx && tx - sx < GAP + 70) {
    return `M ${sx} ${sy} L ${tx} ${ty}`;
  }
  if (sameLane && tx > sx) {                         // skipping node(s): arc above
    return `M ${sx} ${sy - 5} C ${sx + 60} ${sy - 38}, ${tx - 60} ${ty - 38}, ${tx + 1} ${ty - 5}`;
  }
  if (sameLane) {                                    // target to the LEFT: arc above, back
    return `M ${sx} ${sy - 5} C ${sx + 50} ${sy - 44}, ${tx - 50} ${ty - 44}, ${tx + 1} ${ty - 5}`;
  }
  // another row (a floating new node): rise to the target's lane first, then
  // run in horizontally so the head still lands square on the NEXT cell
  const dy = ty - sy, ax = tx - 58;
  return `M ${sx} ${sy} C ${sx + 34} ${sy + dy * 0.35}, ${ax} ${ty - dy * 0.55}, ${ax} ${ty} L ${tx} ${ty}`;
}

/* backward (prev) link — lower lane.
   Starts ON the source node's prev pointer (the dot sits on the LEFT of the
   PREV cell, the side the arrow leaves from) and lands ON the target node's
   PREV cell. */
function bPath(fromEl, toEl) {
  const a = stageRect(prevDot(fromEl)), b = stageRect(prevCell(toEl));
  const sx = a.x - 3,       sy = a.y + a.h / 2;
  const tx = b.x + b.w + 4, ty = b.y + b.h / 2;
  const sameLane = Math.abs(sy - ty) < 8;
  if (sameLane && tx < sx && sx - tx < GAP + 70) {
    return `M ${sx} ${sy} L ${tx} ${ty}`;
  }
  if (sameLane && tx < sx) {                         // skipping node(s): arc below
    return `M ${sx} ${sy + 5} C ${sx - 60} ${sy + 38}, ${tx + 60} ${ty + 38}, ${tx - 1} ${ty + 5}`;
  }
  if (sameLane) {                                    // target to the RIGHT: arc below, back
    return `M ${sx} ${sy + 5} C ${sx - 50} ${sy + 44}, ${tx + 50} ${ty + 44}, ${tx - 1} ${ty + 5}`;
  }
  // another row: drop to the target's lane first, then run in horizontally so
  // the head still lands square on the PREV cell
  const dy = ty - sy, ax = tx + 58;
  return `M ${sx} ${sy} C ${sx - 34} ${sy + dy * 0.35}, ${ax} ${ty - dy * 0.55}, ${ax} ${ty} L ${tx} ${ty}`;
}

function refPath(labelEl, targetEl) {
  const a = stageRect(labelEl), b = stageRect(targetEl);
  const below = a.y > b.y + b.h;                     // label parked under the node
  const sx = a.x + a.w / 2, sy = below ? a.y : a.y + a.h;
  const tx = b.x + b.w / 2, ty = below ? b.y + b.h + 4 : b.y - 4;
  if (Math.abs(sx - tx) < 8) return `M ${sx} ${sy} L ${tx} ${ty}`;
  const c = below ? -26 : 26;
  return `M ${sx} ${sy} C ${sx} ${sy + c}, ${tx} ${ty - c}, ${tx} ${ty}`;
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
        const d = g.kind === 'n' ? fPath(fe, te) : bPath(fe, te);
        addPath(d, '#94a3b8', 3, g.kind === 'n' ? 'ah-link' : 'ah-plink',
          { opacity: alpha, dash: '7 6' });
      }
    }

    // live links — a null reference gets NO arrow (the field shows "null")
    for (const [kind, map] of [['n', snap.next], ['p', snap.prev]]) {
      for (const from in map) {
        const to = map[from];
        if (to === null) continue;
        const fe = nodeEl(from), te = nodeEl(to);
        if (!fe || !te) continue;
        const key = kind + ':' + from;
        const isFresh = linkFx[key] && linkFx[key] > now;
        if (linkFx[key] && linkFx[key] <= now) delete linkFx[key];
        const d = kind === 'n' ? fPath(fe, te) : bPath(fe, te);
        addPath(d,
          isFresh ? '#7c3aed' : (kind === 'n' ? '#64748b' : '#94a3b8'),
          isFresh ? 4.5 : (kind === 'n' ? 3.5 : 3),
          isFresh ? 'ah-fresh' : (kind === 'n' ? 'ah-link' : 'ah-plink'));
      }
    }

    // reference arrows
    stage.querySelectorAll('.ref-label').forEach(lb => {
      const t = lb.dataset.target;
      if (!t) return;
      const te = nodeEl(t);
      if (!te || lb.style.opacity === '0') return;
      const conf = lb.classList.contains('r-head') ? ['#2563eb', 'ah-head']
        : lb.classList.contains('r-tail') ? ['#0d9488', 'ah-tail']
        : lb.classList.contains('r-current') ? ['#d97706', 'ah-current']
        : ['#16a34a', 'ah-new'];
      addPath(refPath(lb, te), conf[0], 3.5, conf[1]);
    });

    // annotation arrows
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
    '    if (head == null) {',
    '        head = newNode;',
    '        tail = newNode;',
    '    } else {',
    '        newNode.next = head;',
    '        head.prev = newNode;',
    '        head = newNode;',
    '    }',
    '    size++;',
    '}'
  ],
  addLast: [
    'public void addLast(int data) {',
    '    Node newNode = new Node(data);',
    '    if (head == null) {',
    '        head = newNode;',
    '        tail = newNode;',
    '    } else {',
    '        tail.next = newNode;',
    '        newNode.prev = tail;',
    '        tail = newNode;',
    '    }',
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
    '    if (index == size) {',
    '        addLast(data);',
    '        return;',
    '    }',
    '    Node newNode = new Node(data);',
    '    Node current = head;',
    '    for (int i = 0; i < index - 1; i++) {',
    '        current = current.next;',
    '    }',
    '    newNode.next = current.next;',
    '    newNode.prev = current;',
    '    current.next.prev = newNode;',
    '    current.next = newNode;',
    '    size++;',
    '}'
  ],
  deleteFirst: [
    'public void deleteFirst() {',
    '    if (head == null) {',
    '        throw new NoSuchElementException();',
    '    }',
    '    if (head == tail) {',
    '        head = null;',
    '        tail = null;',
    '    } else {',
    '        head = head.next;',
    '        head.prev = null;',
    '    }',
    '    size--;',
    '}'
  ],
  deleteLast: [
    'public void deleteLast() {',
    '    if (head == null) {',
    '        throw new NoSuchElementException();',
    '    }',
    '    if (head == tail) {',
    '        head = null;',
    '        tail = null;',
    '    } else {',
    '        tail = tail.prev;',
    '        tail.next = null;',
    '    }',
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
    '    if (index == size - 1) {',
    '        deleteLast();',
    '        return;',
    '    }',
    '    Node current = head;',
    '    for (int i = 0; i < index; i++) {',
    '        current = current.next;',
    '    }',
    '    current.prev.next = current.next;',
    '    current.next.prev = current.prev;',
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
    `نستدعي <b>addFirst(${data})</b> على القائمة المرتبطة المزدوجة (Doubly Linked List).`,
    'العقدة (Node) في القائمة المزدوجة لها مرجعان (Reference) — next و prev — لذا فإن الإضافة في المقدمة تُحدِّث كلا الاتجاهين.');

  const nn = c.newFloating(data, 0);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `ننشئ عقدة جديدة تحتوي على ${data}. كلا مرجعيها — prev و next — يبدأ بقيمة null.`,
    'كل عملية إضافة تبدأ بإنشاء كائن العقدة في الذاكرة.',
    'إلى ماذا يشير newNode.prev و newNode.next مباشرة بعد الإنشاء؟',
    'كلاهما null — العقدة الجديدة تمامًا لا تشير إلى أي شيء في أي من الاتجاهين.', true);

  if (!oldHead) {
    c.clearFx();
    c.push(2, 'if (head == null)',
      'head يساوي null — القائمة فارغة، لذا تصبح العقدة الجديدة هي العقدة الوحيدة.',
      'مع وجود عقدة واحدة، تكون هي العقدة الأولى والأخيرة معًا.');
    c.snap.refs.head = nn; c.placeInOrder(nn, 0);
    c.push(3, 'head = newNode;', 'أصبح head يشير الآن إلى العقدة الجديدة.', '');
    c.snap.refs.tail = nn;
    c.push(4, 'tail = newNode;', 'أصبح tail أيضًا يشير إلى العقدة الجديدة.',
      'في القائمة المرتبطة المزدوجة نحافظ على كلا الطرفين: head و tail.');
    c.clearFx(); c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(10, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');
    return { name: 'addFirst', java: JAVA.addFirst, steps: c.steps, resultList: c.values() };
  }

  c.clearFx();
  c.push(2, 'if (head == null)',
    'head ليس null — القائمة ليست فارغة، لذا ننفذ فرع else.',
    'الحالة العامة يجب أن تربط العقدة الجديدة بالعقدة الأولى القديمة في كلا الاتجاهين.');

  c.clearFx();
  c.snap.next[nn] = oldHead; c.snap.hi = [oldHead];
  c.push(6, 'newNode.next = head;',
    `أصبح newNode.next يشير الآن للأمام إلى Node(${c.data(oldHead)}) — العقدة الأولى القديمة.`,
    'الاتجاه الأول: يجب أن تعرف العقدة الجديدة من يأتي بعدها.',
    'إلى أي عقدة سيشير newNode.next بعد هذه الجملة؟',
    `Node(${c.data(oldHead)}) — العقدة الأولى الحالية.`, true);

  c.clearFx();
  c.snap.prev[oldHead] = nn; c.snap.hi = [oldHead];
  c.push(7, 'head.prev = newNode;',
    `أصبح Node(${c.data(oldHead)}).prev يشير الآن للخلف إلى العقدة الجديدة.`,
    'الاتجاه الثاني: يجب أن تعرف العقدة الأولى القديمة من يأتي قبلها. في القائمة المرتبطة المزدوجة كل رابط له جانبان (prev و next).',
    'لماذا تحتاج القائمة المرتبطة المزدوجة هذه الجملة الإضافية مقارنة بالقائمة المرتبطة الأحادية؟',
    'لأن الروابط ذات اتجاهين: يجب أن تشير العقدة الأولى القديمة للخلف إلى العقدة الجديدة، وإلا لتعطل الاجتياز العكسي.', true);

  c.clearFx();
  c.snap.refs.head = nn;
  c.placeInOrder(nn, 0);
  c.push(8, 'head = newNode;',
    'يُحدَّث head ليشير إلى العقدة الأولى الجديدة.',
    'أصبحت القائمة تبدأ الآن من العقدة الجديدة. لم تتحرك أي عقدة — تغيّرت المراجع فقط.');

  c.clearFx();
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(10, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addFirst', java: JAVA.addFirst, steps: c.steps, resultList: c.values() };
}

function buildAddLast(data) {
  const c = new Ctx(baseList);
  const oldTail = c.snap.refs.tail;
  c.snap.vars = { data };
  c.push(0, `addLast(${data})`,
    `نستدعي <b>addLast(${data})</b>.`,
    'بفضل المرجع (Reference) tail، نصل إلى العقدة (Node) الأخيرة مباشرة — دون الحاجة إلى أي حلقة اجتياز. هذه العملية O(1)!');

  const nn = c.newFloating(data, c.snap.order.length ? c.snap.order.length - 0.35 : 0);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `ننشئ عقدة جديدة تحتوي على ${data} (مع prev = null و next = null).`,
    'العقدة الأخيرة دائمًا حقل next فيها يساوي null — وهذا متحقق أصلًا.');

  if (!oldTail) {
    c.clearFx();
    c.push(2, 'if (head == null)',
      'head يساوي null — القائمة فارغة، لذا تصبح العقدة الجديدة هي العقدة الوحيدة.', '');
    c.snap.refs.head = nn; c.placeInOrder(nn, 0);
    c.push(3, 'head = newNode;', 'أصبح head يشير الآن إلى العقدة الجديدة.', '');
    c.snap.refs.tail = nn;
    c.push(4, 'tail = newNode;', 'أصبح tail أيضًا يشير إلى العقدة الجديدة.', '');
    c.clearFx(); c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(10, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');
    return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
  }

  c.clearFx();
  c.push(2, 'if (head == null)',
    'head ليس null — ننفذ فرع else.',
    'قارن مع القائمة المرتبطة الأحادية: هناك كان علينا المشي حتى النهاية. هنا يأخذنا tail إليها مباشرة.');

  c.clearFx();
  c.snap.next[oldTail] = nn; c.snap.hi = [oldTail];
  c.push(6, 'tail.next = newNode;',
    `أصبحت العقدة الأخيرة Node(${c.data(oldTail)}) تشير الآن للأمام إلى العقدة الجديدة.`,
    'الاتجاه الأول: رابط أمامي من العقدة الأخيرة القديمة.',
    'كيف وصلنا إلى العقدة الأخيرة دون حلقة؟',
    'عبر المرجع tail — القائمة المرتبطة المزدوجة تحتفظ بمرجع مباشر إلى العقدة الأخيرة، مما يجعل addLast بزمن O(1) بلا اجتياز.', true);

  c.clearFx();
  c.snap.prev[nn] = oldTail; c.snap.hi = [oldTail];
  c.push(7, 'newNode.prev = tail;',
    `أصبح newNode.prev يشير الآن للخلف إلى Node(${c.data(oldTail)}).`,
    'الاتجاه الثاني: يجب أن تعرف العقدة الجديدة من يأتي قبلها.');

  c.clearFx();
  c.snap.refs.tail = nn;
  c.placeInOrder(nn, c.snap.order.length);
  c.push(8, 'tail = newNode;',
    'يُحدَّث tail ليشير إلى العقدة الأخيرة الجديدة.',
    'اكتمل الربط في كلا الاتجاهين وأصبح tail صحيحًا من جديد.');

  c.clearFx();
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(10, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
}

function buildAddAt(index, data) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index, data };
  c.push(0, `addAt(${index}, ${data})`,
    `ندرج ${data} عند الفهرس (index) ${index}. تظهر الفهارس فوق كل عقدة (Node).`,
    'في القائمة المرتبطة المزدوجة (Doubly Linked List)، يتطلب إدراج عقدة في الوسط أربعة تحديثات للمراجع (Reference) — اثنان في كل اتجاه.');
  c.push(1, 'if (index < 0 || index > size)',
    `index = ${index} يقع ضمن المدى 0 … ${c.snap.size} — لا يُرمى أي استثناء.`, '');

  if (index === 0) {
    const oldHead = c.snap.refs.head;
    c.push(4, 'if (index == 0)',
      'index يساوي 0 — الإدراج في المقدمة هو بالضبط ما تفعله addFirst.',
      'نعيد استخدام addFirst بدلًا من تكرار منطقها.');
    const nn = c.newFloating(data, 0);
    c.snap.refs.newNode = nn; c.snap.isNew = [nn];
    c.push(5, 'addFirst(data);', `داخل addFirst: تُنشأ عقدة جديدة تحتوي على ${data}.`, '');
    c.snap.next[nn] = oldHead;
    if (oldHead) c.snap.prev[oldHead] = nn;
    c.push(5, 'addFirst(data);',
      'داخل addFirst: newNode.next = head و head.prev = newNode — تم الربط في كلا الاتجاهين.', '');
    c.snap.refs.head = nn;
    if (!oldHead) c.snap.refs.tail = nn;
    c.placeInOrder(nn, 0);
    c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(5, 'addFirst(data);', 'داخل addFirst: head = newNode; size++.', '');
    c.clearFx();
    c.push(6, 'return;', 'انتهت addAt.', '');
    return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (index == 0)', 'index لا يساوي 0 — نتخطى هذه الحالة.', '');

  if (index === c.snap.size) {
    const oldTail = c.snap.refs.tail;
    c.push(8, 'if (index == size)',
      `index يساوي size (${c.snap.size}) — الإدراج في النهاية هو بالضبط ما تفعله addLast.`,
      'بفضل tail، فإن addLast بزمن O(1) — دون حاجة إلى اجتياز.');
    const nn = c.newFloating(data, c.snap.order.length - 0.35);
    c.snap.refs.newNode = nn; c.snap.isNew = [nn];
    c.push(9, 'addLast(data);', `داخل addLast: تُنشأ عقدة جديدة تحتوي على ${data}.`, '');
    c.snap.next[oldTail] = nn; c.snap.prev[nn] = oldTail;
    c.push(9, 'addLast(data);',
      'داخل addLast: tail.next = newNode و newNode.prev = tail — تم الربط في كلا الاتجاهين.', '');
    c.snap.refs.tail = nn;
    c.placeInOrder(nn, c.snap.order.length);
    c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(9, 'addLast(data);', 'داخل addLast: tail = newNode; size++.', '');
    c.clearFx();
    c.push(10, 'return;', 'انتهت addAt.', '');
    return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
  }

  c.push(8, 'if (index == size)', 'index لا يساوي size — نتخطى هذه الحالة.', '');

  const nn = c.newFloating(data, index - 0.5);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(12, `Node newNode = new Node(${data});`,
    `أنشئ العقدة الجديدة التي تحتوي على ${data} (prev = null و next = null).`,
    'تُنشأ «جانبًا» — غير متصلة بأي شيء بعد.');

  let cur = c.snap.refs.head;
  c.clearFx(); c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(13, 'Node current = head;',
    'يبدأ current عند العقدة الأولى (الفهرس 0).',
    `يجب أن يتوقف current عند العقدة التي تسبق موضع الإدراج — الفهرس ${index - 1}.`);

  for (let i = 0; i < index - 1; i++) {
    c.clearFx(); c.snap.vars.i = i; c.snap.hi = [cur];
    c.push(14, 'for (int i = 0; i < index - 1; i++)',
      `i = ${i}، وهو أصغر من ${index - 1} — نواصل التقدم.`, '');
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(15, 'current = current.next;',
      `ينتقل current إلى Node(${c.data(cur)}) عند الفهرس ${i + 1}.`,
      'المرجع وحده هو الذي يتحرك — لا تغيّر أي عقدة موضعها.');
  }
  c.clearFx(); c.snap.vars.i = index - 1; c.snap.hi = [cur];
  c.push(14, 'for (int i = 0; i < index - 1; i++)',
    `i = ${index - 1} — تتوقف الحلقة. current عند الفهرس ${index - 1}، أي العقدة التي تسبق موضع الإدراج.`, '');

  const after = c.snap.next[cur];
  c.clearFx();
  c.snap.annos = [{ id: after, text: 'current.next' }];
  c.snap.next[nn] = after; c.snap.hi = [after];
  c.push(17, 'newNode.next = current.next;',
    `الرابط 1 من 4: يشير newNode للأمام إلى Node(${c.data(after)}).`,
    'نحفظ الاتصال ببقية القائمة قبل تغيير current.next.',
    'لماذا يجب أن نقرأ current.next الآن، قبل تغييره؟',
    `لأن الرابطين 1 و3 يحتاجان كليهما إلى قيمة current.next القديمة — Node(${c.data(after)}). لو غيّرناها أولاً لفقدنا بقية القائمة.`, true);

  c.clearFx();
  c.snap.prev[nn] = cur; c.snap.hi = [cur];
  c.push(18, 'newNode.prev = current;',
    `الرابط 2 من 4: يشير newNode للخلف إلى Node(${c.data(cur)}).`,
    'أصبحت العقدة الجديدة تعرف جارتيها كلتيهما.');

  c.clearFx();
  c.snap.prev[after] = nn; c.snap.hi = [after];
  c.snap.annos = [{ id: after, text: 'current.next' }];
  c.push(19, 'current.next.prev = newNode;',
    `الرابط 3 من 4: يشير Node(${c.data(after)}).prev الآن للخلف إلى العقدة الجديدة.`,
    'العقدة التي تلي موضع الإدراج يجب أن تشير للخلف إلى العقدة الجديدة. لاحظ: current.next ما يزال يشير هنا إلى الجارة القديمة.');

  c.clearFx();
  c.snap.next[cur] = nn; c.snap.hi = [cur];
  c.push(20, 'current.next = newNode;',
    `الرابط 4 من 4: يشير Node(${c.data(cur)}) للأمام إلى العقدة الجديدة. أصبحت السلسلة ${c.data(cur)} ⇄ ${data} ⇄ ${c.data(after)}.`,
    'يجب أن تأتي هذه الجملة أخيرًا — فالروابط الثلاثة السابقة احتاجت جميعها إلى القيمة القديمة لـ current.next.',
    'لماذا تكون current.next = newNode آخر الروابط الأربعة؟',
    'لأن الرابطين 1 و3 يقرآن قيمة current.next القديمة. وتغييرها مبكرًا يعني فقدان المرجع إلى بقية القائمة.', true);

  c.clearFx();
  c.placeInOrder(nn, index);
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = []; delete c.snap.vars.i;
  c.push(21, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
}

function buildDeleteFirst() {
  const c = new Ctx(baseList);
  c.push(0, 'deleteFirst()',
    'نستدعي <b>deleteFirst()</b>.',
    'حذف العقدة الأولى يحتاج تغييرين اثنين للمراجع: تحريك head للأمام، ثم مسح الرابط الخلفي.');

  if (c.snap.order.length === 0) {
    c.push(1, 'if (head == null)', 'head يساوي null — القائمة فارغة.', 'لا يوجد شيء لحذفه.');
    c.push(2, 'throw new NoSuchElementException();',
      'يُرمى استثناء: لا يمكنك الحذف من قائمة فارغة.', '');
    return { name: 'deleteFirst', java: JAVA.deleteFirst, steps: c.steps, resultList: c.values() };
  }
  c.push(1, 'if (head == null)', 'head لا يساوي null — نتابع.', '');

  if (c.snap.order.length === 1) {
    const only = c.snap.order[0];
    c.snap.hi = [only];
    c.push(4, 'if (head == tail)',
      'head و tail يشيران إلى العقدة نفسها — توجد عقدة واحدة بالضبط.',
      'حذف العقدة الوحيدة يجعل القائمة فارغة، لذا يجب أن يصبح الطرفان null.');
    c.clearFx(); c.snap.refs.head = null; c.snap.fade = [only];
    c.push(5, 'head = null;', 'لم يعد head يشير إلى العقدة.', '');
    c.snap.refs.tail = null;
    c.push(6, 'tail = null;', 'ولم يعد tail يشير إليها أيضًا — أصبحت القائمة فارغة.', '');
    c.clearFx(); c.removeNode(only); c.snap.size--; c.snap.sizeFlash = true;
    c.push(11, 'size--;', 'الحجم: 1 → 0.', '');
    return { name: 'deleteFirst', java: JAVA.deleteFirst, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (head == tail)', 'head و tail عقدتان مختلفتان — ندخل فرع else.', '');

  const old = c.snap.refs.head;
  const second = c.snap.next[old];
  c.snap.hi = [old, second];
  c.snap.annos = [{ id: second, text: 'head.next' }];
  c.push(8, 'head = head.next;',
    `حدّد العقدتين: head هو Node(${c.data(old)}) و head.next هو Node(${c.data(second)}).`,
    'سيتحرك head للأمام عقدة واحدة.',
    'بعد انتقال head، هل ستبقى العقدة الأولى الجديدة تشير للخلف إلى العقدة القديمة؟',
    `نعم — ما يزال Node(${c.data(second)}).prev يشير إلى Node(${c.data(old)}). ولهذا يجب أن تجعل الجملة التالية head.prev = null.`, true);

  c.clearFx();
  c.snap.refs.head = second;
  c.snap.fade = [old];
  c.push(8, 'head = head.next;',
    `يشير head الآن إلى Node(${c.data(second)}). لكن لاحظ: ما يزال prev فيها يشير للخلف إلى العقدة القديمة!`,
    'في القائمة المزدوجة، تحريك head وحده لا يكفي — يجب تنظيف الرابط الخلفي أيضًا.');

  c.clearFx();
  c.snap.prev[second] = null; c.snap.hi = [second];
  c.push(9, 'head.prev = null;',
    `يُضبط Node(${c.data(second)}).prev على null — أصبحت الآن عقدة أولى صحيحة.`,
    'لم يعد أي شيء يشير إلى العقدة القديمة في أي من الاتجاهين.');

  c.clearFx();
  c.removeNode(old);
  c.snap.size--; c.snap.sizeFlash = true;
  c.push(11, 'size--;',
    `الحجم: ${c.snap.size + 1} → ${c.snap.size}. يستعيد جامع المهملات (Garbage Collector) العقدة القديمة.`, '');

  return { name: 'deleteFirst', java: JAVA.deleteFirst, steps: c.steps, resultList: c.values() };
}

function buildDeleteLast() {
  const c = new Ctx(baseList);
  c.push(0, 'deleteLast()',
    'نستدعي <b>deleteLast()</b>.',
    'في القائمة الأحادية كان هذا يتطلب اجتيازًا كاملاً حتى العقدة قبل الأخيرة. أما هنا فيأخذنا tail.prev إليها مباشرة — بتكلفة O(1)!');

  if (c.snap.order.length === 0) {
    c.push(1, 'if (head == null)', 'head يساوي null — القائمة فارغة.', 'لا يوجد شيء لحذفه.');
    c.push(2, 'throw new NoSuchElementException();',
      'يُرمى استثناء: لا يمكنك الحذف من قائمة فارغة.', '');
    return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
  }
  c.push(1, 'if (head == null)', 'head لا يساوي null — نتابع.', '');

  if (c.snap.order.length === 1) {
    const only = c.snap.order[0];
    c.snap.hi = [only];
    c.push(4, 'if (head == tail)',
      'head و tail يشيران إلى العقدة نفسها — توجد عقدة واحدة بالضبط.', '');
    c.clearFx(); c.snap.refs.head = null; c.snap.fade = [only];
    c.push(5, 'head = null;', 'لم يعد head يشير إلى العقدة.', '');
    c.snap.refs.tail = null;
    c.push(6, 'tail = null;', 'ولم يعد tail يشير إليها أيضًا — أصبحت القائمة فارغة.', '');
    c.clearFx(); c.removeNode(only); c.snap.size--; c.snap.sizeFlash = true;
    c.push(11, 'size--;', 'الحجم: 1 → 0.', '');
    return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (head == tail)', 'head و tail عقدتان مختلفتان — ندخل فرع else.', '');

  const old = c.snap.refs.tail;
  const secondLast = c.snap.prev[old];
  c.snap.hi = [old, secondLast];
  c.snap.annos = [{ id: secondLast, text: 'tail.prev' }];
  c.push(8, 'tail = tail.prev;',
    `حدّد العقدتين: tail هو Node(${c.data(old)}) و tail.prev هو Node(${c.data(secondLast)}).`,
    'مرجع prev يتيح لنا الوصول إلى العقدة قبل الأخيرة دون أي حلقة.',
    'لماذا تحتاج القائمة الأحادية إلى حلقة اجتياز هنا، بينما لا تحتاجها القائمة المزدوجة؟',
    'العقدة الأحادية لا تستطيع الرجوع للخلف — فالوصول إلى العقدة قبل الأخيرة يتطلب السير من head. أما هنا فيقفز tail.prev إليها مباشرة: O(1) بدلاً من O(n).', true);

  c.clearFx();
  c.snap.refs.tail = secondLast;
  c.push(8, 'tail = tail.prev;',
    `يشير tail الآن إلى Node(${c.data(secondLast)}). لكن next فيها ما يزال يشير إلى العقدة الأخيرة القديمة.`,
    'يجب قطع الرابط الأمامي حتى تصبح العقدة القديمة غير قابلة للوصول.');

  c.clearFx();
  c.snap.next[secondLast] = null; c.snap.hi = [secondLast]; c.snap.fade = [old];
  c.push(9, 'tail.next = null;',
    `يُضبط Node(${c.data(secondLast)}).next على null — أصبحت الآن العقدة الأخيرة. Node(${c.data(old)}) لم تعد قابلة للوصول.`,
    'مرجع prev الخاص بها لا يهم: لم يعد أي شيء يشير إليها.');

  c.clearFx();
  c.removeNode(old);
  c.snap.size--; c.snap.sizeFlash = true;
  c.push(11, 'size--;',
    `الحجم: ${c.snap.size + 1} → ${c.snap.size}. يستعيد جامع المهملات العقدة الأخيرة القديمة.`, '');

  return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
}

function buildDeleteAt(index) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index };
  c.push(0, `deleteAt(${index})`,
    `احذف العقدة عند الفهرس ${index}.`,
    'على خلاف القائمة الأحادية، سيتوقف current على العقدة الضحية نفسها — إذ يتيح لنا prev و next الوصول إلى الجارتين كلتيهما منها.');
  c.push(1, 'if (index < 0 || index >= size)',
    `index = ${index} يقع ضمن 0 … ${c.snap.size - 1} — لا يُرمى أي استثناء.`, '');

  if (index === 0) {
    c.push(4, 'if (index == 0)',
      'index يساوي 0 — حذف العقدة الأولى هو بالضبط ما تفعله deleteFirst.', '');
    const old = c.snap.refs.head;
    const second = c.snap.next[old];
    c.snap.hi = [old];
    c.push(5, 'deleteFirst();', 'داخل deleteFirst: head = head.next; head.prev = null.', '');
    c.snap.refs.head = second ?? null;
    if (second) c.snap.prev[second] = null; else c.snap.refs.tail = null;
    c.snap.fade = [old]; c.snap.hi = [];
    c.push(5, 'deleteFirst();',
      `يشير head الآن إلى ${second ? `Node(${c.data(second)})` : 'null'} وقد مُسح الرابط الخلفي.`, '');
    c.removeNode(old); c.snap.size--; c.snap.sizeFlash = true;
    c.push(5, 'deleteFirst();', 'داخل deleteFirst: size--.', '');
    c.clearFx();
    c.push(6, 'return;', 'انتهت deleteAt.', '');
    return { name: 'deleteAt', java: JAVA.deleteAt, steps: c.steps, resultList: c.values() };
  }
  c.push(4, 'if (index == 0)', 'index لا يساوي 0 — نتخطى هذه الحالة.', '');

  if (index === c.snap.size - 1) {
    c.push(8, 'if (index == size - 1)',
      `index يساوي size − 1 (${index}) — حذف العقدة الأخيرة هو بالضبط ما تفعله deleteLast.`,
      'بفضل tail.prev، تكون deleteLast بتكلفة O(1).');
    const old = c.snap.refs.tail;
    const secondLast = c.snap.prev[old];
    c.snap.hi = [old];
    c.push(9, 'deleteLast();', 'داخل deleteLast: tail = tail.prev; tail.next = null.', '');
    c.snap.refs.tail = secondLast;
    c.snap.next[secondLast] = null;
    c.snap.fade = [old]; c.snap.hi = [];
    c.push(9, 'deleteLast();',
      `يشير tail الآن إلى Node(${c.data(secondLast)}) و next فيها يساوي null.`, '');
    c.removeNode(old); c.snap.size--; c.snap.sizeFlash = true;
    c.push(9, 'deleteLast();', 'داخل deleteLast: size--.', '');
    c.clearFx();
    c.push(10, 'return;', 'انتهت deleteAt.', '');
    return { name: 'deleteAt', java: JAVA.deleteAt, steps: c.steps, resultList: c.values() };
  }
  c.push(8, 'if (index == size - 1)', 'index ليس الموضع الأخير — نتجاوز هذه الحالة.', '');

  let cur = c.snap.refs.head;
  c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(12, 'Node current = head;',
    'يبدأ current عند الفهرس 0.',
    `لاحظ شرط الحلقة: i < index. سيتوقف current على العقدة الضحية عند الفهرس ${index} — وليس قبلها!`,
    'في القائمة الأحادية كان current يتوقف قبل الضحية. لماذا يمكنه هنا التوقف على الضحية نفسها؟',
    'لأن العقدة المزدوجة تعرف جارتيها: current.prev و current.next. لسنا بحاجة إلى القدوم من الجهة اليسرى.', true);

  for (let i = 0; i < index; i++) {
    c.clearFx(); c.snap.vars.i = i; c.snap.hi = [cur];
    c.push(13, 'for (int i = 0; i < index; i++)',
      `i = ${i}، وهو أصغر من ${index} — نواصل التقدم.`, '');
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(14, 'current = current.next;',
      `ينتقل current إلى Node(${c.data(cur)}) عند الفهرس ${i + 1}.`,
      'المرجع وحده هو الذي يتحرك.');
  }
  c.clearFx(); c.snap.vars.i = index; c.snap.hi = [cur];
  c.push(13, 'for (int i = 0; i < index; i++)',
    `i = ${index} — تتوقف الحلقة. يقف current على العقدة الضحية Node(${c.data(cur)}).`, '');

  const left = c.snap.prev[cur];
  const right = c.snap.next[cur];
  c.clearFx(); c.snap.hi = [cur];
  c.snap.annos = [{ id: left, text: 'current.prev' }, { id: right, text: 'current.next' }];
  c.snap.next[left] = right;
  c.push(16, 'current.prev.next = current.next;',
    `تجاوز أمامي: يشير Node(${c.data(left)}) الآن للأمام مباشرة إلى Node(${c.data(right)})، متخطيًا الضحية.`,
    'نصل إلى الجارة اليسرى عبر current.prev — دون حاجة إلى اجتياز.',
    'أي عقدتين تربط هذه الجملة؟',
    `Node(${c.data(left)}) → Node(${c.data(right)})، متخطية Node(${c.data(cur)}).`, true);

  c.clearFx();
  c.snap.prev[right] = left;
  c.snap.fade = [cur];
  c.snap.annos = [{ id: left, text: 'current.prev' }, { id: right, text: 'current.next' }];
  c.push(17, 'current.next.prev = current.prev;',
    `تجاوز خلفي: يشير Node(${c.data(right)}).prev الآن للخلف مباشرة إلى Node(${c.data(left)}). جرى تجاوز الضحية في الاتجاهين.`,
    'أصبحت الجارتان مرتبطتين حول الضحية — لم يعد أي شيء يشير إليها.');

  c.clearFx();
  c.removeNode(cur);
  delete c.snap.refs.current;
  c.snap.size--; c.snap.sizeFlash = true; delete c.snap.vars.i;
  c.push(18, 'size--;',
    `الحجم: ${c.snap.size + 1} → ${c.snap.size}. يستعيد جامع المهملات العقدة المتجاوَزة.`, '');

  return { name: 'deleteAt', java: JAVA.deleteAt, steps: c.steps, resultList: c.values() };
}

/* ================= step expansion (debugger model) ================= */

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

function showMsg(text, ok) {
  const m = $('message');
  m.textContent = text;
  m.classList.toggle('ok', !!ok);
}
const hideMsg = () => showMsg('');

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

function start() {
  const cfg = OPS[currentOpName];
  hideMsg();
  const size = baseList.length;
  let data = null, idx = null;

  if (cfg.data) {
    data = parseInt($('dataInput').value, 10);
    if (Number.isNaN(data)) { showMsg('الرجاء إدخال عدد صحيح في خانة القيمة.'); return; }
  }
  if (cfg.index) {
    idx = parseInt($('indexInput').value, 10);
    if (Number.isNaN(idx)) { showMsg('الرجاء إدخال فهرس (index) صحيح.'); return; }
    if (currentOpName === 'addAt' && (idx < 0 || idx > size)) {
      showMsg(`فهرس غير صالح ${idx}: للإدراج يجب أن يكون الفهرس (index) بين 0 و ${size} (الحجم الحالي). ` +
        `الفهرس ${size} يعني «الإدراج في النهاية»؛ وأي فهرس أكبر سيترك فجوة في القائمة.`);
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

function setPlaying(on) {
  playing = on;
  clearTimeout(playTimer);
  $('playBtn').innerHTML = on ? '&#10074;&#10074; إيقاف مؤقت' : '&#9654; تشغيل';
  if (on) playTimer = setTimeout(tick, PLAY_DELAY());
}
function tick() {
  if (!playing) return;
  if (!op || stepIdx >= op.steps.length - 1) { setPlaying(false); return; }
  goTo(stepIdx + 1);
  if (teachOpen || stepIdx >= op.steps.length - 1) { setPlaying(false); return; }
  playTimer = setTimeout(tick, PLAY_DELAY());
}

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
  showMsg('أُعيد تعيين القائمة إلى 10 → 20 → 40 → 50.', true);
  idleRender();
});

$('emptyBtn').addEventListener('click', () => {
  setPlaying(false);
  baseList = mkItems([]);
  op = null;
  stepIdx = -1;
  hideMsg();
  showMsg('مُسحت القائمة — ابدأ من قائمة فارغة وأضف العقدة الأولى.', true);
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
