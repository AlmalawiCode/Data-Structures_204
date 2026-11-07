/* ==========================================================================
   BST figures + interactive BST lab  (CPCS204)
   - Static figures:  <div class="bst-fig" data-keys="50,30,70"
                            data-ops="del:20 | delp:50"
                            data-hl="50:del,60:succ" data-path="50,70,60"
                            data-cap="caption"></div>
   - Interactive lab: element with id="bst-lab"
   Language: <html lang="ar"> gives Arabic messages.
   ========================================================================== */
(function () {
    'use strict';
    var AR = (document.documentElement.lang || '').toLowerCase().indexOf('ar') === 0;

    /* ---------------- BST model (mirrors BST.java) ---------------- */
    function N(v) { return { v: v, L: null, R: null }; }
    function ins(n, v) {
        if (!n) return N(v);
        if (v < n.v) n.L = ins(n.L, v); else if (v > n.v) n.R = ins(n.R, v);
        return n;
    }
    function minN(n) { while (n.L) n = n.L; return n; }
    function maxN(n) { while (n.R) n = n.R; return n; }
    function del(n, k, usePred) {
        if (!n) return null;
        if (k < n.v) n.L = del(n.L, k, usePred);
        else if (k > n.v) n.R = del(n.R, k, usePred);
        else {
            if (!n.L && !n.R) return null;
            if (!n.L) return n.R;
            if (!n.R) return n.L;
            if (usePred) { var p = maxN(n.L); n.v = p.v; n.L = del(n.L, p.v, true); }
            else { var s = minN(n.R); n.v = s.v; n.R = del(n.R, s.v, false); }
        }
        return n;
    }
    function find(n, k) { while (n && n.v !== k) n = k < n.v ? n.L : n.R; return n; }
    function build(keys) { var r = null; keys.forEach(function (k) { r = ins(r, k); }); return r; }
    function pathTo(n, k) {           // nodes visited when searching k
        var p = [];
        while (n) { p.push(n.v); if (k === n.v) break; n = k < n.v ? n.L : n.R; }
        return p;
    }

    /* ---------------- SVG renderer ---------------- */
    var STY = {
        normal: { fill: '#ffffff', stroke: '#000000', text: '#000000' },
        path:   { fill: '#fff59d', stroke: '#e65100', text: '#000000' },
        found:  { fill: '#2e7d32', stroke: '#1b5e20', text: '#ffffff' },
        del:    { fill: '#c62828', stroke: '#7f0000', text: '#ffffff' },
        succ:   { fill: '#1565c0', stroke: '#0d47a1', text: '#ffffff' },
        pred:   { fill: '#6a1b9a', stroke: '#4a148c', text: '#ffffff' },
        child:  { fill: '#ef6c00', stroke: '#bf360c', text: '#ffffff' },
        isnew:  { fill: '#2e7d32', stroke: '#1b5e20', text: '#ffffff' }
    };
    var TAG = AR
        ? { del: 'يُحذف', succ: 'الخلف', pred: 'السلف', child: 'الابن', isnew: 'جديد', found: 'وُجد', min: 'MIN', max: 'MAX' }
        : { del: 'delete', succ: 'successor', pred: 'predecessor', child: 'child', isnew: 'new', found: 'found', min: 'MIN', max: 'MAX' };

    function render(root, opt) {
        opt = opt || {};
        var hl = opt.hl || {}, path = opt.path || [], labels = opt.labels || {};
        var nodes = [], i = 0;
        (function walk(n, d) {
            if (!n) return;
            walk(n.L, d + 1);
            nodes.push({ n: n, x: i++, d: d });
            walk(n.R, d + 1);
        })(root, 0);
        var R = 24, DX = 58, DY = 78, PAD = 40;
        var maxD = nodes.reduce(function (m, o) { return Math.max(m, o.d); }, 0);
        var W = Math.max(nodes.length, 1) * DX + PAD * 2 - (DX - 2 * R);
        var H = (maxD + 1) * DY + PAD + 14;
        var pos = {};
        nodes.forEach(function (o) { pos[o.n.v] = { x: PAD + R + o.x * DX, y: PAD + o.d * DY, n: o.n }; });
        var s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" style="max-width:100%;height:auto;">';
        if (!root) {
            s += '<text x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle" font-size="20" font-weight="700" fill="#000">root = null</text>';
        }
        // edges
        nodes.forEach(function (o) {
            var a = pos[o.n.v];
            [o.n.L, o.n.R].forEach(function (c) {
                if (!c) return;
                var b = pos[c.v];
                var onPath = path.indexOf(o.n.v) >= 0 && path.indexOf(c.v) >= 0;
                s += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + (onPath ? '#e65100' : '#000') + '" stroke-width="' + (onPath ? 5 : 2.5) + '"/>';
            });
        });
        // nodes
        nodes.forEach(function (o) {
            var p = pos[o.n.v], k = hl[o.n.v] || (path.indexOf(o.n.v) >= 0 ? 'path' : 'normal');
            var st = STY[k] || STY.normal;
            s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + R + '" fill="' + st.fill + '" stroke="' + st.stroke + '" stroke-width="3.5"/>';
            s += '<text x="' + p.x + '" y="' + (p.y + 7) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="20" font-weight="800" fill="' + st.text + '">' + o.n.v + '</text>';
            var lab = labels[o.n.v] || (TAG[k] && k !== 'path' && k !== 'normal' ? TAG[k] : '');
            if (lab) {
                s += '<text x="' + p.x + '" y="' + (p.y + R + 19) + '" text-anchor="middle" font-family="Arial,sans-serif" font-size="15" font-weight="800" paint-order="stroke" stroke="#ffffff" stroke-width="5" fill="' + st.stroke + '">' + lab + '</text>';
            }
        });
        return s + '</svg>';
    }

    function nums(str) {
        return (str || '').split(',').map(function (x) { return x.trim(); }).filter(Boolean).map(Number);
    }
    function pairs(str) {
        var o = {};
        (str || '').split(',').forEach(function (x) {
            var a = x.split(':'); if (a.length === 2) o[Number(a[0].trim())] = a[1].trim();
        });
        return o;
    }

    function drawFigures() {
        var figs = document.querySelectorAll('.bst-fig');
        Array.prototype.forEach.call(figs, function (f) {
            var root = build(nums(f.getAttribute('data-keys')));
            (f.getAttribute('data-ops') || '').split('|').forEach(function (op) {
                op = op.trim(); if (!op) return;
                var a = op.split(':'), k = Number(a[1]);
                if (a[0] === 'del') root = del(root, k, false);
                if (a[0] === 'delp') root = del(root, k, true);
                if (a[0] === 'ins') root = ins(root, k);
            });
            var labels = {};
            (f.getAttribute('data-labels') || '').split(',').forEach(function (x) {
                var a = x.split(':'); if (a.length === 2) labels[Number(a[0].trim())] = a[1].trim();
            });
            var html = render(root, { hl: pairs(f.getAttribute('data-hl')), path: nums(f.getAttribute('data-path')), labels: labels });
            var cap = f.getAttribute('data-cap');
            f.innerHTML = '<div class="bst-svg">' + html + '</div>' + (cap ? '<div class="bst-cap">' + cap + '</div>' : '');
        });
    }

    /* ---------------- Interactive lab ---------------- */
    var T = AR ? {
        empty: 'الشجرة فارغة.',
        bad: 'اكتب عددًا صحيحًا من 1 إلى 99.',
        cmpL: function (k, v) { return k + ' &lt; ' + v + ' ← نذهب يسارًا'; },
        cmpR: function (k, v) { return k + ' &gt; ' + v + ' ← نذهب يمينًا'; },
        insNull: function (k) { return 'وصلنا إلى null ← ننشئ new Node(' + k + ') هنا ✔'; },
        insRoot: function (k) { return 'الشجرة فارغة ← ' + k + ' يصبح الجذر root ✔'; },
        dup: function (k) { return k + ' موجود مسبقًا ← لا نضيف القيم المكررة.'; },
        found: function (k) { return k + ' == ' + k + ' ← تم العثور على القيمة ✔ (return true)'; },
        notFound: function (k) { return 'وصلنا إلى null ← القيمة ' + k + ' غير موجودة ✘ (return false)'; },
        delNot: function (k) { return 'وصلنا إلى null ← ' + k + ' غير موجود، لا يوجد ما يُحذف.'; },
        case1: function (k) { return '<b>الحالة 1 (ورقة):</b> العقدة ' + k + ' ليس لها أبناء ← نحذفها مباشرة (return null).'; },
        case2: function (k, c) { return '<b>الحالة 2 (ابن واحد):</b> العقدة ' + k + ' لها ابن واحد هو ' + c + ' ← الابن يأخذ مكانها.'; },
        case3s: function (k) { return '<b>الحالة 3 (ابنان):</b> العقدة ' + k + ' لها ابنان ← نبحث عن <b>الخلف</b> = أصغر قيمة في الشجرة الفرعية اليمنى: نذهب يمينًا مرة ثم يسارًا حتى النهاية.'; },
        case3p: function (k) { return '<b>الحالة 3 (ابنان):</b> العقدة ' + k + ' لها ابنان ← نبحث عن <b>السلف</b> = أكبر قيمة في الشجرة الفرعية اليسرى: نذهب يسارًا مرة ثم يمينًا حتى النهاية.'; },
        walk: function (v) { return 'نمرّ على ' + v; },
        copyS: function (s, k) { return 'الخلف هو <b>' + s + '</b> ← ننسخ ' + s + ' مكان ' + k + '، ثم نحذف ' + s + ' القديم من الشجرة اليمنى (وهو حالة 1 أو 2).'; },
        copyP: function (p, k) { return 'السلف هو <b>' + p + '</b> ← ننسخ ' + p + ' مكان ' + k + '، ثم نحذف ' + p + ' القديم من الشجرة اليسرى (وهو حالة 1 أو 2).'; },
        done: 'تم ✔ — الترتيب الوسطي (in-order) ما زال مرتبًا: ',
        start: function (op, k) { return '▶ ' + op + '(' + k + ')'; }
    } : {
        empty: 'The tree is empty.',
        bad: 'Type a whole number from 1 to 99.',
        cmpL: function (k, v) { return k + ' &lt; ' + v + ' → go LEFT'; },
        cmpR: function (k, v) { return k + ' &gt; ' + v + ' → go RIGHT'; },
        insNull: function (k) { return 'reached null → create new Node(' + k + ') here ✔'; },
        insRoot: function (k) { return 'tree is empty → ' + k + ' becomes the root ✔'; },
        dup: function (k) { return k + ' is already in the tree → duplicates are not inserted.'; },
        found: function (k) { return k + ' == ' + k + ' → FOUND ✔ (return true)'; },
        notFound: function (k) { return 'reached null → ' + k + ' is NOT in the tree ✘ (return false)'; },
        delNot: function (k) { return 'reached null → ' + k + ' is not in the tree, nothing to delete.'; },
        case1: function (k) { return '<b>CASE 1 (leaf):</b> node ' + k + ' has no children → simply remove it (return null).'; },
        case2: function (k, c) { return '<b>CASE 2 (one child):</b> node ' + k + ' has one child ' + c + ' → the child takes its place.'; },
        case3s: function (k) { return '<b>CASE 3 (two children):</b> node ' + k + ' has two children → find the <b>successor</b> = MINIMUM of the RIGHT subtree: go right once, then left until null.'; },
        case3p: function (k) { return '<b>CASE 3 (two children):</b> node ' + k + ' has two children → find the <b>predecessor</b> = MAXIMUM of the LEFT subtree: go left once, then right until null.'; },
        walk: function (v) { return 'visit ' + v; },
        copyS: function (s, k) { return 'successor is <b>' + s + '</b> → copy ' + s + ' into the node of ' + k + ', then delete the old ' + s + ' from the right subtree (it is case 1 or 2).'; },
        copyP: function (p, k) { return 'predecessor is <b>' + p + '</b> → copy ' + p + ' into the node of ' + k + ', then delete the old ' + p + ' from the left subtree (it is case 1 or 2).'; },
        done: 'Done ✔ — in-order is still sorted: ',
        start: function (op, k) { return '▶ ' + op + '(' + k + ')'; }
    };

    function initLab() {
        var lab = document.getElementById('bst-lab');
        if (!lab) return;
        var DEFAULT = [50, 30, 70, 20, 40, 60, 80, 65];
        var root = build(DEFAULT);
        var view = lab.querySelector('.lab-tree');
        var log = lab.querySelector('.lab-log');
        var inp = lab.querySelector('.lab-input');
        var inord = lab.querySelector('.lab-inorder');
        var speedEl = lab.querySelector('.lab-speed');
        var busy = false;

        function inorder(n, a) { if (n) { inorder(n.L, a); a.push(n.v); inorder(n.R, a); } return a; }
        function show(opt) {
            view.innerHTML = render(root, opt || {});
            inord.textContent = 'in-order: ' + (inorder(root, []).join('  ') || '(empty)');
        }
        function say(html, cls) {
            var d = document.createElement('div');
            d.className = 'lab-line' + (cls ? ' ' + cls : '');
            d.innerHTML = html;
            log.appendChild(d);
            log.scrollTop = log.scrollHeight;
        }
        function delay() { return speedEl ? Number(speedEl.value) : 900; }
        function steps(list, done) {      // list of functions run one after another
            busy = true;
            var i = 0;
            (function next() {
                if (i >= list.length) { busy = false; if (done) done(); return; }
                list[i++]();
                setTimeout(next, delay());
            })();
        }
        function readKey() {
            var k = parseInt(inp.value, 10);
            if (isNaN(k) || k < 1 || k > 99) { say(T.bad, 'bad'); return null; }
            return k;
        }
        function descend(k, act) {        // compare steps from root toward k
            var list = [], path = [], n = root;
            while (n && n.v !== k) {
                (function (v, p) {
                    list.push(function () { show({ path: p }); say(k < v ? T.cmpL(k, v) : T.cmpR(k, v)); });
                })(n.v, path.concat(n.v));
                path.push(n.v);
                n = k < n.v ? n.L : n.R;
            }
            return { list: list, path: path, node: n };
        }

        function doInsert() {
            if (busy) return; var k = readKey(); if (k === null) return;
            log.innerHTML = ''; say(T.start('insert', k), 'head');
            if (!root) { root = ins(root, k); var h0 = {}; h0[k] = 'isnew'; show({ hl: h0 }); say(T.insRoot(k), 'ok'); return; }
            var d = descend(k);
            if (d.node) {
                d.list.push(function () { var h = {}; h[k] = 'found'; show({ path: d.path, hl: h }); say(T.dup(k), 'bad'); });
                steps(d.list); return;
            }
            d.list.push(function () { root = ins(root, k); var h = {}; h[k] = 'isnew'; show({ path: d.path, hl: h }); say(T.insNull(k), 'ok'); });
            steps(d.list);
        }
        function doSearch() {
            if (busy) return; var k = readKey(); if (k === null) return;
            log.innerHTML = ''; say(T.start('search', k), 'head');
            if (!root) { say(T.empty, 'bad'); return; }
            var d = descend(k);
            d.list.push(function () {
                if (d.node) { var h = {}; h[k] = 'found'; show({ path: d.path, hl: h }); say(T.found(k), 'ok'); }
                else { show({ path: d.path }); say(T.notFound(k), 'bad'); }
            });
            steps(d.list);
        }
        function doDelete(usePred) {
            if (busy) return; var k = readKey(); if (k === null) return;
            log.innerHTML = ''; say(T.start(usePred ? 'deleteUsingPredecessor' : 'delete', k), 'head');
            if (!root) { say(T.empty, 'bad'); return; }
            var d = descend(k), n = d.node;
            if (!n) { d.list.push(function () { show({ path: d.path }); say(T.delNot(k), 'bad'); }); steps(d.list); return; }
            var hk = {}; hk[k] = 'del';
            var finish = function () { root = del(root, k, usePred); show(); say(T.done + inorder(root, []).join(' '), 'ok'); };

            if (!n.L && !n.R) {
                d.list.push(function () { show({ path: d.path, hl: hk }); say(T.case1(k)); });
                d.list.push(finish);
            } else if (!n.L || !n.R) {
                var c = (n.L || n.R).v;
                d.list.push(function () { var h = {}; h[k] = 'del'; h[c] = 'child'; show({ path: d.path, hl: h }); say(T.case2(k, c)); });
                d.list.push(finish);
            } else {
                d.list.push(function () { show({ path: d.path, hl: hk }); say(usePred ? T.case3p(k) : T.case3s(k)); });
                var walkPath = [], m = usePred ? n.L : n.R;
                while (m) {
                    walkPath.push(m.v);
                    (function (wp) {
                        d.list.push(function () { show({ path: wp, hl: hk }); say(T.walk(wp[wp.length - 1])); });
                    })(walkPath.slice());
                    m = usePred ? m.R : m.L;
                }
                var r = walkPath[walkPath.length - 1];
                d.list.push(function () { var h = {}; h[k] = 'del'; h[r] = usePred ? 'pred' : 'succ'; show({ path: walkPath, hl: h }); say(usePred ? T.copyP(r, k) : T.copyS(r, k)); });
                d.list.push(finish);
            }
            steps(d.list);
        }

        lab.querySelector('.lab-ins').onclick = doInsert;
        lab.querySelector('.lab-search').onclick = doSearch;
        lab.querySelector('.lab-del').onclick = function () { doDelete(false); };
        lab.querySelector('.lab-delp').onclick = function () { doDelete(true); };
        lab.querySelector('.lab-reset').onclick = function () { if (busy) return; root = build(DEFAULT); log.innerHTML = ''; show(); };
        lab.querySelector('.lab-clear').onclick = function () { if (busy) return; root = null; log.innerHTML = ''; show(); };
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') doInsert(); });
        show();
    }

    function init() { drawFigures(); initLab(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
