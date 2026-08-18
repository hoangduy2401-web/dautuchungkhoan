/* ============================================================
   STATE
   ============================================================ */
// The watchlist survives reloads; DEFAULT_WATCHLIST is only the first-run seed.
// Stored through Store (collection `watchlist`) so it moves to Supabase with
// everything else in phase 5. Store is async, so state.watchlist starts as the
// seed and hydrateWatchlist() replaces it before the first render.
const WATCHLIST_COLLECTION = "watchlist";

async function hydrateWatchlist() {
  const saved = await Store.list(WATCHLIST_COLLECTION);
  // An empty saved list is intentional (user removed everything) — keep it.
  // Distinguish "saved empty" from "never saved" via the raw key, since
  // Store.list() returns [] for both.
  const everSaved = localStorage.getItem("vn_dashboard_watchlist_v1") !== null;
  if (everSaved) state.watchlist = saved.map((r) => (typeof r === "string" ? r : r.symbol));
  if (!state.selected) state.selected = state.watchlist[0] || null;
}

function saveWatchlist() {
  // Plain array of symbols, not {id,...} rows — the order IS the data here.
  Store.replace(WATCHLIST_COLLECTION, state.watchlist).catch((err) =>
    console.warn("[watchlist] không lưu được:", err.message)
  );
}

// Mã chỉ số có thể chọn để vẽ chart — phải khớp INDEX_IDS ở server/index.js.
// Chỉ số đi đường dữ liệu KHÁC hẳn cổ phiếu: /index-history (không OHLC, vẽ
// đường), không có chỉ số cơ bản doanh nghiệp, không có tín hiệu kỹ thuật rổ.
const INDEX_CODES = new Set(["VNINDEX", "VN30", "HNXINDEX", "UPCOM"]);
const isIndexCode = (s) => INDEX_CODES.has(s);

// Watchlist is capped so a long list never pushes the News panel (stacked right
// below it) down the page. Existing lists longer than this keep their rows until
// trimmed — the cap only blocks ADDING beyond it.
const MAX_WATCHLIST = 5;

const state = {
  watchlist: [...APP_CONFIG.DEFAULT_WATCHLIST],
  selected: null, // set right below, once the watchlist is known
  range: 90,
  quotes: {}, // symbol -> {price, changePct, volume}
  sparks: {}, // symbol -> [close, ...] recent closes for the watchlist sparkline
  indices: [], // [{code, value, changePct}] — kept so a transient 0 can fall back
  marketTab: "overview", // overview | heatmap | sector | rank | foreign | signal
  rankExchange: "VNINDEX", // VNINDEX | HNXINDEX | UPCOM — rankings tab exchange
  ovExchange: "VNINDEX", // sàn đang xem ở tab Tổng quan thị trường
  ovVolHistory: {}, // mã chỉ số -> [{date, volume}] — nạp lười, cache cả phiên
  selectedBars: null, // {symbol, bars} — nến của mã đang chọn, chart vừa tải xong
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
document.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("mockBadge").style.display = APP_CONFIG.USE_MOCK ? "inline-block" : "none";
  tickClock();
  setInterval(tickClock, 1000);

  // Store is async, so user data must be hydrated BEFORE the first render —
  // otherwise the watchlist paints the seed and the portfolio paints empty,
  // then both flicker to the real values a moment later.
  await Promise.all([hydrateWatchlist(), Portfolio.load()]);

  renderRangeTabs();
  wireMarketTabs();
  wireOverviewExchanges();
  wireRankExchanges();
  wireSignalTab();
  wireForms();
  wireAccountSync();
  wireAccountAccordion();
  ChartModule.init("priceChartContainer", "rsiChartContainer", "trendOverlay");
  wireChartToolbar();
  wireThemeControls();

  bootData();
  scheduleRefreshLoop();
});

/* ============================================================
   BACKEND STATUS + BOOT
   The backend runs on Render Free, which sleeps after 15 idle minutes. A cold
   start takes 30-60s. Loading data straight into that window used to abort
   every request; combined with the old silent mock fallback, the board painted
   itself with invented numbers that only a manual refresh corrected.
   Now: probe /health first, tell the user what is happening, and paint nothing
   until the instance actually answers.
   ============================================================ */
function setBackendStatus(text, kind) {
  const el = document.getElementById("backendStatus");
  if (!el) return;
  el.textContent = text || "";
  el.className = "backend-status" + (kind ? ` ${kind}` : "");
  el.style.display = text ? "inline-block" : "none";
}

async function bootData() {
  if (APP_CONFIG.USE_MOCK) return refreshAll();

  document.getElementById("indexStrip").innerHTML =
    `<div class="empty-state">Đang kết nối máy chủ…</div>`;

  // Live elapsed counter: a 40s wait with no feedback reads as a broken page.
  const t0 = Date.now();
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    setBackendStatus(
      s < 5 ? "Đang kết nối máy chủ…" : `Đang đánh thức máy chủ… ${s}s`,
      "warn"
    );
  }, 500);

  const awake = await DataService.wakeBackend();
  clearInterval(tick);

  if (!awake) {
    setBackendStatus("Máy chủ không phản hồi — sẽ tự thử lại", "err");
    document.getElementById("indexStrip").innerHTML =
      `<div class="empty-state">Không kết nối được máy chủ. Bảng sẽ tự cập nhật khi máy chủ trả lời.</div>`;
    return; // deliberately no data: an empty board beats a fabricated one
  }

  setBackendStatus("", "");
  await refreshAll();
}

// Self-scheduling loop: the next refresh is queued only AFTER the current one
// finishes, so a slow cycle can never stack on top of another (which used to
// multiply concurrent SSI calls and choke the backend).
function scheduleRefreshLoop() {
  setTimeout(async () => {
    await refreshCycle();
    scheduleRefreshLoop();
  }, APP_CONFIG.REFRESH_INTERVAL_MS);
}

// One refresh cycle. Re-checks that the backend is awake first — the probe
// short-circuits for 60s after a success, so on a healthy server this costs
// nothing; if the instance slept again it waits instead of painting blanks.
async function refreshCycle() {
  if (!APP_CONFIG.USE_MOCK) {
    const awake = await DataService.wakeBackend(30_000);
    if (!awake) {
      setBackendStatus("Máy chủ không phản hồi — sẽ tự thử lại", "err");
      return;
    }
    setBackendStatus("", "");
  }
  await refreshAll();
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

let refreshInFlight = false;
async function refreshAll() {
  if (refreshInFlight) return; // never run two refresh cycles at once
  refreshInFlight = true;
  try {
    await Promise.all([loadIndices(), loadTapeQuotes()]);
    renderTickerTape();
    renderOverview();
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
    // Indices are the canary: if they fail the instance is probably asleep
    // again, so drop the "awake" flag and let the next cycle re-probe.
    DataService.markAsleep();
  }
  const el = document.getElementById("indexStrip");
  if (!state.indices.length) {
    el.innerHTML = `<div class="empty-state">Chưa có dữ liệu chỉ số — đang chờ máy chủ.</div>`;
    return;
  }
  el.innerHTML = state.indices
    .map(
      (ix) => `
    <div class="index-card${ix.code === state.selected ? " active" : ""}" data-index="${ix.code}">
      <div class="code">${ix.code}</div>
      <div class="val">${fmt(ix.value, 2)}</div>
      <div class="chg ${trendClass(ix.changePct)}">${arrow(ix.changePct)} ${fmtPct(ix.changePct)}</div>
    </div>`
    )
    .join("");

  // Click a card to chart that index, same selection model as the watchlist.
  el.querySelectorAll(".index-card[data-index]").forEach((card) => {
    card.addEventListener("click", () => selectSymbol(card.dataset.index));
  });
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
      return `<span class="ticker-item"><span class="sym">${s}</span><span class="price">${fmt(
        q.price
      )}</span> <span class="${trendClass(q.changePct)}">${arrow(q.changePct)} ${fmtPct(
        q.changePct
      )}</span></span>`;
    })
    .join("");
  // duplicate content for seamless scroll loop
  document.getElementById("tickerTrack").innerHTML = items + items;
}

/* ============================================================
   VN30 HEATMAP
   ============================================================ */
// Map a daily % change to a cell colour. Fixed hue (green up / red down),
// ALPHA scales with |%|: near-flat = 0.10 (barely tinted), a ≥4.5% mover = 0.44,
// so big movers visually pop instead of every up/down looking equally saturated.
// Reskin 03/08: alpha tint over the card, not an opaque HSL fill — the tile now
// works in both themes and its label can use the normal text colour.
function heatColor(pct) {
  const mag = Math.min(Math.abs(pct || 0) / 4.5, 1);
  const alpha = (0.1 + mag * 0.34).toFixed(2);
  return (pct || 0) >= 0 ? `rgba(61,220,151,${alpha})` : `rgba(240,98,95,${alpha})`;
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
      // Selected ticker gets the inset accent ring, same as the watchlist row tint.
      const cls =
        (q.changePct > 0 ? "up" : q.changePct < 0 ? "down" : "flat") +
        (s === state.selected ? " active" : "");
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
      renderHeatmap(); // move the accent ring to the new tile
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
        renderHeatmap();
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
  renderHeatmap();
  loadSelectedSymbol();
  // Measure and scroll the window manually instead of scrollIntoView(): that API
  // scrolls the nearest scrollable ancestor, so a card that later sits inside an
  // overflow container would scroll THAT box and leave the page where it was.
  const chart = document.getElementById("symbolTitle");
  if (chart) {
    const top = window.pageYOffset + chart.getBoundingClientRect().top - 70;
    window.scrollTo({ top, behavior: "smooth" });
  }
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
    .map((s) => ({
      s,
      sig: Signals.compute(sigBarsFor(s), state.sigRsiWindow),
      // Khối ngoại chỉ có trên quote đã warm (VN30 + watchlist); mã ngoài đó thì
      // null, và `momentum` tự hạ thang tối đa xuống 11 rồi khai báo.
      mom: Signals.momentum(
        sigBarsFor(s),
        state.quotes[s] ? state.quotes[s].netForeignVal : null
      ),
    }))
    .filter((r) => r.sig);

  // Hạng A–F là phân vị TRONG RỔ — phải có điểm cả rổ trước khi gán cho từng mã.
  const gradeOf = Signals.grader(rows.map((r) => (r.mom ? r.mom.score : NaN)));
  rows.forEach((r) => (r.grade = r.mom ? gradeOf(r.mom.score) : null));

  rows.sort((a, b) => Signals.RANK[a.sig.summary] - Signals.RANK[b.sig.summary]);

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
        <th class="num" title="Momentum Score — phân vị trong rổ đang chọn">Đà</th>
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
          <td class="num">${
            r.mom
              ? `<span class="mom-grade mom-${r.grade}" title="${r.mom.score}/${r.mom.max} điểm — RSI ${r.mom.parts.rsi}, SMA ${r.mom.parts.sma}, giá ${r.mom.parts.price}, KL ${r.mom.parts.vol}${r.mom.parts.ngoai === null ? ", khối ngoại: chưa có" : ", ngoại " + r.mom.parts.ngoai}">${r.grade}</span>`
              : "—"
          }</td>
        </tr>`).join("")}
      </tbody>
    </table></div>
    <div class="sig-note">
      Khung <b>${state.sigTf === "W" ? "tuần" : "ngày"}</b> ·
      <button type="button" class="btn-outline" id="sigTfBtn">Đổi sang khung ${state.sigTf === "W" ? "ngày" : "tuần"}</button>
      · Cửa sổ tín hiệu RSI: <input type="number" id="sigRsiWin" min="1" max="10" value="${state.sigRsiWindow}" />
      phiên — RSI cắt lên 30 / cắt xuống 70 trong N phiên gần nhất vẫn tính là tín hiệu.
      ROC dùng ngưỡng 0 (tài liệu FiinTrade ghi 30/70 là chép nhầm từ dòng RSI).
      <br>Cột <b>Đà</b>: Momentum Score xếp hạng A–F theo <b>phân vị trong rổ đang
      chọn</b> — A là nhóm dẫn đầu rổ, không phải điểm tuyệt đối. Rê chuột để xem
      điểm thành phần. Đổi rổ thì hạng tính lại.
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

// Ngưỡng "đột biến" khối lượng: gấp đôi trung bình 20 phiên. FiinTrade dùng
// 1,5–2×; lấy mốc trên cho ít nhiễu, mã nào cũng dao động quanh 1× hằng ngày.
const VOL_SPIKE_X = 2;

function renderSigPriceVolume(el, symbols) {
  // Đột biến KL trong PHIÊN GẦN NHẤT — cái user chọn từ 24/07. Khác hẳn "KL
  // tăng liên tục" bên dưới: chuỗi bắt xu hướng nhiều phiên, còn cái này bắt
  // một cú vọt đơn lẻ mà chuỗi bỏ sót (vọt 3× rồi phiên sau về bình thường thì
  // volUp = 0). Tách giá lên / giá xuống vì ý nghĩa dòng tiền ngược nhau.
  const spikeUp = [], spikeDown = [];
  for (const s of symbols) {
    const b = sigBarsFor(s);
    if (!b) continue;
    const sp = Signals.volSpike(b, 20);
    if (!sp || sp.volX < VOL_SPIKE_X) continue;
    (sp.priceUp ? spikeUp : spikeDown).push({ s, x: sp.volX });
  }

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
  // Nhóm đột biến đặt TRÊN CÙNG — nó là tín hiệu mạnh nhất trong tab này: một cú
  // vọt khối lượng thường đi trước biến động giá.
  const spikeBlock = (name, list, klass) => `
    <div class="sig-group-title ${klass}">${name} (${list.length})</div>
    ${list.length
      ? `<div class="sig-chips">${list.sort((a, b) => b.x - a.x)
          .map((x) => `<span class="sig-chip ${klass}" data-sym="${x.s}">${x.s} · ${x.x.toFixed(1)}× TB</span>`).join("")}</div>`
      : `<div class="sig-chips"><span class="sig-chip" style="opacity:.55">Không mã nào</span></div>`}`;

  el.innerHTML =
    spikeBlock(`KL đột biến ≥${VOL_SPIKE_X}× + giá lên`, spikeUp, "up") +
    spikeBlock(`KL đột biến ≥${VOL_SPIKE_X}× + giá xuống`, spikeDown, "down") +
    Object.entries(groups).map(([name, list]) => `
    <div class="sig-group-title ${cls[name]}">${name} (${list.length})</div>
    ${list.length
      ? `<div class="sig-chips">${list.sort((a, b) => b.n - a.n)
          .map((x) => `<span class="sig-chip ${cls[name]}" data-sym="${x.s}">${x.s} · ${x.n} phiên</span>`).join("")}</div>`
      : `<div class="sig-chips"><span class="sig-chip" style="opacity:.55">Không mã nào</span></div>`}`).join("")
    + `<div class="sig-note"><b>KL đột biến</b>: khối lượng phiên gần nhất ≥ ${VOL_SPIKE_X}× trung bình 20 phiên trước — bắt cú vọt đơn lẻ mà "KL tăng liên tục" bỏ sót. Chuỗi liên tục phải &gt; 3 phiên (ngưỡng FiinTrade). Dùng phiên gần nhất đã đóng cửa — backend không có khối lượng ước lượng trong phiên.</div>`;

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
 *
 * Thường KHÔNG tốn lần gọi nào: `loadSelectedSymbol` đã tải sẵn cửa sổ rộng
 * hơn rồi cắt 180 phiên bỏ vào `state.sigBars`. Nhánh tự đi lấy bên dưới chỉ
 * chạy khi lần tải đó hỏng, hoặc khi tab Tín hiệu hỏi một mã chưa từng mở.
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
/* ============================================================
   TỔNG QUAN THỊ TRƯỜNG (tab "overview")

   Gộp hai biểu đồ vào MỘT tab vì chúng cùng một câu hỏi — "hôm nay so với kỳ
   trước thế nào" — cùng nguồn dữ liệu và cùng nhịp làm mới. Tách đôi sẽ thành
   nút tab thứ bảy (tràn hàng trên màn hình hẹp) và bắt user bấm qua lại giữa
   hai thứ vốn phải đọc cùng lúc.

   KHÔNG có endpoint mới: khối lượng + độ rộng của phiên hôm nay đã nằm trong
   `/api/price/indices` (số LIVE trong phiên, xem CLAUDE.md mục 7), còn khối
   lượng các phiên trước lấy từ `/api/price/index-history` vốn đã trả `volume`.
   Chuỗi lịch sử nạp LƯỜI một lần cho mỗi sàn rồi cache cả phiên — nó chỉ đổi
   sau khi đóng cửa, không việc gì phải nạp lại mỗi 45 giây.

   Thanh so sánh vẽ bằng CSS, không dùng Lightweight Charts: hai cặp số thì một
   thư viện chart là thừa, và tránh luôn hai lỗi vẽ đã gặp ở mục 7.
   ============================================================ */

// Chuỗi khối lượng theo phiên của một sàn. `/index-history` bỏ dòng đang hình
// thành (IndexValue=0) nên chuỗi này dừng ở phiên GẦN NHẤT ĐÃ ĐÓNG — khối lượng
// hôm nay lấy riêng từ /indices.
async function ensureOvHistory(code) {
  if (state.ovVolHistory[code]) return state.ovVolHistory[code];
  const rows = await DataService.getIndexHistory(code, 30);
  state.ovVolHistory[code] = (rows || []).filter((r) => Number.isFinite(r.volume) && r.volume > 0);
  return state.ovVolHistory[code];
}

// Mốc "phiên hiện tại" là NGÀY CỦA PHIÊN đang báo cáo, không phải hôm nay.
// Cuối tuần và ngày nghỉ, SSI vẫn trả dòng của phiên gần nhất đã đóng: lấy hôm
// nay làm mốc thì "phiên trước" hoá ra chính phiên đó và bảng hiện +0,0% với
// hai con số y hệt (đo 08/08/2026, thứ Bảy). Cùng lỗi từng gặp với HNX trong
// phiên, nhưng nguyên nhân khác nên phải chặn bằng ngày của chính payload.
function ovSessionDate(idx) {
  return (idx && idx.tradingDate) || vnToday();
}

// Ngày hiện tại theo giờ Việt Nam. `toISOString()` trả ngày UTC, lệch một ngày
// trong khoảng 00:00–07:00 giờ VN.
function vnToday() {
  return new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
}

// Tổng khối lượng của tuần chứa `date` (tuần bắt đầu THỨ HAI), chỉ tính các
// phiên có trong chuỗi.
function weekKey(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const dow = (d.getUTCDay() + 6) % 7; // 0 = thứ Hai
  d.setUTCDate(d.getUTCDate() - dow);
  return d.toISOString().slice(0, 10);
}

function wireOverviewExchanges() {
  const host = document.getElementById("ovExchanges");
  if (!host) return;
  host.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-ovex]");
    if (!btn) return;
    state.ovExchange = btn.dataset.ovex;
    host.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
    renderOverview();
  });
}

// Một thanh so sánh: nhãn, hai giá trị, phần trăm chênh lệch.
function ovBar(label, now, prev, unit, sub) {
  const has = Number.isFinite(now) && Number.isFinite(prev) && prev > 0;
  const pct = has ? ((now - prev) / prev) * 100 : null;
  const cls = pct === null ? "flat" : pct > 0 ? "up" : pct < 0 ? "down" : "flat";
  // Hai thanh cùng thang: cái lớn hơn chiếm 100%, cái kia theo tỷ lệ. Nhìn ra
  // ngay ai hơn ai mà không phải đọc số.
  const max = Math.max(now || 0, prev || 0) || 1;
  const w = (v) => `${Math.max(2, Math.min(100, ((v || 0) / max) * 100)).toFixed(1)}%`;

  return `<div class="ov-card">
    <div class="ov-card-head">
      <span class="ov-label">${escapeHtml(label)}</span>
      <span class="ov-pct ${cls}">${pct === null ? "—" : (pct >= 0 ? "+" : "") + pct.toFixed(1) + "%"}</span>
    </div>
    <div class="ov-row">
      <span class="ov-row-lbl">Kỳ này</span>
      <span class="ov-track"><span class="ov-fill now" style="width:${w(now)}"></span></span>
      <span class="ov-val">${Number.isFinite(now) ? fmtVol(now) : "—"}</span>
    </div>
    <div class="ov-row">
      <span class="ov-row-lbl">Kỳ trước</span>
      <span class="ov-track"><span class="ov-fill prev" style="width:${w(prev)}"></span></span>
      <span class="ov-val">${Number.isFinite(prev) ? fmtVol(prev) : "—"}</span>
    </div>
    ${sub ? `<div class="ov-sub">${escapeHtml(sub)}</div>` : ""}
    <div class="ov-unit">${escapeHtml(unit)}</div>
  </div>`;
}

// Khối lượng cổ phiếu tính bằng đơn vị cổ phiếu — hàng trăm triệu thì số nguyên
// đầy đủ không đọc được.
function fmtVol(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + " tỷ";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + " triệu";
  if (v >= 1e3) return (v / 1e3).toFixed(0) + " nghìn";
  return String(Math.round(v));
}

async function renderOverview() {
  const volHost = document.getElementById("ovVolume");
  const breadthHost = document.getElementById("ovBreadth");
  if (!volHost || !breadthHost) return;

  const code = state.ovExchange;
  const idx = state.indices.find((i) => i.code === code) || null;

  // Chuỗi lịch sử nạp lười; trong lúc chờ vẫn vẽ được phần của phiên hôm nay.
  let hist = state.ovVolHistory[code] || null;
  if (!hist) {
    ensureOvHistory(code)
      .then(() => {
        if (state.ovExchange === code) renderOverview();
      })
      .catch((err) => console.warn("[overview] lịch sử KL lỗi:", err.message));
  }

  const sessionDate = ovSessionDate(idx);
  const todayVol = idx && Number.isFinite(idx.totalVol) ? idx.totalVol : null;
  // Chỉ giữ các phiên TRƯỚC phiên đang báo cáo.
  const past = hist ? hist.filter((r) => r.date < sessionDate) : null;
  const prevVol = past && past.length ? past[past.length - 1].volume : null;
  const prevDate = past && past.length ? past[past.length - 1].date : null;

  // Tuần này = các phiên ĐÃ ĐÓNG của tuần hiện tại + phiên hôm nay đang chạy.
  // Tuần trước = trọn tuần liền trước. So "tới thời điểm này" với "cả tuần" là
  // so lệch, nhưng đó đúng là câu hỏi user đặt ra: tuần này đang đi nhanh hay
  // chậm hơn tuần trước.
  let weekVol = null;
  let prevWeekVol = null;
  if (past && past.length) {
    const todayKey = weekKey(sessionDate);
    const groups = new Map();
    for (const r of past) {
      const k = weekKey(r.date);
      groups.set(k, (groups.get(k) || 0) + r.volume);
    }
    weekVol = (groups.get(todayKey) || 0) + (todayVol || 0);
    const keys = [...groups.keys()].filter((k) => k < todayKey).sort();
    prevWeekVol = keys.length ? groups.get(keys[keys.length - 1]) : null;
    if (!weekVol) weekVol = null;
  }

  // Cổ phiếu đang chọn: khối lượng hôm nay từ quote, phiên trước từ chuỗi nến
  // mà chart đã tải sẵn — không gọi thêm gì.
  const sym = state.selected;
  let symToday = null;
  let symPrev = null;
  if (sym && !isIndexCode(sym)) {
    const q = state.quotes[sym];
    symToday = q && Number.isFinite(q.volume) ? q.volume : null;
    // Ưu tiên chuỗi nến mà biểu đồ vừa tải cho chính mã này; rổ tín hiệu chỉ là
    // đường lùi, vì nó chỉ có dữ liệu sau khi user bấm "Tải dữ liệu".
    const bars =
      (state.selectedBars && state.selectedBars.symbol === sym && state.selectedBars.bars) ||
      state.sigBars[sym] ||
      null;
    if (bars && bars.length >= 2) symPrev = bars[bars.length - 2].volume;
  }

  const dayLabel = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" }) : "—");
  volHost.innerHTML =
    ovBar(
      "Khối lượng phiên",
      todayVol,
      prevVol,
      `cổ phiếu · phiên ${dayLabel(sessionDate)} so với ${dayLabel(prevDate)}`
    ) +
    ovBar("Khối lượng tuần", weekVol, prevWeekVol, "cổ phiếu · tuần này tới hiện tại so với trọn tuần trước") +
    (sym && !isIndexCode(sym)
      ? ovBar(`Khối lượng ${sym}`, symToday, symPrev, "cổ phiếu · mã đang chọn", symPrev === null ? "Đang chờ dữ liệu phiên trước của mã này" : "")
      : "");

  // ---- Độ rộng thị trường ----
  const adv = idx && Number.isFinite(idx.advances) ? idx.advances : null;
  const dec = idx && Number.isFinite(idx.declines) ? idx.declines : null;
  const flat = idx && Number.isFinite(idx.noChanges) ? idx.noChanges : null;
  const total = (adv || 0) + (dec || 0) + (flat || 0);

  if (!total) {
    breadthHost.innerHTML = `<div class="empty-state">Chưa có số mã tăng/giảm cho ${escapeHtml(code)}.</div>`;
  } else {
    const p = (v) => ((v || 0) / total) * 100;
    breadthHost.innerHTML = `<div class="ov-card">
      <div class="ov-card-head">
        <span class="ov-label">Độ rộng thị trường</span>
        <span class="ov-pct ${adv >= dec ? "up" : "down"}">${adv} tăng / ${dec} giảm</span>
      </div>
      <div class="ov-breadth-bar">
        <span class="bp up" style="width:${p(adv).toFixed(1)}%" title="${adv} mã tăng"></span>
        <span class="bp flat" style="width:${p(flat).toFixed(1)}%" title="${flat} mã đứng giá"></span>
        <span class="bp down" style="width:${p(dec).toFixed(1)}%" title="${dec} mã giảm"></span>
      </div>
      <div class="ov-breadth-legend">
        <span><i class="sw up"></i>Tăng ${adv}</span>
        <span><i class="sw flat"></i>Đứng ${flat}</span>
        <span><i class="sw down"></i>Giảm ${dec}</span>
        ${Number.isFinite(idx.ceilings) ? `<span class="ceil">Trần ${idx.ceilings}</span>` : ""}
        ${Number.isFinite(idx.floors) ? `<span class="floor">Sàn ${idx.floors}</span>` : ""}
      </div>
    </div>`;
  }

  const isToday = sessionDate === vnToday();
  document.getElementById("ovNote").textContent = !hist
    ? "Đang nạp khối lượng các phiên trước…"
    : isToday
    ? "Khối lượng phiên hôm nay là số trong phiên, chốt lại khi đóng cửa. Các phiên trước lấy theo dữ liệu đã đóng cửa."
    : `Thị trường đang nghỉ — số liệu là của phiên ${dayLabel(sessionDate)}, phiên gần nhất đã đóng cửa.`;
}

function wireMarketTabs() {
  const tabs = document.getElementById("marketTabs");
  if (!tabs) return;
  tabs.querySelectorAll("button[data-mtab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.marketTab = btn.dataset.mtab;
      tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b === btn));
      // Match on [data-pane], NOT ".mtab-pane": the account accordion reuses the
      // same class for its own sub-panes, so a class query here silently hid all
      // three of them and left the accordion body blank until it was re-tabbed.
      document.querySelectorAll("[data-pane]").forEach((p) => {
        p.hidden = p.dataset.pane !== state.marketTab;
      });
      // Signals need whole-basket history (30–50 sequential calls). Render what
      // is already cached; the fetch itself stays behind the explicit button so
      // opening the tab never blocks the UI.
      if (state.marketTab === "signal") renderSignalPane();
      if (state.marketTab === "overview") renderOverview();
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

// Disable the add form and show a hint once the watchlist hits the cap.
function syncWatchlistCap() {
  const atCap = state.watchlist.length >= MAX_WATCHLIST;
  const input = document.getElementById("newSymbol");
  const btn = document.querySelector("#addSymbolForm button");
  const hint = document.getElementById("watchlistHint");
  if (input) input.disabled = atCap;
  if (btn) btn.disabled = atCap;
  if (hint) {
    hint.hidden = !atCap;
    hint.textContent = `Tối đa ${MAX_WATCHLIST} mã theo dõi. Bỏ bớt một mã rồi thêm.`;
  }
}

function renderWatchlist() {
  syncWatchlistCap();
  const el = document.getElementById("watchlist");
  if (state.watchlist.length === 0) {
    el.innerHTML = `<div class="empty-state">Chưa có mã theo dõi.<br>Thêm mã ở ô phía trên.</div>`;
    syncIndexCardActive(); // watchlist rỗng vẫn chọn được chỉ số
    return;
  }
  el.innerHTML = state.watchlist
    .map((s) => {
      // No quote yet -> "—", not 0.00. A zero price reads as real data.
      const q = state.quotes[s] || null;
      const info = DataService.getCompanyInfo(s);
      const pts = sparkPoints(state.sparks[s]);
      const sparkColor = q && q.changePct < 0 ? "var(--down)" : "var(--up)";
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
          <div class="price">${q ? fmt(q.price) : "—"}</div>
          <div class="chg ${q ? trendClass(q.changePct) : ""}">${q ? fmtPct(q.changePct) : "—"}</div>
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
      renderHeatmap();
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

  syncIndexCardActive();
}

// Move the accent ring on the index strip to match state.selected — and take it
// OFF every card when a stock is selected. Called from renderWatchlist because
// every selection change already goes through it (watchlist row, heatmap tile,
// rankings row, index card, selectSymbol); toggling classes in place avoids
// calling loadIndices(), which would refetch all four indices to move a ring.
function syncIndexCardActive() {
  document
    .querySelectorAll(".index-card[data-index]")
    .forEach((c) => c.classList.toggle("active", c.dataset.index === state.selected));
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
    if (!state.watchlist.includes(sym)) {
      // At the cap: don't grow the list (keeps News right beneath it). Select the
      // symbol so its chart still loads, but leave the watchlist unchanged.
      if (state.watchlist.length >= MAX_WATCHLIST) {
        const hint = document.getElementById("watchlistHint");
        if (hint) {
          hint.hidden = false;
          hint.textContent = `Tối đa ${MAX_WATCHLIST} mã theo dõi. Bỏ bớt một mã rồi thêm.`;
        }
        state.selected = sym;
        DataService.getQuote(sym)
          .then((q) => (state.quotes[sym] = q))
          .catch(() => {})
          .finally(() => {
            renderWatchlist();
            loadSelectedSymbol();
          });
        return;
      }
      state.watchlist.push(sym);
    }
    state.selected = sym;
    saveWatchlist();
    DataService.getQuote(sym)
      .then((q) => (state.quotes[sym] = q))
      .catch(() => {}) // no quote yet: the row renders blank until a refresh gets one
      .finally(() => {
        renderWatchlist();
        renderTickerTape();
        loadSelectedSymbol();
        loadSparklines(); // fetch the new symbol's sparkline history
      });
  });

  document.getElementById("txForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = e.target;
    // await: Portfolio writes through Store, and refreshPortfolio() reads the
    // cache Store just refreshed. Rendering first would show the old list.
    await Portfolio.add({
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
    // 5Y ~ 1250 phiên. Backend chia lịch sử theo khối 365 ngày (trước là 30),
    // nên lần tải đầu của khung này tốn 5 lượt gọi SSI thay vì 61 — khoảng 4
    // giây thay vì 8. Sau đó đọc từ cache.
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
  if (isIndexCode(state.selected)) return loadSelectedIndex(state.selected);
  const sym = state.selected;
  const info = DataService.getCompanyInfo(sym);
  // Quote/history no longer fall back to mock, so every call here can reject.
  // A failure must leave the panel showing "—" (or the previous chart), never
  // an invented price.
  let q = state.quotes[sym];
  if (!q) {
    q = await DataService.getQuote(sym).catch(() => null);
    if (q) state.quotes[sym] = q;
  }

  document.getElementById("symbolTitle").innerHTML = `
    <span class="sym">${sym}</span>
    <span class="name">${info.name} · ${info.exchange}</span>
    <span id="symbolSignal"></span>
    <span class="price ${q ? trendClass(q.changePct) : ""}">${
      q ? `${fmt(q.price)} <small>${fmtPct(q.changePct)}</small>` : "—"
    }</span>
  `;
  // MỘT lần gọi lịch sử cho cả biểu đồ lẫn huy hiệu tín hiệu.
  //
  // Trước đây là hai: biểu đồ xin `state.range`, huy hiệu xin SIG_DAYS (180).
  // Nhưng hai khoảng đó chồng lấn hoàn toàn — cửa sổ rộng hơn đã chứa trọn cửa
  // sổ hẹp hơn. Xin đúng một lần cửa sổ rộng nhất rồi cắt ra dùng là đủ cả hai,
  // và cắt ở trình duyệt thì không tốn gì.
  const fetchDays = Math.max(state.range, SIG_DAYS);
  const [full, fundamentals, news, events] = await Promise.all([
    DataService.getHistory(sym, fetchDays).catch(() => null),
    DataService.getFundamentals(sym),
    DataService.getNews(state.watchlist),
    DataService.getEvents(sym),
  ]);

  // Backend cắt lịch sử theo `end - days`; lặp lại đúng công thức đó ở đây để
  // biểu đồ nhận đúng bộ nến như khi còn gọi riêng theo `state.range`.
  const history = sliceLastDays(full, state.range);

  // Pass the dataset identity so the 45s refresh keeps any trendline/ruler the
  // user drew (same symbol + range = same anchors); switching either clears it.
  drawChartOrClear(history, `${sym}|${state.range}`);
  // Giữ lại chuỗi nến của mã đang chọn cho tab Tổng quan dùng chung — nó cần
  // khối lượng phiên trước, và đây là dữ liệu vừa tải xong cho biểu đồ.
  if (Array.isArray(history) && history.length) {
    state.selectedBars = { symbol: sym, bars: history };
    if (state.marketTab === "overview") renderOverview();
  }
  renderFundamentals(fundamentals);
  renderEvents(events);
  renderNews(news);

  // Nạp sẵn cửa sổ 180 phiên cho huy hiệu từ chính dữ liệu vừa tải. Nhờ vậy
  // `renderSymbolSignal` chỉ việc vẽ, không phải gọi mạng lần nữa. Tải hỏng
  // thì để nguyên — nó vẫn còn đường tự đi lấy.
  if (Array.isArray(full) && full.length && !state.sigBars[sym]) {
    state.sigBars[sym] = sliceLastDays(full, SIG_DAYS);
  }
  renderSymbolSignal(sym);
}

// Cắt lấy phần đuôi của chuỗi nến theo số ngày LỊCH (không phải số phiên) —
// đúng công thức backend dùng, nên kết quả trùng với bộ nến của lần gọi riêng.
// `date` dạng YYYY-MM-DD nên so chuỗi là so ngày, không cần dựng Date cho từng nến.
function sliceLastDays(bars, days) {
  if (!Array.isArray(bars) || !bars.length) return bars;
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
  const out = bars.filter((b) => b.date >= cutoff);
  // Chuỗi ngắn hơn cửa sổ (mã mới niêm yết) thì giữ nguyên, đừng trả mảng rỗng.
  return out.length ? out : bars;
}

// Index counterpart of loadSelectedSymbol. Deliberately NOT a branch inside that
// function: an index has no company info, no VNDirect fundamentals and no
// basket-signal badge, so almost none of the stock path applies.
async function loadSelectedIndex(code) {
  const ix = state.indices.find((i) => i.code === code) || null;

  document.getElementById("symbolTitle").innerHTML = `
    <span class="sym">${code}</span>
    <span class="name">Chỉ số thị trường</span>
    <span class="price ${ix ? trendClass(ix.changePct) : ""}">${
      ix ? `${fmt(ix.value, 2)} <small>${fmtPct(ix.changePct)}</small>` : "—"
    }</span>
  `;

  const range = state.range;
  const key = `${code}|${range}`;
  const history = await DataService.getIndexHistory(code, range).catch(() => null);
  // A slow index fetch (up to 61 sequential SSI calls) can land long after the
  // user moved on — dropping it here stops an old response from repainting the
  // chart under someone else's title.
  if (state.selected !== code || state.range !== range) return;
  drawChartOrClear(history, key);
  renderIndexStats(ix);
  // Indices have no company events — hide the dividend panel and collapse its
  // column so the chart takes the full width.
  const ep = document.getElementById("eventsPanel");
  if (ep) ep.hidden = true;
  document.querySelector(".main-grid")?.classList.add("no-events");
}

// Draw, or clear when there is nothing to draw AND the pane currently shows a
// DIFFERENT dataset. Keeping the old chart is right for a transient failure on
// the 45s refresh (same key), but after a switch it would put one instrument's
// price history under another one's name — an invented chart (mục 3).
function drawChartOrClear(history, key) {
  if (Array.isArray(history) && history.length) {
    ChartModule.setData(history, key);
  } else if (ChartModule.currentKey() !== key) {
    ChartModule.setData([], key);
  }
}

// Whole-market stats in place of company fundamentals. `null` means SSI does not
// publish the figure for this index (breadth is per exchange, so VN30 has none)
// — show "—", never 0: see the golden rule in CLAUDE.md section 3.
function renderIndexStats(ix) {
  const dash = "—";
  const billions = (v) => (v == null ? dash : fmt(v / 1e9, 0)); // VND -> tỷ
  const millions = (v) => (v == null ? dash : fmt(v / 1e6, 1)); // CP -> triệu
  const count = (v) => (v == null ? dash : String(v));
  const cells = ix
    ? [
        ["GTGD toàn sàn (tỷ)", billions(ix.totalVal)],
        ["KLGD (triệu CP)", millions(ix.totalVol)],
        ["Số mã tăng", count(ix.advances)],
        ["Số mã giảm", count(ix.declines)],
        ["Số mã đứng giá", count(ix.noChanges)],
      ]
    : [["Chỉ số", "Đang chờ máy chủ"]];
  document.getElementById("fundGrid").innerHTML = cells
    .map(([label, value]) => `<div class="fund-cell"><div class="label">${label}</div><div class="value">${value}</div></div>`)
    .join("");
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
        <div class="meta"><span class="tag">${escapeHtml(n.symbol)}</span><span class="src">${escapeHtml(n.source)} · ${hoursAgo}h trước</span></div>
        <div class="title"><a href="${escapeHtml(safeUrl(n.url))}" target="_blank" rel="noopener">${escapeHtml(n.title)}</a></div>
      </div>`;
    })
    .join("");
}

// Corporate-action history for the selected symbol. Cash + stock dividends
// listed here are exactly what the chart is back-adjusted for (server-side);
// rights issues (Phát hành quyền) are shown for reference but NOT chart-adjusted
// — their ex-price mechanics are too noisy (see server backAdjustHistory).
const EVENT_TYPES = {
  DIVIDEND: { label: "Cổ tức tiền", cls: "ev-cash" },
  KINDDIV: { label: "Cổ phiếu thưởng", cls: "ev-stock" },
  ISSUE: { label: "Phát hành quyền", cls: "ev-issue" },
};

function eventDetail(e) {
  if (e.type === "DIVIDEND") return e.cash != null ? `${fmt(e.cash / 1000, 1)} nghìn đ/cp` : e.note || "—";
  if (e.type === "KINDDIV") return e.ratio != null ? `Tỷ lệ 100:${fmt(e.ratio, 0)}` : e.note || "—";
  if (e.type === "ISSUE")
    return e.ratio != null
      ? `100:${fmt(e.ratio, 0)}${e.issuePrice != null ? ` · giá ${fmt(e.issuePrice / 1000, 1)} nghìn đ` : ""}`
      : e.note || "—";
  return e.note || "—";
}

// dd/mm/yyyy from a YYYY-MM-DD string; string split avoids Date() timezone drift.
function fmtEventDate(d) {
  return d ? d.split("-").reverse().join("/") : "—";
}

function renderEvents(events) {
  const panel = document.getElementById("eventsPanel");
  const el = document.getElementById("eventsList");
  if (!panel || !el) return;
  panel.hidden = false;
  // Reveal the right-hand events column (collapsed by default / for indices).
  document.querySelector(".main-grid")?.classList.remove("no-events");
  if (!Array.isArray(events) || !events.length) {
    el.innerHTML = `<div class="empty-state">Chưa có dữ liệu cổ tức / sự kiện quyền.</div>`;
    return;
  }
  // Compact 2-line rows instead of a wide table — this panel lives in a narrow
  // column beside the chart, so a 4-column table would overflow and scroll.
  const rows = events
    .map((e) => {
      const t = EVENT_TYPES[e.type] || { label: escapeHtml(e.typeDesc || e.type), cls: "" };
      const rec = e.recordDate ? `<span class="ev-rec">ĐK ${fmtEventDate(e.recordDate)}</span>` : "";
      return `
      <div class="ev-item">
        <div class="ev-row1">
          <span class="ev-date">${fmtEventDate(e.exDate)}</span>
          <span class="ev-badge ${t.cls}">${t.label}</span>
        </div>
        <div class="ev-row2">
          <span class="ev-detail">${escapeHtml(eventDetail(e))}</span>${rec}
        </div>
      </div>`;
    })
    .join("");
  el.innerHTML = `
    <div class="ev-list">${rows}</div>
    <div class="ev-note">Ngày GDKHQ = ngày giao dịch không hưởng quyền. Biểu đồ đã điều chỉnh giá theo cổ tức tiền &amp; cổ phiếu thưởng; phát hành quyền chỉ tham khảo, không điều chỉnh.</div>`;
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

  // `loadHoldingQuotes()` ở trên đã đi lấy quote cho mã ngoài watchlist + VN30,
  // nên tới đây thường đủ giá. Còn thiếu nghĩa là lần gọi đó THẤT BẠI (mã lạ,
  // SSI không trả) — và đó mới là chỗ cũ bị hổng: `computeHoldings` rơi về giá
  // vốn, P&L ra 0, tổng vẫn cộng. Nay nó trả null và chỗ này xử tử tế.
  const holdings = Portfolio.computeHoldings(currentPrices);
  const coGia = holdings.filter((h) => h.marketValue !== null);
  const thieuGia = holdings.filter((h) => h.qty > 0 && h.marketValue === null);

  // Chỉ cộng mã có giá thật. Mã thiếu giá được nói ra ở dải ghi chú bên dưới
  // chứ không âm thầm cộng bằng giá vốn.
  const totalValue = coGia.reduce((a, h) => a + h.marketValue, 0);
  const totalUnrealized = coGia.reduce((a, h) => a + h.unrealizedPL, 0);
  const totalRealized = holdings.reduce((a, h) => a + (h.realizedPL || 0), 0);

  const nhan = thieuGia.length ? "Giá trị danh mục (chưa đủ)" : "Giá trị danh mục";

  document.getElementById("holdingsSummary").innerHTML = `
    <div class="stat"><div class="label">${nhan}</div><div class="val"><span class="money">${fmt(totalValue, 1)} tr đ</span></div></div>
    <div class="stat"><div class="label">Lãi/lỗ tạm tính</div><div class="val ${trendClass(totalUnrealized)}"><span class="money">${fmt(totalUnrealized, 1)} tr đ</span></div></div>
    <div class="stat"><div class="label">Lãi/lỗ đã chốt</div><div class="val ${trendClass(totalRealized)}"><span class="money">${fmt(totalRealized, 1)} tr đ</span></div></div>
    ${
      thieuGia.length
        ? `<div class="hold-warn">Chưa lấy được giá của ${thieuGia
            .map((h) => h.symbol)
            .join(", ")} — <strong>chưa tính vào hai số trên</strong>.</div>`
        : ""
    }
  `;

  const holdEl = document.getElementById("holdingsTable");
  holdEl.innerHTML = holdings.length
    ? `<table>
        <thead><tr><th>Mã</th><th class="num">KL</th><th class="num">Giá vốn TB</th><th class="num">Giá hiện tại</th><th class="num">Lãi/lỗ</th></tr></thead>
        <tbody>${holdings
          .map(
            (h) => `<tr>
              <td>${h.symbol}</td>
              <td class="num"><span class="money">${fmt(h.qty, 0)}</span></td>
              <td class="num"><span class="money">${fmt(h.avgCost)}</span></td>
              <td class="num">${h.currentPrice === null ? "—" : fmt(h.currentPrice)}</td>
              <td class="num ${trendClass(h.unrealizedPL)}">${
                h.unrealizedPL === null
                  ? `<span class="muted">chưa có giá</span>`
                  : `<span class="money">${fmt(h.unrealizedPL, 1)}</span> (${fmtPct(h.unrealizedPLPct)})`
              }</td>
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
              <td class="num"><span class="money">${fmt(t.qty, 0)}</span></td>
              <td class="num">${fmt(t.price)}</td>
              <td>${t.note || "—"}</td>
              <td><button class="del-btn" data-id="${t.id}" title="Xóa">✕</button></td>
            </tr>`
          )
          .join("")}</tbody>
      </table>`
    : `<div class="empty-state">Chưa có giao dịch nào. Thêm ở tab "Thêm giao dịch".</div>`;

  txEl.querySelectorAll("[data-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await Portfolio.remove(btn.dataset.id); // await: render reads the cache Store refreshes
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
    <div class="stat"><div class="label">Tổng tài sản</div><div class="val"><span class="money">${fmt(cash.totalAssets, 1)} tr đ</span></div></div>
    <div class="stat"><div class="label">Tiền mặt</div><div class="val"><span class="money">${fmt(cash.cashBal, 1)} tr đ</span></div></div>
    <div class="stat"><div class="label">Sức mua</div><div class="val"><span class="money">${fmt(cash.purchasingPower, 1)} tr đ</span></div></div>
    <div class="stat"><div class="label">Dư nợ</div><div class="val ${cash.debt > 0 ? "down" : ""}"><span class="money">${fmt(cash.debt, 1)} tr đ</span></div></div>
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
              <td class="num" data-label="KL"><span class="money">${fmt(p.qty, 0)}</span></td>
              <td class="num" data-label="Bán được"><span class="money">${fmt(p.sellableQty, 0)}</span></td>
              <td class="num" data-label="Giá vốn"><span class="money">${fmt(p.avgCost)}</span></td>
              <td class="num" data-label="Giá TT">${fmt(p.marketPrice)}</td>
              <td class="num" data-label="Giá trị"><span class="money">${fmt(p.marketValue, 1)}</span></td>
              <td class="num ${trendClass(p.unrealizedPL)}" data-label="Lãi/lỗ"><span class="money">${fmt(p.unrealizedPL, 1)}</span> (${fmtPct(p.unrealizedPLPct)})</td>
            </tr>`
          )
          .join("")}</tbody>
      </table>`
    : `<div class="empty-state">Tài khoản không có mã nào đang nắm giữ.</div>`;
}
