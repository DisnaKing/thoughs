'use strict';
const $ = s => document.querySelector(s);
const KEY = 'thoughs.notes.v1';

/* ---------- Estado ---------- */
let notes = load();
let tombs = (() => { try { return JSON.parse(localStorage.getItem(KEY + '.tombs')) || []; } catch { return []; } })();
let currentId = null;
let mode = 'edit';
let activeTag = null; // etiqueta (normalizada) usada como filtro
let A = { by: {}, edges: [] }; // análisis de relaciones

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch { return []; } }
function persist() { localStorage.setItem(KEY, JSON.stringify(notes)); }
function saveTombs() { localStorage.setItem(KEY + '.tombs', JSON.stringify(tombs)); }
function markDirty(id) { if (typeof Sync !== 'undefined') Sync.dirty(id); }
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const get = id => notes.find(n => n.id === id);
const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const esc = s => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TAG_RE = /(?<![\p{L}\p{N}&#\/\[])#([\p{L}][\p{L}\p{N}_-]*)/gu;
const titleOf = n => n.title.trim() || 'Sin título';

/* ---------- Análisis de relaciones ---------- */
function analyze() {
  const by = {}; notes.forEach(n => by[n.id] = { links: new Set(), mentions: new Set(), back: new Set(), related: [], tags: new Set(), sameTag: new Map() });
  const tagNames = new Map(), tagIds = new Map();
  notes.forEach(n => { for (const m of n.body.matchAll(TAG_RE)) { const k = norm(m[1]); by[n.id].tags.add(k); if (!tagNames.has(k)) tagNames.set(k, { name: m[1], count: 0 }); if (!tagIds.has(k)) tagIds.set(k, new Set()); tagIds.get(k).add(n.id); } });
  tagIds.forEach((ids, k) => { tagNames.get(k).count = ids.size; const l = [...ids]; l.forEach(a => l.forEach(b => { if (a !== b) { const m = by[a].sameTag; m.set(b, [...(m.get(b) || []), k]); } })); });
  const byTitle = new Map(); notes.forEach(n => { const k = norm(n.title.trim()); if (k) byTitle.set(k, n.id); });
  const mentionRes = notes.filter(n => norm(n.title.trim()).length >= 3).map(n => ({ id: n.id, re: new RegExp(`(?<![\\p{L}\\p{N}])${reEsc(norm(n.title.trim()))}(?![\\p{L}\\p{N}])`, 'u') }));

  notes.forEach(n => {
    const nb = norm(n.body);
    for (const m of n.body.matchAll(/\[\[([^\]]+)\]\]/g)) { const id = byTitle.get(norm(m[1].trim())); if (id && id !== n.id) by[n.id].links.add(id); }
    mentionRes.forEach(({ id, re }) => { if (id !== n.id && !by[n.id].links.has(id) && re.test(nb)) by[n.id].mentions.add(id); });
  });
  notes.forEach(n => [...by[n.id].links, ...by[n.id].mentions].forEach(t => by[t].back.add(n.id)));

  // Similitud: texto (BM25 sobre raíces + bigramas) + vecinos en común (enlaces, menciones, etiquetas)
  const nbrs = new Map(notes.map(n => [n.id, new Set([...by[n.id].links, ...by[n.id].mentions, ...by[n.id].back, ...[...by[n.id].tags].map(k => 'tag:' + k)])]));
  const label = k => k.startsWith('tag:') ? '#' + (tagNames.get(k.slice(4)) || { name: k.slice(4) }).name : titleOf(get(k));
  const simMap = Similarity.compute(notes, nbrs, label);
  const sims = [];
  notes.forEach(n => {
    const direct = new Set([...by[n.id].links, ...by[n.id].mentions, ...by[n.id].back]);
    simMap.get(n.id).forEach(r => { if (n.id < r.id) sims.push([n.id, r.id, r.score]); if (!direct.has(r.id)) by[n.id].related.push(r); });
  });
  Object.values(by).forEach(r => r.related.sort((a, b) => b.score - a.score).splice(6));

  const edges = [], seen = new Set();
  notes.forEach(n => [...by[n.id].links, ...by[n.id].mentions].forEach(t => { const k = [n.id, t].sort().join('|'); if (!seen.has(k)) { seen.add(k); edges.push({ a: n.id, b: t, kind: 'link' }); } }));
  sims.forEach(([a, b]) => { const k = [a, b].sort().join('|'); if (!seen.has(k)) { seen.add(k); edges.push({ a, b, kind: 'sim' }); } });
  notes.forEach(n => by[n.id].sameTag.forEach((_, o) => { const k = [n.id, o].sort().join('|'); if (!seen.has(k)) { seen.add(k); edges.push({ a: n.id, b: o, kind: 'sim' }); } }));
  if (activeTag && !tagNames.has(activeTag)) activeTag = null;
  A = { by, edges, byTitle, mentionRes, tagNames };
}

/* ---------- Markdown mínimo con enlaces automáticos ---------- */
function render(n) {
  const slots = [];
  const hold = h => { slots.push(h); return `\u0000${slots.length - 1}\u0000`; };
  let t = n.body;
  t = t.replace(/\[\[([^\]]+)\]\]/g, (_, name) => {
    const id = A.byTitle.get(norm(name.trim()));
    return hold(id ? `<a data-id="${id}">${esc(name)}</a>` : `<a class="new" data-new="${esc(name.trim())}" title="Crear nota">${esc(name)}</a>`);
  });
  t = t.replace(TAG_RE, (_, tag) => hold(`<a class="tag" data-tag="${norm(tag)}">#${esc(tag)}</a>`));
  // menciones automáticas (de las más largas a las más cortas)
  [...A.by[n.id].mentions].map(get).filter(Boolean).sort((a, b) => b.title.length - a.title.length).forEach(m => {
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(${reEsc(m.title.trim())})(?![\\p{L}\\p{N}])`, 'giu');
    t = t.replace(re, x => hold(`<a class="auto" data-id="${m.id}">${esc(x)}</a>`));
  });
  t = esc(t.replace(/\u0000/g, '\u0001')).replace(/\u0001/g, '\u0000');
  t = t.replace(/^### (.*)$/gm, '<h3>$1</h3>').replace(/^## (.*)$/gm, '<h2>$1</h2>').replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/\*([^*]+)\*/g, '<i>$1</i>')
    .replace(/^(?:[-*] .*(?:\n|$))+/gm, b => '<ul>' + b.trim().split('\n').map(l => `<li>${l.slice(2)}</li>`).join('') + '</ul>')
    .replace(/(?<!>)\n/g, '<br>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, i) => slots[i]);
}

/* ---------- UI ---------- */
function setView(v) { document.body.dataset.view = v; }

function renderTagBar() {
  const tags = [...A.tagNames].sort((a, b) => b[1].count - a[1].count).slice(0, 14);
  $('#tagbar').innerHTML = tags.map(([k, v]) => `<button class="tagchip ${k === activeTag ? 'on' : ''}" data-tag="${k}">#${esc(v.name)} <small>${v.count}</small></button>`).join('');
}
function setTag(k) { activeTag = activeTag === k ? null : k; renderTagBar(); renderList(); }

function renderList() {
  renderTagBar();
  const q = norm($('#search').value);
  const items = notes.filter(n => (!q || norm(n.title).includes(q) || norm(n.body).includes(q)) && (!activeTag || A.by[n.id].tags.has(activeTag))).sort((a, b) => b.updated - a.updated);
  $('#list').innerHTML = items.map(n => `<li data-id="${n.id}" class="${n.id === currentId ? 'active' : ''}"><b>${esc(titleOf(n))}</b><small>${esc(n.body.replace(/\s+/g, ' ').slice(0, 70)) || '—'}</small></li>`).join('') || '<li class="none">Sin notas</li>';
}

function renderRelated() {
  const n = get(currentId), box = $('#related');
  if (!n) { box.hidden = true; return; }
  box.hidden = false;
  const r = A.by[n.id];
  const chips = (ids, sub) => ids.length ? ids.map(id => `<button class="chip" data-id="${id}">${esc(titleOf(get(id)))}${sub ? `<small>${esc(sub(id))}</small>` : ''}</button>`).join('') : '<div class="none">—</div>';
  box.innerHTML =
    `<h4>Enlaces</h4>${chips([...r.links])}` +
    `<h4>Menciones detectadas</h4>${chips([...r.mentions])}` +
    `<h4>Enlazada desde</h4>${chips([...r.back])}` +
    `<h4>Etiquetas</h4>${r.tags.size ? [...r.tags].map(k => `<button class="tagchip" data-tag="${k}">#${esc(A.tagNames.get(k).name)}</button>`).join(' ') : '<div class="none">—</div>'}` +
    `<h4>Mismas etiquetas</h4>${r.sameTag.size ? [...r.sameTag].map(([id, ks]) => `<button class="chip" data-id="${id}">${esc(titleOf(get(id)))}<small>${esc(ks.map(k => '#' + A.tagNames.get(k).name).join(' '))}</small></button>`).join('') : '<div class="none">—</div>'}` +
    `<h4>Relacionadas por contenido</h4>${r.related.length ? r.related.map(x => `<button class="chip" data-id="${x.id}">${esc(titleOf(get(x.id)))}<small>${esc([...x.terms.slice(0, 3), ...(x.via.length ? ['vía ' + x.via.slice(0, 2).join(', ')] : [])].join(' · '))}</small></button>`).join('') : '<div class="none">—</div>'}`;
}

function renderNote() {
  const n = get(currentId);
  $('#empty').hidden = !!n; $('#editor').hidden = !n;
  if (!n) { $('#related').hidden = true; return; }
  if (document.activeElement !== $('#title')) $('#title').value = n.title;
  if (document.activeElement !== $('#body')) $('#body').value = n.body;
  $('#body').hidden = mode !== 'edit'; $('#preview').hidden = mode === 'edit';
  $('#modeBtn').textContent = mode === 'edit' ? 'Leer' : 'Editar';
  if (mode === 'read') $('#preview').innerHTML = render(n) || '<span class="none">Nota vacía</span>';
  renderRelated();
}

function open(id, view = 'note') {
  acClose();
  currentId = id; $('#graphView').hidden = true; $('#noteView').hidden = false;
  renderList(); renderNote(); setView(view);
}

function create(title = '') {
  const n = { id: uid(), title, body: '', created: Date.now(), updated: Date.now() };
  notes.push(n); persist(); markDirty(n.id); analyze(); mode = 'edit'; open(n.id);
  (title ? $('#body') : $('#title')).focus();
  return n;
}

/* ---------- Eventos ---------- */
let t;
function changed() {
  const n = get(currentId); if (!n) return;
  n.title = $('#title').value; n.body = $('#body').value; n.updated = Date.now();
  clearTimeout(t); t = setTimeout(() => { persist(); markDirty(n.id); analyze(); renderList(); renderRelated(); }, 350);
}
$('#title').oninput = changed;
$('#body').oninput = () => { changed(); acUpdate(); };

/* ---------- Autocompletado: [[títulos]] y #etiquetas ---------- */
const ac = $('#ac'); let acItems = [], acSel = 0, acCtx = null;
function acClose() { ac.hidden = true; acItems = []; acCtx = null; }
function acUpdate() {
  const ta = $('#body'), pos = ta.selectionStart, before = ta.value.slice(0, pos);
  let m = before.match(/\[\[([^\]\[\n]*)$/), items = [];
  if (m) {
    const raw = m[1].trim(), q = norm(raw);
    items = notes.filter(n => n.id !== currentId && n.title.trim() && norm(n.title).includes(q))
      .sort((a, b) => (norm(b.title).startsWith(q) - norm(a.title).startsWith(q)) || a.title.localeCompare(b.title)).slice(0, 6)
      .map(n => ({ label: n.title, ins: `[[${n.title}]]` }));
    if (raw && !notes.some(n => norm(n.title.trim()) === q)) items.push({ label: `Crear enlace «${raw}»`, ins: `[[${raw}]]`, hint: true });
    acCtx = { start: pos - m[0].length, end: pos };
  } else if ((m = before.match(/(?:^|[\s(])#([\p{L}\p{N}_-]*)$/u))) {
    const q = norm(m[1]);
    items = [...A.tagNames].filter(([k]) => k.startsWith(q) && k !== q).sort((a, b) => b[1].count - a[1].count).slice(0, 6)
      .map(([, v]) => ({ label: '#' + v.name, ins: '#' + v.name + ' ' }));
    acCtx = { start: pos - m[1].length - 1, end: pos };
  }
  acItems = items; acSel = 0;
  if (!items.length) return acClose();
  drawAc();
}
function drawAc() {
  ac.hidden = false;
  ac.innerHTML = acItems.map((it, i) => `<button type="button" class="${i === acSel ? 'on' : ''}${it.hint ? ' hint' : ''}" data-i="${i}">${esc(it.label)}</button>`).join('');
}
function acAccept(i) {
  const it = acItems[i], ta = $('#body'); if (!it || !acCtx) return;
  ta.setRangeText(it.ins, acCtx.start, acCtx.end, 'end');
  acClose(); ta.focus(); ta.dispatchEvent(new Event('input'));
}
ac.onpointerdown = e => { e.preventDefault(); const b = e.target.closest('[data-i]'); if (b) acAccept(+b.dataset.i); };
$('#body').addEventListener('keydown', e => {
  if (ac.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); acSel = (acSel + (e.key === 'ArrowDown' ? 1 : acItems.length - 1)) % acItems.length; drawAc(); }
  else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acAccept(acSel); }
  else if (e.key === 'Escape') { e.preventDefault(); acClose(); }
});
let acTimer;
$('#body').addEventListener('blur', () => { acTimer = setTimeout(acClose, 150); });
$('#body').addEventListener('focus', () => clearTimeout(acTimer));
$('#search').oninput = renderList;
$('#newBtn').onclick = () => create();
$('#list').onclick = e => { const li = e.target.closest('li[data-id]'); if (li) open(li.dataset.id); };
$('#backBtn').onclick = () => setView('list');
$('#modeBtn').onclick = () => { mode = mode === 'edit' ? 'read' : 'edit'; renderNote(); };
$('#delBtn').onclick = () => {
  const n = get(currentId); if (!n || !confirm(`¿Borrar "${titleOf(n)}"?`)) return;
  notes = notes.filter(x => x.id !== n.id); tombs.push({ id: n.id, title: '', body: '', created: n.created, updated: Date.now(), deleted: true }); saveTombs(); markDirty(n.id); currentId = null; persist(); analyze(); renderList(); renderNote(); setView('list');
};
$('#related').onclick = e => { const g = e.target.closest('[data-tag]'); if (g) { setTag(g.dataset.tag); return setView('list'); } const b = e.target.closest('[data-id]'); if (b) open(b.dataset.id); };
$('#tagbar').onclick = e => { const g = e.target.closest('[data-tag]'); if (g) setTag(g.dataset.tag); };
$('#preview').onclick = e => {
  const a = e.target.closest('a'); if (!a) return;
  if (a.dataset.tag) { setTag(a.dataset.tag); return setView('list'); }
  if (a.dataset.id) open(a.dataset.id); else if (a.dataset.new) create(a.dataset.new);
};
$('#exportBtn').onclick = () => {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' }));
  a.download = `thoughs-${new Date().toISOString().slice(0, 10)}.json`; a.click();
};
$('#importBtn').onclick = () => $('#importFile').click();
$('#importFile').onchange = async e => {
  try {
    const data = JSON.parse(await e.target.files[0].text()); let add = 0;
    data.forEach(n => { const cur = get(n.id); if (!cur) { notes.push(n); add++; markDirty(n.id); } else if (n.updated > cur.updated) { Object.assign(cur, n); markDirty(n.id); } });
    persist(); analyze(); renderList(); renderNote(); alert(`Importadas ${add} notas nuevas.`);
  } catch { alert('Archivo no válido'); }
  e.target.value = '';
};

/* ---------- Grafo ---------- */
let sim = null;
$('#graphBtn').onclick = () => { $('#noteView').hidden = true; $('#graphView').hidden = false; setView('graph'); startGraph(); };
$('#backBtn').addEventListener('click', () => { if (sim) sim.stop = true; });

function startGraph() {
  const cv = $('#graph'), ctx = cv.getContext('2d'), dpr = window.devicePixelRatio || 1;
  const W = cv.clientWidth, H = cv.clientHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.scale(dpr, dpr);
  const nodes = notes.map((n, i) => ({ id: n.id, x: W / 2 + Math.cos(i) * 120, y: H / 2 + Math.sin(i) * 120, vx: 0, vy: 0 }));
  const idx = new Map(nodes.map(n => [n.id, n]));
  const edges = A.edges.map(e => ({ a: idx.get(e.a), b: idx.get(e.b), kind: e.kind }));
  const deg = {}; edges.forEach(e => { deg[e.a.id] = (deg[e.a.id] || 0) + 1; deg[e.b.id] = (deg[e.b.id] || 0) + 1; });
  const css = getComputedStyle(document.body), col = n => css.getPropertyValue(n).trim();
  let drag = null, moved = false;
  if (sim) sim.stop = true; const me = sim = { stop: false };

  const step = () => {
    if (me.stop) return;
    for (const a of nodes) {
      a.vx += (W / 2 - a.x) * 0.002; a.vy += (H / 2 - a.y) * 0.002;
      for (const b of nodes) if (a !== b) { let dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy + 0.1; const f = 1800 / d2; a.vx += dx * f / Math.sqrt(d2); a.vy += dy * f / Math.sqrt(d2); }
    }
    for (const e of edges) { const dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, d = Math.hypot(dx, dy) || 1, f = (d - 110) * 0.01; e.a.vx += dx / d * f; e.a.vy += dy / d * f; e.b.vx -= dx / d * f; e.b.vy -= dy / d * f; }
    for (const n of nodes) { if (n === drag) continue; n.vx *= 0.85; n.vy *= 0.85; n.x += n.vx; n.y += n.vy; }
    ctx.clearRect(0, 0, W, H); ctx.font = '13px Inter, system-ui'; ctx.textAlign = 'center';
    for (const e of edges) { ctx.beginPath(); ctx.setLineDash(e.kind === 'sim' ? [5, 4] : []); ctx.strokeStyle = e.kind === 'sim' ? col('--muted') : col('--accent'); ctx.moveTo(e.a.x, e.a.y); ctx.lineTo(e.b.x, e.b.y); ctx.stroke(); }
    ctx.setLineDash([]);
    for (const n of nodes) {
      const r = 6 + Math.min(10, (deg[n.id] || 0) * 2);
      ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 7); ctx.fillStyle = n.id === currentId ? col('--accent') : col('--panel'); ctx.fill(); ctx.strokeStyle = col('--accent'); ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = col('--text'); ctx.fillText(titleOf(get(n.id)).slice(0, 24), n.x, n.y + r + 14);
    }
    requestAnimationFrame(step);
  };
  const hit = e => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; return nodes.find(n => Math.hypot(n.x - x, n.y - y) < 18); };
  cv.onpointerdown = e => { drag = hit(e) || null; moved = false; if (drag) cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = e => { if (!drag) return; const r = cv.getBoundingClientRect(); drag.x = e.clientX - r.left; drag.y = e.clientY - r.top; moved = true; };
  cv.onpointerup = () => { if (drag && !moved) { me.stop = true; open(drag.id); } drag = null; };
  if (!nodes.length) { ctx.fillStyle = col('--muted'); ctx.textAlign = 'center'; ctx.fillText('Aún no hay notas', W / 2, H / 2); return; }
  step();
}

/* ---------- Inicio ---------- */
analyze(); renderList(); renderNote();
if (!notes.length) setView('list');
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
