"use strict";
// Termed's To-Do-Liste: liest und schreibt todos.json im privaten Repo über die GitHub-API.
const REPO = "Termed30/termed-todo-data";
const FILE = "todos.json";
const AREAS = [
  {id: "agentur", name: "Werbeagentur & Kunden", short: "Agentur"},
  {id: "candi", name: "Candi Brand Guide", short: "Candi"},
  {id: "admin", name: "Rechnungen & Admin", short: "Admin"},
  {id: "privat", name: "Privat", short: "Privat"},
];
const K = {token: "termed-todo-token", cache: "termed-todo-cache", filter: "termed-todo-filter"};

// Nur für lokale Tests: ?api=http://127.0.0.1:PORT (wird nur auf localhost akzeptiert)
const API = (() => {
  const p = new URLSearchParams(location.search).get("api");
  const local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  return local && p && /^http:\/\/127\.0\.0\.1:\d+$/.test(p) ? p : "https://api.github.com";
})();

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
  del(k) { try { localStorage.removeItem(k); } catch (e) {} },
};

let todos = [];
let sha = null;
let filter = store.get(K.filter) || "alle";
let busy = false;

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
const areaName = (id) => (AREAS.find((a) => a.id === id) || {name: "Sonstiges"}).name;

// ---------- GitHub ----------
const b64decode = (s) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), (c) => c.charCodeAt(0)));
const b64encode = (str) => { const bytes = new TextEncoder().encode(str); let bin = ""; bytes.forEach((b) => { bin += String.fromCharCode(b); }); return btoa(bin); };

async function gh(method, body) {
  const token = store.get(K.token);
  const url = `${API}/repos/${REPO}/contents/${FILE}` + (method === "GET" ? `?ref=main&t=${Date.now()}` : "");
  const res = await fetch(url, {
    method,
    cache: "no-store",
    headers: {Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", ...(body ? {"Content-Type": "application/json"} : {})},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401 || res.status === 403) throw Object.assign(new Error("auth"), {code: "auth"});
  if (res.status === 404) throw Object.assign(new Error("notfound"), {code: "notfound"});
  if (res.status === 409 || res.status === 422) throw Object.assign(new Error("conflict"), {code: "conflict"});
  if (!res.ok) throw Object.assign(new Error("http " + res.status), {code: "http"});
  return res.json();
}

async function load() {
  const j = await gh("GET");
  const data = JSON.parse(b64decode(j.content));
  return {sha: j.sha, todos: Array.isArray(data.todos) ? data.todos : []};
}

async function save(list, prevSha, message) {
  const doc = {schema: 1, updatedAt: new Date().toISOString(), todos: list};
  const j = await gh("PUT", {message, content: b64encode(JSON.stringify(doc, null, 2) + "\n"), sha: prevSha, branch: "main"});
  return j.content.sha;
}

// Änderung immer auf den neuesten Stand anwenden, bei Konflikt einmal neu versuchen.
async function mutate(fn, message) {
  if (busy) return;
  busy = true; spin(true);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fresh = await load();
        const next = fn(structuredClone(fresh.todos));
        sha = await save(next, fresh.sha, message);
        todos = next; cache(); setStatus(""); render();
        return;
      } catch (e) {
        if (e.code === "conflict" && attempt === 0) continue;
        throw e;
      }
    }
  } catch (e) {
    handleError(e, "Konnte nicht speichern.");
    render();
  } finally { busy = false; spin(false); }
}

async function refresh() {
  if (!store.get(K.token)) return showSetup(true);
  spin(true);
  try {
    const r = await load();
    todos = r.todos; sha = r.sha; cache(); setStatus(""); showSetup(false); render();
  } catch (e) { handleError(e, "Neu laden hat nicht geklappt."); }
  finally { spin(false); }
}

function handleError(e, fallback) {
  if (e.code === "auth") { store.del(K.token); showSetup(true); tokenMsg("Der gespeicherte GitHub-Schlüssel gilt nicht mehr. Bitte einen neuen anlegen und hier einfügen."); return; }
  if (e.code === "notfound") {
    store.del(K.token); showSetup(true); setStatus("");
    tokenMsg("Der Schlüssel darf das private Repo noch nicht sehen. Auf GitHub beim Schlüssel „Repository access → Only select repositories → termed-todo-data“ und „Contents: Read and write“ einstellen, dann hier nochmal einfügen.");
    return;
  }
  if (!navigator.onLine) { setStatus("Offline. Du siehst den letzten Stand. Abhaken geht wieder, sobald du Netz hast."); return; }
  setStatus(fallback + " Tipp oben auf ↻ und versuch es nochmal.");
}

function cache() { store.set(K.cache, JSON.stringify({todos, at: new Date().toISOString()})); }

// ---------- Anzeige ----------
function today() { const d = new Date(); d.setHours(0, 0, 0, 0); return d; }
function dueInfo(due) {
  if (!due) return null;
  const d = new Date(due + "T00:00:00"); if (isNaN(d)) return null;
  const days = Math.round((d - today()) / 86400000);
  const label = d.toLocaleDateString("de-AT", {weekday: "short", day: "2-digit", month: "2-digit"});
  if (days < 0) return {cls: "late", text: `überfällig · ${label}`};
  if (days === 0) return {cls: "late", text: "heute"};
  if (days === 1) return {cls: "soon", text: "morgen"};
  if (days <= 3) return {cls: "soon", text: `in ${days} Tagen · ${label}`};
  return {cls: "", text: label};
}

function renderFilters() {
  const box = $("filters"); box.replaceChildren();
  [{id: "alle", short: "Alle"}, ...AREAS].forEach((a) => {
    const b = el("button", "chip", a.short); b.type = "button";
    b.setAttribute("aria-pressed", String(filter === a.id));
    b.onclick = () => { filter = a.id; store.set(K.filter, filter); renderFilters(); render(); };
    box.append(b);
  });
  const sel = $("f-area");
  if (!sel.options.length) AREAS.forEach((a) => { const o = el("option", null, a.name); o.value = a.id; sel.append(o); });
}

function itemNode(t) {
  const li = el("li", "item" + (t.done ? " done" : ""));
  const info = t.done ? null : dueInfo(t.due);
  if (info && info.cls) li.classList.add(info.cls);
  const cb = el("input", "check"); cb.type = "checkbox"; cb.checked = !!t.done;
  cb.setAttribute("aria-label", (t.done ? "Wieder öffnen: " : "Erledigt: ") + t.title);
  cb.onchange = () => {
    const done = cb.checked;
    mutate((list) => list.map((x) => x.id === t.id ? {...x, done, doneAt: done ? new Date().toISOString() : null} : x),
      (done ? "Erledigt: " : "Wieder offen: ") + t.title);
  };
  const body = el("div", "body");
  body.append(el("span", "title", t.title));
  if (t.note) body.append(el("span", "note", t.note));
  const meta = el("div", "meta");
  if (info) meta.append(el("span", "due", info.text));
  if (filter === "alle") meta.append(el("span", "area-tag", areaName(t.area)));
  if (t.done) {
    const d = el("button", "del", "Löschen"); d.type = "button";
    d.onclick = () => mutate((list) => list.filter((x) => x.id !== t.id), "Gelöscht: " + t.title);
    meta.append(d);
  }
  if (meta.childNodes.length) body.append(meta);
  li.append(cb, body);
  return li;
}

const sortOpen = (a, b) => (a.due || "9999").localeCompare(b.due || "9999") || (a.createdAt || "").localeCompare(b.createdAt || "");

function render() {
  const list = $("list"); list.replaceChildren();
  const allOpen = todos.filter((t) => !t.done);
  const late = allOpen.filter((t) => { const i = dueInfo(t.due); return i && i.cls === "late"; }).length;
  const sum = $("summary"); sum.replaceChildren();
  const s1 = el("span"); s1.append(el("b", null, String(allOpen.length)), " offen"); sum.append(s1);
  if (late) { const s2 = el("span", "late"); s2.append(el("b", null, String(late)), " überfällig oder heute"); sum.append(s2); }
  const s3 = el("span"); s3.append(el("b", null, String(todos.length - allOpen.length)), " erledigt"); sum.append(s3);

  if (!store.get(K.token) && !todos.length) return;
  const visible = todos.filter((t) => filter === "alle" || t.area === filter);
  const open = visible.filter((t) => !t.done).sort(sortOpen);
  const done = visible.filter((t) => t.done).sort((a, b) => (b.doneAt || "").localeCompare(a.doneAt || ""));
  if (!todos.length) { list.append(el("p", "empty", "Noch keine To-dos. Trag unten das erste ein.")); return; }
  const groups = filter === "alle" ? AREAS.map((a) => a.id) : [filter];
  let any = false;
  groups.forEach((g) => {
    const items = open.filter((t) => t.area === g || (g === "privat" && !AREAS.some((a) => a.id === t.area)));
    if (!items.length) return; any = true;
    const sec = el("section"); const h = el("h2");
    h.append(el("span", null, areaName(g)), el("span", null, String(items.length)));
    const ul = el("ul"); items.forEach((t) => ul.append(itemNode(t)));
    sec.append(h, ul); list.append(sec);
  });
  if (!any) list.append(el("p", "empty", "Hier ist alles erledigt."));
  if (done.length) {
    const det = el("details"); det.append(el("summary", null, `Erledigt (${done.length})`));
    const ul = el("ul"); done.forEach((t) => ul.append(itemNode(t))); det.append(ul);
    const sec = el("section"); sec.append(det); list.append(sec);
  }
}

function setStatus(msg) { const s = $("status"); s.textContent = msg || ""; s.hidden = !msg; }
function spin(on) { $("sync").classList.toggle("spin", on); }
function showSetup(on) {
  $("setup").hidden = !on;
  $("add").hidden = on;
  $("logout").hidden = on;
}

// ---------- Ereignisse ----------
function tokenMsg(text, ok) {
  const m = $("token-msg"); m.textContent = text || ""; m.hidden = !text; m.classList.toggle("ok", !!ok);
}
const cleanToken = (s) => (s || "").replace(/\s+/g, "").replace(/^["'“”„]+|["'“”„]+$/g, "");

$("paste").addEventListener("click", async () => {
  try {
    const t = cleanToken(await navigator.clipboard.readText());
    if (t) { $("token").value = t; tokenMsg(""); } else tokenMsg("In der Zwischenablage ist nichts. Kopier den Schlüssel bei GitHub nochmal.");
  } catch (e) { tokenMsg("Einfügen per Knopf geht hier nicht. Tipp lange ins Feld und wähle „Einsetzen“."); $("token").focus(); }
});

// Schlüssel erst speichern, wenn GitHub ihn angenommen hat.
$("token-form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const v = cleanToken($("token").value);
  if (!v) { tokenMsg("Das Feld ist leer. Füg zuerst den Schlüssel ein."); return; }
  if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(v)) {
    tokenMsg("Das sieht nicht wie ein GitHub-Schlüssel aus. Er beginnt mit „github_pat_“. Bitte ganz kopieren.");
    return;
  }
  const btn = $("connect"); btn.disabled = true; btn.textContent = "Prüfe …"; tokenMsg("");
  const old = store.get(K.token);
  store.set(K.token, v);
  try {
    const r = await load();
    todos = r.todos; sha = r.sha; cache();
    $("token").value = ""; tokenMsg("");
    showSetup(false); setStatus(""); render();
  } catch (e) {
    if (old) store.set(K.token, old); else store.del(K.token);
    const why = {
      auth: "GitHub lehnt den Schlüssel ab. Entweder falsch kopiert oder er hat bei „Repository permissions → Contents“ nicht „Read and write“.",
      notfound: "Der Schlüssel sieht das Repo nicht. Bei „Repository access“ muss „Only select repositories → termed-todo-data“ gewählt sein.",
    }[e.code] || (navigator.onLine ? "Verbinden hat nicht geklappt (Fehler " + (e.message || "?") + "). Versuch es gleich nochmal." : "Du bist offline. Verbinden geht nur mit Internet.");
    tokenMsg(why);
  } finally { btn.disabled = false; btn.textContent = "Verbinden"; }
});
$("logout").addEventListener("click", () => { store.del(K.token); todos = []; store.del(K.cache); showSetup(true); render(); });
$("sync").addEventListener("click", refresh);
$("add").addEventListener("submit", (ev) => {
  ev.preventDefault();
  const title = $("f-title").value.trim(); if (!title) return;
  const item = {id: "t" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), title,
    area: $("f-area").value, due: $("f-due").value || null, note: $("f-note").value.trim() || null,
    done: false, doneAt: null, createdAt: new Date().toISOString(), by: "tobias"};
  $("f-title").value = ""; $("f-note").value = ""; $("f-due").value = "";
  mutate((list) => [...list, item], "Neu: " + title);
});
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && !busy) refresh(); });

// ---------- Start ----------
renderFilters();
try { const c = JSON.parse(store.get(K.cache) || "null"); if (c && Array.isArray(c.todos)) todos = c.todos; } catch (e) {}
showSetup(!store.get(K.token));
render();
refresh();
