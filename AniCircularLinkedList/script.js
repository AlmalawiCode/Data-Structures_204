/* ============================================================
   Circular Linked List Simulator — engine + operations
   Vanilla JS. Singly circular list with head AND tail: tail.next
   always points back to head, drawn as a wrap-around arc below
   the row. A single node points to itself (self-loop arc).
   Debugger stepping: the highlighted statement has NOT executed
   yet; each click animates the previous statement's effect.
   ============================================================ */

'use strict';

/* ---------------- constants & global state ---------------- */

const NODE_W = 120, NODE_H = 64, GAP = 50;
const PAD_X = 34, ROW_Y = 150, FLOAT_DY = 175;
const LOOP_DY = 78;                // loop-back lane below the row

let baseList = null;
let speed = 1;
let teachMode = false;
let currentOpName = 'addFirst';

let op = null;
let stepIdx = -1;
let playing = false;
let playTimer = null;

let idCounter = 0;
let renderedSnap = null;
let linkFx = {};
let ghostLinks = [];
let teachOpen = false;

const DUR = () => 900 / speed;
const PLAY_DELAY = () => 2600 / speed;

const $ = id => document.getElementById(id);
const stage = $('stage');
const linkLayer = $('linkLayer');

/* ---------------- snapshot model ---------------- */

function freshSnap(items) {
  const snap = {
    order: [], floating: {}, nodes: {}, next: {},
    refs: { head: null, tail: null },
    fade: [], hi: [], isNew: [], annos: [],
    size: items.length, sizeFlash: false, showIndex: false, vars: {}
  };
  let last = null;
  for (const it of items) {
    snap.order.push(it.id);
    snap.nodes[it.id] = { data: it.data };
    if (last) snap.next[last] = it.id;
    last = it.id;
  }
  if (last) snap.next[last] = snap.order[0];   // circular: tail.next = head
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
  const endX = PAD_X + snap.order.length * (NODE_W + GAP);
  return { pos, endX };
}

/* ---------------- DOM rendering of a snapshot ---------------- */

const REF_NAMES = ['head', 'tail', 'current', 'newNode'];

function renderState(snap) {
  const before = renderedSnap;
  const { pos, endX } = layout(snap);

  if (before) {
    const now = performance.now();
    for (const id in snap.next) {
      const oldT = before.next && id in before.next ? before.next[id] : undefined;
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
    if (!isFresh) {
      const p = pos[id];
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
    }
  });

  // ----- reference labels -----
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
  snap.annos.forEach(an => {
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
  const sx = a.x + a.w - 23, sy = a.y + a.h / 2;
  const tx = b.x - 3, ty = b.y + b.h / 2;
  const sameRow = Math.abs(sy - ty) < 8;

  if (fromEl === toEl) {                            // self-loop: node points to itself
    const ex = a.x + a.w * 0.55, ey = a.y + a.h + 3;
    return `M ${sx} ${sy} C ${sx + 52} ${sy + 4}, ${sx + 40} ${ey + 46}, ${ex} ${ey}`;
  }
  if (sameRow && tx > sx && tx - sx < GAP + 58) {
    return `M ${sx} ${sy} L ${tx} ${ty}`;            // adjacent: straight
  }
  if (sameRow && tx > sx) {                          // skipping node(s): arc above
    return `M ${sx} ${sy - 8} C ${sx + 60} ${sy - 72}, ${tx - 60} ${ty - 72}, ${tx + 1} ${ty - 8}`;
  }
  if (sameRow && tx < sx) {                          // wrap-around: loop below the row
    const loopY = ROW_Y + NODE_H + LOOP_DY;
    const ex = b.x + b.w * 0.3, ey = b.y + b.h + 3;
    return `M ${sx} ${sy} C ${sx + 56} ${sy + 4}, ${sx + 56} ${loopY}, ${sx + 4} ${loopY} ` +
           `L ${ex + 40} ${loopY} C ${ex} ${loopY}, ${ex} ${ey + 40}, ${ex} ${ey}`;
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

    ghostLinks = ghostLinks.filter(g => g.until > now);
    for (const g of ghostLinks) {
      const fe = nodeEl(g.from), te = nodeEl(g.to);
      if (fe && te) {
        const alpha = Math.max(0, (g.until - now) / DUR()) * 0.6;
        addPath(linkPath(fe, te), '#94a3b8', 3, 'ah-link', { opacity: alpha, dash: '7 6' });
      }
    }

    for (const from in snap.next) {
      const to = snap.next[from];
      if (to === null) continue;
      const fe = nodeEl(from), te = nodeEl(to);
      if (!fe || !te) continue;
      const isFresh = linkFx[from] && linkFx[from] > now;
      if (linkFx[from] && linkFx[from] <= now) delete linkFx[from];
      const dim = snap.fade.includes(from);
      addPath(linkPath(fe, te),
        isFresh ? '#7c3aed' : '#64748b',
        isFresh ? 4.5 : 3.5,
        isFresh ? 'ah-fresh' : 'ah-link',
        dim ? { opacity: 0.25 } : {});
    }

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
    '        newNode.next = newNode;',
    '    } else {',
    '        newNode.next = head;',
    '        tail.next = newNode;',
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
    '        newNode.next = newNode;',
    '    } else {',
    '        newNode.next = head;',
    '        tail.next = newNode;',
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
    '        tail.next = head;',
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
    '        Node current = head;',
    '        while (current.next != tail) {',
    '            current = current.next;',
    '        }',
    '        current.next = head;',
    '        tail = current;',
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
  const tailId = c.snap.refs.tail;
  c.snap.vars = { data };
  c.push(0, `addFirst(${data})`,
    `We call <b>addFirst(${data})</b> on the circular list.`,
    'In a circular list there is NO null at the end — tail.next always points back to head, so inserting at the front must keep the circle closed.');

  const nn = c.newFloating(data, 0);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `Create a new node containing ${data}. Its next field starts as null — it is not part of the circle yet.`,
    'Every insertion begins by creating the node object in memory.');

  if (!oldHead) {
    c.clearFx();
    c.push(2, 'if (head == null)',
      'head is null — the list is empty, so the new node becomes the only node.',
      'A circular list with one node is a special case: the node must point to ITSELF.');
    c.snap.refs.head = nn;
    c.push(3, 'head = newNode;', 'head now references the new node.', '');
    c.snap.refs.tail = nn; c.placeInOrder(nn, 0);
    c.push(4, 'tail = newNode;', 'tail also references the new node.', '');
    c.clearFx();
    c.snap.next[nn] = nn; c.snap.hi = [nn];
    c.push(5, 'newNode.next = newNode;',
      'The node points to ITSELF — the smallest possible circle.',
      'Even with one node, the circular rule holds: following next always brings you back around.',
      'Where does the only node of a circular list point?',
      'To itself — tail.next must equal head, and here the node is both head and tail.', true);
    c.clearFx(); c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(11, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');
    return { name: 'addFirst', java: JAVA.addFirst, steps: c.steps, resultList: c.values() };
  }

  c.clearFx();
  c.push(2, 'if (head == null)',
    'head is NOT null — take the else branch.',
    'We must link the new node into the circle at the front.');

  c.clearFx();
  c.snap.next[nn] = oldHead; c.snap.hi = [oldHead];
  c.push(7, 'newNode.next = head;',
    `newNode.next now points to Node(${c.data(oldHead)}) — the current first node.`,
    'The new node is connected forward into the circle before anything else changes.',
    'Which node will newNode.next reference after this statement?',
    `Node(${c.data(oldHead)}) — the current first node.`, true);

  c.clearFx();
  c.snap.next[tailId] = nn; c.snap.hi = [tailId];
  c.push(8, 'tail.next = newNode;',
    `The last node Node(${c.data(tailId)}) now points to the new node instead of the old head.`,
    'This is the CIRCULAR difference: tail.next must always reference the FIRST node. Since newNode is about to become first, the circle is redirected to it.',
    'Why must tail.next change in a circular addFirst, when the singly list never touched the last node?',
    'Because tail.next closes the circle back to the first node. A new first node means the circle must be re-closed onto it — otherwise tail would still loop to the OLD head.', true);

  c.clearFx();
  c.snap.refs.head = nn;
  c.placeInOrder(nn, 0);
  c.push(9, 'head = newNode;',
    'head is updated to reference the new first node. The circle is complete again.',
    'Follow the arrows: from any node you come back around through tail to the new head.');

  c.clearFx();
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(11, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addFirst', java: JAVA.addFirst, steps: c.steps, resultList: c.values() };
}

function buildAddLast(data) {
  const c = new Ctx(baseList);
  const oldHead = c.snap.refs.head;
  const tailId = c.snap.refs.tail;
  c.snap.vars = { data };
  c.push(0, `addLast(${data})`,
    `We call <b>addLast(${data})</b>.`,
    'Thanks to the tail reference, no traversal is needed — and watch closely: addLast is almost IDENTICAL to addFirst!');

  const nn = c.newFloating(data, c.snap.order.length ? c.snap.order.length - 0.35 : 0);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `Create a new node containing ${data} (next = null for now).`, '');

  if (!oldHead) {
    c.clearFx();
    c.push(2, 'if (head == null)',
      'head is null — the list is empty, so the new node becomes the only node.', '');
    c.snap.refs.head = nn;
    c.push(3, 'head = newNode;', 'head now references the new node.', '');
    c.snap.refs.tail = nn; c.placeInOrder(nn, 0);
    c.push(4, 'tail = newNode;', 'tail also references the new node.', '');
    c.clearFx();
    c.snap.next[nn] = nn; c.snap.hi = [nn];
    c.push(5, 'newNode.next = newNode;',
      'The node points to ITSELF — the smallest possible circle.', '');
    c.clearFx(); c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(11, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');
    return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
  }

  c.clearFx();
  c.push(2, 'if (head == null)',
    'head is NOT null — take the else branch.',
    'The new node must join the circle between tail and head.');

  c.clearFx();
  c.snap.next[nn] = oldHead; c.snap.hi = [oldHead];
  c.push(7, 'newNode.next = head;',
    `newNode.next points to Node(${c.data(oldHead)}) — the first node.`,
    'A new LAST node must close the circle: its next always references head.',
    'In the singly list, the new last node had next = null. What does it have here, and why?',
    'next = head — a circular list has no null; the last node always loops back to the first.', true);

  c.clearFx();
  c.snap.next[tailId] = nn; c.snap.hi = [tailId];
  c.push(8, 'tail.next = newNode;',
    `The old last node Node(${c.data(tailId)}) now points to the new node.`,
    'The new node is now inside the circle, after the old tail.');

  c.clearFx();
  c.snap.refs.tail = nn;
  c.placeInOrder(nn, c.snap.order.length);
  c.push(9, 'tail = newNode;',
    'tail is updated to reference the new last node.',
    'Compare with addFirst: the first three statements were IDENTICAL — only this last line differs (head = newNode vs tail = newNode)!',
    'addFirst and addLast share their first three statements. Which single line makes the difference?',
    'The last one: addFirst sets head = newNode, addLast sets tail = newNode. The circle itself is built the same way.', true);

  c.clearFx();
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(11, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
}

function buildAddAt(index, data) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index, data };
  c.push(0, `addAt(${index}, ${data})`,
    `Insert ${data} at index ${index}. Indexes are shown above each node.`,
    'Inserting in the MIDDLE of a circular list works exactly like the singly list — the circle is only touched when inserting at the ends.');
  c.push(1, 'if (index < 0 || index > size)',
    `index = ${index} is within 0 … ${c.snap.size} — no exception is thrown.`, '');

  if (index === 0) {
    const oldHead = c.snap.refs.head;
    const tailId = c.snap.refs.tail;
    c.push(4, 'if (index == 0)',
      'index is 0 — inserting at the front is exactly what addFirst does.', '');
    const nn = c.newFloating(data, 0);
    c.snap.refs.newNode = nn; c.snap.isNew = [nn];
    c.push(5, 'addFirst(data);', `Inside addFirst: a new node containing ${data} is created.`, '');
    c.snap.next[nn] = oldHead;
    if (tailId) c.snap.next[tailId] = nn;
    c.push(5, 'addFirst(data);',
      'Inside addFirst: newNode.next = head and tail.next = newNode — the circle is redirected.', '');
    c.snap.refs.head = nn;
    if (!oldHead) { c.snap.refs.tail = nn; c.snap.next[nn] = nn; }
    c.placeInOrder(nn, 0);
    c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(5, 'addFirst(data);', 'Inside addFirst: head = newNode; size++.', '');
    c.clearFx();
    c.push(6, 'return;', 'addAt is finished.', '');
    return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
  }
  c.push(4, 'if (index == 0)', 'index is not 0 — skip this case.', '');

  if (index === c.snap.size) {
    const oldHead = c.snap.refs.head;
    const tailId = c.snap.refs.tail;
    c.push(8, 'if (index == size)',
      `index equals size (${c.snap.size}) — inserting at the end is exactly what addLast does.`, '');
    const nn = c.newFloating(data, c.snap.order.length - 0.35);
    c.snap.refs.newNode = nn; c.snap.isNew = [nn];
    c.push(9, 'addLast(data);', `Inside addLast: a new node containing ${data} is created.`, '');
    c.snap.next[nn] = oldHead; c.snap.next[tailId] = nn;
    c.push(9, 'addLast(data);',
      'Inside addLast: newNode.next = head and tail.next = newNode — the circle now runs through the new node.', '');
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
    `Create the new node containing ${data} (next = null).`,
    'It is created “off to the side” — not part of the circle yet.');

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
    `newNode now points to Node(${c.data(after)}) — the node that currently follows current.`,
    'We save the connection to the rest of the circle BEFORE changing current.next.',
    'Why must this statement come BEFORE current.next = newNode?',
    `If current.next were changed first, the connection onward to Node(${c.data(after)}) would be lost.`, true);

  c.clearFx();
  c.snap.next[cur] = nn; c.snap.hi = [cur];
  c.push(18, 'current.next = newNode;',
    `Node(${c.data(cur)}) now points to the new node. The circle reads … ${c.data(cur)} → ${data} → ${c.data(after)} …`,
    'The new node is spliced into the circle. Note: head, tail, and the wrap-around link were never touched.');

  c.clearFx();
  c.placeInOrder(nn, index);
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = []; delete c.snap.vars.i;
  c.push(19, 'size++;', `Size: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
}

function buildDeleteFirst() {
  const c = new Ctx(baseList);
  c.push(0, 'deleteFirst()',
    'We call <b>deleteFirst()</b>.',
    'Removing the first node of a circular list needs TWO changes: move head forward AND re-close the circle from tail.');

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
      'head and tail reference the SAME node — there is exactly one node (pointing to itself).', '');
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
  const tailId = c.snap.refs.tail;
  c.snap.hi = [old, second];
  c.snap.annos = [{ id: second, text: 'head.next' }];
  c.push(8, 'head = head.next;',
    `Identify the nodes: head is Node(${c.data(old)}) and head.next is Node(${c.data(second)}).`,
    'head will move forward by one node.',
    'After head moves, where will tail.next still point?',
    `At the OLD first node, Node(${c.data(old)}) — the circle would be broken. That is why the next statement must re-close it.`, true);

  c.clearFx();
  c.snap.refs.head = second;
  c.snap.fade = [old];
  c.push(8, 'head = head.next;',
    `head now references Node(${c.data(second)}). But look at the wrap-around arrow: tail still loops to the OLD node!`,
    'In a circular list, moving head is not enough — tail.next must be updated too.');

  c.clearFx();
  c.snap.next[tailId] = second; c.snap.hi = [tailId];
  c.push(9, 'tail.next = head;',
    `Node(${c.data(tailId)}).next now loops to the new head, Node(${c.data(second)}). The circle is closed again.`,
    'Nothing references the old node any more.');

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
    'A circular SINGLY list still cannot go backward — we must walk to the second-last node, just like the plain singly list.');

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
      'head and tail reference the SAME node — there is exactly one node (pointing to itself).', '');
    c.clearFx(); c.snap.refs.head = null; c.snap.fade = [only];
    c.push(5, 'head = null;', 'head no longer references the node.', '');
    c.snap.refs.tail = null;
    c.push(6, 'tail = null;', 'tail no longer references it either — the list is empty.', '');
    c.clearFx(); c.removeNode(only); c.snap.size--; c.snap.sizeFlash = true;
    c.push(15, 'size--;', 'Size: 1 → 0.', '');
    return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (head == tail)', 'head and tail are different nodes — take the else branch.', '');

  let cur = c.snap.refs.head;
  const tailId = c.snap.refs.tail;
  c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(8, 'Node current = head;',
    'current starts at the first node.',
    'current must stop at the SECOND-LAST node — the one whose next is tail.');

  let first = true;
  while (c.snap.next[cur] !== tailId) {
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.hi = [cur];
    c.snap.annos = [{ id: nxt, text: 'current.next' }];
    c.push(9, 'while (current.next != tail)',
      `current.next is Node(${c.data(nxt)}), which is not tail — keep going.`,
      'We compare against tail, not null.',
      first ? 'In the singly list the loop condition was current.next.next != null. Why can we not use null here?' : null,
      first ? 'A circular list contains NO null — following next forever never reaches null, so the loop would never stop. We compare against tail instead.' : null, true);
    first = false;
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(10, 'current = current.next;',
      `current moves to Node(${c.data(cur)}).`,
      'Only the reference moves.');
  }
  c.clearFx(); c.snap.hi = [cur];
  c.snap.annos = [{ id: tailId, text: 'current.next' }];
  c.push(9, 'while (current.next != tail)',
    `current.next IS tail — current stands on the second-last node, Node(${c.data(cur)}). Exit the loop.`,
    'This node will become the new last node.');

  c.clearFx();
  const headId = c.snap.refs.head;
  c.snap.next[cur] = headId; c.snap.hi = [cur]; c.snap.fade = [tailId];
  c.push(12, 'current.next = head;',
    `Node(${c.data(cur)}) now loops directly back to Node(${c.data(headId)}), skipping the old last node.`,
    `Node(${c.data(tailId)}) is bypassed — the circle closes one node earlier.`,
    'What happens to the old last node now?',
    'Nothing references it any more, so the garbage collector reclaims it.', true);

  c.clearFx();
  c.snap.refs.tail = cur;
  c.push(13, 'tail = current;',
    `tail is updated to reference Node(${c.data(cur)}) — the new last node.`,
    'tail must always mark the node whose next is head.');

  c.clearFx();
  c.removeNode(tailId);
  delete c.snap.refs.current;
  c.snap.size--; c.snap.sizeFlash = true;
  c.push(15, 'size--;',
    `Size: ${c.snap.size + 1} → ${c.snap.size}.`, '');

  return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
}

function buildDeleteAt(index) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index };
  c.push(0, `deleteAt(${index})`,
    `Delete the node at index ${index}.`,
    'Deleting in the MIDDLE works exactly like the singly list — the wrap-around link is only involved at the ends.');
  c.push(1, 'if (index < 0 || index >= size)',
    `index = ${index} is within 0 … ${c.snap.size - 1} — no exception is thrown.`, '');

  if (index === 0) {
    const old = c.snap.refs.head;
    const second = c.snap.next[old];
    const tailId = c.snap.refs.tail;
    c.push(4, 'if (index == 0)',
      'index is 0 — deleting the first node is exactly what deleteFirst does.', '');
    c.snap.hi = [old];
    c.push(5, 'deleteFirst();', 'Inside deleteFirst: head = head.next; tail.next = head.', '');
    if (c.snap.order.length === 1) {
      c.snap.refs.head = null; c.snap.refs.tail = null; c.snap.fade = [old]; c.snap.hi = [];
      c.push(5, 'deleteFirst();', 'The only node is removed — the list becomes empty.', '');
    } else {
      c.snap.refs.head = second; c.snap.next[tailId] = second;
      c.snap.fade = [old]; c.snap.hi = [];
      c.push(5, 'deleteFirst();',
        `head now points to Node(${c.data(second)}) and tail.next loops to it — the circle is re-closed.`, '');
    }
    c.removeNode(old); c.snap.size--; c.snap.sizeFlash = true;
    c.push(5, 'deleteFirst();', 'Inside deleteFirst: size--.', '');
    c.clearFx();
    c.push(6, 'return;', 'deleteAt is finished.', '');
    return { name: 'deleteAt', java: JAVA.deleteAt, steps: c.steps, resultList: c.values() };
  }
  c.push(4, 'if (index == 0)', 'index is not 0 — skip this case.', '');

  if (index === c.snap.size - 1) {
    const old = c.snap.refs.tail;
    const secondLast = c.snap.order[c.snap.order.length - 2];
    const headId = c.snap.refs.head;
    c.push(8, 'if (index == size - 1)',
      `index equals size − 1 (${index}) — deleting the last node is exactly what deleteLast does.`, '');
    c.snap.hi = [old];
    c.push(9, 'deleteLast();',
      'Inside deleteLast: walk until current.next == tail, then re-close the circle.', '');
    c.snap.next[secondLast] = headId; c.snap.refs.tail = secondLast;
    c.snap.fade = [old]; c.snap.hi = [];
    c.push(9, 'deleteLast();',
      `Node(${c.data(secondLast)}) now loops back to head and becomes the new tail.`, '');
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
    `current must stop at index ${index - 1} — the node BEFORE the one we delete.`);

  for (let i = 0; i < index - 1; i++) {
    c.clearFx(); c.snap.vars.i = i; c.snap.hi = [cur];
    c.push(13, 'for (int i = 0; i < index - 1; i++)',
      `i = ${i}, which is less than ${index - 1} — keep moving.`, '');
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(14, 'current = current.next;',
      `current moves to Node(${c.data(cur)}) at index ${i + 1}.`,
      'Only the reference moves.');
  }
  c.clearFx(); c.snap.vars.i = index - 1; c.snap.hi = [cur];
  c.push(13, 'for (int i = 0; i < index - 1; i++)',
    `i = ${index - 1} — the loop stops. current is at index ${index - 1}, just before the victim.`, '');

  const victim = c.snap.next[cur];
  const after = c.snap.next[victim];
  c.clearFx(); c.snap.hi = [cur];
  c.snap.annos = [{ id: victim, text: 'current.next' }, { id: after, text: 'current.next.next' }];
  c.push(16, 'current.next = current.next.next;',
    `Identify the references first: current.next is Node(${c.data(victim)}) — the victim — and current.next.next is Node(${c.data(after)}).`,
    'We read both references before changing anything.',
    'Which node will current.next reference after this statement?',
    `Node(${c.data(after)}) — the victim gets skipped.`, true);

  c.clearFx();
  c.snap.next[cur] = after;
  c.snap.hi = [cur]; c.snap.fade = [victim];
  c.push(16, 'current.next = current.next.next;',
    `Node(${c.data(cur)}) now points directly to Node(${c.data(after)}). Node(${c.data(victim)}) is skipped and out of the circle.`,
    'One reference change removes the node — head, tail and the wrap-around link are untouched.');

  c.clearFx();
  c.removeNode(victim);
  c.snap.size--; c.snap.sizeFlash = true; delete c.snap.vars.i;
  c.push(17, 'size--;',
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
