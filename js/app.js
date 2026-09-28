// Vinculum — lógica del sitio.
// No hace falta tocar este archivo para publicar capítulos: todo sale de
// data/site.json, data/chapters.json y chapters/<idioma>/*.md

import { renderMarkdown, countWords } from './markdown.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const LAYOUTS = ['a', 'b', 'c'];            // patrón visual de las tarjetas
const SPEED = 20;                           // px/s — "cámara lenta"
const WORDS_PER_MINUTE = 200;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

const state = {
  site: null,
  chapters: [],
  lang: 'es',
  md: new Map(),        // cache de textos: "ruta" -> string | null
  current: null,        // capítulo abierto
  pushed: false,        // si abrimos el lector agregando una entrada al historial
  lastFocus: null,
  loadSeq: 0,
  preview: false,       // ?preview en la URL
};

// ---------------------------------------------------------------------------
// Utilidades

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* sin storage */ } },
};

async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res.json();
}

async function getText(url) {
  if (!url) return null;
  if (state.md.has(url)) return state.md.get(url);
  let text = null;
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (res.ok) text = await res.text();
  } catch { /* offline o ruta rota */ }
  state.md.set(url, text);
  return text;
}

const pad = (n) => String(n).padStart(2, '0');

function pick(obj, lang = state.lang) {
  if (obj == null) return '';
  if (typeof obj === 'string') return obj;
  return obj[lang] ?? obj[state.site.defaultLang] ?? Object.values(obj)[0] ?? '';
}

const ui = (key) => pick(state.site.ui)[key] ?? key;

function parseDate(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

const fmt = {
  short: (iso) => new Intl.DateTimeFormat(state.lang, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(parseDate(iso)),
  long: (iso) => new Intl.DateTimeFormat(state.lang, { day: 'numeric', month: 'long', year: 'numeric' }).format(parseDate(iso)),
  month: (iso) => new Intl.DateTimeFormat(state.lang, { month: 'long', year: 'numeric' }).format(parseDate(iso)),
};

// Estado de publicación según la fecha (medianoche local de cada lector)
const DAY = 86400000;
function todayLocal() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
const daysSince = (iso) => Math.round((todayLocal() - parseDate(iso)) / DAY);
// En ?preview todo se trata como publicado (drafts y fechas futuras incluidos).
const isReleased = (ch) => state.preview || daysSince(ch.date) >= 0;  // date <= hoy
const isNew = (ch) => {                                              // últimos 7 días
  const d = daysSince(ch.date);
  return d < 7 && (d >= 0 || state.preview);
};

const isVideo = (src) => /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i.test(src || '');

function minutesFor(ch) {
  if (ch.minutes) return ch.minutes;
  const text = state.md.get(ch.file?.[state.lang]);
  return text ? Math.max(1, Math.round(countWords(text) / WORDS_PER_MINUTE)) : null;
}

// ---------------------------------------------------------------------------
// Medios (imagen o video)

const videoObserver = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
      for (const e of entries) {
        const v = e.target;
        if (e.isIntersecting && !document.body.classList.contains('is-reading')) v.play().catch(() => {});
        else v.pause();
      }
    }, { threshold: 0.05 })
  : null;

function createMedia(ch, { eager = false, autoplay = true } = {}) {
  const box = document.createElement('div');
  box.className = 'media';
  box.dataset.num = pad(ch.number);
  const src = ch.cover;

  if (!src) { box.classList.add('is-empty'); return box; }

  let el;
  if (isVideo(src)) {
    el = document.createElement('video');
    el.muted = true; el.loop = true; el.playsInline = true;
    el.setAttribute('muted', ''); el.setAttribute('playsinline', '');
    el.preload = 'metadata';
    if (ch.poster) el.poster = ch.poster;
    el.src = src;
    if (autoplay) {
      if (videoObserver) videoObserver.observe(el);
      else el.autoplay = true;
    }
  } else {
    el = new Image();
    el.src = src;
    el.alt = '';
    el.decoding = 'async';
    el.loading = eager ? 'eager' : 'lazy';
    el.draggable = false;
  }
  el.addEventListener('error', () => {
    // Si el video no se puede reproducir, usar el poster; si no hay, el número.
    if (el.tagName === 'VIDEO' && ch.poster) {
      videoObserver?.unobserve(el);
      const img = new Image();
      img.src = ch.poster; img.alt = ''; img.draggable = false;
      el.replaceWith(img);
    } else {
      el.remove();
      box.classList.add('is-empty');
    }
  }, { once: true });
  box.append(el);
  return box;
}

// ---------------------------------------------------------------------------
// Idioma

function initialLang() {
  const langs = state.site.languages;
  const fromHash = location.hash.match(/^#\/([a-z]{2})\//)?.[1];
  if (langs.includes(fromHash)) return fromHash;
  const saved = store.get('vinculum-lang');
  if (langs.includes(saved)) return saved;
  const nav = (navigator.language || '').slice(0, 2);
  return langs.includes(nav) ? nav : state.site.defaultLang;
}

function setLang(lang) {
  if (lang === state.lang || !state.site.languages.includes(lang)) return;
  state.lang = lang;
  store.set('vinculum-lang', lang);
  applyLang();
  if (state.current) {
    history.replaceState(history.state, '', `#/${lang}/${state.current.id}`);
    renderReader(state.current, { keepScroll: true });
  }
  refreshMinutes();
}

// ---------------------------------------------------------------------------
// Tema claro / oscuro

function currentTheme() {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  store.set('vinculum-theme', theme);
  applyTheme();
}

function applyTheme() {
  const dark = currentTheme() === 'dark';
  $('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0a0a0a' : '#f2f0eb');
  $$('[data-theme-toggle]').forEach((b) => {
    const label = ui(dark ? 'themeLight' : 'themeDark');
    b.setAttribute('aria-label', label);
    b.title = label;
    b.setAttribute('aria-pressed', String(dark));
  });
}

function applyLang() {
  document.documentElement.lang = state.lang;
  document.title = `${state.site.title} — ${state.site.author}`;
  $('meta[name="description"]')?.setAttribute('content', pick(state.site.description));

  $$('[data-lang-switch]').forEach((group) => {
    group.setAttribute('aria-label', ui('langLabel'));
    $$('button', group).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === state.lang)));
  });
  $$('[data-ui]').forEach((el) => { el.textContent = ui(el.dataset.ui); });
  $$('[data-site]').forEach((el) => { el.textContent = state.site[el.dataset.site]; });
  $('#rail').setAttribute('aria-label', ui('chaptersLabel'));

  $$('.card').forEach((card) => fillCard(card, byId(card.dataset.id)));
  renderIssue();
  applyTheme();
}

// ---------------------------------------------------------------------------
// Índice / carrusel

const byId = (id) => state.chapters.find((c) => c.id === id);

function cardCaption(ch) {
  const title = pick(ch.title);
  const summary = pick(ch.summary);
  return `${ui('chapter')} ${pad(ch.number)}: ${title}${summary ? ` — ${summary}` : ''}`;
}

function fillCard(card, ch) {
  if (!ch) return;
  const pill = $('.pill', card);
  if (pill) pill.textContent = ui('new');

  if (!isReleased(ch)) {
    // Próximamente: número, título y fecha de salida. Sin resumen ni minutos.
    $('.caption', card).textContent = `${ui('chapter')} ${pad(ch.number)}: ${pick(ch.title)}`;
    $('.meta', card).innerHTML = `<span>${ui('availableOn')}</span><span>${fmt.short(ch.date)}</span>`;
    card.setAttribute('aria-label',
      `${ui('chapter')} ${ch.number}: ${pick(ch.title)} — ${ui('availableOn')} ${fmt.long(ch.date)}`);
    return;
  }

  $('.caption', card).textContent = cardCaption(ch);
  const min = minutesFor(ch);
  $('.meta', card).innerHTML =
    `<span>${fmt.short(ch.date)}</span><span>${min ? `${min} ${ui('minutes')}` : '&nbsp;'}</span>`;
  card.setAttribute('aria-label',
    `${ui('chapter')} ${ch.number}: ${pick(ch.title)}${isNew(ch) ? ` — ${ui('new')}` : ''}`);
}

// Recuadro vacío con el número en gótica (capítulos que todavía no salieron)
function emptyMedia(ch) {
  const box = document.createElement('div');
  box.className = 'media is-empty';
  box.dataset.num = pad(ch.number);
  return box;
}

function makeCard(ch, index) {
  const layout = ch.layout && LAYOUTS.includes(ch.layout) ? ch.layout : LAYOUTS[index % LAYOUTS.length];
  const card = document.createElement('button');
  card.type = 'button';
  card.className = `card card--${layout}`;
  card.dataset.id = ch.id;

  const released = isReleased(ch);
  if (!released) {
    card.classList.add('card--soon');
    card.setAttribute('aria-disabled', 'true');
  }

  const media = released ? createMedia(ch, { eager: index < 4 }) : emptyMedia(ch);
  if (released && isNew(ch)) {
    const pill = document.createElement('span');
    pill.className = 'pill';
    media.append(pill);
  }
  const caption = document.createElement('p');
  caption.className = 'caption';
  const meta = document.createElement('p');
  meta.className = 'meta';

  if (layout === 'b') {
    const foot = document.createElement('div');
    foot.className = 'foot';
    foot.append(caption, meta);
    card.append(media, foot);
  } else {
    card.append(media, caption, meta);
  }
  fillCard(card, ch);
  return card;
}

function renderIssue() {
  // Último capítulo publicado: el de número más alto con fecha <= hoy (sin drafts)
  const latest = state.chapters.filter(isReleased).pop();
  if (!latest) { $('#issue').textContent = ''; return; }
  $('#issue').innerHTML = [
    `${ui('chapter')} Nº${pad(latest.number)} · ${state.site.title}`,
    state.site.author,
    fmt.month(latest.date),
  ].map((t) => `<span>${t}</span>`).join('');
}

const rail = {
  el: null, track: null,
  offset: 0, vel: 0, setWidth: 0,
  hover: false, focus: false, dragging: false,
  drag: null, suppressClick: false, last: 0,

  init() {
    this.el = $('#rail');
    this.track = $('#track');
    this.build();

    this.el.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') this.hover = true; });
    this.el.addEventListener('pointerleave', () => { this.hover = false; });
    this.el.addEventListener('pointerdown', (e) => this.onDown(e));
    window.addEventListener('pointermove', (e) => this.onMove(e));
    window.addEventListener('pointerup', (e) => this.onUp(e));
    window.addEventListener('pointercancel', (e) => this.onUp(e));
    this.el.addEventListener('wheel', (e) => {
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      this.offset += d * 0.9;
      e.preventDefault();
    }, { passive: false });

    this.track.addEventListener('click', (e) => {
      const card = e.target.closest('.card');
      if (!card || card.getAttribute('aria-disabled') === 'true') return;
      if (this.suppressClick) { e.preventDefault(); return; }
      state.lastFocus = card;
      openChapter(card.dataset.id);
    });

    this.track.addEventListener('focusin', (e) => {
      const card = e.target.closest('.card');
      this.focus = true;
      if (!card) return;
      const left = card.offsetLeft;
      const right = left + card.offsetWidth;
      const view = this.el.clientWidth;
      const pos = ((this.offset % this.setWidth) + this.setWidth) % this.setWidth;
      if (left < pos || right > pos + view) this.offset = left - parseFloat(getComputedStyle(this.el).paddingLeft || 0) - 20;
    });
    this.track.addEventListener('focusout', () => { this.focus = false; });

    let t;
    window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => this.layoutClones(), 150); });
    document.fonts?.ready.then(() => this.layoutClones());

    this.last = performance.now();
    requestAnimationFrame((now) => this.tick(now));
  },

  build() {
    this.track.innerHTML = '';
    state.chapters.forEach((ch, i) => this.track.append(makeCard(ch, i)));
    this.layoutClones();
  },

  // Ajusta la altura del carrusel al espacio libre entre la barra y el wordmark.
  fit() {
    const top = $('.topbar').offsetHeight;
    const mast = $('.masthead').offsetHeight;
    const breathing = innerWidth < 640 ? 18 : 28;
    const avail = innerHeight - top - mast - breathing;
    const h = Math.round(Math.max(240, Math.min(avail, 760)));
    document.documentElement.style.setProperty('--rail-h', `${h}px`);
  },

  layoutClones() {
    this.fit();
    $$('.card[data-clone]', this.track).forEach((c) => c.remove());
    const originals = $$('.card', this.track);
    if (!originals.length) return;
    const gap = parseFloat(getComputedStyle(this.track).columnGap) || 0;
    const first = originals[0];
    const last = originals[originals.length - 1];
    this.setWidth = last.offsetLeft + last.offsetWidth + gap - first.offsetLeft;
    const reps = Math.ceil(this.el.clientWidth / this.setWidth) + 1;
    for (let r = 0; r < reps; r++) {
      originals.forEach((card, i) => {
        const clone = makeCard(byId(card.dataset.id), i);
        clone.dataset.clone = '';
        clone.tabIndex = -1;
        clone.setAttribute('aria-hidden', 'true');
        this.track.append(clone);
      });
    }
  },

  onDown(e) {
    if (e.button !== 0) return;
    this.drag = { x: e.clientX, start: this.offset, moved: false, lastX: e.clientX, lastT: performance.now(), v: 0 };
  },

  onMove(e) {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true;
      this.dragging = true;
      this.el.classList.add('is-dragging');
    }
    if (d.moved) {
      const now = performance.now();
      const dt = Math.max(1, now - d.lastT) / 1000;
      d.v = -(e.clientX - d.lastX) / dt;
      d.lastX = e.clientX; d.lastT = now;
      this.offset = d.start - dx;
    }
  },

  onUp() {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.moved) {
      this.vel = Math.max(-2500, Math.min(2500, d.v));
      this.suppressClick = true;
      setTimeout(() => { this.suppressClick = false; }, 0);
    }
    this.dragging = false;
    this.el.classList.remove('is-dragging');
  },

  tick(now) {
    const dt = Math.min(0.064, (now - this.last) / 1000);
    this.last = now;
    const paused = this.hover || this.focus || this.dragging || state.current || document.hidden || reduceMotion;
    const target = paused ? 0 : SPEED;
    this.vel += (target - this.vel) * Math.min(1, dt * 2.2);
    if (!this.dragging) this.offset += this.vel * dt;
    if (this.setWidth > 0) this.offset = ((this.offset % this.setWidth) + this.setWidth) % this.setWidth;
    this.track.style.transform = `translate3d(${-this.offset.toFixed(2)}px,0,0)`;
    requestAnimationFrame((n) => this.tick(n));
  },
};

// Calcula minutos de lectura en segundo plano (y los muestra en las tarjetas)
async function refreshMinutes() {
  const lang = state.lang;
  for (const ch of state.chapters) {
    if (ch.minutes || !isReleased(ch)) continue;
    await getText(ch.file?.[lang]);
    if (lang !== state.lang) return;
    $$(`.card[data-id="${ch.id}"]`).forEach((card) => fillCard(card, ch));
  }
}

// ---------------------------------------------------------------------------
// Lector

const reader = {
  el: null, scroller: null,
  init() {
    this.el = $('#reader');
    this.scroller = $('#reader-scroll');
    $('#back').addEventListener('click', closeReader);
    this.scroller.addEventListener('scroll', () => this.progress(), { passive: true });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && state.current) closeReader();
    });
    this.el.addEventListener('keydown', (e) => this.trapFocus(e));
  },
  progress() {
    const s = this.scroller;
    const max = s.scrollHeight - s.clientHeight;
    $('#progress').style.transform = `scaleX(${max > 0 ? Math.min(1, s.scrollTop / max) : 0})`;
  },
  show() {
    if (!this.el.hidden && this.el.classList.contains('is-open')) return;
    clearTimeout(this.hideTimer);
    this.el.hidden = false;
    document.body.classList.add('is-reading');
    $$('.rail video').forEach((v) => v.pause());
    requestAnimationFrame(() => requestAnimationFrame(() => this.el.classList.add('is-open')));
    $('#back').focus({ preventScroll: true });
  },
  hide() {
    this.el.classList.remove('is-open');
    document.body.classList.remove('is-reading');
    this.hideTimer = setTimeout(() => {
      this.el.hidden = true;
      $('#hero-media').innerHTML = '';
      $('#prose').innerHTML = '';
      $('#reader-end').innerHTML = '';
    }, reduceMotion ? 0 : 850);
    // reanudar videos visibles del carrusel
    $$('.rail video').forEach((v) => { videoObserver?.unobserve(v); videoObserver?.observe(v); });
  },
  trapFocus(e) {
    if (e.key !== 'Tab') return;
    const f = $$('button, a[href], [tabindex]:not([tabindex="-1"])', this.el).filter((x) => x.offsetParent !== null);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { last.focus(); e.preventDefault(); }
    else if (!e.shiftKey && document.activeElement === last) { first.focus(); e.preventDefault(); }
  },
};

function openChapter(id) {
  state.pushed = true;
  location.hash = `#/${state.lang}/${id}`;
}

function closeReader() {
  if (!state.current) return;
  if (state.pushed) {
    history.back();
  } else {
    history.replaceState(null, '', location.pathname + location.search);
    route();
  }
}

function goTo(id) {
  history.replaceState(history.state, '', `#/${state.lang}/${id}`);
  route();
}

function route() {
  const m = location.hash.match(/^#\/([a-z]{2})\/([\w-]+)\/?$/);
  if (m) {
    const [, lang, id] = m;
    if (state.site.languages.includes(lang) && lang !== state.lang) {
      state.lang = lang;
      store.set('vinculum-lang', lang);
      applyLang();
      refreshMinutes();
    }
    const ch = byId(id);
    if (!ch || !isReleased(ch)) { history.replaceState(null, '', location.pathname); return route(); }
    if (state.current?.id !== ch.id) renderReader(ch);
    reader.show();
  } else if (state.current) {
    state.current = null;
    state.pushed = false;
    reader.hide();
    state.lastFocus?.isConnected && state.lastFocus.focus({ preventScroll: true });
  }
}

async function renderReader(ch, { keepScroll = false } = {}) {
  state.current = ch;
  const seq = ++state.loadSeq;
  const scroller = reader.scroller;
  const ratio = keepScroll ? scroller.scrollTop / Math.max(1, scroller.scrollHeight - scroller.clientHeight) : 0;

  const title = pick(ch.title);
  $('#crumb').textContent = `${state.site.title} · ${ui('chapter')} ${pad(ch.number)}`;
  $('#reader-title').textContent = title;
  const kicker = () => {
    const min = minutesFor(ch);
    $('#kicker').textContent = [`${ui('chapter')} ${pad(ch.number)}`, fmt.long(ch.date), min && `${min} ${ui('minutes')}`]
      .filter(Boolean).join('  ·  ');
  };
  kicker();

  if (!keepScroll) {
    const hero = $('#hero-media');
    hero.innerHTML = '';
    const media = createMedia(ch, { eager: true, autoplay: false });
    const v = $('video', media);
    if (v) { v.autoplay = true; v.play?.().catch(() => {}); }
    hero.append(...media.childNodes);
    scroller.scrollTop = 0;
    reader.progress();
  }

  const prose = $('#prose');
  if (!keepScroll) prose.innerHTML = `<p class="status">${ui('loading')}</p>`;
  $('#reader-end').innerHTML = '';

  // Texto en el idioma elegido; si falta, en el otro idioma con aviso.
  let used = state.lang;
  let text = await getText(ch.file?.[state.lang]);
  if (text == null) {
    const other = state.site.languages.find((l) => l !== state.lang && ch.file?.[l]);
    if (other) { text = await getText(ch.file[other]); used = other; }
  }
  if (seq !== state.loadSeq) return;

  if (text == null) {
    prose.innerHTML = `<p class="notice">${ui('error')}</p>`;
  } else {
    prose.innerHTML = (used !== state.lang ? `<p class="notice">${ui('fallback')}</p>` : '') + renderMarkdown(text);
    const firstP = $$('p', prose).find((p) =>
      !p.classList.contains('notice') && !p.closest('blockquote') && p.firstChild?.nodeName !== 'EM');
    if (firstP && /^[A-Za-zÀ-ÿ]/.test(firstP.textContent.trim())) {
      firstP.classList.add('dropcap');
    }
  }
  kicker();
  renderEnd(ch);

  if (keepScroll) {
    requestAnimationFrame(() => {
      scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight);
      reader.progress();
    });
  }
}

function renderEnd(ch) {
  const end = $('#reader-end');
  const idx = state.chapters.indexOf(ch);
  const next = state.chapters[idx + 1];
  end.innerHTML = '<span class="rule" aria-hidden="true">✠</span>';

  if (next && !isReleased(next)) {
    // El siguiente todavía no salió: en gris y sin clic, con la fecha.
    const soon = document.createElement('div');
    soon.className = 'next is-soon';
    soon.setAttribute('aria-disabled', 'true');
    const text = document.createElement('span');
    text.innerHTML = `<span class="next-label">${ui('soon')} · ${fmt.short(next.date)}</span><span class="next-title"></span>`;
    $('.next-title', text).textContent = pick(next.title);
    soon.append(emptyMedia(next), text);
    end.append(soon);
  } else if (next) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'next';
    const text = document.createElement('span');
    text.innerHTML = `<span class="next-label">${ui('next')} · ${pad(next.number)}</span><span class="next-title"></span>`;
    $('.next-title', text).textContent = pick(next.title);
    const arrow = document.createElement('span');
    arrow.className = 'next-arrow';
    arrow.setAttribute('aria-hidden', 'true');
    arrow.textContent = '→';
    btn.append(createMedia(next, { autoplay: false }), text, arrow);
    btn.addEventListener('click', () => goTo(next.id));
    end.append(btn);
  } else {
    const note = document.createElement('div');
    note.className = 'end-note';
    note.innerHTML = `<strong>${ui('end')}</strong><p>${ui('endHint')}</p>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn-line';
    btn.textContent = ui('toIndex');
    btn.addEventListener('click', closeReader);
    note.append(btn);
    end.append(note);
  }
}

// ---------------------------------------------------------------------------
// Arranque

async function boot() {
  const [site, data] = await Promise.all([getJSON('data/site.json'), getJSON('data/chapters.json')]);
  state.site = site;
  // ?preview en la URL: se ve todo como si ya estuviera publicado
  // (capítulos en draft y con fecha futura incluidos).
  state.preview = new URLSearchParams(location.search).has('preview');
  state.chapters = (data.chapters || [])
    .filter((c) => state.preview || !c.draft)
    .sort((a, b) => a.number - b.number);
  if (state.preview) {
    const badge = document.createElement('span');
    badge.className = 'preview-badge';
    badge.dataset.ui = 'preview';
    $('.brand').after(badge);
  }
  state.lang = initialLang();

  $$('[data-lang-switch] button').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));
  $$('[data-theme-toggle]').forEach((b) => b.addEventListener('click', () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark')));

  rail.init();
  reader.init();
  applyLang();
  window.addEventListener('hashchange', route);
  route();
  refreshMinutes();
}

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend',
    '<p class="noscript">No se pudo cargar el contenido. Si abriste el archivo directo, serví la carpeta con un servidor local (ver README).</p>');
});
