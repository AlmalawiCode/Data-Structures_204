/* ============================================================
   Merging Linked Lists Simulator — engine + operations
   Vanilla JS. The stage has three rows:
       row 0 — List 1        row 1 — List 2        row 2 — merged result
   A node keeps the colour of the list it came from, and physically
   MOVES down into the result row when a statement links it there, so
   students can see that merging never copies data: it only re-points
   `next` references.
   Debugger stepping: the highlighted statement has NOT executed yet;
   each click animates the previous statement's effect.
   ============================================================ */

'use strict';

/* ---------------- constants & global state ---------------- */

const NODE_W = 100, NODE_H = 58, GAP = 30;
const PAD_X = 92;                         // leaves room for the row caption chips
const ROW_Y = [96, 248, 400];             // y of row 0 / row 1 / row 2
const PITCH = NODE_W + GAP;

let list1 = [];                    // [{id, data}, …] committed input lists
let list2 = [];
let speed = 1;
let teachMode = false;
let currentOpName = 'mergeSorted';

let op = null;
let stepIdx = -1;
let playing = false;
let playTimer = null;

let idCounter = 0;
let renderedSnap = null;
let linkFx = {};                   // 'id' -> expiry timestamp (fresh link accent)
let ghostLinks = [];               // { from, to, until }
let teachOpen = false;

const DUR = () => 900 / speed;
const PLAY_DELAY = () => 2600 / speed;

const $ = id => document.getElementById(id);
const stage = $('stage');
const linkLayer = $('linkLayer');

const clone = s => JSON.parse(JSON.stringify(s));

/* ---------------- snapshot model ----------------
   snap = { nodes:{id:{data, origin}}, next:{id:id|null},
            slots:{id:{row,col}}, refs:{name:id|null},
            hi, fade, annos, vars, rows:[caption|null, …],
            counts:{a,b,r}, countFlash }
   A variable appears in `refs` only once its declaration has run —
   the variables panel is a debugger view, not a fixed list.
   ------------------------------------------------ */

const REF_NAMES = ['head1', 'head2', 'dummy', 'tail', 'p', 'q', 'current', 'pNext', 'qNext', 'result'];

class Ctx {
  constructor(v1, v2, rows) {
    this.snap = {
      nodes: {}, next: {}, slots: {}, refs: {},
      hi: [], fade: [], annos: [], vars: {},
      rows: rows, counts: { a: v1.length, b: v2.length, r: 0 }, countFlash: false
    };
    this.A = this.seed(v1, 0, 'la');
    this.B = this.seed(v2, 1, 'lb');
    this.snap.refs.head1 = this.A[0] ?? null;
    this.snap.refs.head2 = this.B[0] ?? null;
    this.steps = [];
    this.col = 0;                  // next free column in the result row
  }
  seed(items, row, origin) {
    const ids = [];
    items.forEach((it, i) => {
      this.snap.nodes[it.id] = { data: it.data, origin };
      this.snap.slots[it.id] = { row, col: i };
      this.snap.next[it.id] = null;
      if (i > 0) this.snap.next[ids[i - 1]] = it.id;
      ids.push(it.id);
    });
    return ids;
  }
  data(id) { return id === null ? null : this.snap.nodes[id].data; }
  label(id) { return id === null ? 'null' : `Node(${this.data(id)})`; }
  addDummy() {
    const id = 'd' + (++idCounter);
    this.snap.nodes[id] = { data: 0, origin: 'ld' };
    this.snap.slots[id] = { row: 2, col: 0 };
    this.snap.next[id] = null;
    this.col = 1;
    return id;
  }
  /* move a node into the next free slot of the result row */
  toResult(id) {
    this.snap.slots[id] = { row: 2, col: this.col++ };
    this.snap.counts.r++;
    this.snap.countFlash = true;
  }
  /* move a node inside its own row (used by concatenate) */
  place(id, row, col) { this.snap.slots[id] = { row, col }; }
  clearFx() { this.snap.hi = []; this.snap.annos = []; this.snap.countFlash = false; }
  push(line, stmt, means, why, q, a, qPre) {
    this.steps.push({ line, stmt, means, why, q: q || null, a: a || null, qPre: !!qPre, snap: clone(this.snap) });
  }
}

/* ---------------- layout ---------------- */

function layout(snap) {
  const pos = {};
  let maxCol = 0;
  for (const id in snap.slots) {
    const s = snap.slots[id];
    pos[id] = { x: PAD_X + s.col * PITCH, y: ROW_Y[s.row] };
    if (s.col > maxCol) maxCol = s.col;
  }
  return { pos, endX: PAD_X + (maxCol + 1) * PITCH };
}

/* ---------------- DOM rendering of a snapshot ---------------- */

function renderState(snap) {
  const before = renderedSnap;
  const { pos, endX } = layout(snap);

  // detect link changes for the fresh / ghost arrow effects
  if (before) {
    const now = performance.now();
    for (const id in snap.next) {
      const oldT = id in before.next ? before.next[id] : undefined;
      const newT = snap.next[id];
      if (oldT !== undefined && oldT !== newT) {
        if (oldT !== null) ghostLinks.push({ from: id, to: oldT, until: now + DUR() });
        if (newT !== null) linkFx[id] = now + DUR() * 1.4;
      } else if (oldT === undefined && newT !== null) {
        linkFx[id] = now + DUR() * 1.4;
      }
    }
  }

  // ----- row bands & captions -----
  snap.rows.forEach((cap, r) => {
    let band = stage.querySelector(`.row-band.b${r}`);
    let chip = stage.querySelector(`.row-chip.c${r}`);
    if (cap === null) { if (band) band.remove(); if (chip) chip.remove(); return; }
    if (!band) {
      band = document.createElement('div');
      band.className = `row-band b${r}`;
      band.style.top = (ROW_Y[r] - 19) + 'px';
      stage.insertBefore(band, stage.firstChild);
    }
    if (!chip) {
      chip = document.createElement('div');
      chip.className = `row-chip c${r}`;
      chip.style.top = (ROW_Y[r] + NODE_H / 2 - 13) + 'px';
      stage.appendChild(chip);
    }
    chip.textContent = cap;
  });

  // ----- nodes -----
  const live = new Set(Object.keys(snap.slots));
  stage.querySelectorAll('.node').forEach(el => {
    if (!live.has(el.dataset.id) && !el.dataset.dying) {
      el.dataset.dying = '1';
      el.classList.add('bye');
      setTimeout(() => { if (el.dataset.dying) el.remove(); }, 450);
    }
  });
  live.forEach(id => {
    let el = stage.querySelector(`.node[data-id="${id}"]`);
    const isFresh = !el;
    if (el && el.dataset.dying) {        // stepped backwards onto it again
      delete el.dataset.dying;
      el.classList.remove('bye');
    }
    if (isFresh) {
      el = document.createElement('div');
      el.className = 'node ' + snap.nodes[id].origin;
      el.dataset.id = id;
      el.innerHTML = `<div class="cell data"></div><div class="cell nextf"></div>`;
      const p = pos[id];
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
      el.style.opacity = '0';
      stage.appendChild(el);
      requestAnimationFrame(() => { el.style.opacity = ''; });
    }
    el.querySelector('.data').textContent = snap.nodes[id].data;
    const nf = el.querySelector('.nextf');
    const nNull = snap.next[id] === null;
    nf.textContent = nNull ? 'null' : '●';
    nf.classList.toggle('isnull', nNull);
    el.classList.toggle('hi', snap.hi.includes(id));
    el.classList.toggle('fade', snap.fade.includes(id));
    if (!isFresh) {
      const p = pos[id];
      el.style.left = p.x + 'px';
      el.style.top = p.y + 'px';
    }
  });

  // ----- reference labels -----
  REF_NAMES.forEach(name => {
    let lb = stage.querySelector(`.ref-label.r-${name}`);
    const has = name in snap.refs;
    const target = has ? snap.refs[name] : undefined;
    if (!has || target === null || !pos[target]) {
      if (lb && !lb.dataset.dying) {
        lb.dataset.dying = '1';
        lb.style.opacity = '0';
        setTimeout(() => { if (lb.dataset.dying) lb.remove(); }, 400);
      }
      return;
    }
    if (!lb) {
      lb = document.createElement('div');
      lb.className = `ref-label r-${name}`;
      stage.appendChild(lb);
    }
    delete lb.dataset.dying;             // it is in scope again
    lb.textContent = name;
    lb.dataset.target = target;
    const stack = REF_NAMES.filter(n => n in snap.refs && snap.refs[n] === target);
    const level = stack.indexOf(name);
    const p = pos[target];
    lb.style.left = (p.x + NODE_W / 2 - 32) + 'px';
    lb.style.top = (p.y - 56 - level * 34) + 'px';
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
    el.style.left = (p.x + 4) + 'px';
    el.style.top = (p.y + NODE_H + 14) + 'px';
    stage.appendChild(el);
  });

  // ----- stage width, counters, variables -----
  stage.style.minWidth = (endX + 20) + 'px';
  $('cnt1').textContent = snap.counts.a;
  $('cnt2').textContent = snap.counts.b;
  $('cntR').textContent = snap.counts.r;
  const badge = $('countBadge');
  badge.classList.remove('flash');
  if (snap.countFlash) { void badge.offsetWidth; badge.classList.add('flash'); }

  renderVars(snap);
  renderedSnap = snap;
  pinRowChips();
  keepVisible(snap);
}

/* the result row grows wider than the pane — scroll so the highlighted
   node (or the end of the result) stays in view without moving the page */
function pinRowChips() {
  const wrap = stage.parentElement;
  if (!wrap) return;
  stage.querySelectorAll('.row-chip').forEach(ch => { ch.style.left = (8 + wrap.scrollLeft) + 'px'; });
}
if (stage.parentElement) stage.parentElement.addEventListener('scroll', pinRowChips);

function keepVisible(snap) {
  const focus = snap.hi.length ? snap.hi[snap.hi.length - 1] : null;
  if (focus === null) return;
  const el = nodeEl(focus);
  const wrap = stage.parentElement;
  if (!el || !wrap) return;
  const left = el.offsetLeft, right = left + el.offsetWidth;
  const view = wrap.clientWidth;
  if (left < wrap.scrollLeft + 24)
    wrap.scrollTo({ left: Math.max(0, left - 48), behavior: 'smooth' });
  else if (right > wrap.scrollLeft + view - 24)
    wrap.scrollTo({ left: right - view + 48, behavior: 'smooth' });
}

/* ---------------- variable panel (debugger view) ---------------- */

function renderVars(snap) {
  const rows = [];
  for (const name of REF_NAMES) {
    if (!(name in snap.refs)) continue;   // not declared yet → not in scope → not shown
    const id = snap.refs[name];
    const v = id === null ? 'null'
      : `Node(${snap.nodes[id] ? snap.nodes[id].data : '?'})`;
    rows.push({ name, cls: 'v-' + name, val: '→ ' + v });
  }
  for (const k in snap.vars) rows.push({ name: k, cls: '', val: '= ' + snap.vars[k] });

  const tbl = $('varTable');
  const prevVals = tbl.dataset.prev ? JSON.parse(tbl.dataset.prev) : {};
  tbl.innerHTML = rows.map(r =>
    `<tr class="${r.cls}${prevVals[r.name] !== undefined && prevVals[r.name] !== r.val ? ' changed' : ''}">
       <td class="vname">${r.name}</td>
       <td class="vval">${r.val}</td></tr>`).join('');
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

function fPath(fromEl, toEl) {
  const a = stageRect(fromEl), b = stageRect(toEl);
  const sx = a.x + a.w - 4, sy = a.y + a.h / 2;
  const tx = b.x - 3, ty = b.y + b.h / 2;

  if (Math.abs(sy - ty) < 8) {                      // same row
    if (tx > sx && tx - sx < GAP + 40) return `M ${sx} ${sy} L ${tx} ${ty}`;
    if (tx > sx)                                     // skipping node(s): arc above
      return `M ${sx} ${sy - 4} C ${sx + 60} ${sy - 46}, ${tx - 60} ${ty - 46}, ${tx + 1} ${ty - 4}`;
    return `M ${sx} ${sy + 4} C ${sx + 60} ${sy + 50}, ${tx - 60} ${ty + 50}, ${tx - 1} ${ty + 4}`;
  }
  // different rows: leave through the next field, enter through the target's near edge
  const up = ty < sy;
  const ex = b.x + b.w * 0.35, ey = up ? b.y + b.h + 3 : b.y - 3;
  const c = up ? 62 : -62;
  return `M ${sx} ${sy} C ${sx + 58} ${sy}, ${ex} ${ey + c}, ${ex} ${ey}`;
}

function refPath(labelEl, targetEl) {
  const a = stageRect(labelEl), b = stageRect(targetEl);
  const sx = a.x + a.w / 2, sy = a.y + a.h;
  const tx = b.x + b.w / 2, ty = b.y - 4;
  if (Math.abs(sx - tx) < 8) return `M ${sx} ${sy} L ${tx} ${ty}`;
  return `M ${sx} ${sy} C ${sx} ${sy + 24}, ${tx} ${ty - 24}, ${tx} ${ty}`;
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

/* a link that leaves the result row and still points back up into an
   original list is the node's OLD next — true, but not yet overwritten */
function isStale(snap, from, to) {
  const f = snap.slots[from], t = snap.slots[to];
  return !!f && !!t && f.row === 2 && t.row !== 2;
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
        addPath(fPath(fe, te), '#94a3b8', 3, 'ah-link', { opacity: alpha, dash: '7 6' });
      }
    }

    // live links — a null reference gets NO arrow (the field shows "null")
    for (const from in snap.next) {
      const to = snap.next[from];
      if (to === null) continue;
      const fe = nodeEl(from), te = nodeEl(to);
      if (!fe || !te) continue;
      const fresh = linkFx[from] && linkFx[from] > now;
      if (linkFx[from] && linkFx[from] <= now) delete linkFx[from];
      if (fresh) addPath(fPath(fe, te), '#7c3aed', 4.5, 'ah-fresh');
      else if (isStale(snap, from, to)) addPath(fPath(fe, te), '#cbd5e1', 2.5, 'ah-stale', { dash: '7 6' });
      else addPath(fPath(fe, te), '#64748b', 3.5, 'ah-link');
    }

    // reference arrows
    stage.querySelectorAll('.ref-label').forEach(lb => {
      const t = lb.dataset.target;
      if (!t) return;
      const te = nodeEl(t);
      if (!te || lb.style.opacity === '0') return;
      const name = [...lb.classList].find(c => c.startsWith('r-')).slice(2);
      const color = {
        head1: '#2563eb', head2: '#ea580c', dummy: '#64748b', tail: '#16a34a',
        p: '#7c3aed', q: '#0d9488', current: '#d97706',
        pNext: '#a78bfa', qNext: '#5eead4', result: '#be123c'
      }[name] || '#64748b';
      addPath(refPath(lb, te), color, 3.5, 'ah-' + name);
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
  s = s.replace(/\b(public|static|void|int|new|if|else|while|for|return|null)\b/g,
    '<span class="kw">$1</span>');
  s = s.replace(/\b(Node)\b/g, '<span class="type">$1</span>');
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
  if (!act) return;
  const top = act.offsetTop, bottom = top + act.offsetHeight;
  if (top < view.scrollTop) view.scrollTo({ top: Math.max(0, top - 8), behavior: 'smooth' });
  else if (bottom > view.scrollTop + view.clientHeight)
    view.scrollTo({ top: bottom - view.clientHeight + 8, behavior: 'smooth' });
}

/* ================= Java source per operation ================= */

const JAVA = {
  mergeSorted: [
    'public static Node mergeSorted(Node head1, Node head2) {',
    '    Node dummy = new Node(0);',
    '    Node tail = dummy;',
    '    Node p = head1;',
    '    Node q = head2;',
    '    while (p != null && q != null) {',
    '        if (p.data <= q.data) {',
    '            tail.next = p;',
    '            p = p.next;',
    '        } else {',
    '            tail.next = q;',
    '            q = q.next;',
    '        }',
    '        tail = tail.next;',
    '    }',
    '    if (p != null) {',
    '        tail.next = p;',
    '    } else {',
    '        tail.next = q;',
    '    }',
    '    return dummy.next;',
    '}'
  ],
  concat: [
    'public static Node concat(Node head1, Node head2) {',
    '    if (head1 == null) {',
    '        return head2;',
    '    }',
    '    Node current = head1;',
    '    while (current.next != null) {',
    '        current = current.next;',
    '    }',
    '    current.next = head2;',
    '    return head1;',
    '}'
  ],
  mergeAlternate: [
    'public static Node mergeAlternate(Node head1, Node head2) {',
    '    Node p = head1;',
    '    Node q = head2;',
    '    while (p != null && q != null) {',
    '        Node pNext = p.next;',
    '        Node qNext = q.next;',
    '        p.next = q;',
    '        if (pNext != null) {',
    '            q.next = pNext;',
    '        }',
    '        p = pNext;',
    '        q = qNext;',
    '    }',
    '    return head1;',
    '}'
  ]
};

/* ================= operation step builders ================= */

/* ---------- 1. merge two SORTED lists ---------- */

function buildMergeSorted(v1, v2) {
  const c = new Ctx(v1, v2, ['List 1', 'List 2', 'Result']);
  const s1 = v1.map(x => x.data).join(' → ') || 'empty';
  const s2 = v2.map(x => x.data).join(' → ') || 'empty';

  c.push(0, 'mergeSorted(head1, head2)',
    `We merge the two <b>already sorted</b> lists <b>${s1}</b> and <b>${s2}</b> into one sorted list.`,
    'No new nodes are created and no data is copied — we only re-point next references, so the merge costs O(n + m) time and O(1) extra memory.');

  const d = c.addDummy();
  c.snap.refs.dummy = d;
  c.snap.hi = [d];
  c.push(1, 'Node dummy = new Node(0);',
    'Create one temporary <b>dummy (sentinel) node</b>. Its data is never used — only its <code>next</code> field matters.',
    'The dummy removes a whole special case: without it we would need an extra "is the result still empty?" test before every append.',
    'Why start with a dummy node instead of an empty result list?',
    'Because then "append to the result" is always the same statement — tail.next = … — even for the very first node. No if-statement for the empty case.', true);

  c.clearFx();
  c.snap.refs.tail = d;
  c.snap.hi = [d];
  c.push(2, 'Node tail = dummy;',
    'tail always references the <b>last node of the result so far</b>. Right now the result is just the dummy.',
    'Keeping a tail reference makes each append O(1) — we never walk the result list.');

  c.clearFx();
  c.snap.refs.p = c.A[0] ?? null;
  c.push(3, 'Node p = head1;',
    `p is the reading cursor for List 1 — it starts at ${c.label(c.A[0] ?? null)}.`,
    'p and q walk their own lists exactly once each.');

  c.clearFx();
  c.snap.refs.q = c.B[0] ?? null;
  c.push(4, 'Node q = head2;',
    `q is the reading cursor for List 2 — it starts at ${c.label(c.B[0] ?? null)}.`,
    '');

  let firstCompare = true;
  for (;;) {
    const p = c.snap.refs.p, q = c.snap.refs.q;
    const cont = p !== null && q !== null;
    c.clearFx();
    if (p !== null) c.snap.hi.push(p);
    if (q !== null) c.snap.hi.push(q);
    c.push(5, 'while (p != null && q != null)',
      cont
        ? `Both cursors still have a node (p → ${c.data(p)}, q → ${c.data(q)}), so we compare them.`
        : `${p === null ? 'p' : 'q'} is null — one list is exhausted, so the loop stops.`,
      cont ? 'The loop only runs while BOTH lists still have something to compare.'
           : 'Whatever is left in the other list is already sorted and already linked together — it can be attached in one statement.');
    if (!cont) break;

    const pd = c.data(p), qd = c.data(q);
    const take = pd <= qd;
    c.clearFx();
    c.snap.hi = [p, q];
    c.push(6, 'if (p.data <= q.data)',
      `Compare <b>${pd} &le; ${qd}</b> → <b>${take}</b>, so the smaller node is ${take ? `${c.label(p)} from List 1` : `${c.label(q)} from List 2`}.`,
      'Only the two front nodes ever need comparing: everything behind them in each list is already larger.',
      firstCompare ? 'Which of the two front nodes gets appended to the result first?' : null,
      firstCompare ? `${take ? c.label(p) : c.label(q)} — the smaller of ${pd} and ${qd}.` : null, true);
    firstCompare = false;

    const chosen = take ? p : q;
    const oldTail = c.snap.refs.tail;
    c.clearFx();
    c.snap.next[oldTail] = chosen;
    c.toResult(chosen);
    c.snap.hi = [chosen];
    c.push(take ? 7 : 10, take ? 'tail.next = p;' : 'tail.next = q;',
      `${c.label(oldTail)} now links to ${c.label(chosen)} — the node has joined the result.`,
      'The node did not move in memory and its data did not change. Only one reference was re-pointed.');

    c.clearFx();
    const advanced = c.snap.next[chosen];
    c.snap.refs[take ? 'p' : 'q'] = advanced;
    c.snap.hi = advanced === null ? [] : [advanced];
    c.push(take ? 8 : 11, take ? 'p = p.next;' : 'q = q.next;',
      advanced === null
        ? `${take ? 'p' : 'q'} becomes null — List ${take ? 1 : 2} has no more nodes.`
        : `${take ? 'p' : 'q'} moves on to ${c.label(advanced)}.`,
      `Note the order: we read ${take ? 'p' : 'q'}.next <b>before</b> the next iteration overwrites it. That old link is drawn faded — it still exists, it is just about to be replaced.`);

    c.clearFx();
    c.snap.refs.tail = chosen;
    c.snap.hi = [chosen];
    c.push(13, 'tail = tail.next;',
      `tail follows along to ${c.label(chosen)}, the new last node of the result.`,
      'tail must always be the last node, otherwise the next append would splice into the middle.');
  }

  c.clearFx();
  const pLeft = c.snap.refs.p !== null;
  c.push(15, 'if (p != null)',
    pLeft ? 'p is NOT null — List 1 still has nodes left over.'
          : 'p is null — List 1 is finished, so whatever is left of List 2 (possibly nothing) is attached instead.',
    'The leftover part is already a correctly linked, sorted chain — attaching its first node attaches all of it.');

  c.clearFx();
  const oldTail = c.snap.refs.tail;
  const rest = pLeft ? c.snap.refs.p : c.snap.refs.q;
  c.snap.next[oldTail] = rest;
  let walk = rest, moved = 0;
  while (walk !== null) { c.toResult(walk); c.snap.hi.push(walk); walk = c.snap.next[walk]; moved++; }
  c.push(pLeft ? 16 : 18, pLeft ? 'tail.next = p;' : 'tail.next = q;',
    rest === null
      ? 'Both lists are empty, so tail.next = null closes the result list.'
      : `One statement attaches the remaining <b>${moved}</b> node${moved === 1 ? '' : 's'} of List ${pLeft ? 1 : 2}.`,
    rest === null ? 'A linked list must always end in null.'
                  : 'This is why merging is O(n + m) and not O(n × m): the leftover tail is copied by reference, not node by node.',
    'Why can the rest of the list be attached with a single statement?',
    'Because those nodes are already linked to each other in sorted order — attaching the first one attaches the whole chain.');

  c.clearFx();
  const res = c.snap.next[d];
  delete c.snap.refs.dummy;
  delete c.snap.refs.tail;
  delete c.snap.refs.p;
  delete c.snap.refs.q;
  c.snap.refs.result = res;
  c.snap.fade = [d];
  c.push(20, 'return dummy.next;',
    `The real head of the merged list is <b>dummy.next</b> = ${c.label(res)}. The dummy node itself is thrown away (garbage collected).`,
    'The local variables dummy, tail, p and q disappear when the method returns — only the returned reference survives.');

  return { name: 'mergeSorted', java: JAVA.mergeSorted, steps: c.steps };
}

/* ---------- 2. concatenate (append list 2 after list 1) ---------- */

function buildConcat(v1, v2) {
  const c = new Ctx(v1, v2, ['List 1', 'List 2', null]);

  c.push(0, 'concat(head1, head2)',
    'Concatenation simply hangs the whole of List 2 onto the end of List 1. The order inside each list is untouched.',
    'This is the cheapest kind of merge — but it only makes sense when the result does not have to stay sorted.');

  if (c.A.length === 0) {
    c.clearFx();
    c.push(1, 'if (head1 == null)',
      'List 1 is empty, so there is nothing to append to.', '');
    c.snap.refs.result = c.snap.refs.head2;
    c.push(2, 'return head2;',
      'The result is simply List 2.',
      'Always handle the empty-list case first — otherwise the traversal below would dereference null.');
    return { name: 'concat', java: JAVA.concat, steps: c.steps };
  }

  c.clearFx();
  c.snap.hi = [c.A[0]];
  c.push(1, 'if (head1 == null)',
    'List 1 is not empty, so we skip this guard.',
    'Without the guard, current = head1 followed by current.next would throw a NullPointerException.');

  c.clearFx();
  c.snap.refs.current = c.A[0];
  c.snap.hi = [c.A[0]];
  c.push(4, 'Node current = head1;',
    `current starts at the first node of List 1, ${c.label(c.A[0])}.`,
    'We need the LAST node of List 1, and a singly linked list can only be walked forwards.');

  for (;;) {
    const cur = c.snap.refs.current;
    const nxt = c.snap.next[cur];
    c.clearFx();
    c.snap.hi = [cur];
    c.snap.annos = nxt === null ? [] : [{ id: nxt, text: 'current.next' }];
    c.push(5, 'while (current.next != null)',
      nxt === null
        ? `current.next is null → ${c.label(cur)} is the LAST node. The loop stops here.`
        : `current.next is ${c.label(nxt)}, not null → keep walking.`,
      nxt === null ? 'The only node whose next is null is the last one — that is how we recognise the end.'
                   : 'Notice we test current.next, not current: we must stop ON the last node, not past it.',
      nxt === null ? null : 'Why do we test current.next != null instead of current != null?',
      nxt === null ? null : 'Because we need to STOP on the last node so we can change its next field. If we tested current, the loop would run one step too far and current would become null.', true);
    if (nxt === null) break;

    c.clearFx();
    c.snap.refs.current = nxt;
    c.snap.hi = [nxt];
    c.push(6, 'current = current.next;',
      `current advances to ${c.label(nxt)}.`, '');
  }

  const last = c.snap.refs.current;
  c.clearFx();
  c.snap.next[last] = c.B[0] ?? null;
  c.snap.hi = c.B.length ? [last, c.B[0]] : [last];
  c.push(8, 'current.next = head2;',
    c.B.length
      ? `${c.label(last)} — the last node of List 1 — now points to ${c.label(c.B[0])}, the first node of List 2. The two lists are one list now.`
      : 'List 2 is empty, so current.next becomes null and List 1 is unchanged.',
    'One single reference change joins the lists. Walking to the end cost O(n); the join itself is O(1).',
    'How many nodes had to be copied to join the two lists?',
    'None. Exactly one reference — the last node’s next field — was changed.', true);

  // straighten the merged chain into a single row
  c.clearFx();
  c.B.forEach((id, i) => c.place(id, 0, c.A.length + i));
  c.snap.counts.r = c.A.length + c.B.length;
  c.snap.countFlash = true;
  c.snap.refs.result = c.snap.refs.head1;
  delete c.snap.refs.current;
  c.push(9, 'return head1;',
    'The head of List 1 is still the head of the whole result, so we return it.',
    'head2 still references the same node — but that node is no longer the head of a separate list; it is in the middle of the result.');

  return { name: 'concat', java: JAVA.concat, steps: c.steps };
}

/* ---------- 3. merge alternately (zip) ---------- */

function buildMergeAlternate(v1, v2) {
  const c = new Ctx(v1, v2, ['List 1', 'List 2', 'Result']);

  c.push(0, 'mergeAlternate(head1, head2)',
    'Take one node from List 1, then one from List 2, then one from List 1 … until one list runs out.',
    'This is the classic "zip" exercise: it does not compare data at all, so it is pure reference surgery.');

  c.clearFx();
  c.snap.refs.p = c.A[0] ?? null;
  c.snap.hi = c.A.length ? [c.A[0]] : [];
  c.push(1, 'Node p = head1;', `p starts at ${c.label(c.A[0] ?? null)}.`, '');

  c.clearFx();
  c.snap.refs.q = c.B[0] ?? null;
  c.snap.hi = c.B.length ? [c.B[0]] : [];
  c.push(2, 'Node q = head2;', `q starts at ${c.label(c.B[0] ?? null)}.`, '');

  let firstRound = true;
  for (;;) {
    const p = c.snap.refs.p, q = c.snap.refs.q;
    const cont = p !== null && q !== null;
    c.clearFx();
    delete c.snap.refs.pNext;          // declared inside the loop body → out of scope here
    delete c.snap.refs.qNext;
    if (p !== null) c.snap.hi.push(p);
    if (q !== null) c.snap.hi.push(q);
    c.push(3, 'while (p != null && q != null)',
      cont ? `Both lists still have a node (p → ${c.data(p)}, q → ${c.data(q)}), so we zip one more pair.`
           : `${p === null ? 'p' : 'q'} is null — one list ran out, so the zipping stops.`,
      cont ? '' : 'Whatever remains of the longer list is already attached, because we never overwrote that last next field.');
    if (!cont) break;

    c.clearFx();
    const pn = c.snap.next[p];
    c.snap.refs.pNext = pn;
    if (pn !== null) c.snap.hi = [pn];
    c.push(4, 'Node pNext = p.next;',
      `Save p.next (${c.label(pn)}) before it gets overwritten.`,
      'This is the heart of the exercise: the statement p.next = q destroys the link we still need. Save it first, or the rest of List 1 is lost forever.',
      firstRound ? 'What would happen if we did NOT save p.next first?' : null,
      firstRound ? 'p.next = q would overwrite the only reference to the rest of List 1 — those nodes would become unreachable garbage.' : null, true);

    c.clearFx();
    const qn = c.snap.next[q];
    c.snap.refs.qNext = qn;
    if (qn !== null) c.snap.hi = [qn];
    c.push(5, 'Node qNext = q.next;',
      `Save q.next (${c.label(qn)}) for the same reason.`, '');

    c.clearFx();
    c.snap.next[p] = q;
    c.toResult(p);
    c.toResult(q);
    c.snap.hi = [p, q];
    c.push(6, 'p.next = q;',
      `${c.label(p)} now points to ${c.label(q)} — one node from each list, side by side in the result.`,
      'Both nodes are drawn in the result row now, but they never moved in memory: only the arrow changed.');

    c.clearFx();
    c.snap.hi = pn === null ? [q] : [q, pn];
    c.push(7, 'if (pNext != null)',
      pn === null
        ? 'pNext is null — List 1 is finished, so we must NOT touch q.next. Leaving it alone keeps the rest of List 2 attached.'
        : `pNext is ${c.label(pn)}, so we hook the chain back into List 1.`,
      pn === null ? 'A very common bug: overwriting q.next here would cut off everything still waiting in List 2.' : '');

    if (pn !== null) {
      c.clearFx();
      c.snap.next[q] = pn;
      c.snap.hi = [q, pn];
      c.push(8, 'q.next = pNext;',
        `${c.label(q)} now points back to ${c.label(pn)} — the saved rest of List 1.`,
        'The zip closes: …p → q → pNext… and the loop can repeat from pNext.');
    }

    c.clearFx();
    c.snap.refs.p = c.snap.refs.pNext;
    c.push(10, 'p = pNext;', `p moves to ${c.label(c.snap.refs.pNext)}.`, '');

    c.clearFx();
    c.snap.refs.q = c.snap.refs.qNext;
    c.push(11, 'q = qNext;', `q moves to ${c.label(c.snap.refs.qNext)}.`, '');

    firstRound = false;
  }

  // final picture: walk the result and pull every reachable node into the result row
  c.clearFx();
  const resHead = c.snap.refs.head1;   // the method returns head1, whatever it holds
  let walk = resHead, leftovers = 0;
  while (walk !== null) {
    if (c.snap.slots[walk].row !== 2) { c.toResult(walk); c.snap.hi.push(walk); leftovers++; }
    walk = c.snap.next[walk];
  }
  delete c.snap.refs.p;
  delete c.snap.refs.q;
  delete c.snap.refs.pNext;
  delete c.snap.refs.qNext;
  c.snap.refs.result = resHead;
  c.push(13, 'return head1;',
    resHead === null
      ? 'List 1 was empty, so head1 is null and this method returns null — List 2 is <b>lost</b>. A real implementation must guard against an empty first list.'
      : leftovers
        ? `head1 is still the head of the zipped list. The last <b>${leftovers}</b> node${leftovers === 1 ? '' : 's'} of the longer list came along for free — they were never unlinked.`
        : 'head1 is still the head of the zipped list, so we return it.',
    'Both lists were consumed in a single pass: O(n + m) time, O(1) extra memory.');

  return { name: 'mergeAlternate', java: JAVA.mergeAlternate, steps: c.steps };
}

/* ================= debugger-style step expansion =================
   Each rendered step shows the state BEFORE the highlighted statement
   runs; the next click shows that statement's effect. */

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
             means: 'The operation is complete — this is the final state of the lists.',
             why: '',
             q: (last.q && !last.qPre) ? last.q : null,
             a: (last.q && !last.qPre) ? last.a : null,
             phase: 'done', snap: clone(last.snap) });
  return out;
}

/* ================= UI wiring ================= */

const OPS = {
  mergeSorted: {
    title: 'Merge Two Sorted Lists', sorted: true,
    build: (a, b) => buildMergeSorted(a, b)
  },
  concat: {
    title: 'Concatenate (Append)', sorted: false,
    build: (a, b) => buildConcat(a, b)
  },
  mergeAlternate: {
    title: 'Merge Alternately (Zip)', sorted: false,
    build: (a, b) => buildMergeAlternate(a, b)
  }
};

const MAX_NODES = 6;
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

/* parse "10, 30, 50" / "10 30 50" into an array of ints */
function parseList(text, label) {
  const raw = text.split(/[\s,;]+/).filter(t => t.length);
  const out = [];
  for (const t of raw) {
    const n = parseInt(t, 10);
    if (Number.isNaN(n)) { showMsg(`${label}: “${t}” is not an integer. Use numbers separated by commas, e.g. 10, 30, 50.`); return null; }
    out.push(n);
  }
  if (out.length > MAX_NODES) {
    showMsg(`${label}: please use at most ${MAX_NODES} values so the whole animation stays on screen.`);
    return null;
  }
  return out;
}

function readLists() {
  const a = parseList($('list1Input').value, 'List 1');
  if (a === null) return null;
  const b = parseList($('list2Input').value, 'List 2');
  if (b === null) return null;
  if (a.length === 0 && b.length === 0) {
    showMsg('Both lists are empty — enter some values first.');
    return null;
  }
  return { a, b };
}

/* Rebuild list1 / list2 from the inputs, but keep the existing node ids when
   the values have not changed — otherwise every preview would throw away all
   node elements and flash a new set in. */
const sameValues = (vals, items) =>
  vals.length === items.length && vals.every((v, i) => v === items[i].data);

function syncLists() {
  const vals = readLists();
  if (!vals) return null;
  if (!sameValues(vals.a, list1)) list1 = mkItems(vals.a);
  if (!sameValues(vals.b, list2)) list2 = mkItems(vals.b);
  return vals;
}

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
  $('exWhy').innerHTML = st.why || '';
  $('exWhyRow').style.visibility = st.why ? 'visible' : 'hidden';
  const status = $('exStatus');
  if (st.phase === 'pending') { status.textContent = 'not executed yet'; status.className = 'ex-status pending'; }
  else if (st.phase === 'done') { status.textContent = 'complete'; status.className = 'ex-status done'; }
  else { status.className = 'ex-status hidden'; }

  hideTeach();
  if (teachMode && st.q && i > 0) showTeach(st.q, st.a);

  if (st.phase === 'done') {
    const wrap = stage.parentElement;
    if (wrap) wrap.scrollTo({ left: 0, behavior: 'smooth' });
  }

  $('stepIndicator').textContent = `Step ${i} / ${op.steps.length - 1}`;
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

const isSorted = v => v.every((x, i) => i === 0 || v[i - 1] <= x);

function start() {
  hideMsg();
  const vals = readLists();
  if (!vals) return;
  const cfg = OPS[currentOpName];

  if (cfg.sorted && (!isSorted(vals.a) || !isSorted(vals.b))) {
    $('list1Input').value = [...vals.a].sort((x, y) => x - y).join(', ');
    $('list2Input').value = [...vals.b].sort((x, y) => x - y).join(', ');
    showMsg('mergeSorted assumes BOTH inputs are already sorted, so the two lists were sorted first.', true);
  }
  if (!syncLists()) return;

  setPlaying(false);
  op = cfg.build(list1, list2);
  op.steps = expandSteps(op.steps);
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
  syncLists();
  const rows = currentOpName === 'concat'
    ? ['List 1', 'List 2', null]
    : ['List 1', 'List 2', 'Result'];
  const preview = new Ctx(list1, list2, rows);
  renderState(preview.snap);

  renderCode(JAVA[currentOpName], null, null);
  $('codeTitle').textContent = 'Java — ' + cfg.title;
  $('exStmt').textContent = '—';
  $('exMeans').innerHTML = `Press <b>Start Animation</b> to run <b>${cfg.title}</b> one statement at a time.`;
  $('exWhy').textContent = '';
  $('exWhyRow').style.visibility = 'hidden';
  $('stepIndicator').textContent = 'Ready';
  op = null;
  stepIdx = -1;
  updateButtons();
}

function selectOp(name) {
  currentOpName = name;
  document.querySelectorAll('.tab').forEach(t =>
    t.classList.toggle('active', t.dataset.op === name));
  setPlaying(false);
  hideTeach();
  hideMsg();
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
  $('list1Input').value = '10, 30, 50';
  $('list2Input').value = '20, 40, 60';
  hideMsg();
  idleRender();
  showMsg('Lists reset to 10 → 30 → 50 and 20 → 40 → 60.', true);
});

$('randomBtn').addEventListener('click', () => {
  setPlaying(false);
  const rnd = n => Array.from({ length: n }, () => 1 + Math.floor(Math.random() * 98));
  const needSorted = OPS[currentOpName].sorted;
  let a = rnd(2 + Math.floor(Math.random() * 3));
  let b = rnd(2 + Math.floor(Math.random() * 3));
  if (needSorted) { a.sort((x, y) => x - y); b.sort((x, y) => x - y); }
  $('list1Input').value = a.join(', ');
  $('list2Input').value = b.join(', ');
  hideMsg();
  idleRender();
});

[$('list1Input'), $('list2Input')].forEach(inp => {
  inp.addEventListener('change', () => { hideMsg(); idleRender(); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') start(); });
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
document.documentElement.style.setProperty('--dur', DUR() + 'ms');
selectOp('mergeSorted');
