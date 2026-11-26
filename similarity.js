'use strict';
/* Similitud entre notas: BM25 sobre raíces + bigramas + vecinos en común del grafo. Sin dependencias. */
var Similarity = (() => {
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const STOP = new Set(('para como pero esto esta este estos estas esas esos eso cuando donde entre sobre desde hasta porque tambien segun cada todo toda todos todas otro otra otros otras mismo misma muy mas menos sido ser estar esta estan tiene tienen hacer hace hacen puede pueden cual cuales quien quienes algo asi aqui alli ahi cual cuyo cuya ante bajo cabe con contra del los las una unos unas por que son fue era eran sera seran sus sin les nos como entonces ademas aunque mientras durante despues antes luego tras segun hacia vez veces solo sola cosa cosas parte partes forma tipo tipos ver ejemplo ' +
    'with that this from have there their they what when which will would your about into than then them these those been being were also more some such only other over just like each very much many most both after before while where here does done make made using used use can could should may might our out its are the and for not but you all any had has his her she him who how why').split(' '));
  // sufijos del español/inglés, de más largo a más corto (sobre texto sin tildes)
  const SUF = ['amientos', 'imientos', 'amiento', 'imiento', 'aciones', 'iciones', 'uciones', 'acion', 'icion', 'ucion', 'adoras', 'adores', 'adora', 'ador', 'idades', 'idad', 'mente', 'ables', 'ibles', 'able', 'ible', 'ando', 'iendo', 'ismos', 'ismo', 'istas', 'ista', 'icas', 'icos', 'ica', 'ico', 'ivas', 'ivos', 'iva', 'ivo', 'osas', 'osos', 'osa', 'oso', 'adas', 'ados', 'idas', 'idos', 'ada', 'ado', 'ida', 'ido', 'ings', 'ing', 'ies', 'ed', 'es', 's'];
  function stem(w) {
    for (const s of SUF) if (w.length - s.length >= 4 && w.endsWith(s)) { w = w.slice(0, -s.length); break; }
    return w.length > 4 && /[aeo]$/.test(w) ? w.slice(0, -1) : w;
  }
  const clean = t => t.replace(/```[\s\S]*?```/g, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/\[\[|\]\]/g, ' ').replace(/#(?=[\p{L}])/gu, ' ');

  // -> { tf: Map(token -> peso), len, surface: Map(raíz -> forma más usada) }
  function analyzeDoc(n, surface) {
    const tf = new Map(); let len = 0;
    const add = (tok, w) => { tf.set(tok, (tf.get(tok) || 0) + w); };
    const run = (text, w, bigrams) => {
      for (const sentence of norm(clean(text)).split(/[.!?;:\n]+/)) {
        let prev = null;
        for (const raw of sentence.match(/[\p{L}\p{N}]{3,}/gu) || []) {
          if (STOP.has(raw)) { prev = null; continue; }
          const st = stem(raw); if (st.length < 3) { prev = null; continue; }
          add(st, w); len += w;
          const sf = surface.get(st) || new Map(); sf.set(raw, (sf.get(raw) || 0) + 1); surface.set(st, sf);
          if (bigrams && prev) add(prev + '_' + st, w * 1.5);
          prev = st;
        }
      }
    };
    run(n.title, 3, true); run(n.body, 1, true);
    return { tf, len: len || 1 };
  }

  /** items: [{id,title,body}], neighbors: Map(id -> Set(claves de vecinos: ids o 'tag:x'; las etiquetas suman pero no bastan solas)), label(key) -> texto
   *  devuelve Map(id -> [{id, score, terms, via}]) ordenado por score */
  function compute(items, neighbors, label = k => k, min = 0.045) {
    const N = items.length, surface = new Map(), out = new Map(items.map(n => [n.id, []]));
    if (N < 2) return out;
    const docs = items.map(n => analyzeDoc(n, surface));
    const avg = docs.reduce((s, d) => s + d.len, 0) / N, df = new Map();
    docs.forEach(d => d.tf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1)));
    const idf = w => Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
    const vecs = docs.map(d => {
      const v = new Map(); let s = 0;
      d.tf.forEach((c, w) => { const x = idf(w) * (c * 2.2) / (c + 1.2 * (0.25 + 0.75 * d.len / avg)); v.set(w, x); s += x * x; });
      s = Math.sqrt(s) || 1; v.forEach((x, w) => v.set(w, x / s)); return v;
    });
    const show = st => { const m = surface.get(st); return m ? [...m].sort((a, b) => b[1] - a[1])[0][0] : st; };
    // grado de cada vecino (para Adamic-Adar: los vecinos muy populares aportan menos)
    const deg = new Map(); neighbors.forEach(set => set.forEach(k => deg.set(k, (deg.get(k) || 0) + 1)));
    for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
      let dot = 0; const shared = [];
      vecs[i].forEach((x, w) => { const y = vecs[j].get(w); if (y) { dot += x * y; shared.push([w, x * y]); } });
      let aa = 0, linkVia = false; const via = [];
      const ni = neighbors.get(items[i].id), nj = neighbors.get(items[j].id);
      if (ni && nj) ni.forEach(k => { if (nj.has(k)) { aa += 1 / Math.log(2 + deg.get(k)); via.push(label(k)); if (!k.startsWith('tag:')) linkVia = true; } });
      const graph = Math.min(1, aa / 1.5);
      const score = 0.75 * dot + 0.25 * graph;
      const nTerms = shared.filter(s => !s[0].includes('_')).length;
      if (score < min || (nTerms < 2 && !linkVia)) continue;
      const terms = shared.sort((a, b) => b[1] - a[1]).slice(0, 4).map(([w]) => w.split('_').map(show).join(' '));
      out.get(items[i].id).push({ id: items[j].id, score, terms, via });
      out.get(items[j].id).push({ id: items[i].id, score, terms, via });
    }
    out.forEach(l => l.sort((a, b) => b.score - a.score));
    return out;
  }
  return { compute, stem };
})();
if (typeof module !== 'undefined') module.exports = Similarity;
