/* ============================================================
   Doubly Linked List Simulator — engine + operations
   Vanilla JS. Nodes are [prev | data | next] boxes; forward
   (next) arrows travel on the upper lane, backward (prev)
   arrows on the lower lane. All arrows are redrawn each frame
   from live DOM positions so they follow CSS transitions.
   Debugger stepping: the highlighted statement has NOT executed
   yet; each click animates the previous statement's effect.
   ============================================================ */

'use strict';

/* ---------------- constants & global state ---------------- */

const NODE_W = 132, NODE_H = 64, GAP = 66;
const PAD_X = 34, ROW_Y = 170, FLOAT_DY = 168;
const LANE = 11;                   // vertical offset of next (up) / prev (down) lanes

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
        <div class="cell prevf"></div><div class="cell data"></div><div class="cell nextf"></div>`;
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
    nf.textContent = nNull ? 'null' : '•';
    nf.classList.toggle('isnull', nNull);
    pf.textContent = pNull ? 'null' : '•';
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
      lb.style.left = PAD_X + 'px';
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
    lb.style.left = (p.x + NODE_W / 2 - 30) + 'px';
    lb.style.top = (p.y - 60 - level * 36) + 'px';
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

/* forward (next) link: upper lane, leaves the next cell rightward */
function fPath(fromEl, toEl) {
  const a = stageRect(fromEl), b = stageRect(toEl);
  const sx = a.x + a.w - 17, sy = a.y + a.h / 2 - LANE;
  const tx = b.x - 3, ty = b.y + b.h / 2 - LANE;
  const sameRow = Math.abs(sy - ty) < 8;
  if (sameRow && tx > sx && tx - sx < GAP + 58) {
    return `M ${sx} ${sy} L ${tx} ${ty}`;
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

/* backward (prev) link: lower lane, leaves the prev cell leftward */
function bPath(fromEl, toEl) {
  const a = stageRect(fromEl), b = stageRect(toEl);
  const sx = a.x + 17, sy = a.y + a.h / 2 + LANE;
  const tx = b.x + b.w + 3, ty = b.y + b.h / 2 + LANE;
  const sameRow = Math.abs(sy - ty) < 8;
  if (sameRow && tx < sx && sx - tx < GAP + 58) {
    return `M ${sx} ${sy} L ${tx} ${ty}`;
  }
  if (sameRow && tx < sx) {                          // skipping node(s): arc below
    return `M ${sx} ${sy + 8} C ${sx - 60} ${sy + 72}, ${tx + 60} ${ty + 72}, ${tx - 1} ${ty + 8}`;
  }
  if (ty < sy - 40) {                                // target on the row above
    const ex = b.x + b.w * 0.7, ey = b.y + b.h + 3;
    return `M ${sx} ${sy} C ${sx - 55} ${sy}, ${ex} ${ey + 55}, ${ex} ${ey}`;
  }
  if (ty > sy + 40) {                                // target on the row below
    const ex = b.x + b.w * 0.7, ey = b.y - 3;
    return `M ${sx} ${sy} C ${sx - 55} ${sy}, ${ex} ${ey - 55}, ${ex} ${ey}`;
  }
  const dx = Math.max(46, Math.abs(tx - sx) / 2);
  return `M ${sx} ${sy} C ${sx - dx} ${sy}, ${tx + dx} ${ty}, ${tx} ${ty}`;
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
    `We call <b>addFirst(${data})</b> on the doubly linked list.`,
    'A doubly linked node has TWO references — next and prev — so insertion at the front updates both directions.');

  const nn = c.newFloating(data, 0);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `Create a new node containing ${data}. Both of its references — prev and next — start as null.`,
    'Every insertion begins by creating the node object in memory.',
    'What do newNode.prev and newNode.next point to right after creation?',
    'Both are null — a brand-new node references nothing in either direction.', true);

  if (!oldHead) {
    c.clearFx();
    c.push(2, 'if (head == null)',
      'head is null — the list is empty, so the new node becomes the only node.',
      'With one node, it is both the first AND the last node.');
    c.snap.refs.head = nn; c.placeInOrder(nn, 0);
    c.push(3, 'head = newNode;', 'head now references the new node.', '');
    c.snap.refs.tail = nn;
    c.push(4, 'tail = newNode;', 'tail also references the new node.',
      'In a doubly linked list we maintain BOTH ends: head and tail.');
    c.clearFx(); c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(10, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');
    return { name: 'addFirst', java: JAVA.addFirst, steps: c.steps, resultList: c.values() };
  }

  c.clearFx();
  c.push(2, 'if (head == null)',
    'head is NOT null — the list is not empty, so we take the else branch.',
    'The general case must connect the new node to the old first node in BOTH directions.');

  c.clearFx();
  c.snap.next[nn] = oldHead; c.snap.hi = [oldHead];
  c.push(6, 'newNode.next = head;',
    `newNode.next now points forward to Node(${c.data(oldHead)}) — the old first node.`,
    'First direction: the new node must know who comes after it.',
    'Which node will newNode.next reference after this statement?',
    `Node(${c.data(oldHead)}) — the current first node.`, true);

  c.clearFx();
  c.snap.prev[oldHead] = nn; c.snap.hi = [oldHead];
  c.push(7, 'head.prev = newNode;',
    `Node(${c.data(oldHead)}).prev now points backward to the new node.`,
    'Second direction: the old first node must know who comes BEFORE it. In a doubly linked list every link has two sides.',
    'Why does a doubly linked list need this extra statement compared to a singly linked list?',
    'Because links are two-way: the old head must point BACK to the new node, or backward traversal would break.', true);

  c.clearFx();
  c.snap.refs.head = nn;
  c.placeInOrder(nn, 0);
  c.push(8, 'head = newNode;',
    'head is updated to reference the new first node.',
    'The list now starts at the new node. No node moved — only references changed.');

  c.clearFx();
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(10, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addFirst', java: JAVA.addFirst, steps: c.steps, resultList: c.values() };
}

function buildAddLast(data) {
  const c = new Ctx(baseList);
  const oldTail = c.snap.refs.tail;
  c.snap.vars = { data };
  c.push(0, `addLast(${data})`,
    `We call <b>addLast(${data})</b>.`,
    'Thanks to the tail reference, we can reach the last node DIRECTLY — no traversal loop is needed. This is O(1)!');

  const nn = c.newFloating(data, c.snap.order.length ? c.snap.order.length - 0.35 : 0);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `Create a new node containing ${data} (prev = null, next = null).`,
    'A last node always has next = null, which is already true.');

  if (!oldTail) {
    c.clearFx();
    c.push(2, 'if (head == null)',
      'head is null — the list is empty, so the new node becomes the only node.', '');
    c.snap.refs.head = nn; c.placeInOrder(nn, 0);
    c.push(3, 'head = newNode;', 'head now references the new node.', '');
    c.snap.refs.tail = nn;
    c.push(4, 'tail = newNode;', 'tail also references the new node.', '');
    c.clearFx(); c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(10, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');
    return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
  }

  c.clearFx();
  c.push(2, 'if (head == null)',
    'head is NOT null — take the else branch.',
    'Compare with the singly linked list: there we had to WALK to the end. Here tail takes us straight there.');

  c.clearFx();
  c.snap.next[oldTail] = nn; c.snap.hi = [oldTail];
  c.push(6, 'tail.next = newNode;',
    `The last node Node(${c.data(oldTail)}) now points forward to the new node.`,
    'First direction: forward link from the old last node.',
    'How did we reach the last node without a loop?',
    'Through the tail reference — the doubly linked list keeps a direct reference to the last node, making addLast O(1).', true);

  c.clearFx();
  c.snap.prev[nn] = oldTail; c.snap.hi = [oldTail];
  c.push(7, 'newNode.prev = tail;',
    `newNode.prev now points backward to Node(${c.data(oldTail)}).`,
    'Second direction: the new node must know who comes before it.');

  c.clearFx();
  c.snap.refs.tail = nn;
  c.placeInOrder(nn, c.snap.order.length);
  c.push(8, 'tail = newNode;',
    'tail is updated to reference the new last node.',
    'Both directions are linked and tail is correct again.');

  c.clearFx();
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(10, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
}

function buildAddAt(index, data) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index, data };
  c.push(0, `addAt(${index}, ${data})`,
    `Insert ${data} at index ${index}. Indexes are shown above each node.`,
    'In a doubly linked list, splicing a node in requires FOUR reference updates — two in each direction.');
  c.push(1, 'if (index < 0 || index > size)',
    `index = ${index} is within 0 … ${c.snap.size} — no exception is thrown.`, '');

  if (index === 0) {
    const oldHead = c.snap.refs.head;
    c.push(4, 'if (index == 0)',
      'index is 0 — inserting at the front is exactly what addFirst does.',
      'We reuse addFirst instead of duplicating its logic.');
    const nn = c.newFloating(data, 0);
    c.snap.refs.newNode = nn; c.snap.isNew = [nn];
    c.push(5, 'addFirst(data);', `Inside addFirst: a new node containing ${data} is created.`, '');
    c.snap.next[nn] = oldHead;
    if (oldHead) c.snap.prev[oldHead] = nn;
    c.push(5, 'addFirst(data);',
      'Inside addFirst: newNode.next = head and head.prev = newNode — linked in both directions.', '');
    c.snap.refs.head = nn;
    if (!oldHead) c.snap.refs.tail = nn;
    c.placeInOrder(nn, 0);
    c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(5, 'addFirst(data);', 'Inside addFirst: head = newNode; size++.', '');
    c.clearFx();
    c.push(6, 'return;', 'addAt is finished.', '');
    return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (index == 0)', 'index is not 0 — skip this case.', '');

  if (index === c.snap.size) {
    const oldTail = c.snap.refs.tail;
    c.push(8, 'if (index == size)',
      `index equals size (${c.snap.size}) — inserting at the end is exactly what addLast does.`,
      'Thanks to tail, addLast is O(1) — no traversal needed.');
    const nn = c.newFloating(data, c.snap.order.length - 0.35);
    c.snap.refs.newNode = nn; c.snap.isNew = [nn];
    c.push(9, 'addLast(data);', `Inside addLast: a new node containing ${data} is created.`, '');
    c.snap.next[oldTail] = nn; c.snap.prev[nn] = oldTail;
    c.push(9, 'addLast(data);',
      'Inside addLast: tail.next = newNode and newNode.prev = tail — linked in both directions.', '');
    c.snap.refs.tail = nn;
    c.placeInOrder(nn, c.snap.order.length);
    c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(9, 'addLast(data);', 'Inside addLast: tail = newNode; size++.', '');
    c.clearFx();
    c.push(10, 'return;', 'addAt is finished.', '');
    return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
  }

  c.push(8, 'if (index == size)', 'index is not equal to size — skip this case.', '');

  const nn = c.newFloating(data, index - 0.5);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(12, `Node newNode = new Node(${data});`,
    `Create the new node containing ${data} (prev = null, next = null).`,
    'It is created “off to the side” — not connected to anything yet.');

  let cur = c.snap.refs.head;
  c.clearFx(); c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(13, 'Node current = head;',
    'current starts at the first node (index 0).',
    `current must stop on the node BEFORE the insertion position — index ${index - 1}.`);

  for (let i = 0; i < index - 1; i++) {
    c.clearFx(); c.snap.vars.i = i; c.snap.hi = [cur];
    c.push(14, 'for (int i = 0; i < index - 1; i++)',
      `i = ${i}, which is less than ${index - 1} — keep moving.`, '');
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(15, 'current = current.next;',
      `current moves to Node(${c.data(cur)}) at index ${i + 1}.`,
      'Only the reference moves — no node changes position.');
  }
  c.clearFx(); c.snap.vars.i = index - 1; c.snap.hi = [cur];
  c.push(14, 'for (int i = 0; i < index - 1; i++)',
    `i = ${index - 1} — the loop stops. current is at index ${index - 1}, the node BEFORE the insertion point.`, '');

  const after = c.snap.next[cur];
  c.clearFx();
  c.snap.annos = [{ id: after, text: 'current.next' }];
  c.snap.next[nn] = after; c.snap.hi = [after];
  c.push(17, 'newNode.next = current.next;',
    `Link 1 of 4: newNode points forward to Node(${c.data(after)}).`,
    'We capture the connection to the rest of the list BEFORE changing current.next.',
    'Why must we read current.next now, before changing it?',
    `Because links 1 and 3 both need the old current.next — Node(${c.data(after)}). If we overwrote it first, we would lose the rest of the list.`, true);

  c.clearFx();
  c.snap.prev[nn] = cur; c.snap.hi = [cur];
  c.push(18, 'newNode.prev = current;',
    `Link 2 of 4: newNode points backward to Node(${c.data(cur)}).`,
    'The new node now knows both of its neighbours.');

  c.clearFx();
  c.snap.prev[after] = nn; c.snap.hi = [after];
  c.snap.annos = [{ id: after, text: 'current.next' }];
  c.push(19, 'current.next.prev = newNode;',
    `Link 3 of 4: Node(${c.data(after)}).prev now points backward to the new node.`,
    'The node AFTER the insertion point must point back to the new node. Note: current.next still refers to the old neighbour here.');

  c.clearFx();
  c.snap.next[cur] = nn; c.snap.hi = [cur];
  c.push(20, 'current.next = newNode;',
    `Link 4 of 4: Node(${c.data(cur)}) points forward to the new node. The chain reads ${c.data(cur)} ⇄ ${data} ⇄ ${c.data(after)}.`,
    'This statement must come LAST — the three earlier links all needed the old value of current.next.',
    'Why is current.next = newNode the LAST of the four links?',
    'Because links 1 and 3 read the old current.next. Changing it earlier would lose the reference to the rest of the list.', true);

  c.clearFx();
  c.placeInOrder(nn, index);
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = []; delete c.snap.vars.i;
  c.push(21, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
}

function buildDeleteFirst() {
  const c = new Ctx(baseList);
  c.push(0, 'deleteFirst()',
    'We call <b>deleteFirst()</b>.',
    'Removing the first node needs TWO reference changes: move head forward, then erase the backward link.');

  if (c.snap.order.length === 0) {
    c.push(1, 'if (head == null)', 'head is null — the list is empty.', 'There is nothing to delete.');
    c.push(2, 'throw new NoSuchElementException();',
      'An exception is thrown: you cannot delete from an empty list.', '');
    return { name: 'deleteFirst', java: JAVA.deleteFirst, steps: c.steps, resultList: c.values() };
  }
  c.push(1, 'if (head == null)', 'head is not null — continue.', '');

  if (c.snap.order.length === 1) {
    const only = c.snap.order[0];
    c.snap.hi = [only];
    c.push(4, 'if (head == tail)',
      'head and tail reference the SAME node — there is exactly one node.',
      'Deleting the only node empties the list, so both ends must become null.');
    c.clearFx(); c.snap.refs.head = null; c.snap.fade = [only];
    c.push(5, 'head = null;', 'head no longer references the node.', '');
    c.snap.refs.tail = null;
    c.push(6, 'tail = null;', 'tail no longer references it either — the list is empty.', '');
    c.clearFx(); c.removeNode(only); c.snap.size--; c.snap.sizeFlash = true;
    c.push(11, 'size--;', 'Size: 1 → 0.', '');
    return { name: 'deleteFirst', java: JAVA.deleteFirst, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (head == tail)', 'head and tail are different nodes — take the else branch.', '');

  const old = c.snap.refs.head;
  const second = c.snap.next[old];
  c.snap.hi = [old, second];
  c.snap.annos = [{ id: second, text: 'head.next' }];
  c.push(8, 'head = head.next;',
    `Identify the nodes: head is Node(${c.data(old)}) and head.next is Node(${c.data(second)}).`,
    'head will move forward by one node.',
    'After head moves, will the new first node still point backward at the old one?',
    `Yes — Node(${c.data(second)}).prev still references Node(${c.data(old)}). That is why the NEXT statement must set head.prev = null.`, true);

  c.clearFx();
  c.snap.refs.head = second;
  c.snap.fade = [old];
  c.push(8, 'head = head.next;',
    `head now references Node(${c.data(second)}). But notice: its prev still points BACK at the old node!`,
    'In a doubly linked list, moving head is not enough — the backward link must be cleaned up too.');

  c.clearFx();
  c.snap.prev[second] = null; c.snap.hi = [second];
  c.push(9, 'head.prev = null;',
    `Node(${c.data(second)}).prev is set to null — it is now a proper first node.`,
    'Nothing references the old node in either direction any more.');

  c.clearFx();
  c.removeNode(old);
  c.snap.size--; c.snap.sizeFlash = true;
  c.push(11, 'size--;',
    `Size: ${c.snap.size + 1} → ${c.snap.size}. The garbage collector reclaims the old node.`, '');

  return { name: 'deleteFirst', java: JAVA.deleteFirst, steps: c.steps, resultList: c.values() };
}

function buildDeleteLast() {
  const c = new Ctx(baseList);
  c.push(0, 'deleteLast()',
    'We call <b>deleteLast()</b>.',
    'In a SINGLY linked list this needed a full traversal to the second-last node. Here, tail.prev takes us there directly — O(1)!');

  if (c.snap.order.length === 0) {
    c.push(1, 'if (head == null)', 'head is null — the list is empty.', 'There is nothing to delete.');
    c.push(2, 'throw new NoSuchElementException();',
      'An exception is thrown: you cannot delete from an empty list.', '');
    return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
  }
  c.push(1, 'if (head == null)', 'head is not null — continue.', '');

  if (c.snap.order.length === 1) {
    const only = c.snap.order[0];
    c.snap.hi = [only];
    c.push(4, 'if (head == tail)',
      'head and tail reference the SAME node — there is exactly one node.', '');
    c.clearFx(); c.snap.refs.head = null; c.snap.fade = [only];
    c.push(5, 'head = null;', 'head no longer references the node.', '');
    c.snap.refs.tail = null;
    c.push(6, 'tail = null;', 'tail no longer references it either — the list is empty.', '');
    c.clearFx(); c.removeNode(only); c.snap.size--; c.snap.sizeFlash = true;
    c.push(11, 'size--;', 'Size: 1 → 0.', '');
    return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (head == tail)', 'head and tail are different nodes — take the else branch.', '');

  const old = c.snap.refs.tail;
  const secondLast = c.snap.prev[old];
  c.snap.hi = [old, secondLast];
  c.snap.annos = [{ id: secondLast, text: 'tail.prev' }];
  c.push(8, 'tail = tail.prev;',
    `Identify the nodes: tail is Node(${c.data(old)}) and tail.prev is Node(${c.data(secondLast)}).`,
    'The prev reference lets us reach the second-last node WITHOUT any loop.',
    'Why does the singly linked list need a traversal loop here, while the doubly linked list does not?',
    'A singly node cannot go backward — reaching the second-last node requires walking from head. Here tail.prev jumps straight to it: O(1) instead of O(n).', true);

  c.clearFx();
  c.snap.refs.tail = secondLast;
  c.push(8, 'tail = tail.prev;',
    `tail now references Node(${c.data(secondLast)}). But its next still points at the old last node.`,
    'The forward link must be cut so the old node becomes unreachable.');

  c.clearFx();
  c.snap.next[secondLast] = null; c.snap.hi = [secondLast]; c.snap.fade = [old];
  c.push(9, 'tail.next = null;',
    `Node(${c.data(secondLast)}).next is set to null — it is now the last node. Node(${c.data(old)}) is unreachable.`,
    'Its own prev reference does not matter: nothing points TO the node any more.');

  c.clearFx();
  c.removeNode(old);
  c.snap.size--; c.snap.sizeFlash = true;
  c.push(11, 'size--;',
    `Size: ${c.snap.size + 1} → ${c.snap.size}. The garbage collector reclaims the old last node.`, '');

  return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
}

function buildDeleteAt(index) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index };
  c.push(0, `deleteAt(${index})`,
    `Delete the node at index ${index}.`,
    'Unlike the singly linked list, current will stop ON the victim node itself — prev and next let us reach BOTH neighbours from it.');
  c.push(1, 'if (index < 0 || index >= size)',
    `index = ${index} is within 0 … ${c.snap.size - 1} — no exception is thrown.`, '');

  if (index === 0) {
    c.push(4, 'if (index == 0)',
      'index is 0 — deleting the first node is exactly what deleteFirst does.', '');
    const old = c.snap.refs.head;
    const second = c.snap.next[old];
    c.snap.hi = [old];
    c.push(5, 'deleteFirst();', 'Inside deleteFirst: head = head.next; head.prev = null.', '');
    c.snap.refs.head = second ?? null;
    if (second) c.snap.prev[second] = null; else c.snap.refs.tail = null;
    c.snap.fade = [old]; c.snap.hi = [];
    c.push(5, 'deleteFirst();',
      `head now points to ${second ? `Node(${c.data(second)})` : 'null'} and the backward link is cleared.`, '');
    c.removeNode(old); c.snap.size--; c.snap.sizeFlash = true;
    c.push(5, 'deleteFirst();', 'Inside deleteFirst: size--.', '');
    c.clearFx();
    c.push(6, 'return;', 'deleteAt is finished.', '');
    return { name: 'deleteAt', java: JAVA.deleteAt, steps: c.steps, resultList: c.values() };
  }
  c.push(4, 'if (index == 0)', 'index is not 0 — skip this case.', '');

  if (index === c.snap.size - 1) {
    c.push(8, 'if (index == size - 1)',
      `index equals size − 1 (${index}) — deleting the last node is exactly what deleteLast does.`,
      'Thanks to tail.prev, deleteLast is O(1).');
    const old = c.snap.refs.tail;
    const secondLast = c.snap.prev[old];
    c.snap.hi = [old];
    c.push(9, 'deleteLast();', 'Inside deleteLast: tail = tail.prev; tail.next = null.', '');
    c.snap.refs.tail = secondLast;
    c.snap.next[secondLast] = null;
    c.snap.fade = [old]; c.snap.hi = [];
    c.push(9, 'deleteLast();',
      `tail now points to Node(${c.data(secondLast)}) and its next is null.`, '');
    c.removeNode(old); c.snap.size--; c.snap.sizeFlash = true;
    c.push(9, 'deleteLast();', 'Inside deleteLast: size--.', '');
    c.clearFx();
    c.push(10, 'return;', 'deleteAt is finished.', '');
    return { name: 'deleteAt', java: JAVA.deleteAt, steps: c.steps, resultList: c.values() };
  }
  c.push(8, 'if (index == size - 1)', 'index is not the last position — skip this case.', '');

  let cur = c.snap.refs.head;
  c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(12, 'Node current = head;',
    'current starts at index 0.',
    `Note the loop condition: i < index. current will stop ON the victim node at index ${index} — not before it!`,
    'In the singly linked list, current stopped BEFORE the victim. Why can it stop ON the victim here?',
    'Because a doubly node knows both neighbours: current.prev and current.next. We do not need to arrive from the left.', true);

  for (let i = 0; i < index; i++) {
    c.clearFx(); c.snap.vars.i = i; c.snap.hi = [cur];
    c.push(13, 'for (int i = 0; i < index; i++)',
      `i = ${i}, which is less than ${index} — keep moving.`, '');
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(14, 'current = current.next;',
      `current moves to Node(${c.data(cur)}) at index ${i + 1}.`,
      'Only the reference moves.');
  }
  c.clearFx(); c.snap.vars.i = index; c.snap.hi = [cur];
  c.push(13, 'for (int i = 0; i < index; i++)',
    `i = ${index} — the loop stops. current stands ON the victim node, Node(${c.data(cur)}).`, '');

  const left = c.snap.prev[cur];
  const right = c.snap.next[cur];
  c.clearFx(); c.snap.hi = [cur];
  c.snap.annos = [{ id: left, text: 'current.prev' }, { id: right, text: 'current.next' }];
  c.snap.next[left] = right;
  c.push(16, 'current.prev.next = current.next;',
    `Bypass forward: Node(${c.data(left)}) now points forward directly to Node(${c.data(right)}), skipping the victim.`,
    'The left neighbour is reached through current.prev — no traversal needed.',
    'Which two nodes does this statement connect?',
    `Node(${c.data(left)}) → Node(${c.data(right)}), skipping over Node(${c.data(cur)}).`, true);

  c.clearFx();
  c.snap.prev[right] = left;
  c.snap.fade = [cur];
  c.snap.annos = [{ id: left, text: 'current.prev' }, { id: right, text: 'current.next' }];
  c.push(17, 'current.next.prev = current.prev;',
    `Bypass backward: Node(${c.data(right)}).prev now points back directly to Node(${c.data(left)}). The victim is bypassed in BOTH directions.`,
    'Both neighbours now link around the victim — nothing points to it any more.');

  c.clearFx();
  c.removeNode(cur);
  delete c.snap.refs.current;
  c.snap.size--; c.snap.sizeFlash = true; delete c.snap.vars.i;
  c.push(18, 'size--;',
    `Size: ${c.snap.size + 1} → ${c.snap.size}. The garbage collector reclaims the skipped node.`, '');

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
             means: 'The operation is complete — this is the final state of the list.',
             why: '',
             q: (last.q && !last.qPre) ? last.q : null,
             a: (last.q && !last.qPre) ? last.a : null,
             phase: 'done', snap: clone(last.snap) });
  return out;
}

/* ================= UI wiring ================= */

const OPS = {
  addFirst:    { title: 'Add First',          data: true,  index: false, defData: 5,
                 build: a => buildAddFirst(a.data) },
  addLast:     { title: 'Add Last',           data: true,  index: false, defData: 60,
                 build: a => buildAddLast(a.data) },
  addAt:       { title: 'Add at Position',    data: true,  index: true,  defData: 30, defIndex: 2,
                 build: a => buildAddAt(a.index, a.data) },
  deleteFirst: { title: 'Delete First',       data: false, index: false,
                 build: () => buildDeleteFirst() },
  deleteLast:  { title: 'Delete Last',        data: false, index: false,
                 build: () => buildDeleteLast() },
  deleteAt:    { title: 'Delete at Position', data: false, index: true,  defIndex: 2,
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
  if (st.phase === 'pending') { status.textContent = 'not executed yet'; status.className = 'ex-status pending'; }
  else if (st.phase === 'done') { status.textContent = 'complete'; status.className = 'ex-status done'; }
  else { status.className = 'ex-status hidden'; }

  hideTeach();
  if (teachMode && st.q && i > 0) showTeach(st.q, st.a);

  $('stepIndicator').textContent = `Step ${i} / ${op.steps.length - 1}`;

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
    if (Number.isNaN(data)) { showMsg('Please enter an integer value for Data.'); return; }
  }
  if (cfg.index) {
    idx = parseInt($('indexInput').value, 10);
    if (Number.isNaN(idx)) { showMsg('Please enter an integer Index.'); return; }
    if (currentOpName === 'addAt' && (idx < 0 || idx > size)) {
      showMsg(`Invalid index ${idx}: for insertion the index must be between 0 and ${size} (the current size). ` +
        `Index ${size} means “insert at the end”; a larger index would leave a gap in the list.`);
      return;
    }
    if (currentOpName === 'deleteAt') {
      if (size === 0) { showMsg('The list is empty — there is nothing to delete.'); return; }
      if (idx < 0 || idx >= size) {
        showMsg(`Invalid index ${idx}: for deletion the index must be between 0 and ${size - 1} (size − 1). ` +
          `There is no node at position ${idx}.`);
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
  $('playBtn').innerHTML = on ? '&#10074;&#10074; Pause' : '&#9654; Play';
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
  $('codeTitle').textContent = 'Java — ' + cfg.title;
  $('exStmt').textContent = '—';
  $('exMeans').innerHTML = `Press <b>Start Animation</b> to run <b>${cfg.title}</b> one statement at a time.`;
  $('exWhy').textContent = '';
  $('exWhyRow').style.visibility = 'hidden';
  $('stepIndicator').textContent = 'Ready';
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
  showMsg('List reset to 10 → 20 → 40 → 50.', true);
  idleRender();
});

$('emptyBtn').addEventListener('click', () => {
  setPlaying(false);
  baseList = mkItems([]);
  op = null;
  stepIdx = -1;
  hideMsg();
  showMsg('List cleared — start from an empty list and add the first node.', true);
  idleRender();
});

$('teachBtn').addEventListener('click', () => {
  teachMode = !teachMode;
  const b = $('teachBtn');
  b.textContent = 'Teaching Mode: ' + (teachMode ? 'On' : 'Off');
  b.classList.toggle('on', teachMode);
  b.setAttribute('aria-pressed', String(teachMode));
  if (!teachMode) hideTeach();
  showMsg(teachMode
    ? 'Teaching Mode ON — questions will appear at key steps; answers stay hidden until you press Reveal Answer.'
    : 'Teaching Mode OFF — the animation runs without class questions.', true);
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
