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
    `نستدعي <b>addFirst(${data})</b> على القائمة الدائرية.`,
    'في القائمة الدائرية (Circular Linked List) لا يوجد null في النهاية — يشير tail.next دائمًا عائدًا إلى head، لذا يجب أن يحافظ الإدراج في المقدمة على انغلاق الدائرة.');

  const nn = c.newFloating(data, 0);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `أنشئ عقدة جديدة تحتوي على ${data}. يبدأ حقل next فيها بقيمة null — فهي ليست جزءًا من الدائرة بعد.`,
    'كل عملية إدراج تبدأ بإنشاء كائن العقدة في الذاكرة.');

  if (!oldHead) {
    c.clearFx();
    c.push(2, 'if (head == null)',
      'head يساوي null — القائمة فارغة، لذا تصبح العقدة الجديدة هي العقدة الوحيدة.',
      'القائمة الدائرية ذات العقدة الواحدة حالة خاصة: يجب أن تشير العقدة إلى نفسها.');
    c.snap.refs.head = nn;
    c.push(3, 'head = newNode;', 'يشير head الآن إلى العقدة الجديدة.', '');
    c.snap.refs.tail = nn; c.placeInOrder(nn, 0);
    c.push(4, 'tail = newNode;', 'ويشير tail أيضًا إلى العقدة الجديدة.', '');
    c.clearFx();
    c.snap.next[nn] = nn; c.snap.hi = [nn];
    c.push(5, 'newNode.next = newNode;',
      'تشير العقدة إلى نفسها — أصغر دائرة ممكنة.',
      'حتى مع عقدة واحدة، تبقى القاعدة الدائرية قائمة: تتبُّع next يعيدك دائمًا إلى نقطة البداية.',
      'إلى أين تشير العقدة الوحيدة في القائمة الدائرية؟',
      'إلى نفسها — يجب أن يساوي tail.next قيمة head، وهنا العقدة هي head و tail معًا.', true);
    c.clearFx(); c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(11, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');
    return { name: 'addFirst', java: JAVA.addFirst, steps: c.steps, resultList: c.values() };
  }

  c.clearFx();
  c.push(2, 'if (head == null)',
    'head لا يساوي null — ندخل فرع else.',
    'يجب أن نربط العقدة الجديدة في مقدمة الدائرة.');

  c.clearFx();
  c.snap.next[nn] = oldHead; c.snap.hi = [oldHead];
  c.push(7, 'newNode.next = head;',
    `يشير newNode.next الآن إلى Node(${c.data(oldHead)}) — العقدة الأولى الحالية.`,
    'تُربط العقدة الجديدة بالدائرة أولًا قبل تغيير أي شيء آخر.',
    'إلى أي عقدة سيشير newNode.next بعد هذه الجملة؟',
    `Node(${c.data(oldHead)}) — العقدة الأولى الحالية.`, true);

  c.clearFx();
  c.snap.next[tailId] = nn; c.snap.hi = [tailId];
  c.push(8, 'tail.next = newNode;',
    `تشير العقدة الأخيرة Node(${c.data(tailId)}) الآن إلى العقدة الجديدة بدلًا من الرأس القديم.`,
    'هذا هو الفرق الدائري: يجب أن يشير tail.next دائمًا إلى العقدة الأولى. وبما أن newNode على وشك أن تصبح الأولى، تُعاد الدائرة إليها.',
    'لماذا يجب تغيير tail.next في addFirst الدائرية، بينما لم تلمس القائمة الأحادية العقدة الأخيرة أبدًا؟',
    'لأن tail.next يغلق الدائرة عائدًا إلى العقدة الأولى. وعقدة أولى جديدة تعني وجوب إعادة إغلاق الدائرة عليها — وإلا لبقي tail يدور إلى الرأس القديم.', true);

  c.clearFx();
  c.snap.refs.head = nn;
  c.placeInOrder(nn, 0);
  c.push(9, 'head = newNode;',
    'يُحدَّث head ليشير إلى العقدة الأولى الجديدة. اكتملت الدائرة من جديد.',
    'تتبّع الأسهم: من أي عقدة تعود دائرًا عبر tail إلى الرأس الجديد.');

  c.clearFx();
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(11, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addFirst', java: JAVA.addFirst, steps: c.steps, resultList: c.values() };
}

function buildAddLast(data) {
  const c = new Ctx(baseList);
  const oldHead = c.snap.refs.head;
  const tailId = c.snap.refs.tail;
  c.snap.vars = { data };
  c.push(0, `addLast(${data})`,
    `نستدعي <b>addLast(${data})</b>.`,
    'بفضل مرجع tail لا حاجة إلى اجتياز — ولاحظ جيدًا: addLast تكاد تكون مطابقة تمامًا لـ addFirst!');

  const nn = c.newFloating(data, c.snap.order.length ? c.snap.order.length - 0.35 : 0);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(1, `Node newNode = new Node(${data});`,
    `أنشئ عقدة جديدة تحتوي على ${data} (قيمة next حاليًا null).`, '');

  if (!oldHead) {
    c.clearFx();
    c.push(2, 'if (head == null)',
      'head يساوي null — القائمة فارغة، لذا تصبح العقدة الجديدة هي العقدة الوحيدة.', '');
    c.snap.refs.head = nn;
    c.push(3, 'head = newNode;', 'يشير head الآن إلى العقدة الجديدة.', '');
    c.snap.refs.tail = nn; c.placeInOrder(nn, 0);
    c.push(4, 'tail = newNode;', 'ويشير tail أيضًا إلى العقدة الجديدة.', '');
    c.clearFx();
    c.snap.next[nn] = nn; c.snap.hi = [nn];
    c.push(5, 'newNode.next = newNode;',
      'تشير العقدة إلى نفسها — أصغر دائرة ممكنة.', '');
    c.clearFx(); c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(11, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');
    return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
  }

  c.clearFx();
  c.push(2, 'if (head == null)',
    'head لا يساوي null — ندخل فرع else.',
    'يجب أن تنضم العقدة الجديدة إلى الدائرة بين tail و head.');

  c.clearFx();
  c.snap.next[nn] = oldHead; c.snap.hi = [oldHead];
  c.push(7, 'newNode.next = head;',
    `يشير newNode.next إلى Node(${c.data(oldHead)}) — العقدة الأولى.`,
    'العقدة الأخيرة الجديدة يجب أن تغلق الدائرة: يشير next فيها دائمًا إلى head.',
    'في القائمة الأحادية كانت العقدة الأخيرة الجديدة تحمل next = null. فماذا تحمل هنا، ولماذا؟',
    'next = head — القائمة الدائرية لا تحتوي على null؛ فالعقدة الأخيرة تعود دائمًا إلى الأولى.', true);

  c.clearFx();
  c.snap.next[tailId] = nn; c.snap.hi = [tailId];
  c.push(8, 'tail.next = newNode;',
    `تشير العقدة الأخيرة القديمة Node(${c.data(tailId)}) الآن إلى العقدة الجديدة.`,
    'أصبحت العقدة الجديدة داخل الدائرة، بعد الذيل القديم.');

  c.clearFx();
  c.snap.refs.tail = nn;
  c.placeInOrder(nn, c.snap.order.length);
  c.push(9, 'tail = newNode;',
    'يُحدَّث tail ليشير إلى العقدة الأخيرة الجديدة.',
    'قارن مع addFirst: الجمل الثلاث الأولى متطابقة — ولا يختلف سوى هذا السطر الأخير (head = newNode مقابل tail = newNode)!',
    'تتشارك addFirst و addLast جملها الثلاث الأولى. فما السطر الوحيد الذي يصنع الفرق؟',
    'السطر الأخير: addFirst تجعل head = newNode بينما addLast تجعل tail = newNode. أما الدائرة نفسها فتُبنى بالطريقة ذاتها.', true);

  c.clearFx();
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
  c.push(11, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addLast', java: JAVA.addLast, steps: c.steps, resultList: c.values() };
}

function buildAddAt(index, data) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index, data };
  c.push(0, `addAt(${index}, ${data})`,
    `أدرج ${data} عند الفهرس ${index}. تظهر الفهارس فوق كل عقدة.`,
    'الإدراج في وسط القائمة الدائرية يعمل تمامًا مثل القائمة الأحادية — لا تُمسّ الدائرة إلا عند الإدراج في الطرفين.');
  c.push(1, 'if (index < 0 || index > size)',
    `index = ${index} يقع ضمن 0 … ${c.snap.size} — لا يُرمى أي استثناء.`, '');

  if (index === 0) {
    const oldHead = c.snap.refs.head;
    const tailId = c.snap.refs.tail;
    c.push(4, 'if (index == 0)',
      'index يساوي 0 — الإدراج في المقدمة هو بالضبط ما تفعله addFirst.', '');
    const nn = c.newFloating(data, 0);
    c.snap.refs.newNode = nn; c.snap.isNew = [nn];
    c.push(5, 'addFirst(data);', `داخل addFirst: تُنشأ عقدة جديدة تحتوي على ${data}.`, '');
    c.snap.next[nn] = oldHead;
    if (tailId) c.snap.next[tailId] = nn;
    c.push(5, 'addFirst(data);',
      'داخل addFirst: newNode.next = head و tail.next = newNode — تُعاد وجهة الدائرة.', '');
    c.snap.refs.head = nn;
    if (!oldHead) { c.snap.refs.tail = nn; c.snap.next[nn] = nn; }
    c.placeInOrder(nn, 0);
    c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(5, 'addFirst(data);', 'داخل addFirst: head = newNode; size++.', '');
    c.clearFx();
    c.push(6, 'return;', 'انتهت addAt.', '');
    return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
  }
  c.push(4, 'if (index == 0)', 'index لا يساوي 0 — نتجاوز هذه الحالة.', '');

  if (index === c.snap.size) {
    const oldHead = c.snap.refs.head;
    const tailId = c.snap.refs.tail;
    c.push(8, 'if (index == size)',
      `index يساوي size (${c.snap.size}) — الإدراج في النهاية هو بالضبط ما تفعله addLast.`, '');
    const nn = c.newFloating(data, c.snap.order.length - 0.35);
    c.snap.refs.newNode = nn; c.snap.isNew = [nn];
    c.push(9, 'addLast(data);', `داخل addLast: تُنشأ عقدة جديدة تحتوي على ${data}.`, '');
    c.snap.next[nn] = oldHead; c.snap.next[tailId] = nn;
    c.push(9, 'addLast(data);',
      'داخل addLast: newNode.next = head و tail.next = newNode — أصبحت الدائرة تمر عبر العقدة الجديدة.', '');
    c.snap.refs.tail = nn;
    c.placeInOrder(nn, c.snap.order.length);
    c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = [];
    c.push(9, 'addLast(data);', 'داخل addLast: tail = newNode; size++.', '');
    c.clearFx();
    c.push(10, 'return;', 'انتهت addAt.', '');
    return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
  }
  c.push(8, 'if (index == size)', 'index لا يساوي size — نتجاوز هذه الحالة.', '');

  const nn = c.newFloating(data, index - 0.5);
  c.snap.refs.newNode = nn; c.snap.isNew = [nn];
  c.push(12, `Node newNode = new Node(${data});`,
    `أنشئ العقدة الجديدة التي تحتوي على ${data} (قيمة next تساوي null).`,
    'تُنشأ «جانبًا» — ليست جزءًا من الدائرة بعد.');

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
    `يشير newNode الآن إلى Node(${c.data(after)}) — العقدة التي تلي current حاليًا.`,
    'نحفظ الاتصال ببقية الدائرة قبل تغيير current.next.',
    'لماذا يجب أن تأتي هذه الجملة قبل current.next = newNode؟',
    `لو غُيِّر current.next أولًا لضاع الاتصال بما بعده إلى Node(${c.data(after)}).`, true);

  c.clearFx();
  c.snap.next[cur] = nn; c.snap.hi = [cur];
  c.push(18, 'current.next = newNode;',
    `تشير Node(${c.data(cur)}) الآن إلى العقدة الجديدة. أصبحت الدائرة تقرأ … ${c.data(cur)} → ${data} → ${c.data(after)} …`,
    'أُدخلت العقدة الجديدة في الدائرة. لاحظ: لم تُمسّ head ولا tail ولا رابط الالتفاف إطلاقًا.');

  c.clearFx();
  c.placeInOrder(nn, index);
  c.snap.size++; c.snap.sizeFlash = true; c.snap.isNew = []; delete c.snap.vars.i;
  c.push(19, 'size++;', `الحجم: ${c.snap.size - 1} → ${c.snap.size}.`, '');

  return { name: 'addAt', java: JAVA.addAt, steps: c.steps, resultList: c.values() };
}

function buildDeleteFirst() {
  const c = new Ctx(baseList);
  c.push(0, 'deleteFirst()',
    'نستدعي <b>deleteFirst()</b>.',
    'حذف العقدة الأولى من القائمة الدائرية يحتاج تغييرين اثنين: تحريك head للأمام، وإعادة إغلاق الدائرة من tail.');

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
      'head و tail يشيران إلى العقدة نفسها — توجد عقدة واحدة بالضبط (تشير إلى نفسها).', '');
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
  const tailId = c.snap.refs.tail;
  c.snap.hi = [old, second];
  c.snap.annos = [{ id: second, text: 'head.next' }];
  c.push(8, 'head = head.next;',
    `حدّد العقدتين: head هو Node(${c.data(old)}) و head.next هو Node(${c.data(second)}).`,
    'سيتحرك head للأمام عقدة واحدة.',
    'بعد انتقال head، إلى أين سيبقى tail.next مشيرًا؟',
    `إلى العقدة الأولى القديمة Node(${c.data(old)}) — وبذلك تنكسر الدائرة. ولهذا يجب أن تعيد الجملة التالية إغلاقها.`, true);

  c.clearFx();
  c.snap.refs.head = second;
  c.snap.fade = [old];
  c.push(8, 'head = head.next;',
    `يشير head الآن إلى Node(${c.data(second)}). لكن انظر إلى سهم الالتفاف: ما يزال tail يدور إلى العقدة القديمة!`,
    'في القائمة الدائرية، تحريك head وحده لا يكفي — يجب تحديث tail.next أيضًا.');

  c.clearFx();
  c.snap.next[tailId] = second; c.snap.hi = [tailId];
  c.push(9, 'tail.next = head;',
    `يدور Node(${c.data(tailId)}).next الآن إلى الرأس الجديد Node(${c.data(second)}). أُغلقت الدائرة من جديد.`,
    'لم يعد أي شيء يشير إلى العقدة القديمة.');

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
    'القائمة الدائرية الأحادية ما تزال عاجزة عن الرجوع للخلف — يجب أن نسير حتى العقدة قبل الأخيرة، تمامًا كالقائمة الأحادية العادية.');

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
      'head و tail يشيران إلى العقدة نفسها — توجد عقدة واحدة بالضبط (تشير إلى نفسها).', '');
    c.clearFx(); c.snap.refs.head = null; c.snap.fade = [only];
    c.push(5, 'head = null;', 'لم يعد head يشير إلى العقدة.', '');
    c.snap.refs.tail = null;
    c.push(6, 'tail = null;', 'ولم يعد tail يشير إليها أيضًا — أصبحت القائمة فارغة.', '');
    c.clearFx(); c.removeNode(only); c.snap.size--; c.snap.sizeFlash = true;
    c.push(15, 'size--;', 'الحجم: 1 → 0.', '');
    return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
  }

  c.push(4, 'if (head == tail)', 'head و tail عقدتان مختلفتان — ندخل فرع else.', '');

  let cur = c.snap.refs.head;
  const tailId = c.snap.refs.tail;
  c.snap.refs.current = cur; c.snap.hi = [cur];
  c.push(8, 'Node current = head;',
    'يبدأ current عند العقدة الأولى.',
    'يجب أن يتوقف current عند العقدة قبل الأخيرة — تلك التي يشير next فيها إلى tail.');

  let first = true;
  while (c.snap.next[cur] !== tailId) {
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.hi = [cur];
    c.snap.annos = [{ id: nxt, text: 'current.next' }];
    c.push(9, 'while (current.next != tail)',
      `current.next هو Node(${c.data(nxt)})، وهو ليس tail — نواصل.`,
      'نقارن بـ tail وليس بـ null.',
      first ? 'في القائمة الأحادية كان شرط الحلقة current.next.next != null. لماذا لا يمكننا استخدام null هنا؟' : null,
      first ? 'القائمة الدائرية لا تحتوي على null إطلاقًا — تتبُّع next إلى الأبد لن يصل إلى null أبدًا، فلن تتوقف الحلقة أبدًا. لذلك نقارن بـ tail بدلًا منه.' : null, true);
    first = false;
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(10, 'current = current.next;',
      `ينتقل current إلى Node(${c.data(cur)}).`,
      'المرجع وحده هو الذي يتحرك.');
  }
  c.clearFx(); c.snap.hi = [cur];
  c.snap.annos = [{ id: tailId, text: 'current.next' }];
  c.push(9, 'while (current.next != tail)',
    `current.next هو tail فعلًا — يقف current على العقدة قبل الأخيرة Node(${c.data(cur)}). نخرج من الحلقة.`,
    'ستصبح هذه العقدة هي العقدة الأخيرة الجديدة.');

  c.clearFx();
  const headId = c.snap.refs.head;
  c.snap.next[cur] = headId; c.snap.hi = [cur]; c.snap.fade = [tailId];
  c.push(12, 'current.next = head;',
    `تدور Node(${c.data(cur)}) الآن مباشرة عائدةً إلى Node(${c.data(headId)})، متخطيةً العقدة الأخيرة القديمة.`,
    `جرى تجاوز Node(${c.data(tailId)}) — تنغلق الدائرة قبلها بعقدة واحدة.`,
    'ماذا يحدث للعقدة الأخيرة القديمة الآن؟',
    'لم يعد أي شيء يشير إليها، فيستعيدها جامع المهملات.', true);

  c.clearFx();
  c.snap.refs.tail = cur;
  c.push(13, 'tail = current;',
    `يُحدَّث tail ليشير إلى Node(${c.data(cur)}) — العقدة الأخيرة الجديدة.`,
    'يجب أن يحدد tail دائمًا العقدة التي يشير next فيها إلى head.');

  c.clearFx();
  c.removeNode(tailId);
  delete c.snap.refs.current;
  c.snap.size--; c.snap.sizeFlash = true;
  c.push(15, 'size--;',
    `الحجم: ${c.snap.size + 1} → ${c.snap.size}.`, '');

  return { name: 'deleteLast', java: JAVA.deleteLast, steps: c.steps, resultList: c.values() };
}

function buildDeleteAt(index) {
  const c = new Ctx(baseList);
  c.snap.showIndex = true; c.snap.vars = { index };
  c.push(0, `deleteAt(${index})`,
    `احذف العقدة عند الفهرس ${index}.`,
    'الحذف من الوسط يعمل تمامًا مثل القائمة الأحادية — لا يتدخل رابط الالتفاف إلا عند الطرفين.');
  c.push(1, 'if (index < 0 || index >= size)',
    `index = ${index} يقع ضمن 0 … ${c.snap.size - 1} — لا يُرمى أي استثناء.`, '');

  if (index === 0) {
    const old = c.snap.refs.head;
    const second = c.snap.next[old];
    const tailId = c.snap.refs.tail;
    c.push(4, 'if (index == 0)',
      'index يساوي 0 — حذف العقدة الأولى هو بالضبط ما تفعله deleteFirst.', '');
    c.snap.hi = [old];
    c.push(5, 'deleteFirst();', 'داخل deleteFirst: head = head.next; tail.next = head.', '');
    if (c.snap.order.length === 1) {
      c.snap.refs.head = null; c.snap.refs.tail = null; c.snap.fade = [old]; c.snap.hi = [];
      c.push(5, 'deleteFirst();', 'حُذفت العقدة الوحيدة — أصبحت القائمة فارغة.', '');
    } else {
      c.snap.refs.head = second; c.snap.next[tailId] = second;
      c.snap.fade = [old]; c.snap.hi = [];
      c.push(5, 'deleteFirst();',
        `يشير head الآن إلى Node(${c.data(second)}) ويدور tail.next إليها — أُعيد إغلاق الدائرة.`, '');
    }
    c.removeNode(old); c.snap.size--; c.snap.sizeFlash = true;
    c.push(5, 'deleteFirst();', 'داخل deleteFirst: size--.', '');
    c.clearFx();
    c.push(6, 'return;', 'انتهت deleteAt.', '');
    return { name: 'deleteAt', java: JAVA.deleteAt, steps: c.steps, resultList: c.values() };
  }
  c.push(4, 'if (index == 0)', 'index لا يساوي 0 — نتجاوز هذه الحالة.', '');

  if (index === c.snap.size - 1) {
    const old = c.snap.refs.tail;
    const secondLast = c.snap.order[c.snap.order.length - 2];
    const headId = c.snap.refs.head;
    c.push(8, 'if (index == size - 1)',
      `index يساوي size − 1 (${index}) — حذف العقدة الأخيرة هو بالضبط ما تفعله deleteLast.`, '');
    c.snap.hi = [old];
    c.push(9, 'deleteLast();',
      'داخل deleteLast: نسير حتى يصبح current.next هو tail، ثم نعيد إغلاق الدائرة.', '');
    c.snap.next[secondLast] = headId; c.snap.refs.tail = secondLast;
    c.snap.fade = [old]; c.snap.hi = [];
    c.push(9, 'deleteLast();',
      `تدور Node(${c.data(secondLast)}) الآن عائدةً إلى head وتصبح هي الذيل الجديد.`, '');
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
    `يجب أن يتوقف current عند الفهرس ${index - 1} — أي العقدة التي تسبق العقدة المراد حذفها.`);

  for (let i = 0; i < index - 1; i++) {
    c.clearFx(); c.snap.vars.i = i; c.snap.hi = [cur];
    c.push(13, 'for (int i = 0; i < index - 1; i++)',
      `i = ${i}، وهو أصغر من ${index - 1} — نواصل التقدم.`, '');
    const nxt = c.snap.next[cur];
    c.clearFx(); c.snap.refs.current = nxt; c.snap.hi = [nxt]; cur = nxt;
    c.push(14, 'current = current.next;',
      `ينتقل current إلى Node(${c.data(cur)}) عند الفهرس ${i + 1}.`,
      'المرجع وحده هو الذي يتحرك.');
  }
  c.clearFx(); c.snap.vars.i = index - 1; c.snap.hi = [cur];
  c.push(13, 'for (int i = 0; i < index - 1; i++)',
    `i = ${index - 1} — تتوقف الحلقة. current عند الفهرس ${index - 1}، قبل الضحية مباشرة.`, '');

  const victim = c.snap.next[cur];
  const after = c.snap.next[victim];
  c.clearFx(); c.snap.hi = [cur];
  c.snap.annos = [{ id: victim, text: 'current.next' }, { id: after, text: 'current.next.next' }];
  c.push(16, 'current.next = current.next.next;',
    `حدّد المراجع أولًا: current.next هو Node(${c.data(victim)}) — الضحية — و current.next.next هو Node(${c.data(after)}).`,
    'نقرأ المرجعين كليهما قبل تغيير أي شيء.',
    'إلى أي عقدة سيشير current.next بعد هذه الجملة؟',
    `Node(${c.data(after)}) — يجري تخطي الضحية.`, true);

  c.clearFx();
  c.snap.next[cur] = after;
  c.snap.hi = [cur]; c.snap.fade = [victim];
  c.push(16, 'current.next = current.next.next;',
    `تشير Node(${c.data(cur)}) الآن مباشرة إلى Node(${c.data(after)}). جرى تخطي Node(${c.data(victim)}) وخرجت من الدائرة.`,
    'تغيير مرجع واحد يحذف العقدة — دون مساس بـ head أو tail أو رابط الالتفاف.');

  c.clearFx();
  c.removeNode(victim);
  c.snap.size--; c.snap.sizeFlash = true; delete c.snap.vars.i;
  c.push(17, 'size--;',
    `الحجم: ${c.snap.size + 1} → ${c.snap.size}. يستعيد جامع المهملات العقدة المتخطاة.`, '');

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
