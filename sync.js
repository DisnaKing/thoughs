'use strict';
/* Sincronización con Supabase (API REST directa, sin SDK). Fusión por "última edición gana". */
const Sync = (() => {
  const CK = 'thoughs.sync.cfg', SK = 'thoughs.sync.session', DK = 'thoughs.sync.dirty', RK = 'thoughs.sync.cursor';
  const rd = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const wr = (k, v) => v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
  let cfg = rd(CK, null), sess = rd(SK, null), dirtySet = new Set(rd(DK, [])), cursor = rd(RK, 0), busy = false, timer = null, status = '';

  // Enlace de configuración: #cfg=<base64 {url,key}>
  const m = location.hash.match(/cfg=([^&]+)/);
  if (m) { try { cfg = JSON.parse(atob(decodeURIComponent(m[1]))); wr(CK, cfg); history.replaceState(null, '', location.pathname + location.search); } catch {} }

  const say = t => { status = t; $('#syncStatus').textContent = t; };
  const cleanUrl = u => u.trim().replace(/\/+$/, '');

  async function authCall(path, body) {
    const r = await fetch(`${cfg.url}/auth/v1/${path}`, { method: 'POST', headers: { apikey: cfg.key, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error_description || d.msg || d.message || `Error ${r.status}`);
    return d;
  }
  function setSession(d) {
    sess = d.access_token ? { access: d.access_token, refresh: d.refresh_token, exp: Date.now() + (d.expires_in - 60) * 1000, uid: d.user.id, email: d.user.email } : null;
    wr(SK, sess); return !!sess;
  }
  async function token() {
    if (!sess) throw new Error('Sin sesión');
    if (Date.now() > sess.exp) { try { setSession(await authCall('token?grant_type=refresh_token', { refresh_token: sess.refresh })); } catch (e) { sess = null; wr(SK, null); throw e; } }
    return sess.access;
  }
  async function api(path, opts = {}) {
    const r = await fetch(`${cfg.url}/rest/v1/${path}`, { ...opts, headers: { apikey: cfg.key, Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    if (!r.ok) throw new Error(`API ${r.status}: ${(await r.text()).slice(0, 120)}`);
    return opts.method === 'POST' ? null : r.json();
  }

  const local = id => notes.find(n => n.id === id) || tombs.find(n => n.id === id);

  async function run() {
    if (!cfg || !sess || busy || !navigator.onLine) return;
    busy = true; say('sincronizando…'); const applied = new Set();
    try {
      // 1) traer cambios del servidor
      for (;;) {
        const rows = await api(`notes?select=*&rev=gt.${cursor}&order=rev.asc&limit=1000`);
        for (const r of rows) {
          cursor = Math.max(cursor, r.rev);
          const loc = local(r.id);
          if (loc && loc.updated >= r.updated) continue; // lo local es igual o más reciente
          applied.add(r.id); notes = notes.filter(n => n.id !== r.id); tombs = tombs.filter(n => n.id !== r.id);
          const item = { id: r.id, title: r.title, body: r.body, created: r.created, updated: r.updated };
          if (r.deleted) tombs.push({ ...item, deleted: true }); else notes.push(item);
          dirtySet.delete(r.id);
        }
        if (rows.length < 1000) break;
      }
      // 2) subir cambios locales
      const rows = [...dirtySet].map(local).filter(Boolean).map(n => ({ id: n.id, user_id: sess.uid, title: n.title || '', body: n.body || '', created: n.created, updated: n.updated, deleted: !!n.deleted }));
      if (rows.length) await api('notes?on_conflict=user_id,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows) });
      dirtySet.clear(); wr(DK, []); wr(RK, cursor);
      persist(); saveTombs();
      if (currentId && !get(currentId)) currentId = null;
      analyze(); renderList(); renderNote();
      const cur = get(currentId); // si el servidor cambió la nota abierta, refrescar aunque tenga el foco
      if (cur && applied.has(cur.id)) { $('#title').value = cur.title; $('#body').value = cur.body; }
      say('al día · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    } catch (e) { say('error'); msg(e.message); }
    busy = false;
  }

  function dirty(id) { dirtySet.add(id); wr(DK, [...dirtySet]); schedule(); }
  function schedule(ms = 1500) { if (!cfg || !sess) return; clearTimeout(timer); timer = setTimeout(run, ms); }

  /* ---- Diálogo ---- */
  const msg = t => { $('#syncMsg').textContent = t || ''; };
  function draw() {
    const b = $('#syncBody');
    if (!cfg) b.innerHTML = `<h3>Sincronización</h3><p>Pega la URL y la clave <i>anon</i> de tu proyecto Supabase (ver README).</p>
      <input id="sUrl" placeholder="https://xxxx.supabase.co"><input id="sKey" placeholder="anon public key"><button type="button" id="sSave" class="primary">Guardar</button>`;
    else if (!sess) b.innerHTML = `<h3>Iniciar sesión</h3><input id="sMail" type="email" placeholder="email" autocomplete="email"><input id="sPass" type="password" placeholder="contraseña (mín. 6)" autocomplete="current-password">
      <button type="button" id="sIn" class="primary">Entrar</button><button type="button" id="sUp">Crear cuenta</button><button type="button" id="sCfg">Cambiar proyecto</button>`;
    else b.innerHTML = `<h3>Sincronización activa</h3><p>${esc(sess.email)}<br>Estado: ${esc(status)}</p>
      <button type="button" id="sNow" class="primary">Sincronizar ahora</button><button type="button" id="sLink">Copiar enlace para otro dispositivo</button><button type="button" id="sOut" class="danger">Cerrar sesión</button>`;
    const on = (id, f) => { const e = $('#' + id); if (e) e.onclick = f; };
    on('sSave', () => { cfg = { url: cleanUrl($('#sUrl').value), key: $('#sKey').value.trim() }; if (!/^https?:\/\//.test(cfg.url) || !cfg.key) { cfg = null; return msg('URL o clave no válidas'); } wr(CK, cfg); msg(''); draw(); });
    on('sCfg', () => { cfg = null; wr(CK, null); draw(); });
    const login = async up => {
      try {
        msg('…'); const body = { email: $('#sMail').value.trim(), password: $('#sPass').value };
        const d = await authCall(up ? 'signup' : 'token?grant_type=password', body);
        if (!setSession(d)) return msg('Cuenta creada. Confirma tu correo y luego pulsa Entrar.');
        notes.forEach(n => dirtySet.add(n.id)); tombs.forEach(n => dirtySet.add(n.id)); wr(DK, [...dirtySet]); cursor = 0; wr(RK, 0);
        msg(''); draw(); run();
      } catch (e) { msg(e.message); }
    };
    on('sIn', () => login(false)); on('sUp', () => login(true));
    on('sNow', () => { msg(''); run().then(draw); });
    on('sOut', () => { sess = null; wr(SK, null); say('desactivada'); draw(); });
    on('sLink', async () => {
      const u = location.origin + location.pathname + '#cfg=' + encodeURIComponent(btoa(JSON.stringify(cfg)));
      try { await navigator.clipboard.writeText(u); msg('Enlace copiado (contiene la clave pública del proyecto, no tu contraseña).'); } catch { prompt('Copia este enlace:', u); }
    });
  }
  $('#syncBtn').onclick = () => { msg(''); draw(); $('#syncDlg').showModal(); };

  say(sess ? 'conectando…' : cfg ? 'sin sesión' : 'desactivada');
  addEventListener('online', () => run());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) run(); });
  setInterval(() => { if (!document.hidden) run(); }, 60000);
  if (cfg && !sess) { draw(); $('#syncDlg').showModal(); } // enlace de configuración recién abierto
  schedule(300);
  return { dirty, run };
})();
