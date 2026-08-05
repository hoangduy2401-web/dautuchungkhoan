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

  // Store bất đồng bộ: nạp mã ghim TRƯỚC lần vẽ đầu, nếu không bảng vẽ xong
  // rồi mới nhảy thứ tự.
  fxState.pinned = (await Store.getSetting(PINNED_SETTING, [])) || [];

  renderRangeTabs();
  wireTable();
  wireConverter();
  wireChartToggles();
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
  document.querySelectorAll(".fx-table th.sortable").forEach((th) => {
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

  document.querySelectorAll(".fx-table th.sortable").forEach((th) => {
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
