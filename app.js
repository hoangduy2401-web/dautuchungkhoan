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
  marketTab: "heatmap", // heatmap | sector | rank | foreign | signal
  rankExchange: "VNINDEX", // VNINDEX | HNXINDEX | UPCOM — rankings tab exchange
  chart: null,

  // --- Signals tab (FiinTrade Tier 1) ---
  sigBars: {},          // symbol -> OHLCV, fixed 180d window (NOT the chart range)
  sigBasket: "VN30",    // key into APP_CONFIG
  sigTab: "summary",    // summary | pv | ta
  sigTf: "D",           // D | W — daily or weekly bars
  sigRsiWindow: 3,      // phiên tín hiệu RSI còn hiệu lực (sai lệch #2)
  sigLoading: false,
  sigLoaded: {},        // basket key -> true once its symbols are in sigBars
};

// Fixed history window for every signal computation. Deliberately NOT
// state.range: RSI(14)/CMF(20) would give different numbers at 1M vs 6M, so the
// same symbol on the same day would show two different badges.
const SIG_DAYS = 180;

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
  wireRankExchanges();
  wireSignalTab();
  wireForms();
  wireAccountSync();
  wireAccountAccordion();
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

  // Trendline and ruler share the overlay canvas, so only one can be armed at a
  // time — arming one disarms the other. Both auto-disarm once 2 points are set.
  const drawBtn = document.getElementById("drawTrendBtn");
  const measureBtn = document.getElementById("measureBtn");
  let tool = null; // null | "trend" | "measure"

  function setTool(next) {
    tool = next;
    drawBtn.classList.toggle("active", tool === "trend");
    measureBtn.classList.toggle("active", tool === "measure");
    ChartModule.setDrawMode(tool === "trend");
    ChartModule.setMeasureMode(tool === "measure");
  }

  drawBtn.addEventListener("click", () => setTool(tool === "trend" ? null : "trend"));
  measureBtn.addEventListener("click", () => setTool(tool === "measure" ? null : "measure"));
  document.addEventListener("trendline-drawn", () => setTool(null));
  document.addEventListener("measure-drawn", () => setTool(null));

  // "Xóa" wipes both drawings and disarms whichever tool is active.
  document.getElementById("clearTrendBtn").addEventListener("click", () => {
    setTool(null);
    ChartModule.clearAll();
  });
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
    renderForeign();
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

// The stock basket ranked for each exchange tab.
function rankBasket(ex) {
  if (ex === "HNXINDEX") return APP_CONFIG.HNX30 || [];
  if (ex === "UPCOM") return APP_CONFIG.UPCOM || [];
  return APP_CONFIG.VN30;
}

function renderRankings() {
  const gEl = document.getElementById("topGainers");
  const lEl = document.getElementById("topLosers");
  if (!gEl || !lEl) return;
  const quoted = rankBasket(state.rankExchange)
    .map((s) => ({ s, q: state.quotes[s] }))
    .filter((r) => r.q)
    .map((r) => ({ s: r.s, chg: r.q.changePct, price: r.q.price }));

  if (quoted.length === 0) {
    gEl.innerHTML = lEl.innerHTML = `<div class="empty-state">Đang tải…</div>`;
    return;
  }
  const sorted = quoted.sort((a, b) => b.chg - a.chg);
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

// HNX/UPCoM baskets aren't warmed — fetch their quotes the first time the user
// opens that exchange, then cache. VN-Index reuses the already-warmed VN30.
async function loadRankPool(ex) {
  const missing = rankBasket(ex).filter((s) => !state.quotes[s]);
  if (missing.length === 0) return;
  await loadQuotesFor(missing);
  if (state.rankExchange === ex) renderRankings();
}

function wireRankExchanges() {
  const box = document.getElementById("rankExchanges");
  if (!box) return;
  box.querySelectorAll("button[data-ex]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.rankExchange = btn.dataset.ex;
      box.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      renderRankings(); // shows cached rows or a loading state immediately
      loadRankPool(state.rankExchange); // fills in HNX/UPCoM on first open
    });
  });
}

// Foreign flow: net foreign buy/sell value per VN30 symbol (tỷ đồng), sorted by
// magnitude. Reuses the netForeignVal already carried on each warmed quote.
function renderForeign() {
  const el = document.getElementById("foreignList");
  if (!el) return;
  const rows = APP_CONFIG.VN30
    .map((s) => ({ s, v: state.quotes[s] ? state.quotes[s].netForeignVal : null }))
    .filter((r) => hasVal(r.v))
    .sort((a, b) => Math.abs(b.v) - Math.abs(a.v))
    .slice(0, 15);
  if (rows.length === 0) {
    el.innerHTML = `<div class="empty-state">Chưa có dữ liệu khối ngoại.</div>`;
    return;
  }
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.v)), 0.1);
  el.innerHTML = rows
    .map((r) => {
      const buy = r.v >= 0;
      const color = buy ? "var(--up)" : "var(--down)";
      const w = (Math.abs(r.v) / maxAbs) * 100;
      return `<div class="sector-row">
        <div class="s-name">${r.s}</div>
        <div class="s-track"><div class="s-fill" style="width:${w.toFixed(1)}%;background:${color}"></div></div>
        <div class="s-val" style="color:${color}">${buy ? "+" : ""}${r.v.toFixed(1)} tỷ</div>
      </div>`;
    })
    .join("");
}

/* ============================================================
   SIGNALS TAB — FiinTrade Tier 1
   Composite signal (MA5 / RSI14 / CMF20 / ROC9 -> 3x3 matrix), price-volume
   streaks, and TA strategy screens. All maths lives in `signals.js`.

   Cost model: needs OHLCV for the WHOLE basket, which the dashboard otherwise
   never loads. So the fetch is lazy AND explicit (button), sequential to respect
   the backend's concurrency=1 limiter, and cached per basket for the session.
   It is deliberately absent from refreshAll() — a 45s loop re-fetching 50
   symbols would recreate the throttling spiral fixed on 23/07 (CLAUDE.md §6).
   ============================================================ */
const SIG_CLASS = {
  "Tăng mạnh": "sig-sb", "Tăng": "sig-b", "Trung tính": "sig-n",
  "Giảm": "sig-br", "Giảm mạnh": "sig-sbr",
};
const SIG_GROUP_CLASS = { "Tăng": "sig-b", "Trung tính": "sig-n", "Giảm": "sig-br" };

// Pick a symbol and scroll the chart into view — the signals tab sits well above
// the chart panel, so a click that only swapped the data would look like nothing
// happened.
function selectSymbol(sym) {
  if (!sym || sym === state.selected) return;
  state.selected = sym;
  renderWatchlist();
  loadSelectedSymbol();
  const chart = document.getElementById("symbolTitle");
  if (chart) chart.scrollIntoView({ behavior: "smooth", block: "center" });
}

function sigBasketSymbols() {
  return APP_CONFIG[state.sigBasket] || APP_CONFIG.VN30;
}

// Bars used for every signal: weekly is resampled from the same daily series,
// so switching timeframe costs nothing extra.
function sigBarsFor(sym) {
  const raw = state.sigBars[sym];
  if (!raw) return null;
  return state.sigTf === "W" ? Signals.toWeekly(raw) : raw;
}

async function loadSignalBasket() {
  if (state.sigLoading) return;
  const symbols = sigBasketSymbols();
  const missing = symbols.filter((s) => !state.sigBars[s]);
  const statusEl = document.getElementById("sigStatus");
  const btn = document.getElementById("sigLoadBtn");
  if (missing.length === 0) {
    state.sigLoaded[state.sigBasket] = true;
    renderSignalPane();
    return;
  }

  state.sigLoading = true;
  if (btn) btn.disabled = true;
  const t0 = Date.now();
  let ok = 0, fail = 0;

  // Sequential on purpose — the backend limiter is concurrency=1 and SSI
  // throttles parallel bursts hard.
  for (let i = 0; i < missing.length; i++) {
    if (statusEl) {
      statusEl.textContent = `Đang tải ${i + 1}/${missing.length} — ${missing[i]}… (${Math.round((Date.now() - t0) / 1000)}s)`;
    }
    try {
      const rows = await DataService.getHistory(missing[i], SIG_DAYS);
      if (Array.isArray(rows) && rows.length) { state.sigBars[missing[i]] = rows; ok++; } else fail++;
    } catch (err) {
      fail++;
      console.warn("[signals]", missing[i], err.message);
    }
    if (i % 5 === 4) renderSignalPane(); // progressive fill so the wait is visible
  }

  state.sigLoading = false;
  state.sigLoaded[state.sigBasket] = true;
  if (btn) btn.disabled = false;
  renderSignalPane(); // owns #sigStatus — writes the coverage line
  if (statusEl) {
    statusEl.textContent += ` · ${Math.round((Date.now() - t0) / 1000)}s${fail ? ` · ${fail} lỗi` : ""}`;
  }
}

function renderSignalPane() {
  const el = document.getElementById("sigPane");
  if (!el) return;
  const all = sigBasketSymbols();
  const loaded = all.filter((s) => state.sigBars[s]);

  // Baskets overlap (22 of HOSE_LIQUID's 49 are also VN30), so switching can show
  // a half-full table that looks complete. Say the coverage out loud.
  const statusEl = document.getElementById("sigStatus");
  if (statusEl && !state.sigLoading) {
    statusEl.textContent = loaded.length === all.length
      ? `đủ ${all.length} mã`
      : `${loaded.length}/${all.length} mã — bấm Tải dữ liệu để nạp ${all.length - loaded.length} mã còn lại`;
  }

  if (loaded.length === 0) {
    el.innerHTML = `<div class="sig-empty">Bấm <b>Tải dữ liệu</b> để nạp lịch sử ${SIG_DAYS} phiên cho rổ đang chọn (${sigBasketSymbols().length} mã, tải tuần tự nên mất ~30–90 giây lần đầu; sau đó dùng lại trong phiên).</div>`;
    return;
  }
  if (state.sigTab === "summary") renderSigSummary(el, loaded);
  else if (state.sigTab === "pv") renderSigPriceVolume(el, loaded);
  else renderSigStrategies(el, loaded);
}

function renderSigSummary(el, symbols) {
  const rows = symbols
    .map((s) => ({ s, sig: Signals.compute(sigBarsFor(s), state.sigRsiWindow) }))
    .filter((r) => r.sig)
    .sort((a, b) => Signals.RANK[a.sig.summary] - Signals.RANK[b.sig.summary]);

  if (rows.length === 0) {
    el.innerHTML = `<div class="sig-empty">Chưa đủ nến để tính (cần tối thiểu ${Signals.MIN_BARS}).</div>`;
    return;
  }

  el.innerHTML = `
    <div class="sig-table-wrap"><table>
      <thead><tr>
        <th>Mã</th><th class="num">Giá</th><th class="num">MA(5)</th><th>TB Động</th>
        <th class="num">RSI(14)</th><th class="num">CMF(20)</th><th class="num">ROC(9)</th>
        <th>Chỉ tiêu</th><th>Tổng hợp</th>
      </tr></thead>
      <tbody>${rows.map((r) => `
        <tr data-sym="${r.s}" style="cursor:pointer">
          <td><b>${r.s}</b></td>
          <td class="num">${fmt(r.sig.price)}</td>
          <td class="num">${fmt(r.sig.ma5)}</td>
          <td><span class="sig ${SIG_GROUP_CLASS[r.sig.maSig]}">${r.sig.maSig}</span></td>
          <td class="num ${trendClass(r.sig.rsiSig === "Tăng" ? 1 : r.sig.rsiSig === "Giảm" ? -1 : 0)}">${fmt(r.sig.rsi, 1)}</td>
          <td class="num ${trendClass(r.sig.cmf)}">${fmt(r.sig.cmf, 3)}</td>
          <td class="num ${trendClass(r.sig.roc)}">${fmt(r.sig.roc, 2)}</td>
          <td><span class="sig ${SIG_GROUP_CLASS[r.sig.indSig]}">${r.sig.indSig}</span></td>
          <td><span class="sig ${SIG_CLASS[r.sig.summary]}">${r.sig.summary}</span></td>
        </tr>`).join("")}
      </tbody>
    </table></div>
    <div class="sig-note">
      Khung <b>${state.sigTf === "W" ? "tuần" : "ngày"}</b> ·
      <button type="button" class="btn-outline" id="sigTfBtn">Đổi sang khung ${state.sigTf === "W" ? "ngày" : "tuần"}</button>
      · Cửa sổ tín hiệu RSI: <input type="number" id="sigRsiWin" min="1" max="10" value="${state.sigRsiWindow}" />
      phiên — RSI cắt lên 30 / cắt xuống 70 trong N phiên gần nhất vẫn tính là tín hiệu.
      ROC dùng ngưỡng 0 (tài liệu FiinTrade ghi 30/70 là chép nhầm từ dòng RSI).
    </div>`;

  el.querySelectorAll("tr[data-sym]").forEach((tr) => {
    tr.addEventListener("click", () => selectSymbol(tr.dataset.sym));
  });
  const tfBtn = el.querySelector("#sigTfBtn");
  if (tfBtn) tfBtn.addEventListener("click", () => { state.sigTf = state.sigTf === "W" ? "D" : "W"; renderSignalPane(); });
  const win = el.querySelector("#sigRsiWin");
  if (win) win.addEventListener("change", (e) => {
    state.sigRsiWindow = Math.max(1, Math.min(10, Number(e.target.value) || 3));
    renderSignalPane();
  });
}

function renderSigPriceVolume(el, symbols) {
  const groups = {
    "Giá tăng liên tục": [], "Giá giảm liên tục": [], "KL tăng liên tục": [],
    "KL tăng + giá tăng": [], "KL tăng + giá giảm": [],
  };
  for (const s of symbols) {
    const b = sigBarsFor(s);
    if (!b || b.length < 5) continue;
    const st = Signals.streaks(b);
    if (st.upDays > 3) groups["Giá tăng liên tục"].push({ s, n: st.upDays });
    if (st.downDays > 3) groups["Giá giảm liên tục"].push({ s, n: st.downDays });
    if (st.volUp > 3) {
      groups["KL tăng liên tục"].push({ s, n: st.volUp });
      if (st.priceVsStart > 0) groups["KL tăng + giá tăng"].push({ s, n: st.volUp });
      else if (st.priceVsStart < 0) groups["KL tăng + giá giảm"].push({ s, n: st.volUp });
    }
  }
  const cls = {
    "Giá tăng liên tục": "up", "Giá giảm liên tục": "down", "KL tăng liên tục": "",
    "KL tăng + giá tăng": "up", "KL tăng + giá giảm": "down",
  };
  el.innerHTML = Object.entries(groups).map(([name, list]) => `
    <div class="sig-group-title ${cls[name]}">${name} (${list.length})</div>
    ${list.length
      ? `<div class="sig-chips">${list.sort((a, b) => b.n - a.n)
          .map((x) => `<span class="sig-chip ${cls[name]}" data-sym="${x.s}">${x.s} · ${x.n} phiên</span>`).join("")}</div>`
      : `<div class="sig-chips"><span class="sig-chip" style="opacity:.55">Không mã nào</span></div>`}`).join("")
    + `<div class="sig-note">Chuỗi phải &gt; 3 phiên (ngưỡng của FiinTrade). Dùng phiên gần nhất đã đóng cửa — backend không có khối lượng ước lượng trong phiên.</div>`;

  el.querySelectorAll(".sig-chip[data-sym]").forEach((c) => {
    c.addEventListener("click", () => selectSymbol(c.dataset.sym));
  });
}

function renderSigStrategies(el, symbols) {
  const MONTHS = 3, VOL_RATIO = 1, MA_PCT = 1, ACCUM_RATIO = 2, ACCUM_PCT = 1;
  const rows = [];
  for (const s of symbols) {
    const b = sigBarsFor(s);
    if (!b || b.length < Signals.MIN_BARS) continue;
    const closes = b.map((x) => x.close);
    rows.push({
      s, last: b[b.length - 1],
      vr: Signals.volRatio(b), pc: Signals.pctChange(b),
      ma20: Signals.sma(closes, 20)[b.length - 1],
      ext: Signals.extremes(b, MONTHS),
    });
  }

  const breakUp = rows.filter((r) => r.ext && r.vr > VOL_RATIO && r.last.close > r.ext.high);
  const breakDn = rows.filter((r) => r.ext && r.vr > VOL_RATIO && r.last.close < r.ext.low);
  const maUp = rows.filter((r) => r.ma20 != null && r.vr > VOL_RATIO && r.last.close > r.ma20 && r.pc > MA_PCT);
  const maDn = rows.filter((r) => r.ma20 != null && r.vr > VOL_RATIO && r.last.close < r.ma20 && r.pc < -MA_PCT);
  const accum = rows.filter((r) => r.vr > ACCUM_RATIO && r.pc > ACCUM_PCT);

  const chips = (list, cls, label) => `
    <div class="sig-group-title ${cls}">${label} (${list.length})</div>
    <div class="sig-chips">${list.length
      ? list.sort((a, b) => b.vr - a.vr).map((r) =>
          `<span class="sig-chip ${cls}" data-sym="${r.s}" title="KL ${fmt(r.vr, 2)}× TB 10 phiên">${r.s} · ${fmt(r.pc, 2)}%</span>`).join("")
      : `<span class="sig-chip" style="opacity:.55">Không mã nào</span>`}</div>`;

  el.innerHTML =
    chips(breakUp, "up", `Vượt đỉnh ${MONTHS} tháng`) +
    chips(breakDn, "down", `Thủng đáy ${MONTHS} tháng`) +
    chips(maUp, "up", "Vượt lên MA20") +
    chips(maDn, "down", "Cắt xuống MA20") +
    chips(accum, "up", "Tích lũy (KL đột biến + giá tăng)") +
    `<div class="sig-note">
       Lọc chung: khối lượng phiên cuối &gt; ${VOL_RATIO}× trung bình 10 phiên trước đó — phá đỉnh/đáy mà không có khối lượng thì FiinTrade không tính là tín hiệu.
       Đỉnh/đáy so theo <b>giá đóng cửa</b>. Tích lũy cần KL &gt; ${ACCUM_RATIO}× và giá tăng &gt; ${ACCUM_PCT}%.
     </div>`;

  el.querySelectorAll(".sig-chip[data-sym]").forEach((c) => {
    c.addEventListener("click", () => selectSymbol(c.dataset.sym));
  });
}

/**
 * Signal badge beside the symbol name in the chart panel.
 * Uses the fixed SIG_DAYS window, never state.range — otherwise the badge would
 * change when the user switches 1M/3M/6M, which reads as a bug.
 * One extra call per symbol, cached in state.sigBars and shared with the tab.
 */
async function renderSymbolSignal(sym) {
  const paint = () => {
    const host = document.getElementById("symbolSignal");
    // Guard against a slow fetch landing after the user picked another symbol.
    if (!host || state.selected !== sym) return;
    const sig = Signals.compute(state.sigBars[sym], state.sigRsiWindow);
    if (!sig) { host.innerHTML = ""; return; }
    host.innerHTML = `<span class="sig ${SIG_CLASS[sig.summary]}"
      title="TB Động ${sig.maSig} · Chỉ tiêu ${sig.indSig} — RSI ${fmt(sig.rsi, 1)} · CMF ${fmt(sig.cmf, 3)} · ROC ${fmt(sig.roc, 2)}">${sig.summary}</span>`;
  };

  if (state.sigBars[sym]) { paint(); return; }
  try {
    const rows = await DataService.getHistory(sym, SIG_DAYS);
    if (Array.isArray(rows) && rows.length) state.sigBars[sym] = rows;
  } catch (err) {
    console.warn("[signal badge]", sym, err.message);
    return; // no badge is better than a wrong badge
  }
  paint();
}

function wireSignalTab() {
  const basket = document.getElementById("sigBasket");
  if (basket) basket.addEventListener("change", (e) => {
    state.sigBasket = e.target.value;
    const status = document.getElementById("sigStatus");
    if (status) status.textContent = "";
    renderSignalPane();
  });
  document.querySelectorAll("#sigSubTabs button").forEach((b) => {
    b.addEventListener("click", () => {
      state.sigTab = b.dataset.sig;
      document.querySelectorAll("#sigSubTabs button").forEach((x) => x.classList.toggle("active", x === b));
      renderSignalPane();
    });
  });
  const btn = document.getElementById("sigLoadBtn");
  if (btn) btn.addEventListener("click", () => loadSignalBasket());
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
      // Signals need whole-basket history (30–50 sequential calls). Render what
      // is already cached; the fetch itself stays behind the explicit button so
      // opening the tab never blocks the UI.
      if (state.marketTab === "signal") renderSignalPane();
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
    <span id="symbolSignal"></span>
    <span class="price ${trendClass(q.changePct)}">${fmt(q.price)} <small>${fmtPct(q.changePct)}</small></span>
  `;
  const [history, fundamentals, news] = await Promise.all([
    DataService.getHistory(sym, state.range),
    DataService.getFundamentals(sym),
    DataService.getNews(state.watchlist),
  ]);

  // Pass the dataset identity so the 45s refresh keeps any trendline/ruler the
  // user drew (same symbol + range = same anchors); switching either clears it.
  ChartModule.setData(history, `${sym}|${state.range}`);
  renderFundamentals(fundamentals);
  renderNews(news);

  // Badge LAST and un-awaited. The backend limiter runs concurrency=1, so
  // starting this before the chart would put a 180-day fetch ahead of the data
  // the user is actually looking at and delay the chart on a cold cache.
  renderSymbolSignal(sym);
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
    : `<div class="empty-state">Chưa có giao dịch nào. Thêm ở tab "Thêm giao dịch".</div>`;

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

/* ============================================================
   ACCOUNT CARD ACCORDION — "Xem thêm" + 3 sub-tabs
   The SSI account, the transaction form and the manual holdings/history used to
   be three stacked cards eating the whole page bottom. They now live in one
   card: collapsed by default (head + SSI summary only), expanded on demand.
   Open/close state and the active tab persist in localStorage.
   ============================================================ */
const MORE_OPEN_KEY = "vn_dashboard_account_more_v1";
const ACCT_TAB_KEY = "vn_dashboard_account_tab_v1";

function setAccountMore(open) {
  const box = document.getElementById("accountMore");
  const btn = document.getElementById("moreToggle");
  box.hidden = !open;
  btn.textContent = open ? "Thu gọn ▴" : "Xem thêm ▾";
  btn.setAttribute("aria-expanded", String(open));
  btn.classList.toggle("active", open);
  localStorage.setItem(MORE_OPEN_KEY, open ? "1" : "0");
}

function setAcctTab(name) {
  document.querySelectorAll("#acctTabs button").forEach((b) => b.classList.toggle("active", b.dataset.atab === name));
  document.querySelectorAll("[data-apane]").forEach((p) => (p.hidden = p.dataset.apane !== name));
  localStorage.setItem(ACCT_TAB_KEY, name);
}

function wireAccountAccordion() {
  const btn = document.getElementById("moreToggle");
  btn.addEventListener("click", () => setAccountMore(document.getElementById("accountMore").hidden));
  document.querySelectorAll("#acctTabs button").forEach((b) => {
    b.addEventListener("click", () => setAcctTab(b.dataset.atab));
  });
  setAcctTab(localStorage.getItem(ACCT_TAB_KEY) || "ssi");
  setAccountMore(localStorage.getItem(MORE_OPEN_KEY) === "1");
}

// Syncing while collapsed would hide the result — open the card so the fresh
// positions table is actually visible.
function openAccountPane() {
  setAccountMore(true);
  setAcctTab("ssi");
}

async function syncAccount(retryCode) {
  const key = getApiKey();
  if (!key) return;

  setAccountStatus("Đang đồng bộ...", "");
  try {
    if (retryCode) await DataService.loginAccount(key, retryCode);
    const data = await DataService.getAccountPortfolio(key);
    renderAccount(data);
    openAccountPane();
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
