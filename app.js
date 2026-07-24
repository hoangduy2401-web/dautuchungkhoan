/* ============================================================
   STATE
   ============================================================ */
// The watchlist survives reloads; DEFAULT_WATCHLIST is only the first-run seed.
const WATCHLIST_KEY = "vn_dashboard_watchlist_v1";

function loadWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(WATCHLIST_KEY));
    // An empty saved list is intentional (user removed everything) — keep it.
    if (Array.isArray(saved)) return saved;
  } catch {
    /* corrupted entry -> fall back to the seed */
  }
  return [...APP_CONFIG.DEFAULT_WATCHLIST];
}

function saveWatchlist() {
  try {
    localStorage.setItem(WATCHLIST_KEY, JSON.stringify(state.watchlist));
  } catch (err) {
    console.warn("[watchlist] không lưu được:", err.message);
  }
}

const state = {
  watchlist: loadWatchlist(),
  selected: null, // set right below, once the watchlist is known
  range: 90,
  quotes: {}, // symbol -> {price, changePct, volume}
  sparks: {}, // symbol -> [close, ...] recent closes for the watchlist sparkline
  indices: [], // [{code, value, changePct}] — kept so a transient 0 can fall back
  marketTab: "heatmap", // heatmap | sector | rank — active market-overview pane
  chart: null,
};

// VN30 → sector, for the "Theo ngành" tab (average % change per sector).
const SECTOR_MAP = {
  ACB: "Ngân hàng", BID: "Ngân hàng", CTG: "Ngân hàng", HDB: "Ngân hàng", LPB: "Ngân hàng",
  MBB: "Ngân hàng", SHB: "Ngân hàng", SSB: "Ngân hàng", STB: "Ngân hàng", TCB: "Ngân hàng",
  TPB: "Ngân hàng", VCB: "Ngân hàng", VIB: "Ngân hàng", VPB: "Ngân hàng",
  BCM: "Bất động sản", VHM: "Bất động sản", VIC: "Bất động sản", VRE: "Bất động sản",
  SSI: "Chứng khoán",
  MSN: "Bán lẻ & tiêu dùng", MWG: "Bán lẻ & tiêu dùng", SAB: "Bán lẻ & tiêu dùng", VNM: "Bán lẻ & tiêu dùng",
  GVR: "Thép & vật liệu", HPG: "Thép & vật liệu",
  GAS: "Dầu khí", PLX: "Dầu khí",
  FPT: "Công nghệ", VJC: "Hàng không", BVH: "Bảo hiểm",
};
state.selected = state.watchlist[0] || null;

// Some upstream fields have no data source yet and arrive as null -> show a dash.
const hasVal = (n) => n !== null && n !== undefined && Number.isFinite(Number(n));
const fmt = (n, d = 2) =>
  hasVal(n)
    ? Number(n).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d })
    : "—";
const fmtPct = (n) => (hasVal(n) ? `${n >= 0 ? "+" : ""}${Number(n).toFixed(2)}%` : "—");
const trendClass = (n) => (n > 0.001 ? "up" : n < -0.001 ? "down" : "flat");
const arrow = (n) => (n > 0.001 ? "▲" : n < -0.001 ? "▼" : "•");

// Build a 56×22 sparkline polyline from a list of closes (last ~24 used).
// Returns "" when there is not enough data yet so the row renders without it.
function sparkPoints(closes, w = 56, h = 22, pad = 2) {
  if (!Array.isArray(closes) || closes.length < 2) return "";
  const tail = closes.slice(-24);
  const mn = Math.min(...tail), mx = Math.max(...tail), rg = mx - mn || 1;
  return tail
    .map((v, i) => `${((i / (tail.length - 1)) * w).toFixed(1)},${(h - pad - ((v - mn) / rg) * (h - 2 * pad)).toFixed(1)}`)
    .join(" ");
}

// News comes from an external RSS source, so escape any text before injecting it
// as innerHTML and allow only http(s) links (blocks e.g. javascript: URLs).
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeUrl = (u) => (/^https?:\/\//i.test(String(u || "")) ? String(u) : "#");

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("mockBadge").style.display = APP_CONFIG.USE_MOCK ? "inline-block" : "none";
  tickClock();
  setInterval(tickClock, 1000);

  renderRangeTabs();
  wireMarketTabs();
  wireForms();
  wireAccountSync();
  ChartModule.init("priceChartContainer", "rsiChartContainer", "trendOverlay");
  wireChartToolbar();
  wireThemeControls();

  refreshAll();
  scheduleRefreshLoop();
});

/* ============================================================
   LIQUID GLASS THEME CONTROLS — Sáng/Tối toggle + Trong/Đục slider
   Mirrors the approved mock. The slider drives the glass fill alpha;
   toggling the theme re-applies chart colours (chart reads CSS vars).
   ============================================================ */
// Per-theme glass alpha range for the slider (0 = Trong/clear, 100 = Đục).
const GLASS = {
  light: { min: 0.20, max: 0.85, raiseDelta: 0.18, def: 29 },
  dark: { min: 0.02, max: 0.22, raiseDelta: 0.045, def: 15 },
};
let currentTheme = document.documentElement.getAttribute("data-theme") || "light";

function setGlass(v) {
  const g = GLASS[currentTheme] || GLASS.light;
  const a = g.min + (g.max - g.min) * (v / 100);
  const root = document.documentElement;
  root.style.setProperty("--glass-a", a.toFixed(3));
  root.style.setProperty("--glass-raised-a", Math.min(a + g.raiseDelta, 0.98).toFixed(3));
}

function setTheme(t) {
  currentTheme = t;
  document.documentElement.setAttribute("data-theme", t);
  const dark = document.getElementById("tDark");
  const light = document.getElementById("tLight");
  if (dark) dark.classList.toggle("on", t === "dark");
  if (light) light.classList.toggle("on", t === "light");
  const range = document.getElementById("glassRange");
  if (range) { range.value = GLASS[t].def; setGlass(range.value); }
  // Chart colours (grid/text) come from CSS vars — re-apply after theme swap.
  if (typeof ChartModule.applyTheme === "function") ChartModule.applyTheme();
}

function wireThemeControls() {
  const light = document.getElementById("tLight");
  const dark = document.getElementById("tDark");
  const range = document.getElementById("glassRange");
  if (light) light.addEventListener("click", () => setTheme("light"));
  if (dark) dark.addEventListener("click", () => setTheme("dark"));
  if (range) range.addEventListener("input", (e) => setGlass(e.target.value));
  setTheme(currentTheme); // sync button state + slider + glass to the initial theme
}

// Self-scheduling loop: the next refresh is queued only AFTER the current one
// finishes, so a slow cycle can never stack on top of another (which used to
// multiply concurrent SSI calls and choke the backend).
function scheduleRefreshLoop() {
  setTimeout(async () => {
    await refreshAll();
    scheduleRefreshLoop();
  }, APP_CONFIG.REFRESH_INTERVAL_MS);
}

function wireChartToolbar() {
  document.getElementById("chkMA10").addEventListener("change", (e) => ChartModule.toggleSeries("ma10", e.target.checked));
  document.getElementById("chkMA20").addEventListener("change", (e) => ChartModule.toggleSeries("ma20", e.target.checked));
  document.getElementById("chkBB").addEventListener("change", (e) => ChartModule.toggleSeries("bb", e.target.checked));
  document.getElementById("chkVol").addEventListener("change", (e) => ChartModule.toggleSeries("volume", e.target.checked));
  document.getElementById("chkRSI").addEventListener("change", (e) => ChartModule.toggleSeries("rsi", e.target.checked));

  const drawBtn = document.getElementById("drawTrendBtn");
  let drawing = false;
  drawBtn.addEventListener("click", () => {
    drawing = !drawing;
    drawBtn.classList.toggle("active", drawing);
    ChartModule.setDrawMode(drawing);
  });
  document.addEventListener("trendline-drawn", () => {
    drawing = false;
    drawBtn.classList.remove("active");
  });
  document.getElementById("clearTrendBtn").addEventListener("click", () => ChartModule.clearTrendline());
}

function tickClock() {
  document.getElementById("clock").textContent = new Date().toLocaleString("vi-VN");
}

let refreshInFlight = false;
async function refreshAll() {
  if (refreshInFlight) return; // never run two refresh cycles at once
  refreshInFlight = true;
  try {
    await Promise.all([loadIndices(), loadTapeQuotes()]);
    renderTickerTape();
    renderHeatmap();
    renderSectors();
    renderRankings();
    renderWatchlist();
    await loadSelectedSymbol();
    await refreshPortfolio();
    loadSparklines(); // non-blocking: sparklines fill in once histories arrive
  } finally {
    refreshInFlight = false;
  }
}

/* ============================================================
   INDEX STRIP
   ============================================================ */
async function loadIndices() {
  try {
    const fresh = await DataService.getIndices();
    // Defensive: if a refresh returns a 0/blank value for an index (SSI can emit
    // a transient 0 during the ATO auction), keep the last good value we had
    // instead of flashing 0 on the board.
    const prev = new Map(state.indices.map((ix) => [ix.code, ix]));
    state.indices = fresh.map((ix) =>
      ix.value > 0 ? ix : prev.get(ix.code) || ix
    );
  } catch (e) {
    console.error(e);
    if (!state.indices) state.indices = [];
  }
  const el = document.getElementById("indexStrip");
  el.innerHTML = state.indices
    .map(
      (ix) => `
    <div class="index-card">
      <div class="code">${ix.code}</div>
      <div class="val">${fmt(ix.value, 2)}</div>
      <div class="chg ${trendClass(ix.changePct)}">${arrow(ix.changePct)} ${fmtPct(ix.changePct)}</div>
    </div>`
    )
    .join("");
}

/* ============================================================
   TICKER TAPE
   ============================================================ */
function renderTickerTape() {
  // The tape runs the full VN30 basket, independent of the personal watchlist.
  const items = APP_CONFIG.VN30
    .map((s) => {
      const q = state.quotes[s];
      if (!q) return "";
      return `<span class="ticker-item"><span class="sym">${s}</span><span class="${trendClass(
        q.changePct
      )}">${fmt(q.price)} ${arrow(q.changePct)} ${fmtPct(q.changePct)}</span></span>`;
    })
    .join("");
  // duplicate content for seamless scroll loop
  document.getElementById("tickerTrack").innerHTML = items + items;
}

/* ============================================================
   VN30 HEATMAP
   ============================================================ */
// Map a daily % change to a cell colour. Fixed hue (150 green up / 355 red down),
// lightness scales with |%|: near-flat ≈ 92% (pale), a ≥4.5% mover ≈ 45% (deep),
// so big movers visually pop instead of every up/down looking equally saturated.
function heatColor(pct) {
  const mag = Math.min(Math.abs(pct || 0) / 4.5, 1);
  const light = 92 - mag * 47;
  return (pct || 0) >= 0
    ? `hsl(150,55%,${light.toFixed(1)}%)`
    : `hsl(355,70%,${light.toFixed(1)}%)`;
}

function renderHeatmap() {
  const el = document.getElementById("vn30Heatmap");
  if (!el) return;
  // Biggest gainers first, losers last; symbols without a quote yet sink down.
  const rows = APP_CONFIG.VN30
    .map((s) => ({ s, q: state.quotes[s] }))
    .sort((a, b) => {
      const av = a.q ? a.q.changePct : -Infinity;
      const bv = b.q ? b.q.changePct : -Infinity;
      return bv - av;
    });
  el.innerHTML = rows
    .map(({ s, q }) => {
      if (!q) {
        return `<div class="heat-cell heat-empty"><span class="hc-sym">${s}</span><span class="hc-pct">—</span></div>`;
      }
      const cls = q.changePct > 0 ? "up" : q.changePct < 0 ? "down" : "flat";
      return `<div class="heat-cell ${cls}" data-symbol="${s}" style="background:${heatColor(
        q.changePct
      )}" title="${s} · ${fmt(q.price)} · ${fmtPct(q.changePct)}">
        <span class="hc-sym">${s}</span>
        <span class="hc-pct">${fmtPct(q.changePct)}</span>
      </div>`;
    })
    .join("");

  // Click a cell to load that symbol in the chart, like the watchlist rows.
  el.querySelectorAll(".heat-cell[data-symbol]").forEach((cell) => {
    cell.addEventListener("click", () => {
      state.selected = cell.dataset.symbol;
      loadSelectedSymbol();
      renderWatchlist();
    });
  });
}

/* ============================================================
   MARKET OVERVIEW — SECTOR + RANKINGS TABS
   Both derive from the already-warmed VN30 quotes; no extra API calls.
   ============================================================ */
// Return the VN30 symbols that have a quote, as {s, chg, price} rows.
function vn30Quoted() {
  return APP_CONFIG.VN30.map((s) => ({ s, q: state.quotes[s] }))
    .filter((r) => r.q)
    .map((r) => ({ s: r.s, chg: r.q.changePct, price: r.q.price }));
}

function renderSectors() {
  const el = document.getElementById("sectorList");
  if (!el) return;
  const rows = vn30Quoted();
  const agg = {};
  rows.forEach(({ s, chg }) => {
    const sec = SECTOR_MAP[s] || "Khác";
    (agg[sec] = agg[sec] || { sum: 0, n: 0 }).sum += chg;
    agg[sec].n += 1;
  });
  const list = Object.keys(agg)
    .map((name) => ({ name, avg: agg[name].sum / agg[name].n }))
    .sort((a, b) => b.avg - a.avg);
  const maxAbs = Math.max(...list.map((x) => Math.abs(x.avg)), 0.1);
  el.innerHTML = list
    .map((x) => {
      const up = x.avg >= 0;
      const color = up ? "var(--up)" : "var(--down)";
      const w = (Math.abs(x.avg) / maxAbs) * 100;
      return `<div class="sector-row">
        <div class="s-name">${x.name}</div>
        <div class="s-track"><div class="s-fill" style="width:${w.toFixed(1)}%;background:${color}"></div></div>
        <div class="s-val" style="color:${color}">${up ? "+" : ""}${x.avg.toFixed(2)}%</div>
      </div>`;
    })
    .join("");
}

function renderRankings() {
  const gEl = document.getElementById("topGainers");
  const lEl = document.getElementById("topLosers");
  if (!gEl || !lEl) return;
  const sorted = vn30Quoted().sort((a, b) => b.chg - a.chg);
  const row = (r) => `<div class="rank-row ${r.s === state.selected ? "active" : ""}" data-symbol="${r.s}">
      <div class="r-sym">${r.s}</div>
      <div class="r-price">${fmt(r.price)}</div>
      <div class="r-chg ${trendClass(r.chg)}">${arrow(r.chg)} ${fmtPct(r.chg)}</div>
    </div>`;
  gEl.innerHTML = sorted.slice(0, 5).map(row).join("");
  lEl.innerHTML = sorted.slice(-5).reverse().map(row).join("");

  [gEl, lEl].forEach((box) =>
    box.querySelectorAll(".rank-row[data-symbol]").forEach((r) => {
      r.addEventListener("click", () => {
        state.selected = r.dataset.symbol;
        loadSelectedSymbol();
        renderWatchlist();
        renderRankings();
      });
    })
  );
}

// Tab switcher: toggle active button + which pane is visible. Data for all panes
// is pre-rendered on refresh, so switching is just show/hide.
function wireMarketTabs() {
  const tabs = document.getElementById("marketTabs");
  if (!tabs) return;
  tabs.querySelectorAll("button[data-mtab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.marketTab = btn.dataset.mtab;
      tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".mtab-pane").forEach((p) => {
        p.hidden = p.dataset.pane !== state.marketTab;
      });
    });
  });
}

/* ============================================================
   WATCHLIST
   ============================================================ */
async function loadWatchlistQuotes() {
  await loadQuotesFor(state.watchlist);
}

// Quotes needed on screen = VN30 tape + personal watchlist, deduped. Backend
// warms the VN30 basket so these are served from cache, not fresh SSI hits.
async function loadTapeQuotes() {
  const symbols = [...new Set([...APP_CONFIG.VN30, ...state.watchlist])];
  await loadQuotesFor(symbols);
}

async function loadQuotesFor(symbols) {
  const results = await Promise.all(
    symbols.map((s) =>
      DataService.getQuote(s)
        .then((q) => [s, q])
        .catch(() => [s, null])
    )
  );
  results.forEach(([s, q]) => {
    if (q) state.quotes[s] = q;
  });
}

// Fetch a short close-price history per watched symbol for its row sparkline.
// Cached in state.sparks so the refresh loop only fetches symbols not seen yet
// (sparkline shape barely moves intraday — no need to refetch every cycle).
async function loadSparklines() {
  const missing = state.watchlist.filter((s) => !state.sparks[s]);
  if (missing.length === 0) return;
  await Promise.all(
    missing.map((s) =>
      DataService.getHistory(s, 40)
        .then((rows) => {
          if (Array.isArray(rows) && rows.length) state.sparks[s] = rows.map((r) => r.close);
        })
        .catch(() => {})
    )
  );
  renderWatchlist();
}

function renderWatchlist() {
  const el = document.getElementById("watchlist");
  if (state.watchlist.length === 0) {
    el.innerHTML = `<div class="empty-state">Chưa có mã theo dõi.<br>Thêm mã ở ô phía trên.</div>`;
    return;
  }
  el.innerHTML = state.watchlist
    .map((s) => {
      const q = state.quotes[s] || { price: 0, changePct: 0 };
      const info = DataService.getCompanyInfo(s);
      const pts = sparkPoints(state.sparks[s]);
      const sparkColor = q.changePct >= 0 ? "var(--up)" : "var(--down)";
      const spark = pts
        ? `<svg class="spark" width="56" height="22" viewBox="0 0 56 22" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${sparkColor}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"></polyline></svg>`
        : "";
      return `
      <div class="watch-item ${s === state.selected ? "active" : ""}" data-symbol="${s}">
        <span class="drag" title="Kéo để sắp xếp" aria-label="Kéo để sắp xếp">☰</span>
        <div>
          <div class="sym">${s}</div>
          <div class="name">${info.name}</div>
        </div>
        ${spark}
        <div class="right">
          <div class="price">${fmt(q.price)}</div>
          <div class="chg ${trendClass(q.changePct)}">${fmtPct(q.changePct)}</div>
        </div>
        <span class="rm" data-remove="${s}" title="Bỏ theo dõi">✕</span>
      </div>`;
    })
    .join("");

  el.querySelectorAll(".watch-item").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.dataset.remove) return;
      if (e.target.closest(".drag")) return; // handle is for dragging, not select
      state.selected = row.dataset.symbol;
      loadSelectedSymbol();
      renderWatchlist();
    });
  });
  enableWatchlistDrag(el);
  el.querySelectorAll("[data-remove]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const sym = btn.dataset.remove;
      state.watchlist = state.watchlist.filter((s) => s !== sym);
      if (state.selected === sym) state.selected = state.watchlist[0];
      saveWatchlist();
      renderWatchlist();
      renderTickerTape();
      if (state.selected) loadSelectedSymbol();
    });
  });
}

// Pointer-based drag reorder (works with mouse AND touch, no HTML5 DnD which is
// unreliable on mobile). Grab the ☰ handle, drag a row past its neighbours; the
// new order is read back from the DOM and persisted on release.
function enableWatchlistDrag(el) {
  let dragging = null;
  let moved = false;

  const rowAfter = (y) => {
    const rows = [...el.querySelectorAll(".watch-item:not(.dragging)")];
    return rows.find((r) => {
      const b = r.getBoundingClientRect();
      return y < b.top + b.height / 2;
    }) || null;
  };

  el.querySelectorAll(".drag").forEach((handle) => {
    handle.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragging = handle.closest(".watch-item");
      moved = false;
      dragging.classList.add("dragging");
      handle.setPointerCapture(e.pointerId);
    });
    handle.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      moved = true;
      const after = rowAfter(e.clientY);
      if (after == null) el.appendChild(dragging);
      else if (after !== dragging) el.insertBefore(dragging, after);
    });
    const finish = () => {
      if (!dragging) return;
      dragging.classList.remove("dragging");
      dragging = null;
      if (!moved) return; // a plain tap on the handle: nothing to reorder
      state.watchlist = [...el.querySelectorAll(".watch-item")].map((r) => r.dataset.symbol);
      saveWatchlist();
      renderWatchlist(); // re-render to re-wire handlers on the new DOM
    };
    handle.addEventListener("pointerup", finish);
    handle.addEventListener("pointercancel", finish);
  });
}

function wireForms() {
  document.getElementById("addSymbolForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const input = document.getElementById("newSymbol");
    const sym = input.value.trim().toUpperCase();
    input.value = "";
    if (!sym) return;
    if (!state.watchlist.includes(sym)) state.watchlist.push(sym);
    state.selected = sym;
    saveWatchlist();
    DataService.getQuote(sym)
      .then((q) => (state.quotes[sym] = q))
      .finally(() => {
        renderWatchlist();
        renderTickerTape();
        loadSelectedSymbol();
        loadSparklines(); // fetch the new symbol's sparkline history
      });
  });

  document.getElementById("txForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = e.target;
    Portfolio.add({
      symbol: f.symbol.value,
      type: f.type.value,
      qty: f.qty.value,
      price: f.price.value,
      date: f.date.value || new Date().toISOString().slice(0, 10),
      note: f.note.value,
    });
    f.reset();
    refreshPortfolio(); // pull the new symbol's quote if we don't have it yet
  });
}

/* ============================================================
   SELECTED SYMBOL: CHART + FUNDAMENTALS + NEWS
   ============================================================ */
function renderRangeTabs() {
  const ranges = [
    { label: "1M", days: 30 },
    { label: "3M", days: 90 },
    { label: "6M", days: 180 },
    { label: "1Y", days: 365 },
    // 5Y ~ 1250 trading days; the backend chunks history in 30-day calls, so the
    // first uncached load of this range is slow (~40 SSI calls). Cached after.
    { label: "5Y", days: 1825 },
  ];
  const el = document.getElementById("rangeTabs");
  el.innerHTML = ranges
    .map((r) => `<button data-days="${r.days}" class="${r.days === state.range ? "active" : ""}">${r.label}</button>`)
    .join("");
  el.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.range = Number(btn.dataset.days);
      renderRangeTabs();
      loadSelectedSymbol();
    });
  });
}

async function loadSelectedSymbol() {
  if (!state.selected) return;
  const sym = state.selected;
  const info = DataService.getCompanyInfo(sym);
  const q = state.quotes[sym] || (await DataService.getQuote(sym));
  state.quotes[sym] = q;

  document.getElementById("symbolTitle").innerHTML = `
    <span class="sym">${sym}</span>
    <span class="name">${info.name} · ${info.exchange}</span>
    <span class="price ${trendClass(q.changePct)}">${fmt(q.price)} <small>${fmtPct(q.changePct)}</small></span>
  `;

  const [history, fundamentals, news] = await Promise.all([
    DataService.getHistory(sym, state.range),
    DataService.getFundamentals(sym),
    DataService.getNews(state.watchlist),
  ]);

  ChartModule.setData(history);
  renderFundamentals(fundamentals);
  renderNews(news);
}

function renderFundamentals(f) {
  const cells = [
    ["Vốn hóa (nghìn tỷ)", fmt(f.marketCap, 1)],
    ["P/E", fmt(f.pe, 1)],
    ["P/B", fmt(f.pb, 2)],
    ["EPS (nghìn đ)", fmt(f.eps, 2)],
    ["ROE (%)", fmt(f.roe, 1)],
    ["ROA (%)", fmt(f.roa, 1)],
    ["Cổ tức (%)", fmt(f.dividendYield, 1)],
    ["DT YoY (%)", fmtPct(f.revenueYoY)],
    ["LNST YoY (%)", fmtPct(f.netProfitYoY)],
    ["Nợ/Vốn CSH", fmt(f.debtToEquity, 2)],
  ];
  document.getElementById("fundGrid").innerHTML = cells
    .map(([label, value]) => `<div class="fund-cell"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join("");
}

function renderNews(items) {
  const el = document.getElementById("newsList");
  if (!items.length) {
    el.innerHTML = `<div class="empty-state">Chưa có tin tức.</div>`;
    return;
  }
  el.innerHTML = items
    .slice(0, 12)
    .map((n) => {
      const t = new Date(n.time);
      const hoursAgo = Math.max(1, Math.round((Date.now() - t) / 3600000));
      return `
      <div class="news-item">
        <div class="meta"><span class="tag">${escapeHtml(n.symbol)}</span><span>${escapeHtml(n.source)}</span><span>${hoursAgo}h trước</span></div>
        <div class="title"><a href="${escapeHtml(safeUrl(n.url))}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a></div>
      </div>`;
    })
    .join("");
}

/* ============================================================
   PORTFOLIO / TRANSACTION HISTORY
   ============================================================ */
// Held symbols may sit outside the VN30 tape + watchlist (the only quotes loaded
// by the refresh loop), so fetch quotes for any holding we don't have yet —
// otherwise its live price falls back to cost basis and P&L shows 0.
async function loadHoldingQuotes() {
  const held = Portfolio.computeHoldings({})
    .filter((h) => h.qty > 0)
    .map((h) => h.symbol);
  const missing = [...new Set(held)].filter((s) => !state.quotes[s]);
  if (missing.length) await loadQuotesFor(missing);
}

// Load any missing holding quotes, then render. Used after the refresh loop and
// after a transaction is added/removed.
async function refreshPortfolio() {
  await loadHoldingQuotes();
  renderPortfolio();
}

function renderPortfolio() {
  const currentPrices = {};
  Object.entries(state.quotes).forEach(([s, q]) => (currentPrices[s] = q.price));

  const holdings = Portfolio.computeHoldings(currentPrices);
  const totalValue = holdings.reduce((a, h) => a + h.marketValue, 0);
  const totalUnrealized = holdings.reduce((a, h) => a + h.unrealizedPL, 0);
  const totalRealized = holdings.reduce((a, h) => a + h.realizedPL, 0);

  document.getElementById("holdingsSummary").innerHTML = `
    <div class="stat"><div class="label">Giá trị danh mục</div><div class="val">${fmt(totalValue, 1)} tr đ</div></div>
    <div class="stat"><div class="label">Lãi/lỗ tạm tính</div><div class="val ${trendClass(totalUnrealized)}">${fmt(totalUnrealized, 1)} tr đ</div></div>
    <div class="stat"><div class="label">Lãi/lỗ đã chốt</div><div class="val ${trendClass(totalRealized)}">${fmt(totalRealized, 1)} tr đ</div></div>
  `;

  const holdEl = document.getElementById("holdingsTable");
  holdEl.innerHTML = holdings.length
    ? `<table>
        <thead><tr><th>Mã</th><th class="num">KL</th><th class="num">Giá vốn TB</th><th class="num">Giá hiện tại</th><th class="num">Lãi/lỗ</th></tr></thead>
        <tbody>${holdings
          .map(
            (h) => `<tr>
              <td>${h.symbol}</td>
              <td class="num">${fmt(h.qty, 0)}</td>
              <td class="num">${fmt(h.avgCost)}</td>
              <td class="num">${fmt(h.currentPrice)}</td>
              <td class="num ${trendClass(h.unrealizedPL)}">${fmt(h.unrealizedPL, 1)} (${fmtPct(h.unrealizedPLPct)})</td>
            </tr>`
          )
          .join("")}</tbody>
      </table>`
    : `<div class="empty-state">Chưa có mã nào đang nắm giữ.</div>`;

  const txs = Portfolio.list().sort((a, b) => new Date(b.date) - new Date(a.date));
  const txEl = document.getElementById("txTable");
  txEl.innerHTML = txs.length
    ? `<table>
        <thead><tr><th>Ngày</th><th>Mã</th><th>Loại</th><th class="num">KL</th><th class="num">Giá</th><th>Ghi chú</th><th></th></tr></thead>
        <tbody>${txs
          .map(
            (t) => `<tr>
              <td>${t.date}</td>
              <td>${t.symbol}</td>
              <td><span class="pill ${t.type}">${t.type === "buy" ? "MUA" : "BÁN"}</span></td>
              <td class="num">${fmt(t.qty, 0)}</td>
              <td class="num">${fmt(t.price)}</td>
              <td>${t.note || "—"}</td>
              <td><button class="del-btn" data-id="${t.id}" title="Xóa">✕</button></td>
            </tr>`
          )
          .join("")}</tbody>
      </table>`
    : `<div class="empty-state">Chưa có giao dịch nào. Thêm giao dịch đầu tiên ở bên trái.</div>`;

  txEl.querySelectorAll("[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      Portfolio.remove(btn.dataset.id);
      renderPortfolio();
    });
  });
}

/* ============================================================
   SSI ACCOUNT SYNC (read-only)
   The dashboard API key unlocks the account endpoints on the proxy.
   It is NOT an SSI credential — PIN/OTP are never stored, they are
   passed straight through to the backend for one login call.
   ============================================================ */
const API_KEY_STORAGE = "vn_dashboard_api_key_v1";

function getApiKey({ prompt: askAgain = false } = {}) {
  let key = localStorage.getItem(API_KEY_STORAGE);
  if (!key || askAgain) {
    key = window.prompt("Nhập khóa truy cập dashboard (DASHBOARD_API_KEY):", key || "");
    if (!key) return null;
    localStorage.setItem(API_KEY_STORAGE, key.trim());
  }
  return key.trim();
}

function setAccountStatus(text, kind = "") {
  const el = document.getElementById("accountStatus");
  el.textContent = text;
  el.className = `account-status ${kind}`;
}

function wireAccountSync() {
  document.getElementById("syncAccountBtn").addEventListener("click", () => syncAccount());
}

async function syncAccount(retryCode) {
  const key = getApiKey();
  if (!key) return;

  setAccountStatus("Đang đồng bộ...", "");
  try {
    if (retryCode) await DataService.loginAccount(key, retryCode);
    const data = await DataService.getAccountPortfolio(key);
    renderAccount(data);
  } catch (err) {
    if (err.status === 401) {
      setAccountStatus("Sai khóa truy cập", "down");
      getApiKey({ prompt: true });
      return;
    }
    if (err.status === 428 && !retryCode) {
      // PIN/OTP session expired — ask for a fresh code and retry once.
      const code = window.prompt("Nhập mã PIN hoặc OTP của SSI để đăng nhập:");
      if (code) return syncAccount(code.trim());
      setAccountStatus("Cần mã PIN/OTP", "down");
      return;
    }
    setAccountStatus(`Lỗi: ${err.message}`, "down");
    console.warn("[account]", err);
  }
}

function renderAccount({ positions, cash, fetchedAt }) {
  const time = new Date(fetchedAt).toLocaleTimeString("vi-VN");
  setAccountStatus(`Cập nhật ${time}`, "up");

  document.getElementById("accountSummary").innerHTML = `
    <div class="stat"><div class="label">Tổng tài sản</div><div class="val">${fmt(cash.totalAssets, 1)} tr đ</div></div>
    <div class="stat"><div class="label">Tiền mặt</div><div class="val">${fmt(cash.cashBal, 1)} tr đ</div></div>
    <div class="stat"><div class="label">Sức mua</div><div class="val">${fmt(cash.purchasingPower, 1)} tr đ</div></div>
    <div class="stat"><div class="label">Dư nợ</div><div class="val ${cash.debt > 0 ? "down" : ""}">${fmt(cash.debt, 1)} tr đ</div></div>
  `;

  document.getElementById("accountTable").innerHTML = positions.length
    ? `<table>
        <thead><tr><th>Mã</th><th class="num">KL</th><th class="num">Bán được</th><th class="num">Giá vốn</th><th class="num">Giá TT</th><th class="num">Giá trị</th><th class="num">Lãi/lỗ</th></tr></thead>
        <tbody>${positions
          .map(
            // data-label drives the mobile card layout (see .css @640): each cell
          // shows its column name so no info is lost when the table is stacked.
          (p) => `<tr>
              <td data-label="Mã">${p.symbol}</td>
              <td class="num" data-label="KL">${fmt(p.qty, 0)}</td>
              <td class="num" data-label="Bán được">${fmt(p.sellableQty, 0)}</td>
              <td class="num" data-label="Giá vốn">${fmt(p.avgCost)}</td>
              <td class="num" data-label="Giá TT">${fmt(p.marketPrice)}</td>
              <td class="num" data-label="Giá trị">${fmt(p.marketValue, 1)}</td>
              <td class="num ${trendClass(p.unrealizedPL)}" data-label="Lãi/lỗ">${fmt(p.unrealizedPL, 1)} (${fmtPct(p.unrealizedPLPct)})</td>
            </tr>`
          )
          .join("")}</tbody>
      </table>`
    : `<div class="empty-state">Tài khoản không có mã nào đang nắm giữ.</div>`;
}
