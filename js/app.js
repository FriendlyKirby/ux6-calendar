(() => {
  "use strict";

  const D = window.DEMO_DATA;
  const STORE_KEY = "ux6-demo-v1";
  const CAL_START = 8 * 60;   // week view starts 8:00 AM
  const CAL_END = 23 * 60;    // and ends 11:00 PM

  /* ---------- small helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
  const byId = (list) => Object.fromEntries(list.map((x) => [x.id, x]));

  /* ---------- dates ---------- */
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
  const startOfWeek = (d) => addDays(startOfDay(d), -d.getDay());
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const toMin = (t) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
  const dayDiff = (a, b) => Math.round((startOfDay(a) - startOfDay(b)) / 864e5);
  const fmtDate = (d, o) => d.toLocaleDateString("en-US", o);
  const nowMin = () => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); };

  function fmtClock(min, withSuffix = true) {
    const h = Math.floor(min / 60), m = min % 60;
    const h12 = ((h + 11) % 12) + 1;
    const s = m ? `${h12}:${String(m).padStart(2, "0")}` : `${h12}`;
    return withSuffix ? `${s} ${h < 12 ? "AM" : "PM"}` : s;
  }
  function fmtRange(a, b) {
    const sameHalf = (a < 720) === (b < 720);
    return sameHalf ? `${fmtClock(a, false)}–${fmtClock(b)}` : `${fmtClock(a)}–${fmtClock(b)}`;
  }
  function relDay(d) {
    const n = dayDiff(d, TODAY);
    if (n === 0) return "Today";
    if (n === 1) return "Tomorrow";
    if (n === -1) return "Yesterday";
    return "";
  }

  const TODAY = startOfDay(new Date());
  const ANCHOR = startOfWeek(TODAY);

  /* ---------- data ---------- */
  const CATS = byId(D.categories);
  const FMTS = byId(D.formats);
  const INTS = byId(D.interests);
  const CLUBS = byId(D.clubs);
  const REAL_CLUBS = D.clubs.filter((c) => !c.host).sort((a, b) => a.name.localeCompare(b.name));

  const EVENTS = D.events.map((e) => {
    const date = addDays(ANCHOR, e.d);
    return {
      ...e,
      date,
      start: toMin(e.s),
      end: toMin(e.e),
      host: e.club === "ams" ? "ams" : "club",
      cat: e.cat || CLUBS[e.club].cat,
      deadlineDate: e.reg && e.reg.deadline != null ? addDays(ANCHOR, e.reg.deadline) : null,
    };
  }).sort((a, b) => a.date - b.date || a.start - b.start);
  const EV = byId(EVENTS);

  const isPast = (e) => e.date < TODAY || (sameDay(e.date, TODAY) && e.end <= nowMin());
  const upcomingFor = (clubId) => EVENTS.filter((e) => e.club === clubId && !isPast(e));

  /* ---------- search (keyword + synonyms + typo tolerance) ---------- */
  const norm = (s) => String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1);

  const SYN = new Map();
  for (const group of D.synonyms) for (const w of group) SYN.set(w, [...new Set([...(SYN.get(w) || []), ...group.filter((x) => x !== w)])]);

  function lev(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      let rowBest = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        if (cur[j] < rowBest) rowBest = cur[j];
      }
      if (rowBest > max) return max + 1;
      prev = cur;
    }
    return prev[b.length];
  }

  /** Every query word must match the item: exactly, as a prefix, via a related word, or within 1-2 typos. */
  function matchQuery(index, q) {
    const qt = tokens(q);
    if (!qt.length) return { hit: true, score: 0, fuzzy: [] };
    let score = 0;
    const fuzzy = [];
    for (const t of qt) {
      const related = SYN.get(t) || [];
      let best = 0, typoWord = null;
      for (const w of index) {
        if (w === t) best = Math.max(best, 4);
        else if (w.startsWith(t)) best = Math.max(best, 3);
        else if (related.some((r) => w === r || (r.length > 3 && w.startsWith(r)))) best = Math.max(best, 2);
        else if (t.length >= 4 && best < 1) {
          const max = t.length >= 7 ? 2 : 1;
          if (lev(t, w, max) <= max) { best = 1; typoWord = w; }
        }
      }
      if (!best) return { hit: false, score: 0, fuzzy: [] };
      if (best === 1 && typoWord) fuzzy.push(typoWord);
      score += best;
    }
    return { hit: true, score, fuzzy };
  }

  const tagText = (tags) => tags.map((t) => (INTS[t] ? INTS[t].label : t)).join(" ");
  for (const c of D.clubs) {
    c.index = [...new Set(tokens([c.name, c.short, c.blurb, c.desc, tagText(c.tags), CATS[c.cat].label].join(" ")))];
  }
  for (const e of EVENTS) {
    const c = CLUBS[e.club];
    e.index = [...new Set(tokens([e.title, c.name, c.short, e.loc || "", e.desc, tagText(e.tags), tagText(c.tags), FMTS[e.fmt].label, CATS[e.cat].label].join(" ")))];
  }

  /* ---------- state + persistence ---------- */
  const freshEventFilters = () => ({
    q: "", when: "upcoming", from: "", to: "",
    hosts: new Set(), fmts: new Set(), cats: new Set(),
    club: "", free: false, reg: "any", newcomer: false, fits: false, sort: "soon",
  });
  const freshClubFilters = () => ({ q: "", cats: new Set(), letter: "", hasEvents: false, noFee: false, beginner: false, following: false, sort: "az" });

  function loadStored() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
  }
  const stored = loadStored();
  const S = {
    user: stored.user || null,
    saved: new Set((stored.saved || []).filter((id) => EV[id])),
    timetable: !!stored.timetable,
    interests: new Set((stored.interests || []).filter((id) => INTS[id])),
    followed: new Set((stored.followed || []).filter((id) => CLUBS[id])),
    cal: {
      view: stored.calView === "month" ? "month" : "week",
      cursor: TODAY,
      layers: Object.assign({ mine: true, classes: true, others: true }, stored.layers || {}),
    },
    ef: freshEventFilters(),
    cf: freshClubFilters(),
    filtersOpen: false,
    sheetStack: [],
  };

  function persist() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        user: S.user, saved: [...S.saved], timetable: S.timetable, interests: [...S.interests],
        followed: [...S.followed], calView: S.cal.view, layers: S.cal.layers,
      }));
    } catch { /* storage unavailable (private window etc.) — demo still works for this session */ }
  }

  /* ---------- schedule logic ---------- */
  function classesOn(date) {
    if (!S.timetable) return [];
    const wd = date.getDay();
    return D.courses.filter((c) => c.days.includes(wd)).map((c) => ({
      kind: "class", key: `${c.code}-${c.sec}`, title: `${c.code} ${c.kind}`, code: c.code, sec: c.sec,
      loc: c.loc, date, start: toMin(c.s), end: toMin(c.e),
    }));
  }
  const overlaps = (a, b) => a.start < b.end && b.start < a.end;

  /** Things on the user's schedule (classes + saved events) that overlap this event. */
  function clashesFor(e) {
    const out = [];
    for (const c of classesOn(e.date)) if (overlaps(e, c)) out.push({ label: `${c.code} ${c.title.split(" ").pop().toLowerCase()}`, start: c.start, end: c.end, kind: "class" });
    for (const id of S.saved) {
      if (id === e.id) continue;
      const o = EV[id];
      if (sameDay(o.date, e.date) && overlaps(e, o)) out.push({ label: o.title, start: o.start, end: o.end, kind: "event", id: o.id });
    }
    return out;
  }
  const clashText = (list) => list.map((c) => `${c.label} (${fmtRange(c.start, c.end)})`).join(" and ");

  function matchReasons(e) {
    const reasons = [];
    for (const t of new Set([...e.tags, ...CLUBS[e.club].tags])) if (S.interests.has(t)) reasons.push(INTS[t].label);
    if (S.followed.has(e.club)) reasons.unshift(`You follow ${CLUBS[e.club].short}`);
    return [...new Set(reasons)];
  }
  const matchScore = (e) => {
    let s = 0;
    for (const t of new Set([...e.tags, ...CLUBS[e.club].tags])) if (S.interests.has(t)) s += 2;
    if (S.followed.has(e.club)) s += 3;
    return s;
  };

  /* ---------- event filtering ---------- */
  function inWhen(e, f) {
    const n = dayDiff(e.date, TODAY);
    switch (f.when) {
      case "today": return n === 0 && !isPast(e);
      case "week": return n >= 0 && n <= 6 - TODAY.getDay() && !isPast(e);
      case "next7": return n >= 0 && n < 7 && !isPast(e);
      case "next30": return n >= 0 && n < 30 && !isPast(e);
      case "custom": {
        if (f.from && e.date < new Date(f.from + "T00:00")) return false;
        if (f.to && e.date > new Date(f.to + "T00:00")) return false;
        return true;
      }
      case "past": return isPast(e);
      default: return !isPast(e);
    }
  }

  /** skip: names of facets to ignore (used for facet counts and for the calendar layer). */
  function eventPasses(e, f, skip = {}) {
    if (!skip.when && !inWhen(e, f)) return false;
    if (!skip.hosts && f.hosts.size && !f.hosts.has(e.host)) return false;
    if (!skip.fmts && f.fmts.size && !f.fmts.has(e.fmt)) return false;
    if (!skip.cats && f.cats.size && !f.cats.has(e.cat)) return false;
    if (!skip.club && f.club && e.club !== f.club) return false;
    if (f.free && e.cost !== 0) return false;
    if (f.reg === "none" && e.reg) return false;
    if (f.reg === "required" && !e.reg) return false;
    if (f.newcomer && !e.newcomer) return false;
    if (f.fits && clashesFor(e).length) return false;
    if (!skip.q && f.q && !matchQuery(e.index, f.q).hit) return false;
    return true;
  }

  function activeEventFilterCount(f, { ignoreWhen = false } = {}) {
    let n = 0;
    if (!ignoreWhen && f.when !== "upcoming") n++;
    n += f.hosts.size + f.fmts.size + f.cats.size;
    if (f.club) n++;
    if (f.free) n++;
    if (f.reg !== "any") n++;
    if (f.newcomer) n++;
    if (f.fits) n++;
    if (f.q.trim()) n++;
    return n;
  }

  /* ---------- club filtering ---------- */
  function clubPasses(c, f, skip = {}) {
    if (!skip.cats && f.cats.size && !f.cats.has(c.cat)) return false;
    if (!skip.letter && f.letter && c.name[0].toUpperCase() !== f.letter) return false;
    if (f.hasEvents && !upcomingFor(c.id).length) return false;
    if (f.noFee && c.fee !== 0) return false;
    if (f.beginner && !c.beginner) return false;
    if (f.following && !S.followed.has(c.id)) return false;
    if (f.q && !matchQuery(c.index, f.q).hit) return false;
    return true;
  }

  /* ---------- generated artwork (no stock photos) ---------- */
  function hash(str) { let h = 2166136261; for (const ch of str) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
  function rng(seed) { let s = seed || 1; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822519) ^ Math.imul(s ^ (s >>> 13), 3266489917)) >>> 0) / 4294967296; }

  /** A small poster-like SVG for an event or club, coloured by category, patterned by format. */
  function art(seedStr, cat, pattern, label, w = 320, h = 180) {
    const r = rng(hash(seedStr));
    const fill = `var(--cat-${cat})`;
    const ink = "var(--art-ink)";
    let shapes = "";
    switch (pattern) {
      case "workshop": { // grid of squares
        const n = 6 + Math.floor(r() * 4), size = w / n;
        for (let i = 0; i < n; i++) for (let j = 0; j < Math.ceil(h / size); j++) if (r() > 0.55) shapes += `<rect x="${i * size + 3}" y="${j * size + 3}" width="${size - 6}" height="${size - 6}" />`;
        break;
      }
      case "social": { // scattered dots
        for (let i = 0; i < 22; i++) shapes += `<circle cx="${(r() * w).toFixed(1)}" cy="${(r() * h).toFixed(1)}" r="${(4 + r() * 22).toFixed(1)}" />`;
        break;
      }
      case "talk": { // horizontal bars
        for (let y = 12; y < h; y += 18) shapes += `<rect x="${(r() * 40).toFixed(1)}" y="${y}" width="${(w * (0.3 + r() * 0.6)).toFixed(1)}" height="8" />`;
        break;
      }
      case "competition": { // diagonal stripes
        for (let x = -h; x < w; x += 26) shapes += `<path d="M${x} ${h} L${x + h} 0 L${x + h + 11} 0 L${x + 11} ${h} Z" />`;
        break;
      }
      case "performance": { // concentric arcs
        const cx = w * (0.2 + r() * 0.6), cy = h * 1.05;
        for (let rad = 20; rad < w; rad += 22) shapes += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad}" fill="none" stroke-width="7" />`;
        break;
      }
      case "sport": { // waves
        for (let y = 20; y < h + 20; y += 24) {
          let d = `M0 ${y}`;
          for (let x = 0; x <= w; x += 40) d += ` Q${x + 20} ${y - 12 - r() * 6} ${x + 40} ${y}`;
          shapes += `<path d="${d}" fill="none" stroke-width="6" />`;
        }
        break;
      }
      case "info": { // one big half circle + small one
        shapes += `<circle cx="${(w * (0.55 + r() * 0.3)).toFixed(1)}" cy="${(h * 0.2).toFixed(1)}" r="${(h * 0.75).toFixed(1)}" /><circle cx="${(w * 0.18).toFixed(1)}" cy="${(h * 0.78).toFixed(1)}" r="${(h * 0.14).toFixed(1)}" />`;
        break;
      }
      case "volunteer": { // plus signs
        for (let i = 0; i < 14; i++) { const x = r() * w, y = r() * h, s = 6 + r() * 10; shapes += `<path d="M${(x - s).toFixed(1)} ${y.toFixed(1)}h${(2 * s).toFixed(1)}M${x.toFixed(1)} ${(y - s).toFixed(1)}v${(2 * s).toFixed(1)}" stroke-width="6" />`; }
        break;
      }
      default: { // club banner: large rotated blocks
        for (let i = 0; i < 5; i++) shapes += `<rect x="${(r() * w).toFixed(1)}" y="${(r() * h - 40).toFixed(1)}" width="${(30 + r() * 90).toFixed(1)}" height="${(30 + r() * 90).toFixed(1)}" transform="rotate(${Math.round(r() * 40 - 20)} ${w / 2} ${h / 2})" />`;
      }
    }
    const text = label ? `<text x="14" y="${h - 16}" class="art-label">${esc(label)}</text>` : "";
    return `<svg class="art" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      <rect width="${w}" height="${h}" style="fill:${fill}" />
      <g style="fill:${ink};stroke:${ink}" class="art-shapes">${shapes}</g>${text}</svg>`;
  }

  function monogram(c) {
    return `<span class="mono cat-${c.cat}" aria-hidden="true">${esc(c.short)}</span>`;
  }

  /* ---------- tags shown on event rows/cards ---------- */
  function costText(e) {
    if (e.cost === null || e.cost === undefined) return null;
    return e.cost === 0 ? "Free" : `$${e.cost}`;
  }
  function eventTags(e, { clashes } = {}) {
    const t = [];
    t.push(`<span class="tag tag-fmt">${esc(FMTS[e.fmt].label)}</span>`);
    const cost = costText(e);
    t.push(cost ? `<span class="tag ${e.cost === 0 ? "tag-free" : "tag-cost"}">${cost}</span>` : `<span class="tag tag-missing">Cost not posted</span>`);
    if (e.reg) t.push(`<span class="tag tag-reg">Registration required</span>`);
    if (e.newcomer) t.push(`<span class="tag tag-new">Newcomer-friendly</span>`);
    if (!e.loc) t.push(`<span class="tag tag-missing">Location TBA</span>`);
    if (S.saved.has(e.id)) t.push(`<span class="tag tag-saved">In your calendar</span>`);
    const cl = clashes || clashesFor(e);
    if (cl.length && !isPast(e)) t.push(`<span class="tag tag-clash">Clashes with ${esc(cl[0].label)}${cl.length > 1 ? ` +${cl.length - 1}` : ""}</span>`);
    return t.join("");
  }

  /* ================================================================
   * Pages
   * ================================================================ */
  const view = $("#view");

  function route() {
    const raw = location.hash.replace(/^#\/?/, "");
    const [name, query] = raw.split("?");
    return { name: ["calendar", "events", "clubs", "profile"].includes(name) ? name : "calendar", params: new URLSearchParams(query || "") };
  }

  function render({ keepScroll = false } = {}) {
    const r = route();
    const y = window.scrollY;
    $$(".main-nav a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.route === r.name));
    if (r.name === "calendar") view.innerHTML = pageCalendar();
    if (r.name === "events") view.innerHTML = pageEvents();
    if (r.name === "clubs") view.innerHTML = pageClubs();
    if (r.name === "profile") view.innerHTML = pageProfile();
    renderAccount();
    document.title = { calendar: "Calendar", events: "Events", clubs: "Clubs", profile: "Profile" }[r.name] + " · (name tbd)";
    if (keepScroll) window.scrollTo(0, y);
  }

  function renderAccount() {
    const el = $("#account");
    el.innerHTML = S.user
      ? `<a class="account-chip" href="#/profile" ${route().name === "profile" ? "aria-current" : ""}><span class="avatar" aria-hidden="true">${esc(S.user.name.slice(0, 1).toUpperCase())}</span><span class="account-name">${esc(S.user.name)}</span></a>`
      : `<button type="button" class="btn btn-small" data-action="signin">Sign in</button>`;
  }

  /* ---------- Calendar ---------- */
  function calItemsFor(date) {
    const items = [];
    const L = S.cal.layers;
    if (L.classes) for (const c of classesOn(date)) items.push({ kind: "class", start: c.start, end: c.end, ref: c });
    for (const e of EVENTS) {
      if (!sameDay(e.date, date)) continue;
      if (S.saved.has(e.id)) { if (L.mine) items.push({ kind: "mine", start: e.start, end: e.end, ref: e }); }
      else if (L.others && eventPasses(e, S.ef, { when: true })) items.push({ kind: "other", start: e.start, end: e.end, ref: e });
    }
    return items;
  }

  function layoutLanes(items) {
    const sorted = items.slice().sort((a, b) => a.start - b.start || b.end - a.end);
    let group = [], groupEnd = -Infinity;
    const finish = () => {
      const lanes = [];
      for (const it of group) {
        let l = lanes.findIndex((end) => end <= it.start);
        if (l === -1) { l = lanes.length; lanes.push(it.end); } else lanes[l] = it.end;
        it.lane = l;
      }
      for (const it of group) it.lanes = lanes.length;
      group = [];
    };
    for (const it of sorted) {
      if (group.length && it.start >= groupEnd) { finish(); groupEnd = -Infinity; }
      group.push(it);
      groupEnd = Math.max(groupEnd, it.end);
    }
    if (group.length) finish();
    return sorted;
  }

  function weekSummary() {
    const start = startOfWeek(TODAY), end = addDays(start, 7);
    const mine = EVENTS.filter((e) => S.saved.has(e.id) && e.date >= start && e.date < end);
    const clashing = mine.filter((e) => clashesFor(e).length);
    if (!mine.length) return "Nothing saved this week yet.";
    return `${plural(mine.length, "saved event")} this week` + (clashing.length ? ` · <strong class="warn-text">${plural(clashing.length, "clash", "clashes")}</strong>` : " · no clashes");
  }

  function pageCalendar() {
    const c = S.cal;
    const isWeek = c.view === "week";
    const wkStart = startOfWeek(c.cursor);
    const title = isWeek
      ? (() => {
          const end = addDays(wkStart, 6);
          const sameMonth = wkStart.getMonth() === end.getMonth();
          return `${fmtDate(wkStart, { month: "short", day: "numeric" })} – ${fmtDate(end, sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}, ${end.getFullYear()}`;
        })()
      : fmtDate(c.cursor, { month: "long", year: "numeric" });
    const nFilters = activeEventFilterCount(S.ef, { ignoreWhen: true });
    const greeting = S.user ? `Hi ${esc(S.user.name)}.` : "Your week at a glance.";

    return `<section class="page page-calendar" aria-labelledby="page-title">
      <header class="page-head">
        <div>
          <p class="eyebrow">${esc(fmtDate(TODAY, { weekday: "long", month: "long", day: "numeric" }))}</p>
          <h1 id="page-title">Calendar</h1>
          <p class="page-lede">${greeting} ${weekSummary()}</p>
        </div>
      </header>
      ${!S.timetable ? `<div class="notice notice-cta">
          <p><strong>Add your classes</strong> so clashes with club events show up automatically.</p>
          <button type="button" class="btn btn-primary" data-action="import-timetable">Import timetable</button>
        </div>` : ""}
      <div class="cal-layout">
        <div class="cal-main">
          <div class="cal-toolbar">
            <div class="cal-nav">
              <button type="button" class="btn btn-icon" data-action="cal-prev" aria-label="Previous ${isWeek ? "week" : "month"}">‹</button>
              <button type="button" class="btn btn-small" data-action="cal-today">Today</button>
              <button type="button" class="btn btn-icon" data-action="cal-next" aria-label="Next ${isWeek ? "week" : "month"}">›</button>
              <h2 class="cal-title" aria-live="polite">${esc(title)}</h2>
            </div>
            <div class="seg" role="group" aria-label="Calendar view">
              <button type="button" data-action="cal-view" data-view="month" aria-pressed="${!isWeek}">Month</button>
              <button type="button" data-action="cal-view" data-view="week" aria-pressed="${isWeek}">Week</button>
            </div>
          </div>
          <div class="cal-layers" role="group" aria-label="Show on calendar">
            <label class="layer layer-mine"><input type="checkbox" data-layer="mine" ${c.layers.mine ? "checked" : ""}><span class="swatch"></span> My events</label>
            <label class="layer layer-class ${S.timetable ? "" : "is-disabled"}"><input type="checkbox" data-layer="classes" ${c.layers.classes ? "checked" : ""} ${S.timetable ? "" : "disabled"}><span class="swatch"></span> Classes</label>
            <label class="layer layer-other"><input type="checkbox" data-layer="others" ${c.layers.others ? "checked" : ""}><span class="swatch"></span> Other club events</label>
            <span class="layer-note">${nFilters ? `Other events use your <a href="#/events">Events filters (${nFilters} on)</a> · <button type="button" class="link-btn" data-action="clear-event-filters">clear</button>` : `Showing all club events · <a href="#/events">filter them</a>`}</span>
          </div>
          <div class="cal-body">${isWeek ? weekGrid(wkStart) : monthGrid(c.cursor)}</div>
        </div>
        <aside class="cal-side" aria-label="Your schedule">
          ${upNextPanel()}
          ${timetablePanel()}
          <section class="side-panel legend" aria-label="Legend">
            <h3>Key</h3>
            <ul>
              <li><span class="swatch sw-mine"></span> Saved to my calendar</li>
              <li><span class="swatch sw-class"></span> Class (from timetable)</li>
              <li><span class="swatch sw-other"></span> Other event (not saved)</li>
              <li><span class="swatch sw-clash"></span> Clashes with something</li>
            </ul>
          </section>
        </aside>
      </div>
    </section>`;
  }

  function blockHtml(it) {
    const top = (Math.max(it.start, CAL_START) - CAL_START) / 60;
    const height = Math.max((Math.min(it.end, CAL_END) - Math.max(it.start, CAL_START)) / 60, 0.42);
    const pos = `top:calc(var(--hour) * ${top.toFixed(3)});height:calc(var(--hour) * ${height.toFixed(3)} - 2px);left:calc(${it.lane} * 100% / ${it.lanes});width:calc(100% / ${it.lanes} - 3px)`;
    const short = height < 0.9;
    if (it.kind === "class") {
      const c = it.ref;
      return `<div class="blk blk-class ${short ? "is-short" : ""}" style="${pos}" title="${esc(`${c.title} ${c.sec}, ${fmtRange(c.start, c.end)}, ${c.loc}`)}">
        <span class="blk-title">${esc(c.code)} <span class="blk-sub">${esc(c.title.split(" ").pop())}</span></span>
        <span class="blk-meta">${esc(fmtRange(c.start, c.end))} · ${esc(c.loc)}</span></div>`;
    }
    const e = it.ref;
    const clash = it.kind === "mine" && clashesFor(e).length;
    const cls = ["blk", `blk-${it.kind}`, `cat-${e.cat}`, clash ? "is-clash" : "", isPast(e) ? "is-past" : "", short ? "is-short" : ""].join(" ");
    return `<button type="button" class="${cls}" style="${pos}" data-open-event="${e.id}" aria-label="${esc(`${e.title}, ${fmtRange(e.start, e.end)}${clash ? ", clashes with your schedule" : ""}`)}">
      <span class="blk-title">${esc(e.title)}</span>
      <span class="blk-meta">${esc(fmtRange(e.start, e.end))}${e.loc ? ` · ${esc(e.loc)}` : ""}</span>
      ${clash ? `<span class="blk-flag">Clash</span>` : ""}
    </button>`;
  }

  function weekGrid(start) {
    const days = Array.from({ length: 7 }, (_, i) => addDays(start, i));
    const hours = [];
    for (let m = CAL_START; m < CAL_END; m += 60) hours.push(m);
    const head = days.map((d) => `<button type="button" class="wk-head ${sameDay(d, TODAY) ? "is-today" : ""}" data-action="goto-day" data-date="${d.toISOString()}" aria-label="${esc(fmtDate(d, { weekday: "long", month: "long", day: "numeric" }))}">
        <span class="wk-dow">${fmtDate(d, { weekday: "short" })}</span><span class="wk-num"><span>${d.getDate()}</span></span></button>`).join("");
    const cols = days.map((d) => {
      const items = layoutLanes(calItemsFor(d));
      const isToday = sameDay(d, TODAY);
      const nm = nowMin();
      const nowLine = isToday && nm >= CAL_START && nm <= CAL_END ? `<div class="now-line" style="top:calc(var(--hour) * ${((nm - CAL_START) / 60).toFixed(3)})"><span class="sr-only">Now</span></div>` : "";
      return `<div class="wk-col ${isToday ? "is-today" : ""} ${d < TODAY ? "is-pastday" : ""}" aria-label="${esc(fmtDate(d, { weekday: "long" }))}">${items.map(blockHtml).join("")}${nowLine}</div>`;
    }).join("");
    return `<div class="week" style="--hours:${hours.length}">
      <div class="wk-heads"><span class="wk-corner"></span>${head}</div>
      <div class="wk-grid">
        <div class="wk-times" aria-hidden="true">${hours.map((m) => `<span>${fmtClock(m)}</span>`).join("")}</div>
        <div class="wk-cols">${cols}</div>
      </div>
    </div>`;
  }

  function monthGrid(cursor) {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const daysInMonth = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
    const weeks = Math.ceil((first.getDay() + daysInMonth) / 7);
    const gridStart = startOfWeek(first);
    const dows = Array.from({ length: 7 }, (_, i) => fmtDate(addDays(gridStart, i), { weekday: "short" }));
    const MAX = 3;
    let cells = "";
    for (let i = 0; i < weeks * 7; i++) {
      const d = addDays(gridStart, i);
      const items = calItemsFor(d).filter((it) => it.kind !== "class").sort((a, b) => (a.kind === "mine" ? -1 : 0) - (b.kind === "mine" ? -1 : 0) || a.start - b.start);
      const classes = S.cal.layers.classes ? classesOn(d).length : 0;
      const shown = items.slice(0, MAX);
      const more = items.length - shown.length;
      const chips = shown.map((it) => {
        const e = it.ref;
        const clash = it.kind === "mine" && clashesFor(e).length;
        return `<li><button type="button" class="chip chip-${it.kind} cat-${e.cat} ${clash ? "is-clash" : ""} ${isPast(e) ? "is-past" : ""}" data-open-event="${e.id}">
          <span class="chip-time">${fmtClock(e.start)}</span> <span class="chip-title">${esc(e.title)}</span>${clash ? `<span class="sr-only"> (clash)</span>` : ""}</button></li>`;
      }).join("");
      const outside = d.getMonth() !== cursor.getMonth();
      cells += `<div class="mo-cell ${outside ? "is-outside" : ""} ${sameDay(d, TODAY) ? "is-today" : ""} ${d < TODAY ? "is-pastday" : ""}">
        <button type="button" class="mo-date" data-action="goto-day" data-date="${d.toISOString()}" aria-label="${esc(fmtDate(d, { weekday: "long", month: "long", day: "numeric" }))}, open week"><span>${d.getDate()}</span></button>
        ${classes ? `<span class="mo-classes" title="${plural(classes, "class", "classes")} this day">${plural(classes, "class", "classes")}</span>` : ""}
        <ul class="mo-chips">${chips}</ul>
        ${more > 0 ? `<button type="button" class="mo-more" data-action="goto-day" data-date="${d.toISOString()}">+${more} more</button>` : ""}
      </div>`;
    }
    return `<div class="month" style="--weeks:${weeks}">
      <div class="mo-dows">${dows.map((x) => `<span>${x}</span>`).join("")}</div>
      <div class="mo-grid">${cells}</div>
    </div>`;
  }

  function upNextPanel() {
    const list = EVENTS.filter((e) => S.saved.has(e.id) && !isPast(e)).slice(0, 6);
    const body = list.length
      ? `<ol class="mini-list">${list.map((e) => {
          const cl = clashesFor(e);
          return `<li><button type="button" class="mini-row ${cl.length ? "is-clash" : ""}" data-open-event="${e.id}">
            <span class="mini-date">${esc(relDay(e.date) || fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" }))}</span>
            <span class="mini-title">${esc(e.title)}</span>
            <span class="mini-meta">${esc(fmtRange(e.start, e.end))}${cl.length ? ` · <span class="warn-text">clashes with ${esc(cl[0].label)}</span>` : ""}</span>
          </button></li>`;
        }).join("")}</ol>`
      : `<p class="muted">Nothing saved yet. Open any event and choose <em>Add to my calendar</em>.</p><a class="btn btn-small" href="#/events">Browse events</a>`;
    return `<section class="side-panel"><h3>Coming up</h3>${body}</section>`;
  }

  function timetablePanel() {
    if (!S.timetable) return "";
    const codes = [...new Set(D.courses.map((c) => c.code))];
    return `<section class="side-panel">
      <h3>Timetable</h3>
      <p class="muted">${plural(D.courses.length, "section")} imported: ${esc(codes.join(", "))}.</p>
      <a class="link-btn" href="#/profile">Manage in profile</a>
    </section>`;
  }

  /* ---------- Events ---------- */
  function facetCount(skip, test) {
    return EVENTS.filter((e) => eventPasses(e, S.ef, skip) && test(e)).length;
  }

  function checkboxList(name, options, selected, countFn) {
    return options.map((o) => {
      const n = countFn(o.id);
      const on = selected.has(o.id);
      return `<label class="check ${!n && !on ? "is-empty" : ""}"><input type="checkbox" data-filter="${name}" value="${o.id}" ${on ? "checked" : ""}>
        <span class="check-label">${esc(o.label)}</span><span class="count">${n}</span></label>`;
    }).join("");
  }

  function eventFilterPanel() {
    const f = S.ef;
    const whenOpts = [["upcoming", "Any upcoming"], ["today", "Today"], ["week", "This week"], ["next7", "Next 7 days"], ["next30", "Next 30 days"], ["custom", "Pick dates"], ["past", "Past events"]];
    const hasSchedule = S.timetable || S.saved.size;
    const clubOptions = [...REAL_CLUBS].sort((a, b) => (S.followed.has(b.id) - S.followed.has(a.id)) || a.name.localeCompare(b.name));
    return `<div class="filter-group">
        <h3 class="filter-title">When</h3>
        ${whenOpts.map(([v, l]) => `<label class="radio"><input type="radio" name="when" data-filter="when" value="${v}" ${f.when === v ? "checked" : ""}> ${l}</label>`).join("")}
        ${f.when === "custom" ? `<div class="date-range">
            <label class="field field-compact"><span>From</span><input type="date" data-filter="from" value="${esc(f.from)}"></label>
            <label class="field field-compact"><span>To</span><input type="date" data-filter="to" value="${esc(f.to)}"></label>
          </div>` : ""}
      </div>
      <div class="filter-group">
        <h3 class="filter-title">Hosted by</h3>
        ${checkboxList("hosts", [{ id: "club", label: "Student clubs" }, { id: "ams", label: "AMS (campus-wide)" }], f.hosts, (id) => facetCount({ hosts: 1 }, (e) => e.host === id))}
        <label class="field field-compact club-select"><span>Specific club</span>
          <select data-filter="club">
            <option value="">All clubs</option>
            ${clubOptions.map((c) => `<option value="${c.id}" ${f.club === c.id ? "selected" : ""}>${S.followed.has(c.id) ? "★ " : ""}${esc(c.name)}</option>`).join("")}
          </select>
        </label>
      </div>
      <div class="filter-group">
        <h3 class="filter-title">Type of event</h3>
        ${checkboxList("fmts", D.formats, f.fmts, (id) => facetCount({ fmts: 1 }, (e) => e.fmt === id))}
      </div>
      <div class="filter-group">
        <h3 class="filter-title">Club category</h3>
        ${checkboxList("cats", D.categories, f.cats, (id) => facetCount({ cats: 1 }, (e) => e.cat === id))}
      </div>
      <div class="filter-group">
        <h3 class="filter-title">Practical</h3>
        <label class="check"><input type="checkbox" data-filter="free" ${f.free ? "checked" : ""}><span class="check-label">Free only</span></label>
        <label class="check"><input type="checkbox" data-filter="newcomer" ${f.newcomer ? "checked" : ""}><span class="check-label">Good for newcomers</span></label>
        <label class="field field-compact"><span>Registration</span>
          <select data-filter="reg">
            <option value="any" ${f.reg === "any" ? "selected" : ""}>Doesn't matter</option>
            <option value="none" ${f.reg === "none" ? "selected" : ""}>No registration — just show up</option>
            <option value="required" ${f.reg === "required" ? "selected" : ""}>Registration required</option>
          </select>
        </label>
        <label class="check ${hasSchedule ? "" : "is-disabled"}"><input type="checkbox" data-filter="fits" ${f.fits ? "checked" : ""} ${hasSchedule ? "" : "disabled"}><span class="check-label">Fits my schedule</span></label>
        ${hasSchedule ? "" : `<p class="hint">Import your timetable or save an event to use this.</p>`}
      </div>`;
  }

  function activeChips(kind) {
    const chips = [];
    if (kind === "events") {
      const f = S.ef;
      const whenLabel = { today: "Today", week: "This week", next7: "Next 7 days", next30: "Next 30 days", past: "Past events", custom: `${f.from || "…"} to ${f.to || "…"}` };
      if (f.q.trim()) chips.push(["q", "", `“${f.q.trim()}”`]);
      if (f.when !== "upcoming") chips.push(["when", "", whenLabel[f.when]]);
      for (const h of f.hosts) chips.push(["hosts", h, h === "ams" ? "AMS events" : "Club events"]);
      if (f.club) chips.push(["club", "", CLUBS[f.club].name]);
      for (const x of f.fmts) chips.push(["fmts", x, FMTS[x].label]);
      for (const x of f.cats) chips.push(["cats", x, CATS[x].label]);
      if (f.free) chips.push(["free", "", "Free"]);
      if (f.newcomer) chips.push(["newcomer", "", "Newcomer-friendly"]);
      if (f.reg !== "any") chips.push(["reg", "", f.reg === "none" ? "No registration" : "Registration required"]);
      if (f.fits) chips.push(["fits", "", "Fits my schedule"]);
    } else {
      const f = S.cf;
      if (f.q.trim()) chips.push(["q", "", `“${f.q.trim()}”`]);
      for (const x of f.cats) chips.push(["cats", x, CATS[x].label]);
      if (f.letter) chips.push(["letter", "", `Starts with ${f.letter}`]);
      if (f.hasEvents) chips.push(["hasEvents", "", "Has upcoming events"]);
      if (f.noFee) chips.push(["noFee", "", "No membership fee"]);
      if (f.beginner) chips.push(["beginner", "", "Beginner-friendly"]);
      if (f.following) chips.push(["following", "", "Following"]);
    }
    if (!chips.length) return "";
    return `<div class="chips" aria-label="Active filters">
      ${chips.map(([k, v, label]) => `<button type="button" class="filter-chip" data-action="remove-filter" data-scope="${kind}" data-key="${k}" data-value="${esc(v)}" aria-label="Remove filter: ${esc(label)}">${esc(label)} <span aria-hidden="true">×</span></button>`).join("")}
      <button type="button" class="link-btn" data-action="clear-filters" data-scope="${kind}">Clear all</button>
    </div>`;
  }

  function fuzzyNote(items, q) {
    if (!q.trim()) return "";
    const words = new Set();
    for (const it of items) for (const w of matchQuery(it.index, q).fuzzy) words.add(w);
    return words.size ? `<p class="fuzzy-note">Including close matches: ${[...words].slice(0, 4).map((w) => `<em>${esc(w)}</em>`).join(", ")}</p>` : "";
  }

  function eventRow(e) {
    const c = CLUBS[e.club];
    const cl = clashesFor(e);
    const reasons = S.ef.sort === "match" ? matchReasons(e) : [];
    return `<li><button type="button" class="ev-row cat-${e.cat} ${isPast(e) ? "is-past" : ""} ${S.saved.has(e.id) ? "is-saved" : ""}" data-open-event="${e.id}">
      <span class="ev-date" aria-hidden="true"><span class="ev-dow">${fmtDate(e.date, { weekday: "short" })}</span><span class="ev-day">${e.date.getDate()}</span><span class="ev-mon">${fmtDate(e.date, { month: "short" })}</span></span>
      <span class="ev-art">${art(e.id, e.cat, e.fmt, "", 160, 120)}</span>
      <span class="ev-main">
        <span class="ev-club">${esc(c.name)}</span>
        <span class="ev-title">${esc(e.title)}</span>
        <span class="ev-meta"><span class="sr-only">${esc(fmtDate(e.date, { weekday: "long", month: "long", day: "numeric" }))}, </span>${esc(fmtRange(e.start, e.end))} · ${e.loc ? esc(e.loc) : `<span class="missing">Location TBA</span>`}</span>
        <span class="ev-tags">${eventTags(e, { clashes: cl })}</span>
        ${reasons.length ? `<span class="ev-why">Matches: ${esc(reasons.join(", "))}</span>` : ""}
      </span>
      <span class="ev-go" aria-hidden="true">›</span>
    </button></li>`;
  }

  function pageEvents() {
    const f = S.ef;
    let list = EVENTS.filter((e) => eventPasses(e, f));
    const grouped = f.sort === "soon";
    if (f.sort === "match") list = list.slice().sort((a, b) => matchScore(b) - matchScore(a) || a.date - b.date || a.start - b.start);
    if (f.when === "past") list = list.slice().reverse();
    const nActive = activeEventFilterCount(f);

    let body;
    if (!list.length) {
      body = `<div class="empty"><p><strong>No events match.</strong></p><p class="muted">Try removing a filter${f.q ? " or searching a broader word" : ""}.</p><button type="button" class="btn" data-action="clear-filters" data-scope="events">Clear all filters</button></div>`;
    } else if (grouped) {
      const groups = [];
      for (const e of list) {
        const last = groups[groups.length - 1];
        if (last && sameDay(last.date, e.date)) last.items.push(e); else groups.push({ date: e.date, items: [e] });
      }
      body = `<div class="ev-groups">${groups.map((g) => {
        const rel = relDay(g.date);
        return `<section class="ev-group"><h3 class="ev-group-head">${rel ? `<span class="rel">${rel}</span> ` : ""}${esc(fmtDate(g.date, { weekday: "long", month: "long", day: "numeric" }))}</h3>
          <ul class="ev-list">${g.items.map(eventRow).join("")}</ul></section>`;
      }).join("")}</div>`;
    } else {
      body = `<ul class="ev-list ev-list-flat">${list.map(eventRow).join("")}</ul>`;
    }

    const picks = !nActive && S.interests.size
      ? EVENTS.filter((e) => !isPast(e) && matchScore(e) > 0 && !S.saved.has(e.id)).sort((a, b) => matchScore(b) - matchScore(a) || a.date - b.date).slice(0, 3)
      : [];
    const picksHtml = picks.length ? `<section class="picks" aria-labelledby="picks-title">
        <h2 id="picks-title" class="section-title">Picked for you</h2>
        <ul class="pick-list">${picks.map((e) => `<li><button type="button" class="pick cat-${e.cat}" data-open-event="${e.id}">
          <span class="pick-art">${art(e.id, e.cat, e.fmt, "", 240, 110)}</span>
          <span class="pick-when">${esc(relDay(e.date) || fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" }))} · ${esc(fmtRange(e.start, e.end))}</span>
          <span class="pick-title">${esc(e.title)}</span>
          <span class="pick-why">Because: ${esc(matchReasons(e).slice(0, 2).join(", "))}</span>
        </button></li>`).join("")}</ul>
      </section>` : "";

    return `<section class="page page-events" aria-labelledby="page-title">
      <header class="page-head">
        <div>
          <p class="eyebrow">Find something to go to</p>
          <h1 id="page-title">Events</h1>
          <p class="page-lede">Every club and AMS event in one list. Filter by what you're into and when you're free.</p>
        </div>
      </header>
      ${picksHtml}
      <div class="browse-layout ${S.filtersOpen ? "filters-open" : ""}">
        <aside class="filters" id="event-filters" aria-label="Event filters">
          <div class="filters-head"><h2 class="section-title">Filter events</h2>${nActive ? `<button type="button" class="link-btn" data-action="clear-filters" data-scope="events">Reset</button>` : ""}</div>
          ${eventFilterPanel()}
        </aside>
        <div class="results">
          <div class="results-bar">
            <label class="search">
              <span class="sr-only">Search events</span>
              <input type="search" data-filter="q" value="${esc(f.q)}" placeholder="Search events — try “photo”, “yoga” or a club name" autocomplete="off">
            </label>
            <button type="button" class="btn filters-toggle" data-action="toggle-filters" aria-expanded="${S.filtersOpen}" aria-controls="event-filters">Filters${nActive ? ` (${nActive})` : ""}</button>
            <label class="sort"><span>Sort</span>
              <select data-filter="sort">
                <option value="soon" ${f.sort === "soon" ? "selected" : ""}>Soonest first</option>
                <option value="match" ${f.sort === "match" ? "selected" : ""}>Best match for me</option>
              </select>
            </label>
          </div>
          <p class="result-count" role="status"><strong>${plural(list.length, "event")}</strong>${f.when === "upcoming" && !nActive ? " coming up" : " match"}${f.sort === "match" && !S.interests.size && !S.followed.size ? ` · <a href="#/profile">pick interests</a> to improve matches` : ""}</p>
          ${activeChips("events")}
          ${fuzzyNote(list, f.q)}
          ${body}
        </div>
      </div>
    </section>`;
  }

  /* ---------- Clubs ---------- */
  function pageClubs() {
    const f = S.cf;
    let list = REAL_CLUBS.filter((c) => clubPasses(c, f));
    if (f.q.trim()) list = list.slice().sort((a, b) => matchQuery(b.index, f.q).score - matchQuery(a.index, f.q).score || a.name.localeCompare(b.name));
    else if (f.sort === "events") list = list.slice().sort((a, b) => upcomingFor(b.id).length - upcomingFor(a.id).length || a.name.localeCompare(b.name));
    else if (f.sort === "match") {
      const sc = (c) => c.tags.filter((t) => S.interests.has(t)).length * 2 + (S.followed.has(c.id) ? 3 : 0);
      list = list.slice().sort((a, b) => sc(b) - sc(a) || a.name.localeCompare(b.name));
    }
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
    const letterHas = new Set(REAL_CLUBS.filter((c) => clubPasses(c, f, { letter: 1 })).map((c) => c.name[0].toUpperCase()));
    const nActive = f.cats.size + (f.letter ? 1 : 0) + f.hasEvents + f.noFee + f.beginner + f.following + (f.q.trim() ? 1 : 0);

    const cards = list.map((c) => {
      const up = upcomingFor(c.id);
      const next = up[0];
      return `<li><button type="button" class="club-card cat-${c.cat}" data-open-club="${c.id}">
        <span class="club-top">${monogram(c)}<span class="club-cat">${esc(CATS[c.cat].label)}</span>${S.followed.has(c.id) ? `<span class="tag tag-saved">Following</span>` : ""}</span>
        <span class="club-name">${esc(c.name)}</span>
        <span class="club-blurb">${esc(c.blurb)}</span>
        <span class="club-foot">
          <span>${up.length ? `<strong>${plural(up.length, "upcoming event")}</strong>` : `<span class="muted">No upcoming events</span>`}</span>
          ${next ? `<span class="club-next">Next: ${esc(relDay(next.date) || fmtDate(next.date, { month: "short", day: "numeric" }))} — ${esc(next.title)}</span>` : ""}
        </span>
      </button></li>`;
    }).join("");

    return `<section class="page page-clubs" aria-labelledby="page-title">
      <header class="page-head">
        <div>
          <p class="eyebrow">${REAL_CLUBS.length} clubs in this demo</p>
          <h1 id="page-title">Clubs</h1>
          <p class="page-lede">Search by name or by what you're into. Open a club to see what it does and what it has coming up.</p>
        </div>
      </header>
      <div class="browse-layout ${S.filtersOpen ? "filters-open" : ""}">
        <aside class="filters" id="club-filters" aria-label="Club filters">
          <div class="filters-head"><h2 class="section-title">Filter clubs</h2>${nActive ? `<button type="button" class="link-btn" data-action="clear-filters" data-scope="clubs">Reset</button>` : ""}</div>
          <div class="filter-group">
            <h3 class="filter-title">Category</h3>
            ${checkboxList("ccats", D.categories, f.cats, (id) => REAL_CLUBS.filter((c) => clubPasses(c, f, { cats: 1 }) && c.cat === id).length)}
          </div>
          <div class="filter-group">
            <h3 class="filter-title">Starts with</h3>
            <div class="letters" role="group" aria-label="First letter">
              ${letters.map((l) => `<button type="button" data-action="letter" data-letter="${l}" aria-pressed="${f.letter === l}" ${letterHas.has(l) || f.letter === l ? "" : "disabled"}>${l}</button>`).join("")}
            </div>
          </div>
          <div class="filter-group">
            <h3 class="filter-title">Practical</h3>
            <label class="check"><input type="checkbox" data-cfilter="hasEvents" ${f.hasEvents ? "checked" : ""}><span class="check-label">Has upcoming events</span></label>
            <label class="check"><input type="checkbox" data-cfilter="noFee" ${f.noFee ? "checked" : ""}><span class="check-label">No membership fee</span></label>
            <label class="check"><input type="checkbox" data-cfilter="beginner" ${f.beginner ? "checked" : ""}><span class="check-label">Beginner-friendly</span></label>
            <label class="check ${S.followed.size ? "" : "is-disabled"}"><input type="checkbox" data-cfilter="following" ${f.following ? "checked" : ""} ${S.followed.size ? "" : "disabled"}><span class="check-label">Clubs I follow</span><span class="count">${S.followed.size}</span></label>
          </div>
        </aside>
        <div class="results">
          <div class="results-bar">
            <label class="search">
              <span class="sr-only">Search clubs</span>
              <input type="search" data-cfilter="q" value="${esc(f.q)}" placeholder="Search clubs — name, interest or a typo like “fotography”" autocomplete="off">
            </label>
            <button type="button" class="btn filters-toggle" data-action="toggle-filters" aria-expanded="${S.filtersOpen}" aria-controls="club-filters">Filters${nActive ? ` (${nActive})` : ""}</button>
            <label class="sort"><span>Sort</span>
              <select data-cfilter="sort" ${f.q.trim() ? "disabled" : ""}>
                <option value="az" ${f.sort === "az" ? "selected" : ""}>A–Z</option>
                <option value="events" ${f.sort === "events" ? "selected" : ""}>Most upcoming events</option>
                <option value="match" ${f.sort === "match" ? "selected" : ""}>Best match for me</option>
              </select>
            </label>
          </div>
          <p class="result-count" role="status"><strong>${plural(list.length, "club")}</strong>${f.q.trim() ? " · sorted by relevance" : ""}</p>
          ${activeChips("clubs")}
          ${fuzzyNote(list, f.q)}
          ${list.length ? `<ul class="club-grid">${cards}</ul>` : `<div class="empty"><p><strong>No clubs match.</strong></p><p class="muted">The real AMS directory has 300+ clubs; this demo has ${REAL_CLUBS.length}.</p><button type="button" class="btn" data-action="clear-filters" data-scope="clubs">Clear all filters</button></div>`}
        </div>
      </div>
    </section>`;
  }

  /* ---------- Profile ---------- */
  function pageProfile() {
    const savedList = EVENTS.filter((e) => S.saved.has(e.id));
    return `<section class="page page-profile" aria-labelledby="page-title">
      <header class="page-head">
        <div>
          <p class="eyebrow">${S.user ? "Signed in" : "Browsing as a guest"}</p>
          <h1 id="page-title">${S.user ? esc(S.user.name) : "Your profile"}</h1>
          <p class="page-lede">Interests decide what shows up under <em>Picked for you</em>. Your timetable is how we spot clashes.</p>
        </div>
        ${S.user ? `<button type="button" class="btn" data-action="signout">Sign out</button>` : `<button type="button" class="btn btn-primary" data-action="signin">Sign in</button>`}
      </header>
      <div class="profile-grid">
        <section class="panel" aria-labelledby="int-title">
          <h2 id="int-title" class="section-title">Interests</h2>
          <p class="muted">Pick as many as you like. ${S.interests.size ? `${S.interests.size} selected.` : "None selected yet."}</p>
          <div class="interest-list" role="group" aria-label="Interests">
            ${D.interests.map((i) => `<button type="button" class="interest" data-action="toggle-interest" data-id="${i.id}" aria-pressed="${S.interests.has(i.id)}">${esc(i.label)}</button>`).join("")}
          </div>
          ${S.interests.size ? `<a class="btn btn-small" href="#/events">See events picked for you</a>` : ""}
        </section>
        <section class="panel" aria-labelledby="tt-title">
          <h2 id="tt-title" class="section-title">Class timetable</h2>
          ${S.timetable ? `<table class="tt">
              <thead><tr><th scope="col">Course</th><th scope="col">Days</th><th scope="col">Time</th><th scope="col">Room</th></tr></thead>
              <tbody>${D.courses.map((c) => `<tr><td><strong>${esc(c.code)}</strong> ${esc(c.sec)} <span class="muted">${esc(c.kind)}</span></td>
                <td>${c.days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join(" ")}</td>
                <td>${esc(fmtRange(toMin(c.s), toMin(c.e)))}</td><td>${esc(c.loc)}</td></tr>`).join("")}</tbody>
            </table>
            <button type="button" class="btn btn-small" data-action="clear-timetable">Remove timetable</button>`
          : `<p class="muted">Import your schedule from Workday to see classes on the calendar and get warned about clashes.</p>
            <button type="button" class="btn btn-primary" data-action="import-timetable">Import sample timetable</button>
            <p class="hint">Demo: loads a made-up CPSC/STAT/PSYC schedule instead of connecting to Workday.</p>`}
        </section>
        <section class="panel" aria-labelledby="fol-title">
          <h2 id="fol-title" class="section-title">Clubs you follow</h2>
          ${S.followed.size ? `<ul class="plain-list">${[...S.followed].map((id) => `<li><button type="button" class="link-btn" data-open-club="${id}">${esc(CLUBS[id].name)}</button></li>`).join("")}</ul>`
            : `<p class="muted">Follow a club from its page to see its events first.</p><a class="btn btn-small" href="#/clubs">Find clubs</a>`}
        </section>
        <section class="panel" aria-labelledby="sv-title">
          <h2 id="sv-title" class="section-title">Saved events</h2>
          ${savedList.length ? `<ul class="plain-list">${savedList.map((e) => `<li><button type="button" class="link-btn" data-open-event="${e.id}">${esc(e.title)}</button> <span class="muted">${esc(fmtDate(e.date, { month: "short", day: "numeric" }))}</span></li>`).join("")}</ul>
              <button type="button" class="btn btn-small" data-action="download-all">Export all as .ics</button>`
            : `<p class="muted">Events you add to your calendar show up here.</p>`}
        </section>
      </div>
    </section>`;
  }

  /* ================================================================
   * Sheets (event + club details)
   * ================================================================ */
  const sheet = $("#sheet");
  const sheetInner = $("#sheet-inner");

  function openSheet(type, id, { push = false } = {}) {
    // Opening from inside a sheet keeps history so "Back" works; opening from the page starts fresh.
    if (!(push && sheet.open)) S.sheetStack = [];
    S.sheetStack.push({ type, id });
    drawSheet();
    if (!sheet.open) sheet.showModal();
    sheetInner.scrollTop = 0;
    sheet.scrollTop = 0;
    const h = $("#sheet-title", sheet);
    if (h) h.focus({ preventScroll: true });
  }
  function drawSheet() {
    const top = S.sheetStack.at(-1);
    if (!top) return;
    const prev = S.sheetStack.at(-2);
    const back = prev ? `<button type="button" class="sheet-back" data-action="sheet-back">‹ Back to ${esc(prev.type === "club" ? CLUBS[prev.id].name : EV[prev.id].title)}</button>` : "";
    sheetInner.innerHTML = (top.type === "event" ? eventSheet(EV[top.id]) : clubSheet(CLUBS[top.id])).replace("<!--back-->", back);
  }
  function closeSheet() { if (sheet.open) sheet.close(); }
  sheet.addEventListener("close", () => { S.sheetStack = []; });
  sheet.addEventListener("click", (ev) => { if (ev.target === sheet) closeSheet(); }); // click on backdrop

  function eventSheet(e) {
    const c = CLUBS[e.club];
    const cl = clashesFor(e);
    const past = isPast(e);
    const saved = S.saved.has(e.id);
    const cost = costText(e);
    const regText = e.reg
      ? `<strong>Required.</strong> ${esc(e.reg.how)}.${e.deadlineDate ? ` Deadline: ${esc(fmtDate(e.deadlineDate, { weekday: "short", month: "short", day: "numeric" }))}.` : ""}${e.reg.cap ? ` Capacity ${e.reg.cap}.` : ""}`
      : "Not needed — just show up.";
    const when = `${fmtDate(e.date, { weekday: "long", month: "long", day: "numeric" })}${relDay(e.date) ? ` (${relDay(e.date).toLowerCase()})` : ""}`;
    return `<article class="detail detail-event cat-${e.cat}">
      <div class="sheet-bar"><!--back--><button type="button" class="sheet-close" data-action="sheet-close" aria-label="Close">×</button></div>
      <div class="detail-art">${art(e.id, e.cat, e.fmt, "", 640, 220)}</div>
      <div class="detail-body">
        <p class="eyebrow">${esc(FMTS[e.fmt].label)} · ${esc(CATS[e.cat].label)}</p>
        <h2 id="sheet-title" tabindex="-1">${esc(e.title)}</h2>
        ${c.host ? `<p class="host">Hosted by the AMS</p>` : `<button type="button" class="host host-link" data-open-club="${c.id}" data-push="1">${monogram(c)} <span>Hosted by <strong>${esc(c.name)}</strong></span> <span aria-hidden="true">›</span></button>`}
        ${past ? `<p class="notice notice-muted">This event has ended.</p>` : ""}
        ${cl.length && !past ? `<p class="notice notice-warn" role="note"><strong>Clashes with your schedule:</strong> ${esc(clashText(cl))}.</p>` : ""}
        <dl class="facts">
          <div><dt>When</dt><dd>${esc(when)}<br>${esc(fmtRange(e.start, e.end))}</dd></div>
          <div><dt>Where</dt><dd>${e.loc ? esc(e.loc) : `<span class="missing">Not posted yet — check with the club</span>`}</dd></div>
          <div><dt>Cost</dt><dd>${cost ? (e.cost === 0 ? "Free" : `${cost} per person`) : `<span class="missing">Not posted yet</span>`}</dd></div>
          <div><dt>Registration</dt><dd>${regText}</dd></div>
          <div><dt>Who it's for</dt><dd>${e.newcomer ? "Open to everyone, including first-timers" : "Best if you have some experience"}</dd></div>
        </dl>
        <p class="detail-desc">${esc(e.desc)}</p>
        <p class="updated">Info last updated ${e.upd === 0 ? "today" : `${plural(e.upd, "day")} ago`} by ${esc(c.host ? "AMS Events" : c.short)}.</p>
      </div>
      <div class="detail-actions">
        ${past ? "" : saved
          ? `<button type="button" class="btn btn-added" data-action="unsave" data-id="${e.id}" aria-pressed="true"><span aria-hidden="true">✓</span> In your calendar <span class="btn-sub">Remove</span></button>`
          : `<button type="button" class="btn btn-primary" data-action="save" data-id="${e.id}">Add to my calendar</button>`}
        ${e.reg && !past ? `<button type="button" class="btn" data-action="register" data-id="${e.id}">Register ↗</button>` : ""}
        <button type="button" class="btn btn-quiet" data-action="ics" data-id="${e.id}">Download .ics</button>
      </div>
      <div class="confirm" id="confirm" hidden></div>
    </article>`;
  }

  function clubSheet(c) {
    const up = upcomingFor(c.id);
    const following = S.followed.has(c.id);
    return `<article class="detail detail-club cat-${c.cat}">
      <div class="sheet-bar"><!--back--><button type="button" class="sheet-close" data-action="sheet-close" aria-label="Close">×</button></div>
      <div class="detail-art club-banner">${art(c.id, c.cat, "club", "", 640, 160)}${monogram(c)}</div>
      <div class="detail-body">
        <p class="eyebrow">${esc(CATS[c.cat].label)} · since ${c.founded} · about ${c.members} members</p>
        <h2 id="sheet-title" tabindex="-1">${esc(c.name)}</h2>
        <p class="detail-lede">${esc(c.blurb)}</p>
        <div class="detail-inline-actions">
          <button type="button" class="btn ${following ? "btn-added" : ""}" data-action="follow" data-id="${c.id}" aria-pressed="${following}">${following ? "✓ Following" : "Follow"}</button>
          <button type="button" class="btn btn-quiet" data-action="join" data-id="${c.id}">Join club ↗</button>
        </div>
        <p class="detail-desc">${esc(c.desc)}</p>
        <dl class="facts">
          <div><dt>Meets</dt><dd>${esc(c.meets)}</dd></div>
          <div><dt>Membership</dt><dd>${c.fee ? `$${c.fee} per year` : "Free"}${c.beginner ? " · beginners welcome" : " · some experience expected"}</dd></div>
          <div><dt>Contact</dt><dd>Instagram @${esc(c.handle)}</dd></div>
        </dl>
        <section class="club-events" aria-labelledby="ce-title">
          <h3 id="ce-title">${up.length ? `Coming up (${up.length})` : "No upcoming events"}</h3>
          ${up.length ? `<ul class="mini-list">${up.slice(0, 5).map((e) => {
              const cl = clashesFor(e);
              return `<li><button type="button" class="mini-row ${cl.length ? "is-clash" : ""}" data-open-event="${e.id}" data-push="1">
                <span class="mini-date">${esc(relDay(e.date) || fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" }))}</span>
                <span class="mini-title">${esc(e.title)}${S.saved.has(e.id) ? ` <span class="tag tag-saved">Saved</span>` : ""}</span>
                <span class="mini-meta">${esc(fmtRange(e.start, e.end))}${cl.length ? ` · <span class="warn-text">clashes with ${esc(cl[0].label)}</span>` : ""}</span>
              </button></li>`;
            }).join("")}</ul>` : `<p class="muted">Follow the club and its next event will show up under Picked for you.</p>`}
          ${up.length ? `<button type="button" class="btn btn-small" data-action="club-events" data-id="${c.id}">Show ${up.length > 5 ? "all" : "these"} in Events</button>` : ""}
        </section>
      </div>
    </article>`;
  }

  /* ---------- saving events (with clash check) ---------- */
  function saveEvent(id, { force = false } = {}) {
    const e = EV[id];
    const cl = clashesFor(e);
    if (cl.length && !force) {
      const box = $("#confirm", sheet);
      box.hidden = false;
      box.innerHTML = `<p><strong>Heads up:</strong> this overlaps with ${esc(clashText(cl))}.</p>
        <div class="confirm-actions"><button type="button" class="btn btn-primary" data-action="save-anyway" data-id="${id}">Add anyway</button>
        <button type="button" class="btn" data-action="cancel-save">Don't add</button></div>`;
      $("[data-action=save-anyway]", box).focus();
      return;
    }
    S.saved.add(id);
    persist();
    drawSheet();
    render({ keepScroll: true });
    toast(`Added “${e.title}” — ${fmtDate(e.date, { weekday: "short", month: "short", day: "numeric" })}, ${fmtRange(e.start, e.end)}${cl.length ? " (overlaps)" : ""}.`, {
      label: "View in calendar",
      run: () => { closeSheet(); S.cal.view = "week"; S.cal.cursor = e.date; S.cal.layers.mine = true; persist(); go("calendar"); },
    });
  }
  function unsaveEvent(id) {
    S.saved.delete(id);
    persist();
    drawSheet();
    render({ keepScroll: true });
    toast(`Removed “${EV[id].title}” from your calendar.`, { label: "Undo", run: () => { S.saved.add(id); persist(); if (sheet.open) drawSheet(); render({ keepScroll: true }); } });
  }

  /* ---------- .ics export ---------- */
  function icsStamp(date, min) {
    const p = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}T${p(Math.floor(min / 60))}${p(min % 60)}00`;
  }
  const icsEscape = (s) => String(s).replace(/[\\;,]/g, (m) => "\\" + m).replace(/\n/g, "\\n");
  function downloadIcs(list, filename) {
    const now = new Date();
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//UX6//Campus events demo//EN"];
    for (const e of list) {
      lines.push("BEGIN:VEVENT", `UID:${e.id}-${icsStamp(e.date, e.start)}@ux6.demo`, `DTSTAMP:${icsStamp(now, now.getHours() * 60 + now.getMinutes())}`,
        `DTSTART:${icsStamp(e.date, e.start)}`, `DTEND:${icsStamp(e.date, e.end)}`, `SUMMARY:${icsEscape(e.title)}`,
        `LOCATION:${icsEscape(e.loc || "TBA")}`, `DESCRIPTION:${icsEscape(`${CLUBS[e.club].name}. ${e.desc}`)}`, "END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  /* ---------- toasts ---------- */
  const toasts = $("#toasts");
  function toast(msg, action) {
    const el = document.createElement("div");
    el.className = "toast";
    el.innerHTML = `<span class="toast-msg">${esc(msg)}</span>${action ? `<button type="button" class="toast-action">${esc(action.label)}</button>` : ""}<button type="button" class="toast-x" aria-label="Dismiss">×</button>`;
    const kill = () => { el.classList.add("is-leaving"); setTimeout(() => el.remove(), 200); };
    if (action) $(".toast-action", el).addEventListener("click", () => { action.run(); kill(); });
    $(".toast-x", el).addEventListener("click", kill);
    toasts.replaceChildren(el);
    setTimeout(kill, 6500);
  }

  /* ================================================================
   * Interaction
   * ================================================================ */
  function go(name, params) {
    const target = `#/${name}${params ? "?" + params : ""}`;
    if (location.hash === target) render(); else location.hash = target;
    window.scrollTo(0, 0);
  }

  function removeFilter(scope, key, value) {
    const f = scope === "events" ? S.ef : S.cf;
    const fresh = scope === "events" ? freshEventFilters() : freshClubFilters();
    if (f[key] instanceof Set) f[key].delete(value);
    else f[key] = fresh[key];
    if (key === "when") { f.from = ""; f.to = ""; }
  }

  document.addEventListener("click", (ev) => {
    const t = ev.target.closest("[data-action], [data-open-event], [data-open-club]");
    if (!t) return;

    if (t.dataset.openEvent) return openSheet("event", t.dataset.openEvent, { push: !!t.dataset.push });
    if (t.dataset.openClub) return openSheet("club", t.dataset.openClub, { push: !!t.dataset.push });

    const a = t.dataset.action;
    const id = t.dataset.id;
    switch (a) {
      case "cal-prev":
      case "cal-next": {
        const dir = a === "cal-next" ? 1 : -1;
        const c = S.cal.cursor;
        S.cal.cursor = S.cal.view === "week" ? addDays(c, 7 * dir) : new Date(c.getFullYear(), c.getMonth() + dir, 1);
        return render({ keepScroll: true });
      }
      case "cal-today": S.cal.cursor = TODAY; return render({ keepScroll: true });
      case "cal-view": S.cal.view = t.dataset.view; persist(); return render({ keepScroll: true });
      case "goto-day": S.cal.cursor = new Date(t.dataset.date); S.cal.view = "week"; persist(); return render({ keepScroll: true });
      case "clear-event-filters": S.ef = freshEventFilters(); return render({ keepScroll: true });
      case "import-timetable":
        S.timetable = true; S.cal.layers.classes = true; persist(); render({ keepScroll: true });
        return toast(`Imported ${plural(D.courses.length, "class section")}. Clashes now show on the calendar and in Events.`, route().name === "calendar" ? null : { label: "Open calendar", run: () => { S.cal.view = "week"; go("calendar"); } });
      case "clear-timetable": S.timetable = false; S.ef.fits = false; persist(); render({ keepScroll: true }); return toast("Timetable removed.");
      case "toggle-filters": S.filtersOpen = !S.filtersOpen; return render({ keepScroll: true });
      case "remove-filter": removeFilter(t.dataset.scope, t.dataset.key, t.dataset.value); return render({ keepScroll: true });
      case "clear-filters":
        if (t.dataset.scope === "events") S.ef = Object.assign(freshEventFilters(), { sort: S.ef.sort });
        else S.cf = Object.assign(freshClubFilters(), { sort: S.cf.sort });
        return render({ keepScroll: true });
      case "letter": S.cf.letter = S.cf.letter === t.dataset.letter ? "" : t.dataset.letter; return render({ keepScroll: true });
      case "toggle-interest":
        if (S.interests.has(id)) S.interests.delete(id); else S.interests.add(id);
        persist(); return render({ keepScroll: true });
      case "sheet-close": return closeSheet();
      case "sheet-back": S.sheetStack.pop(); return drawSheet();
      case "save": return saveEvent(id);
      case "save-anyway": return saveEvent(id, { force: true });
      case "cancel-save": { const box = $("#confirm", sheet); box.hidden = true; box.innerHTML = ""; return $("[data-action=save]", sheet)?.focus(); }
      case "unsave": return unsaveEvent(id);
      case "register": return toast(`Demo: this would open ${CLUBS[EV[id].club].name}'s registration form in a new tab.`);
      case "join": return toast(`Demo: this would open ${CLUBS[id].name}'s membership sign-up.`);
      case "ics": downloadIcs([EV[id]], `${id}.ics`); return toast("Downloaded .ics — open it to add this event to Google, Apple or Outlook calendar.");
      case "download-all": return downloadIcs(EVENTS.filter((e) => S.saved.has(e.id)), "my-club-events.ics");
      case "follow": {
        const was = S.followed.has(id);
        if (was) S.followed.delete(id); else S.followed.add(id);
        persist(); drawSheet(); render({ keepScroll: true });
        return toast(was ? `Unfollowed ${CLUBS[id].name}.` : `Following ${CLUBS[id].name}. Its events will rank higher for you.`);
      }
      case "club-events":
        closeSheet();
        S.ef = Object.assign(freshEventFilters(), { club: id, sort: S.ef.sort });
        S.filtersOpen = false;
        return go("events");
      case "signin": {
        const dlg = $("#signin");
        $("#signin-form").reset();
        dlg.showModal();
        return;
      }
      case "signout": S.user = null; persist(); render(); return toast("Signed out. Your saved events stay on this device.");
      case "reset-demo":
        if (!confirm("Reset the demo? This clears saved events, interests, follows and the timetable.")) return;
        try { localStorage.removeItem(STORE_KEY); } catch { /* ignore */ }
        Object.assign(S, { user: null, saved: new Set(), timetable: false, interests: new Set(), followed: new Set(), ef: freshEventFilters(), cf: freshClubFilters() });
        S.cal = { view: "week", cursor: TODAY, layers: { mine: true, classes: true, others: true } };
        persist(); closeSheet(); go("calendar");
        return toast("Demo reset.");
    }
  });

  // Filter inputs (events + clubs) and calendar layers
  let searchTimer = null;
  function onFilterInput(ev) {
    const el = ev.target;
    if (el.dataset.layer) { S.cal.layers[el.dataset.layer] = el.checked; persist(); return render({ keepScroll: true }); }
    const key = el.dataset.filter || el.dataset.cfilter;
    if (!key) return;
    const isClub = !!el.dataset.cfilter;
    let f = isClub ? S.cf : S.ef;
    if (key === "ccats") f = S.cf;
    const field = key === "ccats" ? "cats" : key;
    if (f[field] instanceof Set) { if (el.checked) f[field].add(el.value); else f[field].delete(el.value); }
    else if (el.type === "checkbox") f[field] = el.checked;
    else f[field] = el.value;

    if (field === "q") {
      // Re-render after typing pauses, then put the caret back in the search box.
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        const pos = el.selectionStart;
        render({ keepScroll: true });
        const box = $(`input[data-${isClub ? "cfilter" : "filter"}="q"]`);
        if (box) { box.focus(); box.setSelectionRange(pos, pos); }
      }, 180);
      return;
    }
    render({ keepScroll: true });
    // keep keyboard focus on the same control after re-render
    const sel = el.dataset.filter ? `[data-filter="${el.dataset.filter}"]` : `[data-cfilter="${el.dataset.cfilter}"]`;
    const again = $$(sel).find((x) => x.value === el.value) || $(sel);
    if (again) again.focus({ preventScroll: true });
  }
  document.addEventListener("input", (ev) => { if (ev.target.matches('input[type="search"]')) onFilterInput(ev); });
  document.addEventListener("change", (ev) => { if (!ev.target.matches('input[type="search"]')) onFilterInput(ev); });

  $("#signin").addEventListener("close", () => {
    const dlg = $("#signin");
    if (dlg.returnValue !== "ok") return;
    const name = new FormData($("#signin-form")).get("name").trim();
    if (!name) return;
    S.user = { name };
    persist();
    if (!S.interests.size) { go("profile"); toast(`Welcome, ${name}. Pick a few interests to get recommendations.`); }
    else { render(); toast(`Signed in as ${name}.`); }
  });

  window.addEventListener("hashchange", () => { render(); view.focus({ preventScroll: true }); window.scrollTo(0, 0); });
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "/" || ev.target.matches("input, textarea, select") || sheet.open) return;
    const box = $('.results-bar input[type="search"]');
    if (box) { ev.preventDefault(); box.focus(); }
  });

  // Deep link: #/events?club=filmphoto
  const startRoute = route();
  if (startRoute.name === "events" && CLUBS[startRoute.params.get("club")]) S.ef.club = startRoute.params.get("club");

  render();
})();
