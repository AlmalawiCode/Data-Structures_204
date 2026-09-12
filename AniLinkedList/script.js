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
    `We call <b>addFirst(${data})</b> on the list.`,
    'Watch how a node is added to the FRONT without moving any existing node.');

  const nn = c.newFloating(data, 0);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `Create a new node containing ${data}. Its next field starts as null.`,
    'Every insertion begins by creating the node object in memory. It is not connected to the list yet.',
    'When this node is created, what will its next field point to?',
    'null — a brand-new node does not reference anything yet.', true);

  c.clearFx();
  c.snap.next[nn] = oldHead;
  if (oldHead) c.snap.hi = [oldHead];
  c.push(2, 'newNode.next = head;',
    'newNode.next now points to the same node referenced by head.',
    'We connect the new node to the list BEFORE moving head, so no node is ever lost.',
    'Which node will newNode.next reference after this statement?',
    oldHead ? `Node(${c.data(oldHead)}) — the current first node.` : 'null — the list is empty, so head is null.', true);

  c.clearFx();
  c.snap.refs.head = nn;
  c.placeInOrder(nn, 0);
  c.push(3, 'head = newNode;',
    'head is updated to reference the new first node.',
    'The list now officially starts at the new node.',
    'Will any existing node be moved in memory by this statement?',
    'No — only the head reference changes. Linked-list nodes never move.', true);

  c.clearFx();
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(4, 'size++;',
    `The size counter is incremented: ${c.snap.size - 1} → ${c.snap.size}.`,
    'Keeping size up to date makes size queries O(1).');

  return { name: 'addFirst', java: JAVA.addFirst, steps: c.steps, resultList: c.values() };
}

function buildAddLast(data) {
  const c = new Ctx(baseList);
  c.snap.vars = { data };
  const empty = c.snap.order.length === 0;
  c.push(0, `addLast(${data})`,
    `We call <b>addLast(${data})</b>.`,
    'The new node must become the LAST node, so we first walk to the end of the list.');

  const nn = c.newFloating(data, empty ? 0 : c.snap.order.length - 0.35);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `Create a new node containing ${data}, with next = null.`,
    'A last node always has next = null — which is already true for a fresh node.');

  if (empty) {
    c.clearFx();
    c.push(2, 'if (head == null)',
      'head is null — the list is empty, so the new node simply becomes the first node.',
      'An empty list is a special case: there is no last node to attach to.');
    c.snap.refs.head = nn; c.placeInOrder(nn, 0);
    c.push(3, 'head = newNode;',
      'head now references the new node.',
      'With one node, it is both the first and the last node.');
    c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(4, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');
    c.clearFx();
    c.push(5, 'return;', 'The method ends — no traversal was needed.', '');
    return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
  }

  c.clearFx();
  c.push(2, 'if (head == null)',
    'head is NOT null, so we skip this block.',
    'The special case only applies to an empty list.');

  let cur = c.snap.refs.head;
  c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(7, 'Node current = head;',
    'A traversal reference current starts at the first node.',
    'current will walk along the list. It is only a reference — the nodes themselves never move.',
    'Which node does current point to now?',
    `Node(${c.data(cur)}) — the same node that head references.`);

  let first = true;
  while (c.snap.next[cur] !== null) {
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.hi = [cur];
    c.push(8, 'while (current.next != null)',
      `current.next is Node(${c.data(nxt)}), not null — enter the loop.`,
      'We keep walking until current stands on the LAST node.');
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(9, 'current = current.next;',
      first ? 'current moves forward to the node that its next field references.'
            : `current moves forward to Node(${c.data(cur)}).`,
      'The reference current moves — NOT the nodes.',
      first ? 'Which node will current point to after this statement?' : null,
      first ? `Node(${c.data(cur)}).` : null, first);
    first = false;
  }

  c.clearFx(); c.snap.hi = [cur];
  c.push(8, 'while (current.next != null)',
    `current.next is null — current has reached the LAST node, Node(${c.data(cur)}). The loop stops.`,
    'The last node is the only node whose next field is null.',
    'Why does the loop stop here?',
    `Because Node(${c.data(cur)}).next is null — current is standing on the last node.`);

  c.clearFx();
  c.snap.next[cur] = nn; c.snap.hi = [cur];
  c.push(11, 'current.next = newNode;',
    `The last node Node(${c.data(cur)}) now points to the new node.`,
    'This single reference change attaches the new node to the end of the list.');

  c.clearFx();
  c.placeInOrder(nn, c.snap.order.length);
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(12, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
}

function buildAddAt(index, data) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index, data };
  c.push(0, `addAt(${index}, ${data})`,
    `Insert ${data} at index ${index}. Indexes are shown above each node.`,
    `We must reach the node BEFORE position ${index}, then re-link exactly two references.`);
  c.push(1, 'if (index < 0 || index > size)',
    `index = ${index} is within 0 … ${c.snap.size} — no exception is thrown.`,
    'Bounds are always validated before touching the list.');

  if (index === 0) {
    const oldHead = c.snap.refs.head;
    c.push(4, 'if (index == 0)',
      'index is 0 — inserting at the front is exactly what addFirst does.',
      'We reuse addFirst instead of duplicating its logic.');
    const nn = c.newFloating(data, 0);
    c.snap.refs.newNode = nn; c.snap.isNew = [nn];
    c.push(5, 'addFirst(data);',
      `Inside addFirst: a new node containing ${data} is created.`, '');
    c.snap.next[nn] = oldHead;
    c.push(5, 'addFirst(data);',
      'Inside addFirst: newNode.next = head — the new node is linked to the old first node.', '');
    c.snap.refs.head = nn; c.placeInOrder(nn, 0);
    c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(5, 'addFirst(data);',
      'Inside addFirst: head = newNode; size++. The new node is now first.', '');
    c.clearFx();
    c.push(6, 'return;', 'addAt is finished.', '');
    return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (index == 0)', 'index is not 0 — skip the special case.', '');

  const nn = c.newFloating(data, index - 0.5);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(8, `Node newNode = new Node(${data});`,
    `Create the new node containing ${data} (next = null).`,
    'It is created “off to the side” — not connected to anything yet.');

  let cur = c.snap.refs.head;
  c.clearFx(); c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(9, 'Node current = head;',
    'current starts at the first node (index 0).',
    `current must stop on the node BEFORE the insertion position — index ${index - 1}.`);

  for (let i = 0; i < index - 1; i++) {
    c.clearFx(); c.snap.vars.i = i; c.snap.hi = [cur];
    c.push(10, 'for (int i = 0; i < index - 1; i++)',
      `i = ${i}, which is less than ${index - 1} — keep moving.`,
      `The loop runs until current reaches index ${index - 1}.`);
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(11, 'current = current.next;',
      `current moves to Node(${c.data(cur)}) at index ${i + 1}.`,
      'Only the reference moves — no node changes position.');
  }
  c.clearFx(); c.snap.vars.i = index - 1; c.snap.hi = [cur];
  c.push(10, 'for (int i = 0; i < index - 1; i++)',
    `i = ${index - 1} — the loop stops. current is at index ${index - 1}, the node BEFORE the insertion point.`,
    'Stopping one node early is essential: it is that node’s next field we must change.');

  const after = c.snap.next[cur];
  c.clearFx();
  if (after) { c.snap.annos = [{ id: after, text: 'current.next' }]; c.snap.hi = [after]; }
  c.snap.next[nn] = after;
  c.push(13, 'newNode.next = current.next;',
    after ? `newNode now points to Node(${c.data(after)}) — the node that currently follows current.`
          : 'current.next is null (we are inserting at the end), so newNode.next stays null.',
    'We save the connection to the REST of the list before touching current.next. Doing these two statements in the opposite order would lose every node after current!',
    'Why must this statement come BEFORE current.next = newNode?',
    after ? `If current.next were changed first, Node(${c.data(after)}) and everything after it would become unreachable.`
          : 'In general, changing current.next first would throw away the rest of the list.', true);

  c.clearFx();
  c.snap.next[cur] = nn; c.snap.hi = [cur];
  c.push(14, 'current.next = newNode;',
    `Node(${c.data(cur)}) now points to the new node. The chain reads ${c.data(cur)} → ${data}${after ? ' → ' + c.data(after) : ''}.`,
    `Both links are correct — the new node is spliced in at position ${index}.`);

  c.clearFx();
  c.placeInOrder(nn, index);
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = []; delete c.snap.vars.i;
  c.push(15, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
}

function buildDeleteFirst() {
  const c = new Ctx(baseList);
  c.push(0, 'deleteFirst()',
    'We call <b>deleteFirst()</b>.',
    'The first node is removed by changing ONE reference — no node is shifted.');

  if (c.snap.order.length === 0) {
    c.push(1, 'if (head == null)', 'head is null — the list is empty.', 'There is nothing to delete.');
    c.push(2, 'throw new NoSuchElementException();',
      'An exception is thrown: you cannot delete from an empty list.',
      'Failing fast here prevents a NullPointerException later.');
    return { name: 'deleteFirst', java: JAVA.deleteFirst, steps: c.steps, resultList: c.values() };
  }

  c.push(1, 'if (head == null)', 'head is not null — the list has at least one node. Continue.', '');

  const old = c.snap.refs.head;
  const second = c.snap.next[old];
  c.snap.hi = second ? [old, second] : [old];
  if (second) c.snap.annos = [{ id: second, text: 'head.next' }];
  c.push(4, 'head = head.next;',
    second ? `First, identify the two references involved: head is Node(${c.data(old)}) and head.next is Node(${c.data(second)}).`
           : 'head.next is null — after this statement the list will be empty.',
    'Before executing, be clear about where head will move to.',
    'Where will head point after this statement executes?',
    second ? `Node(${c.data(second)}) — the second node becomes the first.` : 'null — the list becomes empty.');

  c.clearFx();
  c.snap.refs.head = second ?? null;
  c.snap.fade = [old];
  c.push(4, 'head = head.next;',
    `head now references ${second ? `Node(${c.data(second)})` : 'null'}. No node was physically shifted — we simply changed the head reference.`,
    `The old first node, Node(${c.data(old)}), is no longer reachable from head.`);

  c.clearFx();
  c.removeNode(old);
  c.snap.size--; c.snap.sizeFlash = true;
  c.push(5, 'size--;',
    `Size: ${c.snap.size + 1} → ${c.snap.size}. The unreachable node is reclaimed by Java's garbage collector.`,
    'In Java we never free memory manually.');

  return { name: 'deleteFirst', java: JAVA.deleteFirst, steps: c.steps, resultList: c.values() };
}

function buildDeleteLast() {
  const c = new Ctx(baseList);
  c.push(0, 'deleteLast()',
    'We call <b>deleteLast()</b>.',
    'We must walk to the SECOND-LAST node — it is the one whose next field must become null.');

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
    c.push(4, 'if (head.next == null)',
      'There is exactly ONE node, so head.next is null.',
      'A single-node list has no second-last node — this is a special case.');
    c.clearFx(); c.snap.refs.head = null; c.snap.fade = [only];
    c.push(5, 'head = null;', 'head no longer references the node — the list is now empty.', '');
    c.clearFx(); c.removeNode(only); c.snap.size--; c.snap.sizeFlash = true;
    c.push(6, 'size--;', 'Size: 1 → 0.', '');
    c.push(7, 'return;', 'The method ends.', '');
    return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (head.next == null)', 'The list has more than one node — skip the special case.', '');

  let cur = c.snap.refs.head;
  c.snap.refs.current = cur; c.snap.hi = [cur];
  const secondLast = c.snap.order[c.snap.order.length - 2];
  c.push(9, 'Node current = head;',
    'current starts at the first node.',
    'current must stop at the SECOND-LAST node.',
    'At which node must current stop, and why?',
    `Node(${c.data(secondLast)}) — the second-last node, because its next field must be set to null.`);

  while (true) {
    const nxt = c.snap.next[cur];
    const nxt2 = nxt !== null ? c.snap.next[nxt] : null;
    c.clearFx(); c.snap.hi = [cur];
    if (nxt2 !== null) {
      c.snap.annos = [{ id: nxt2, text: 'current.next.next' }];
      c.push(10, 'while (current.next.next != null)',
        `current.next.next is Node(${c.data(nxt2)}), not null — keep going.`,
        'We look TWO nodes ahead so that we stop one node before the end.');
      c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
      c.push(11, 'current = current.next;',
        `current moves to Node(${c.data(cur)}).`,
        'Only the reference moves — the nodes stay in place.');
    } else {
      c.push(10, 'while (current.next.next != null)',
        `current.next.next is null — current is at the SECOND-LAST node, Node(${c.data(cur)}). Exit the loop.`,
        'One more step would overshoot: we need the node BEFORE the last one.');
      break;
    }
  }

  const last = c.snap.next[cur];
  c.clearFx();
  c.snap.next[cur] = null; c.snap.hi = [cur]; c.snap.fade = [last];
  c.push(13, 'current.next = null;',
    `The link from Node(${c.data(cur)}) to Node(${c.data(last)}) is removed. Node(${c.data(cur)}) is now the last node.`,
    `Node(${c.data(last)}) is unreachable — cutting this single reference is all that “deleting” means.`,
    'What happens to the old last node now?',
    'Nothing references it any more, so the garbage collector reclaims it.');

  c.clearFx();
  c.removeNode(last);
  c.snap.size--; c.snap.sizeFlash = true;
  c.push(14, 'size--;', `Size: ${c.snap.size + 1} → ${c.snap.size}.`, '');

  return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
}

function buildDeleteAt(index) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index };
  c.push(0, `deleteAt(${index})`,
    `Delete the node at index ${index}.`,
    `We must reach the node BEFORE index ${index} and make it skip over the victim node.`);
  c.push(1, 'if (index < 0 || index >= size)',
    `index = ${index} is within 0 … ${c.snap.size - 1} — no exception is thrown.`,
    'For deletion the index must be strictly less than size.');

  if (index === 0) {
    const old = c.snap.refs.head;
    const second = c.snap.next[old];
    c.push(4, 'if (index == 0)',
      'index is 0 — deleting the first node is exactly what deleteFirst does.',
      'We reuse deleteFirst instead of duplicating code.');
    c.snap.hi = [old];
    c.push(5, 'deleteFirst();', 'Inside deleteFirst: head = head.next is about to run.', '');
    c.snap.refs.head = second ?? null; c.snap.fade = [old]; c.snap.hi = [];
    c.push(5, 'deleteFirst();',
      `head now points to ${second ? `Node(${c.data(second)})` : 'null'} — the old first node is unreachable.`, '');
    c.removeNode(old); c.snap.size--; c.snap.sizeFlash = true;
    c.push(5, 'deleteFirst();', 'Inside deleteFirst: size--.', '');
    c.clearFx();
    c.push(6, 'return;', 'deleteAt is finished.', '');
    return { name: 'deleteAt', java: JAVA.deleteAt, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (index == 0)', 'index is not 0 — skip the special case.', '');

  let cur = c.snap.refs.head;
  c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(8, 'Node current = head;',
    'current starts at index 0.',
    `current must stop at index ${index - 1} — the node BEFORE the one we delete.`);

  for (let i = 0; i < index - 1; i++) {
    c.clearFx(); c.snap.vars.i = i; c.snap.hi = [cur];
    c.push(9, 'for (int i = 0; i < index - 1; i++)',
      `i = ${i}, which is less than ${index - 1} — keep moving.`, '');
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(10, 'current = current.next;',
      `current moves to Node(${c.data(cur)}) at index ${i + 1}.`,
      'Only the reference moves.');
  }
  c.clearFx(); c.snap.vars.i = index - 1; c.snap.hi = [cur];
  c.push(9, 'for (int i = 0; i < index - 1; i++)',
    `i = ${index - 1} — the loop stops. current is at index ${index - 1}, just before the victim.`,
    'We stop one node early so we can rewire that node’s next field.');

  const victim = c.snap.next[cur];
  const after = c.snap.next[victim];
  c.clearFx(); c.snap.hi = [cur];
  c.snap.annos = [{ id: victim, text: 'current.next' }];
  if (after) c.snap.annos.push({ id: after, text: 'current.next.next' });
  c.push(12, 'current.next = current.next.next;',
    `Identify the references first: current.next is Node(${c.data(victim)}) — the victim — and current.next.next is ${after ? `Node(${c.data(after)})` : 'null'}.`,
    'We read both references before changing anything.',
    'Which node will current.next reference after this statement?',
    after ? `Node(${c.data(after)}) — the victim gets skipped.` : 'null — the victim was the last node.');

  c.clearFx();
  c.snap.next[cur] = after ?? null;
  c.snap.hi = [cur]; c.snap.fade = [victim];
  c.push(12, 'current.next = current.next.next;',
    `Node(${c.data(cur)}) now points directly to ${after ? `Node(${c.data(after)})` : 'null'}. Node(${c.data(victim)}) is skipped because Node(${c.data(cur)}) no longer references it.`,
    'One reference change removes the node from the chain — nothing is shifted.');

  c.clearFx();
  c.removeNode(victim);
  c.snap.size--; c.snap.sizeFlash = true; delete c.snap.vars.i;
  c.push(13, 'size--;',
    `Size: ${c.snap.size + 1} → ${c.snap.size}. The garbage collector reclaims the skipped node.`, '');

  return { name: 'deleteAt', java: JAVA.deleteAt, steps: c.steps, resultList: c.values() };
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
             means: 'The operation is complete — this is the final state of the list.',
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

/* ----- start ----- */
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

/* ----- play / pause ----- */
function nextDelay() {
  return PLAY_DELAY();
}
function setPlaying(on) {
  playing = on;
  clearTimeout(playTimer);
  $('playBtn').innerHTML = on ? '&#10074;&#10074; Pause' : '&#9654; Play';
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
  $('codeTitle').textContent = 'Java — ' + cfg.title;
  $('exStmt').textContent = '—';
  $('exMeans').innerHTML = `Press <b>Start Animation</b> to run <b>${cfg.title}</b> one statement at a time.`;
  $('exWhy').textContent = '';
  $('exWhyRow').style.visibility = 'hidden';
  $('stepIndicator').textContent = 'Ready';
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
  showMsg('List reset to 10 → 20 → 40 → 50.', true);
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
