// ============================================================
// NGOẠI TỆ — bảng tỷ giá Vietcombank + biểu đồ tỷ giá thị trường.
//
// Hai loại tỷ giá KHÁC NHAU nằm cùng một trang, cố ý:
//   bảng    = giá niêm yết bán lẻ của Vietcombank, có biên mua–bán
//   biểu đồ = giá thị trường liên ngân hàng, một giá duy nhất
// Chúng lệch nhau ~0,8% và sẽ không bao giờ khớp. Mọi con số phải đứng cạnh
// nhãn nguồn của nó — số đúng dán nhãn sai dẫn tới quyết định sai y như số bịa
// (mục 1.5 của docs/QUYHOACH.md, luật vàng CLAUDE.md mục 3).
// ============================================================

const fxState = {
  rates: [], // [{code, name, buyCash, buyTransfer, sell}] — null = VCB không niêm yết
  updatedAt: null,
  pinned: [], // mã ghim, lưu qua Store
  search: "",
  sortKey: "code",
  sortDir: 1,
  selected: "USD",
  range: 90,
  loadingChart: false,
  holdings: [], // danh mục cá nhân, bản sao trong bộ nhớ của collection holdings_fx
  editingId: null, // dòng đang ở chế độ sửa tại chỗ
  confirmDeleteId: null, // dòng đang chờ xác nhận xoá (bấm Xoá lần hai)
};

// Nguồn miễn phí chỉ có 366 ngày lịch sử nên KHÔNG có mốc 5 năm như trang chứng
// khoán. Backend trả 400 range_too_long nếu vượt — đừng thêm nút 5Y ở đây mà
// không đổi nguồn trước.
const FX_RANGES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
];

const PINNED_SETTING = "fxPinned";
const HOLDINGS_COLLECTION = "holdings_fx"; // tên đã chốt ở docs/QUYHOACH.md 3.4

const hasVal = (n) => n !== null && n !== undefined && Number.isFinite(Number(n));
const fmtRate = (n) =>
  hasVal(n)
    ? Number(n).toLocaleString("vi-VN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "—";
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Tên ngoại tệ tiếng Việt cho vài mã hay dùng; mã khác giữ nguyên tên tiếng Anh
// của Vietcombank (đã đủ nhận ra).
const FX_NAMES_VI = {
  USD: "Đô la Mỹ", EUR: "Euro", GBP: "Bảng Anh", JPY: "Yên Nhật",
  CNY: "Nhân dân tệ", KRW: "Won Hàn Quốc", AUD: "Đô la Úc", CAD: "Đô la Canada",
  SGD: "Đô la Singapore", THB: "Baht Thái", HKD: "Đô la Hồng Kông", CHF: "Franc Thụy Sĩ",
};

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  initChrome();

  // Store bất đồng bộ: nạp mã ghim và danh mục TRƯỚC lần vẽ đầu, nếu không bảng
  // vẽ xong rồi mới nhảy thứ tự, và danh mục hiện rỗng rồi mới nhảy số.
  const [pinned, holdings] = await Promise.all([
    Store.getSetting(PINNED_SETTING, []),
    Store.list(HOLDINGS_COLLECTION),
  ]);
  fxState.pinned = pinned || [];
  fxState.holdings = holdings || [];

  renderRangeTabs();
  wireTable();
  wireConverter();
  wireChartToggles();
  wireHoldings();
  renderHoldings(); // vẽ ngay: danh mục đọc được kể cả khi máy chủ chưa trả lời
  ChartModule.init("priceChartContainer", "rsiChartContainer", "trendOverlay");
  // Chuỗi tỷ giá không có khối lượng và RSI trên một cặp tiền tệ không nói lên
  // điều gì hữu ích ở đây — tắt cả hai, giữ MA10/MA20.
  ChartModule.toggleSeries("volume", false);
  ChartModule.toggleSeries("rsi", false);

  bootData();
});

function setBackendStatus(text, kind) {
  const el = document.getElementById("backendStatus");
  if (!el) return;
  el.textContent = text || "";
  el.className = "backend-status" + (kind ? ` ${kind}` : "");
  el.style.display = text ? "inline-block" : "none";
}

// Render Free ngủ sau 15 phút không ai gọi; lần tải đầu sau đó mất 30–60s.
// Đánh thức trước rồi mới nạp dữ liệu — giống trang chứng khoán.
async function bootData() {
  const t0 = Date.now();
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    setBackendStatus(s < 5 ? "Đang kết nối máy chủ…" : `Đang đánh thức máy chủ… ${s}s`, "warn");
  }, 500);

  const awake = await DataService.wakeBackend();
  clearInterval(tick);

  if (!awake) {
    setBackendStatus("Máy chủ không phản hồi — tải lại trang để thử lại", "err");
    setTableMessage("Không kết nối được máy chủ.");
    return; // không vẽ gì: bảng trống hơn hẳn bảng số bịa
  }

  setBackendStatus("", "");
  await Promise.all([loadRates(), loadChart()]);
}

/* ============================================================
   BẢNG TỶ GIÁ (Vietcombank — bán lẻ)
   ============================================================ */
async function loadRates() {
  try {
    const data = await DataService.getFxRates();
    fxState.rates = Array.isArray(data.rates) ? data.rates : [];
    fxState.updatedAt = data.updatedAt || null;
    renderUpdatedAt();
    renderTable();
    fillConverterCodes();
    updateConverter("foreign");
    fillHoldCodes();
    renderHoldings(); // vẽ lại: giờ mới có tỷ giá để quy đổi giá trị danh mục
  } catch (err) {
    console.warn("[ngoai-te] tỷ giá lỗi:", err.message);
    DataService.markAsleep();
    setTableMessage("Nguồn lỗi — chưa lấy được tỷ giá.");
  }
}

function renderUpdatedAt() {
  const el = document.getElementById("fxUpdatedAt");
  if (!el) return;
  if (!fxState.updatedAt) {
    el.textContent = "";
    return;
  }
  const d = new Date(fxState.updatedAt);
  el.textContent = Number.isNaN(d.getTime())
    ? ""
    : ` · cập nhật ${d.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`;
}

function setTableMessage(msg) {
  document.getElementById("fxTableBody").innerHTML =
    `<tr><td colspan="7" class="empty-state">${escapeHtml(msg)}</td></tr>`;
}

// Chênh lệch mua–bán tính theo giá bán, dùng giá mua chuyển khoản vì mọi mã đều
// có (mua tiền mặt thì 8 mã bỏ trống).
function spreadPct(r) {
  if (!hasVal(r.buyTransfer) || !hasVal(r.sell) || !r.sell) return null;
  return ((r.sell - r.buyTransfer) / r.sell) * 100;
}

function visibleRates() {
  const q = fxState.search.trim().toLowerCase();
  const rows = fxState.rates.filter(
    (r) =>
      !q ||
      r.code.toLowerCase().includes(q) ||
      String(r.name || "").toLowerCase().includes(q) ||
      String(FX_NAMES_VI[r.code] || "").toLowerCase().includes(q)
  );

  const key = fxState.sortKey;
  const dir = fxState.sortDir;
  rows.sort((a, b) => {
    // Mã ghim luôn nổi lên đầu, bất kể đang sắp theo cột nào.
    const pa = fxState.pinned.includes(a.code) ? 0 : 1;
    const pb = fxState.pinned.includes(b.code) ? 0 : 1;
    if (pa !== pb) return pa - pb;

    let va, vb;
    if (key === "code") { va = a.code; vb = b.code; }
    else if (key === "name") { va = FX_NAMES_VI[a.code] || a.name; vb = FX_NAMES_VI[b.code] || b.name; }
    else if (key === "spread") { va = spreadPct(a); vb = spreadPct(b); }
    else { va = a[key]; vb = b[key]; }

    if (typeof va === "string" || typeof vb === "string") {
      return String(va).localeCompare(String(vb)) * dir;
    }
    // Ô trống (VCB không niêm yết) luôn xuống cuối, không coi là 0 — sắp theo 0
    // sẽ đẩy chúng lẫn vào giữa các mã rẻ và trông như giá thật.
    if (!hasVal(va) && !hasVal(vb)) return 0;
    if (!hasVal(va)) return 1;
    if (!hasVal(vb)) return -1;
    return (va - vb) * dir;
  });
  return rows;
}

function renderTable() {
  const rows = visibleRates();
  if (!rows.length) {
    setTableMessage(fxState.rates.length ? "Không có mã nào khớp." : "Đang chờ máy chủ…");
    return;
  }

  document.getElementById("fxTableBody").innerHTML = rows
    .map((r) => {
      const pinned = fxState.pinned.includes(r.code);
      const sp = spreadPct(r);
      return `<tr data-code="${r.code}"${r.code === fxState.selected ? ' class="sel"' : ""}>
        <td class="th-pin"><button type="button" class="pin-btn${pinned ? " on" : ""}" data-pin="${r.code}"
          title="${pinned ? "Bỏ ghim" : "Ghim lên đầu"}" aria-pressed="${pinned}">★</button></td>
        <td class="code">${escapeHtml(r.code)}</td>
        <td class="th-name">${escapeHtml(FX_NAMES_VI[r.code] || r.name || "")}</td>
        <td class="num">${fmtRate(r.buyCash)}</td>
        <td class="num">${fmtRate(r.buyTransfer)}</td>
        <td class="num">${fmtRate(r.sell)}</td>
        <td class="num muted">${hasVal(sp) ? sp.toFixed(2) + "%" : "—"}</td>
      </tr>`;
    })
    .join("");

  // Cột nào đang sắp: đánh dấu ở tiêu đề.
  document.querySelectorAll(".asset-table th.sortable").forEach((th) => {
    const on = th.dataset.sort === fxState.sortKey;
    th.classList.toggle("sorted", on);
    th.dataset.dir = on ? (fxState.sortDir === 1 ? "asc" : "desc") : "";
  });
}

function wireTable() {
  const search = document.getElementById("fxSearch");
  search.addEventListener("input", () => {
    fxState.search = search.value;
    renderTable();
  });

  document.querySelectorAll(".asset-table th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort;
      // Bấm lại cùng cột = đảo chiều; cột số mặc định giảm dần (số lớn trước).
      if (fxState.sortKey === key) fxState.sortDir *= -1;
      else {
        fxState.sortKey = key;
        fxState.sortDir = key === "code" || key === "name" ? 1 : -1;
      }
      renderTable();
    });
  });

  // Uỷ quyền sự kiện: bảng vẽ lại nhiều lần, gắn listener từng dòng sẽ rò rỉ.
  document.getElementById("fxTableBody").addEventListener("click", async (e) => {
    const pin = e.target.closest("[data-pin]");
    if (pin) {
      const code = pin.dataset.pin;
      fxState.pinned = fxState.pinned.includes(code)
        ? fxState.pinned.filter((c) => c !== code)
        : [...fxState.pinned, code];
      renderTable();
      await Store.setSetting(PINNED_SETTING, fxState.pinned);
      return;
    }
    const tr = e.target.closest("tr[data-code]");
    if (tr) selectCurrency(tr.dataset.code);
  });
}

/* ============================================================
   BIỂU ĐỒ (thị trường liên ngân hàng — FXRatesAPI)
   ============================================================ */
function renderRangeTabs() {
  document.getElementById("fxRangeTabs").innerHTML = FX_RANGES.map(
    (r) =>
      `<button type="button" data-days="${r.days}"${r.days === fxState.range ? ' class="active"' : ""}>${r.label}</button>`
  ).join("");

  document.getElementById("fxRangeTabs").addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-days]");
    if (!btn) return;
    fxState.range = Number(btn.dataset.days);
    document
      .querySelectorAll("#fxRangeTabs button")
      .forEach((b) => b.classList.toggle("active", Number(b.dataset.days) === fxState.range));
    loadChart();
  });
}

// MA10/MA20 bật sẵn. Không có nến, khối lượng, Bollinger hay RSI ở trang này —
// chuỗi tỷ giá chỉ có một giá mỗi ngày.
function wireChartToggles() {
  const wire = (id, name) => {
    const el = document.getElementById(id);
    el.addEventListener("change", () => ChartModule.toggleSeries(name, el.checked));
  };
  wire("chkMA10", "ma10");
  wire("chkMA20", "ma20");
}

function selectCurrency(code) {
  if (!code || code === fxState.selected) return;
  fxState.selected = code;
  renderTable(); // đổi dòng đang chọn
  loadChart();
}

async function loadChart() {
  const code = fxState.selected;
  const days = fxState.range;
  const title = document.getElementById("fxChartTitle");
  title.textContent = `${code}/VND — ${FX_NAMES_VI[code] || code}`;
  document.getElementById("fxChartStats").innerHTML = `<span class="muted">Đang tải…</span>`;

  fxState.loadingChart = true;
  try {
    const data = await DataService.getFxHistory(code, days);
    // Người dùng bấm nhanh sang mã/khung khác trong lúc chờ: bỏ qua phản hồi lạc
    // hậu, nếu không dữ liệu của mã cũ sẽ nằm dưới tên mã mới (CLAUDE.md mục 7).
    if (fxState.selected !== code || fxState.range !== days) return;

    const items = Array.isArray(data.items) ? data.items : [];
    if (!items.length) throw new Error("chuỗi rỗng");

    // Không có OHLC — ChartModule tự nhận ra và vẽ đường khi thiếu `open`.
    ChartModule.setData(
      items.map((d) => ({ date: d.date, close: d.rate, volume: 0 })),
      `${code}|${days}`
    );
    renderChartStats(items);
  } catch (err) {
    console.warn("[ngoai-te] lịch sử lỗi:", err.message);
    DataService.markAsleep();
    // Xoá trắng thay vì để chuỗi của mã khác nằm dưới tiêu đề mã này.
    if (fxState.selected === code && fxState.range === days) {
      ChartModule.setData([], null);
      document.getElementById("fxChartStats").innerHTML =
        `<span class="muted">Nguồn lỗi — chưa lấy được lịch sử ${escapeHtml(code)}.</span>`;
    }
  } finally {
    fxState.loadingChart = false;
  }
}

function renderChartStats(items) {
  const first = items[0].rate;
  const last = items[items.length - 1].rate;
  const chg = first ? ((last - first) / first) * 100 : 0;
  const cls = chg > 0.001 ? "up" : chg < -0.001 ? "down" : "flat";
  const lo = Math.min(...items.map((d) => d.rate));
  const hi = Math.max(...items.map((d) => d.rate));
  const lastDate = new Date(items[items.length - 1].date).toLocaleDateString("vi-VN");

  document.getElementById("fxChartStats").innerHTML = `
    <div class="stat"><span class="label">Mới nhất (${escapeHtml(lastDate)})</span><span class="val">${fmtRate(last)}</span></div>
    <div class="stat"><span class="label">Biến động khung</span><span class="val ${cls}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</span></div>
    <div class="stat"><span class="label">Thấp nhất</span><span class="val">${fmtRate(lo)}</span></div>
    <div class="stat"><span class="label">Cao nhất</span><span class="val">${fmtRate(hi)}</span></div>`;
}

/* ============================================================
   QUY ĐỔI NHANH (theo giá Vietcombank)
   Hai chiều dùng HAI giá khác nhau, đúng như khi ra quầy:
     ngoại tệ -> VND : ngân hàng MUA (giá mua chuyển khoản)
     VND -> ngoại tệ : ngân hàng BÁN (giá bán)
   Lấy chung một giá cho cả hai chiều sẽ ra con số không tồn tại ở quầy nào.
   ============================================================ */
function fillConverterCodes() {
  const sel = document.getElementById("convCode");
  const keep = sel.value || fxState.selected;
  sel.innerHTML = fxState.rates
    .map((r) => `<option value="${r.code}">${escapeHtml(r.code)}</option>`)
    .join("");
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

function rateFor(code) {
  return fxState.rates.find((r) => r.code === code) || null;
}

// Chấp cả kiểu Việt ("1.234,5") lẫn kiểu Anh ("1,234.5"), và cả chuỗi do chính
// ô bên kia sinh ra ("2.608.000" — toLocaleString tiếng Việt).
function parseAmount(s) {
  const raw = String(s || "").trim().replace(/\s/g, "");
  if (!raw) return null;

  const commas = (raw.match(/,/g) || []).length;
  let cleaned;
  // Một dấu phẩy duy nhất, đứng sau mọi dấu chấm -> phẩy là dấu thập phân kiểu
  // Việt ("1.234,5"). Từ hai dấu phẩy trở lên thì nó chỉ có thể là phân tách
  // nghìn kiểu Anh ("1,000,000") — nhánh này từng nuốt mất số đó.
  if (commas === 1 && raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
    cleaned = raw.replace(/\./g, "").replace(",", ".");
  } else if (commas > 0) {
    cleaned = raw.replace(/,/g, ""); // Anh: phẩy = nghìn
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    // Chỉ có dấu chấm và mọi nhóm sau đều đúng 3 chữ số -> phân tách nghìn kiểu
    // Việt ("1.000.000"). "26.5" hay "1.0345" không khớp nên vẫn là thập phân.
    // Còn lại "1.000" là thật sự mơ hồ; trang tiếng Việt nên chọn 1000.
    cleaned = raw.replace(/\./g, "");
  } else {
    cleaned = raw;
  }

  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const fmtMoney = (n, d) =>
  Number(n).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });

function updateConverter(from) {
  const code = document.getElementById("convCode").value;
  const r = rateFor(code);
  const foreignEl = document.getElementById("convForeign");
  const vndEl = document.getElementById("convVnd");
  const note = document.getElementById("convNote");
  if (!r) return;

  const buy = r.buyTransfer; // ngân hàng mua vào
  const sell = r.sell; // ngân hàng bán ra

  if (from === "foreign") {
    const amt = parseAmount(foreignEl.value);
    vndEl.value = amt !== null && hasVal(buy) ? fmtMoney(amt * buy, 0) : "";
  } else {
    const amt = parseAmount(vndEl.value);
    foreignEl.value = amt !== null && hasVal(sell) && sell ? fmtMoney(amt / sell, 2) : "";
  }

  note.innerHTML =
    `Bán ${escapeHtml(code)} cho ngân hàng: <strong>${fmtRate(buy)}</strong> ₫/1 ${escapeHtml(code)} · ` +
    `Mua ${escapeHtml(code)} từ ngân hàng: <strong>${fmtRate(sell)}</strong> ₫/1 ${escapeHtml(code)}`;
}

function wireConverter() {
  document.getElementById("convForeign").addEventListener("input", () => updateConverter("foreign"));
  document.getElementById("convVnd").addEventListener("input", () => updateConverter("vnd"));
  document.getElementById("convCode").addEventListener("change", () => updateConverter("foreign"));
}

/* ============================================================
   DANH MỤC CÁ NHÂN (collection `holdings_fx`)

   Đây là DANH SÁCH NẮM GIỮ sửa trực tiếp, KHÔNG phải sổ giao dịch mua/bán như
   `portfolio.js` của trang chứng khoán. Cố ý khác: user cầm một số dư ngoại tệ
   và khi nó thay đổi thì sửa thẳng con số đó, chứ không ghi thêm một lệnh mua/
   bán. Vì vậy giá vốn là MỘT Ô NHẬP, không phải kết quả bình quân gia quyền của
   nhiều lệnh — đừng "sửa lại cho giống trang chứng khoán".

   Định giá theo **giá mua chuyển khoản của Vietcombank**: đó là giá bán lại cho
   ngân hàng, tức số tiền thật sự thu về. Không dùng giá liên ngân hàng của biểu
   đồ — nó cao hơn ~0,8% và không ai mua của bạn ở giá đó.

   Mọi số tiền và số lượng nắm giữ bọc `<span class="money">` để nút con mắt che
   được (mục 3b). Giá vốn và giá quy đổi là GIÁ, không che — xem cùng mục.
   ============================================================ */

// Giá dùng để định giá một mã. null = VCB không niêm yết -> hiện "—", không bịa.
function holdRate(code) {
  const r = rateFor(code);
  return r && hasVal(r.buyTransfer) ? r.buyTransfer : null;
}

// Một dòng danh mục kèm các số đã tính. rate/value/pl = null khi thiếu tỷ giá
// hoặc thiếu giá vốn — người gọi phải hiện "—" chứ không thay bằng 0.
function holdRow(h) {
  const rate = holdRate(h.code);
  const amount = Number(h.amount) || 0;
  const cost = hasVal(h.cost) ? Number(h.cost) : null;
  const value = rate === null ? null : amount * rate;
  const pl = rate === null || cost === null ? null : amount * (rate - cost);
  const plPct = rate === null || cost === null || !cost ? null : ((rate - cost) / cost) * 100;
  return { ...h, amount, cost, rate, value, pl, plPct };
}

function renderHoldings() {
  const body = document.getElementById("holdTableBody");
  const rows = fxState.holdings.map(holdRow);

  if (!rows.length) {
    body.innerHTML =
      `<tr><td colspan="7" class="empty-state">Chưa có mã nào. Thêm ở ô phía trên.</td></tr>`;
    document.getElementById("holdSummary").innerHTML = "";
    return;
  }

  body.innerHTML = rows.map((r) => (r.id === fxState.editingId ? editRowHtml(r) : viewRowHtml(r))).join("");
  renderHoldSummary(rows);
}

function viewRowHtml(r) {
  const plCls = r.pl === null ? "" : r.pl > 0 ? "up" : r.pl < 0 ? "down" : "flat";
  const plText =
    r.pl === null
      ? "—"
      : `<span class="money">${r.pl >= 0 ? "+" : ""}${fmtMoney(r.pl, 0)} ₫</span> <span class="${plCls}">(${r.plPct >= 0 ? "+" : ""}${r.plPct.toFixed(2)}%)</span>`;
  const delLabel = r.id === fxState.confirmDeleteId ? "Chắc chứ?" : "Xoá";

  return `<tr data-hid="${r.id}">
    <td class="code">${escapeHtml(r.code)}</td>
    <td class="num"><span class="money">${fmtMoney(r.amount, r.amount % 1 ? 2 : 0)}</span></td>
    <td class="num muted">${r.cost === null ? "—" : fmtRate(r.cost)}</td>
    <td class="num muted col-rate">${r.rate === null ? "—" : fmtRate(r.rate)}</td>
    <td class="num">${r.value === null ? "—" : `<span class="money">${fmtMoney(r.value, 0)}</span>`}</td>
    <td class="num ${plCls}">${plText}</td>
    <td class="act">
      <button type="button" class="row-btn" data-act="edit">Sửa</button>
      <button type="button" class="row-btn danger" data-act="del">${delLabel}</button>
    </td>
  </tr>`;
}

// Sửa tại chỗ: chỉ số tiền và giá vốn đổi được. Muốn đổi mã thì xoá rồi thêm
// lại — đổi mã tại chỗ nghĩa là giá vốn cũ đang tính bằng đơn vị khác.
function editRowHtml(r) {
  return `<tr data-hid="${r.id}">
    <td class="code">${escapeHtml(r.code)}</td>
    <td class="num"><input class="edit-input" data-edit="amount" value="${fmtMoney(r.amount, r.amount % 1 ? 2 : 0)}" /></td>
    <td class="num"><input class="edit-input" data-edit="cost" value="${r.cost === null ? "" : fmtMoney(r.cost, 0)}" placeholder="—" /></td>
    <td class="num muted col-rate">${r.rate === null ? "—" : fmtRate(r.rate)}</td>
    <td class="num muted">—</td>
    <td class="num muted">—</td>
    <td class="act">
      <button type="button" class="row-btn save" data-act="save">Lưu</button>
      <button type="button" class="row-btn" data-act="cancel">Huỷ</button>
    </td>
  </tr>`;
}

function renderHoldSummary(rows) {
  const priced = rows.filter((r) => r.value !== null);
  const missing = rows.length - priced.length;
  const total = priced.reduce((s, r) => s + r.value, 0);

  const withCost = rows.filter((r) => r.pl !== null);
  const totalPl = withCost.reduce((s, r) => s + r.pl, 0);
  const totalCost = withCost.reduce((s, r) => s + r.amount * r.cost, 0);
  const plPct = totalCost ? (totalPl / totalCost) * 100 : null;
  const plCls = totalPl > 0 ? "up" : totalPl < 0 ? "down" : "flat";

  document.getElementById("holdSummary").innerHTML =
    `<div class="stat">
       <span class="label">Tổng giá trị${missing ? ` (thiếu tỷ giá ${missing} mã)` : ""}</span>
       <span class="val"><span class="money">${priced.length ? fmtMoney(total, 0) + " ₫" : "—"}</span></span>
     </div>` +
    (withCost.length
      ? `<div class="stat">
           <span class="label">Lãi/lỗ (${withCost.length}/${rows.length} mã có giá vốn)</span>
           <span class="val ${plCls}"><span class="money">${totalPl >= 0 ? "+" : ""}${fmtMoney(totalPl, 0)} ₫</span>${
             plPct === null ? "" : ` <span>(${plPct >= 0 ? "+" : ""}${plPct.toFixed(2)}%)</span>`
           }</span>
         </div>`
      : "");
}

function fillHoldCodes() {
  const sel = document.getElementById("holdCode");
  const keep = sel.value;
  sel.innerHTML = fxState.rates.map((r) => `<option value="${r.code}">${escapeHtml(r.code)}</option>`).join("");
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

// kind = "warn": cảnh báo đơn vị, không chặn — đổi màu để khỏi lẫn với lỗi thật.
function setHoldError(msg, kind) {
  const el = document.getElementById("holdError");
  el.textContent = msg || "";
  el.hidden = !msg;
  el.classList.toggle("warn", kind === "warn" && !!msg);
}

// Ô giá vốn trang này là **₫/1 đơn vị ngoại tệ** — CÙNG đơn vị với tỷ giá đang
// hiện, không phải quy đổi gì (khác trang Vàng). Lỗi hay gặp: gõ "26" thay vì
// "26.000" cho USD. Dùng đúng `holdRate` mà bảng dùng để định giá, nên cảnh báo
// và bảng nói cùng một con số; VCB không niêm yết -> null -> CostGuard im lặng.
const costConfirm = CostGuard.makeConfirmer();
const COST_GUARD_OPTS = { unitLabel: "₫/1 đơn vị", marketLabel: "tỷ giá hiện tại", fmt: fmtRate };

function wireHoldings() {
  document.getElementById("holdForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("holdCode").value;
    const amountEl = document.getElementById("holdAmount");
    const costEl = document.getElementById("holdCost");
    const amount = parseAmount(amountEl.value);
    const costRaw = costEl.value.trim();
    const cost = costRaw ? parseAmount(costRaw) : null;

    if (!code) return setHoldError("Chưa nạp được danh sách ngoại tệ — thử lại khi bảng tỷ giá hiện số.");
    if (amount === null || amount <= 0) return setHoldError("Số tiền phải là số lớn hơn 0.");
    if (costRaw && (cost === null || cost <= 0)) return setHoldError("Giá vốn phải là số lớn hơn 0, hoặc để trống.");

    if (cost !== null) {
      const warn = costConfirm.guard(`add|${code}|${cost}`, cost, holdRate(code), COST_GUARD_OPTS);
      if (warn) return setHoldError(warn, "warn");
    }

    setHoldError("");
    await Store.add(HOLDINGS_COLLECTION, {
      code,
      amount,
      cost, // null = không theo dõi lãi/lỗ cho mã này
      updatedAt: new Date().toISOString(),
    });
    fxState.holdings = await Store.list(HOLDINGS_COLLECTION);
    amountEl.value = "";
    costEl.value = "";
    renderHoldings();
  });

  // Uỷ quyền sự kiện: bảng vẽ lại sau mỗi thao tác.
  document.getElementById("holdTableBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const tr = btn.closest("tr[data-hid]");
    const id = tr.dataset.hid;

    if (btn.dataset.act === "edit") {
      fxState.editingId = id;
      fxState.confirmDeleteId = null;
      renderHoldings(); // `tr` cũ đã bị thay, phải tìm lại dòng mới để focus
      document.querySelector(`tr[data-hid="${id}"] [data-edit="amount"]`)?.focus();
      return;
    }

    if (btn.dataset.act === "cancel") {
      fxState.editingId = null;
      costConfirm.reset(); // bỏ dở thì nhịp xác nhận cũng phải quên
      setHoldError("");
      renderHoldings();
      return;
    }

    if (btn.dataset.act === "save") {
      const amount = parseAmount(tr.querySelector('[data-edit="amount"]').value);
      const costRaw = tr.querySelector('[data-edit="cost"]').value.trim();
      const cost = costRaw ? parseAmount(costRaw) : null;
      if (amount === null || amount <= 0) return setHoldError("Số tiền phải là số lớn hơn 0.");
      if (costRaw && (cost === null || cost <= 0)) return setHoldError("Giá vốn phải là số lớn hơn 0, hoặc để trống.");

      if (cost !== null) {
        const h = fxState.holdings.find((x) => String(x.id) === id);
        const warn = costConfirm.guard(
          `edit|${id}|${cost}`,
          cost,
          h ? holdRate(h.code) : null,
          COST_GUARD_OPTS
        );
        if (warn) return setHoldError(warn, "warn");
      }

      setHoldError("");
      await Store.update(HOLDINGS_COLLECTION, id, { amount, cost, updatedAt: new Date().toISOString() });
      fxState.holdings = await Store.list(HOLDINGS_COLLECTION);
      fxState.editingId = null;
      renderHoldings();
      return;
    }

    if (btn.dataset.act === "del") {
      // Hai nhịp thay vì confirm(): bấm lần đầu đổi nhãn thành "Chắc chứ?".
      // Xoá là thao tác không hoàn tác được và nút nằm ngay cạnh nút Sửa.
      if (fxState.confirmDeleteId !== id) {
        fxState.confirmDeleteId = id;
        renderHoldings();
        setTimeout(() => {
          if (fxState.confirmDeleteId === id) {
            fxState.confirmDeleteId = null;
            renderHoldings();
          }
        }, 4000);
        return;
      }
      fxState.confirmDeleteId = null;
      await Store.remove(HOLDINGS_COLLECTION, id);
      fxState.holdings = await Store.list(HOLDINGS_COLLECTION);
      renderHoldings();
    }
  });

  // Enter để lưu, Esc để huỷ khi đang sửa tại chỗ.
  document.getElementById("holdTableBody").addEventListener("keydown", (e) => {
    if (!fxState.editingId) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.closest("tr")?.querySelector('[data-act="save"]')?.click();
    } else if (e.key === "Escape") {
      e.target.closest("tr")?.querySelector('[data-act="cancel"]')?.click();
    }
  });
}
