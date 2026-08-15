// ============================================================
// VÀNG — bảng giá PNJ (dự phòng BTMC) + quy đổi khối lượng + danh mục cá nhân.
//
// ĐƠN VỊ — đã xác minh 06/08/2026 bằng ba nguồn độc lập, đây là việc 2.1 của
// docs/QUYHOACH.md và cùng loại lỗi với giá VND thô của SSI:
//   backend trả **nghìn đồng / CHỈ**  (PNJ giaban 14270 = 14,27 triệu/chỉ)
//   1 lượng = 10 chỉ = 37,5 gram
//   đối chiếu báo chí cùng ngày: SJC 138,8 – 141,8 triệu/lượng ✓
// Đừng đổi hệ số ở đây mà không đo lại — xem docs/VANG.md.
// ============================================================

const goldState = {
  items: [], // [{code, name, buy, sell}] — nghìn đồng/chỉ, null = tiệm không niêm yết
  source: null, // "PNJ" | "BTMC"
  branch: null,
  updatedAt: null,
  note: null, // chỉ có khi nguồn dự phòng trả lời
  unit: "luong", // đơn vị hiển thị của bảng giá
  showAll: false, // hiện cả vàng tuổi thấp (18K trở xuống)
  holdings: [],
  editingId: null,
  confirmDeleteId: null,
};

const HOLDINGS_COLLECTION = "holdings_gold"; // tên đã chốt ở docs/QUYHOACH.md 3.4

// Hệ số quy về CHỈ — đơn vị gốc của mọi con số trong trang.
const UNIT_FACTOR = { luong: 10, chi: 1, gram: 1 / 3.75 };
const UNIT_LABEL = { luong: "lượng", chi: "chỉ", gram: "gram" };

// Nhóm chính của PNJ. Bảng mặc định chỉ hiện nhóm này: 13 mã còn lại là vàng
// nữ trang tuổi thấp (18K trở xuống), chênh lệch mua-bán 9–21% nên trộn vào
// bảng sẽ kéo mọi so sánh lệch hẳn. BTMC (mã = tên sản phẩm) chỉ có 9 dòng,
// coi là chính hết.
const PNJ_MAIN = ["SJC", "N24K", "KB", "TL", "PNJ", "24K", "999"];

// Ngưỡng cảnh báo chênh lệch mua-bán (việc 2.6). Đo 06/08/2026 trên nhóm vàng
// 999.9 của PNJ: 2,10% (SJC) đến 3,54%. 5% là biên trên rộng rãi so với mức
// đó — CHƯA có chuỗi lịch sử để chốt ngưỡng chuẩn, nên coi đây là mốc tạm và
// soát lại khi có dữ liệu nhiều ngày.
const SPREAD_WARN_PCT = 5;

const hasVal = (n) => n !== null && n !== undefined && Number.isFinite(Number(n));
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtMoney = (n, d = 0) =>
  Number(n).toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtQty = (n) =>
  Number(n).toLocaleString("vi-VN", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

// Giá backend là nghìn đồng/chỉ -> số ĐỒNG cho một đơn vị hiển thị.
function priceIn(pricePerChi, unit) {
  if (!hasVal(pricePerChi)) return null;
  return pricePerChi * 1000 * UNIT_FACTOR[unit];
}

function spreadPct(it) {
  if (!hasVal(it.buy) || !hasVal(it.sell) || !it.sell) return null;
  return ((it.sell - it.buy) / it.sell) * 100;
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  initChrome();

  // Store bất đồng bộ: nạp danh mục TRƯỚC lần vẽ đầu, nếu không bảng hiện rỗng
  // rồi mới nhảy số.
  goldState.holdings = (await Store.list(HOLDINGS_COLLECTION)) || [];

  document.getElementById("holdDate").value = new Date().toISOString().slice(0, 10);

  wireUnitTabs();
  wireConverter();
  wireHoldings();
  renderHoldings();

  bootData();
});

function setBackendStatus(text, kind) {
  const el = document.getElementById("backendStatus");
  if (!el) return;
  el.textContent = text || "";
  el.className = "backend-status" + (kind ? ` ${kind}` : "");
  el.style.display = text ? "inline-block" : "none";
}

// Render Free ngủ sau 15 phút; đánh thức trước rồi mới nạp — như hai trang kia.
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
  await loadPrices();
}

/* ============================================================
   BẢNG GIÁ
   ============================================================ */
async function loadPrices() {
  try {
    const d = await DataService.getGoldPrices();
    goldState.items = Array.isArray(d.items) ? d.items : [];
    goldState.source = d.source || null;
    goldState.branch = d.branch || null;
    goldState.updatedAt = d.updatedAt || null;
    goldState.note = d.note || null;
    renderSource();
    renderTable();
    fillTypeSelects();
    updateConverter();
    renderHoldings(); // giờ mới có giá để định giá danh mục
  } catch (err) {
    console.warn("[vang] giá lỗi:", err.message);
    DataService.markAsleep();
    setTableMessage("Nguồn lỗi — chưa lấy được giá vàng.");
  }
}

function renderSource() {
  const el = document.getElementById("goldSource");
  const when = goldState.updatedAt ? new Date(goldState.updatedAt) : null;
  const stamp =
    when && !Number.isNaN(when.getTime())
      ? ` · niêm yết ${when.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`
      : "";
  const branch = goldState.branch ? ` (${escapeHtml(goldState.branch)})` : "";
  el.textContent = `${goldState.source || "—"}${branch}${stamp}`;

  // Nguồn dự phòng trả lời = giá của MỘT TIỆM KHÁC. Phải nói ra, nếu không user
  // thấy số nhảy và tưởng thị trường biến động.
  const fb = document.getElementById("goldFallback");
  fb.textContent = goldState.note || "";
  fb.hidden = !goldState.note;
}

function setTableMessage(msg) {
  document.getElementById("goldTableBody").innerHTML =
    `<tr><td colspan="4" class="empty-state">${escapeHtml(msg)}</td></tr>`;
}

function visibleItems() {
  if (goldState.showAll || goldState.source !== "PNJ") return goldState.items;
  return goldState.items.filter((it) => PNJ_MAIN.includes(it.code));
}

function renderTable() {
  const rows = visibleItems();
  if (!rows.length) {
    setTableMessage(goldState.items.length ? "Không có loại nào." : "Đang chờ máy chủ…");
    return;
  }

  const u = goldState.unit;
  document.getElementById("goldTableBody").innerHTML = rows
    .map((it) => {
      const sp = spreadPct(it);
      const warn = hasVal(sp) && sp >= SPREAD_WARN_PCT;
      const buy = priceIn(it.buy, u);
      const sell = priceIn(it.sell, u);
      return `<tr>
        <td class="gold-name">${escapeHtml(it.name || it.code)}</td>
        <td class="num">${buy === null ? "—" : fmtMoney(buy)}</td>
        <td class="num">${sell === null ? "—" : fmtMoney(sell)}</td>
        <td class="num ${warn ? "warn" : "muted"}">${hasVal(sp) ? sp.toFixed(2) + "%" : "—"}${
          warn ? ' <span class="warn-dot" title="Chênh lệch mua-bán giãn rộng">▲</span>' : ""
        }</td>
      </tr>`;
    })
    .join("");

  renderSpreadNote();
}

function renderSpreadNote() {
  const el = document.getElementById("spreadNote");
  const main = goldState.items.filter((it) => hasVal(spreadPct(it)) && (goldState.source !== "PNJ" || PNJ_MAIN.includes(it.code)));
  if (!main.length) {
    el.textContent = "";
    return;
  }
  const sjc = goldState.items.find((it) => it.code === "SJC" || /SJC/i.test(it.name || ""));
  const sjcSp = sjc ? spreadPct(sjc) : null;
  const avg = main.reduce((s, it) => s + spreadPct(it), 0) / main.length;
  // Trung bình luôn tính trên nhóm chính (con số ổn định để so sánh), nhưng số
  // dòng cảnh báo phải đếm theo đúng những gì bảng ĐANG hiện — bật "vàng tuổi
  // thấp" mà chú thích vẫn nói "không có dòng nào vượt ngưỡng" là mâu thuẫn với
  // 8 dấu ▲ ngay phía trên.
  const warned = visibleItems().filter((it) => {
    const sp = spreadPct(it);
    return hasVal(sp) && sp >= SPREAD_WARN_PCT;
  }).length;

  el.innerHTML =
    `Giá theo <strong>${UNIT_LABEL[goldState.unit]}</strong>. ` +
    (hasVal(sjcSp) ? `Chênh lệch mua–bán của vàng miếng SJC hiện <strong>${sjcSp.toFixed(2)}%</strong>, ` : "") +
    `trung bình nhóm chính <strong>${avg.toFixed(2)}%</strong>. ` +
    `Vượt ${SPREAD_WARN_PCT}% được đánh dấu ▲ — chênh lệch giãn rộng thường là lúc thị trường căng, ` +
    `mua vào lúc đó lỗ ngay phần chênh.` +
    (warned ? ` <span class="warn">Đang có ${warned} loại vượt ngưỡng.</span>` : "");
}

function wireUnitTabs() {
  const tabs = document.getElementById("unitTabs");
  const sync = () =>
    tabs.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.unit === goldState.unit));
  sync();
  tabs.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-unit]");
    if (!btn) return;
    goldState.unit = btn.dataset.unit;
    sync();
    renderTable();
  });

  const chk = document.getElementById("chkAllTypes");
  chk.addEventListener("change", () => {
    goldState.showAll = chk.checked;
    renderTable();
  });
}

/* ============================================================
   QUY ĐỔI KHỐI LƯỢNG + THÀNH TIỀN
   ============================================================ */
function parseAmount(s) {
  const raw = String(s || "").trim().replace(/\s/g, "");
  if (!raw) return null;
  const commas = (raw.match(/,/g) || []).length;
  let cleaned;
  if (commas === 1 && raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
    cleaned = raw.replace(/\./g, "").replace(",", "."); // Việt: chấm = nghìn
  } else if (commas > 0) {
    cleaned = raw.replace(/,/g, ""); // Anh: phẩy = nghìn
  } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
    cleaned = raw.replace(/\./g, ""); // "1.000.000"
  } else {
    cleaned = raw;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function fillTypeSelects() {
  const sellable = goldState.items.filter((it) => hasVal(it.buy));
  const options = sellable
    .map((it) => `<option value="${escapeHtml(it.code)}">${escapeHtml(it.name || it.code)}</option>`)
    .join("");
  for (const id of ["convType", "holdType"]) {
    const sel = document.getElementById(id);
    const keep = sel.value;
    sel.innerHTML = options;
    if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
  }
}

function itemByCode(code) {
  return goldState.items.find((it) => it.code === code) || null;
}

function updateConverter() {
  const qty = parseAmount(document.getElementById("convQty").value);
  const unit = document.getElementById("convUnit").value;
  const out = document.getElementById("convOut");
  const moneyOut = document.getElementById("convMoneyOut");

  if (qty === null) {
    out.textContent = "";
    moneyOut.textContent = "";
    return;
  }

  const chi = qty * UNIT_FACTOR[unit];
  out.innerHTML =
    `<span>${fmtQty(chi / 10)} lượng</span><span>${fmtQty(chi)} chỉ</span><span>${fmtQty(chi * 3.75)} gram</span>`;

  const it = itemByCode(document.getElementById("convType").value);
  if (!it) {
    moneyOut.textContent = "";
    return;
  }
  const buy = hasVal(it.buy) ? chi * it.buy * 1000 : null;
  const sell = hasVal(it.sell) ? chi * it.sell * 1000 : null;
  moneyOut.innerHTML =
    `<div><span class="lbl">Bán cho tiệm</span><strong class="money">${buy === null ? "—" : fmtMoney(buy) + " ₫"}</strong></div>` +
    `<div><span class="lbl">Mua từ tiệm</span><strong class="money">${sell === null ? "—" : fmtMoney(sell) + " ₫"}</strong></div>`;
}

function wireConverter() {
  document.getElementById("convQty").addEventListener("input", updateConverter);
  document.getElementById("convUnit").addEventListener("change", updateConverter);
  document.getElementById("convType").addEventListener("change", updateConverter);
}

/* ============================================================
   DANH MỤC CÁ NHÂN (collection `holdings_gold`)

   Cùng khuôn với danh mục ngoại tệ: DANH SÁCH NẮM GIỮ sửa trực tiếp, không phải
   sổ giao dịch mua/bán. Định giá theo **giá tiệm MUA VÀO** — đó là số tiền thật
   sự thu về khi bán lại, không phải giá niêm yết bán ra.

   Giá vốn nhập theo **triệu đồng/lượng** vì đó là cách người Việt nhớ giá vàng
   ("mua 138 triệu một lượng"); nội bộ quy về nghìn đồng/chỉ để so với bảng giá.
   ============================================================ */
const COST_TO_PER_CHI = 100; // triệu ₫/lượng -> nghìn ₫/chỉ (×1e6 ÷10 ÷1e3)

// Giá thị trường quy về ĐÚNG đơn vị của ô giá vốn (triệu ₫/lượng) để CostGuard
// so sánh. Ưu tiên giá tiệm MUA VÀO — đó là giá dùng để định giá danh mục, nên
// cảnh báo và bảng nói cùng một con số. Tiệm không niêm yết chiều mua (PNJ chỉ
// mua vàng nguyên liệu) thì lấy tạm giá bán ra; không có cả hai thì trả null và
// CostGuard im lặng, không cảnh báo dựa trên số không có.
function marketCostFor(code) {
  const it = itemByCode(code);
  if (!it) return null;
  const perChi = hasVal(it.buy) ? it.buy : hasVal(it.sell) ? it.sell : null;
  return perChi === null ? null : perChi / COST_TO_PER_CHI;
}

const costConfirm = CostGuard.makeConfirmer();
const COST_GUARD_OPTS = {
  unitLabel: "triệu ₫/lượng",
  marketLabel: "giá vàng hiện tại",
  // maximumFractionDigits, KHÔNG dùng fmtMoney: fmtMoney ghim cả min lẫn max nên
  // gợi ý "80" bị in thành "80,0" — số gợi ý phải gõ lại được y nguyên.
  fmt: (n) => Number(n).toLocaleString("vi-VN", { maximumFractionDigits: n < 100 ? 1 : 0 }),
};

function holdRow(h) {
  const it = itemByCode(h.code);
  const qty = Number(h.qty) || 0;
  const chi = qty * (UNIT_FACTOR[h.unit] || 1);
  const buy = it && hasVal(it.buy) ? it.buy : null; // nghìn ₫/chỉ
  const cost = hasVal(h.cost) ? Number(h.cost) : null; // triệu ₫/lượng
  const costPerChi = cost === null ? null : cost * COST_TO_PER_CHI;
  const value = buy === null ? null : chi * buy * 1000;
  const pl = buy === null || costPerChi === null ? null : chi * (buy - costPerChi) * 1000;
  const plPct = costPerChi ? ((buy - costPerChi) / costPerChi) * 100 : null;
  return { ...h, qty, chi, buy, cost, value, pl, plPct: buy === null ? null : plPct };
}

function renderHoldings() {
  const body = document.getElementById("holdTableBody");
  const rows = goldState.holdings.map(holdRow);

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-state">Chưa có mục nào. Thêm ở ô phía trên.</td></tr>`;
    document.getElementById("holdSummary").innerHTML = "";
    return;
  }

  body.innerHTML = rows.map((r) => (r.id === goldState.editingId ? editRowHtml(r) : viewRowHtml(r))).join("");
  renderHoldSummary(rows);
}

function viewRowHtml(r) {
  const plCls = r.pl === null ? "" : r.pl > 0 ? "up" : r.pl < 0 ? "down" : "flat";
  const plText =
    r.pl === null
      ? "—"
      : `<span class="money">${r.pl >= 0 ? "+" : ""}${fmtMoney(r.pl)} ₫</span> <span class="${plCls}">(${r.plPct >= 0 ? "+" : ""}${r.plPct.toFixed(2)}%)</span>`;
  const delLabel = r.id === goldState.confirmDeleteId ? "Chắc chứ?" : "Xoá";

  return `<tr data-hid="${r.id}">
    <td class="gold-name">${escapeHtml(r.name || r.code)}</td>
    <td class="num"><span class="money">${fmtQty(r.qty)}</span> ${UNIT_LABEL[r.unit] || ""}</td>
    <td class="num muted">${r.cost === null ? "—" : fmtMoney(r.cost, 1) + " tr/lượng"}</td>
    <td class="num muted col-rate">${r.buy === null ? "—" : fmtMoney(r.buy * 10 * 1000)}</td>
    <td class="num">${r.value === null ? "—" : `<span class="money">${fmtMoney(r.value)}</span>`}</td>
    <td class="num ${plCls}">${plText}</td>
    <td class="col-date muted">${escapeHtml(r.date || "—")}</td>
    <td class="act">
      <button type="button" class="row-btn" data-act="edit">Sửa</button>
      <button type="button" class="row-btn danger" data-act="del">${delLabel}</button>
    </td>
  </tr>`;
}

// Sửa tại chỗ: số lượng, giá vốn, ngày mua. Đổi LOẠI thì xoá rồi thêm lại —
// giá vốn cũ gắn với loại vàng cũ.
function editRowHtml(r) {
  return `<tr data-hid="${r.id}">
    <td class="gold-name">${escapeHtml(r.name || r.code)}</td>
    <td class="num"><input class="edit-input" data-edit="qty" value="${fmtQty(r.qty)}" /> ${UNIT_LABEL[r.unit] || ""}</td>
    <td class="num"><input class="edit-input" data-edit="cost" value="${r.cost === null ? "" : fmtMoney(r.cost, 1)}" placeholder="tr/lượng" /></td>
    <td class="num muted col-rate">${r.buy === null ? "—" : fmtMoney(r.buy * 10 * 1000)}</td>
    <td class="num muted">—</td>
    <td class="num muted">—</td>
    <td class="col-date"><input class="edit-input" type="date" data-edit="date" value="${escapeHtml(r.date || "")}" /></td>
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
  const totalChi = rows.reduce((s, r) => s + r.chi, 0);

  const withCost = rows.filter((r) => r.pl !== null);
  const totalPl = withCost.reduce((s, r) => s + r.pl, 0);
  const totalCost = withCost.reduce((s, r) => s + r.chi * r.cost * COST_TO_PER_CHI * 1000, 0);
  const plPct = totalCost ? (totalPl / totalCost) * 100 : null;
  const plCls = totalPl > 0 ? "up" : totalPl < 0 ? "down" : "flat";

  document.getElementById("holdSummary").innerHTML =
    `<div class="stat">
       <span class="label">Tổng giá trị${missing ? ` (thiếu giá ${missing} mục)` : ""}</span>
       <span class="val"><span class="money">${priced.length ? fmtMoney(total) + " ₫" : "—"}</span></span>
     </div>
     <div class="stat">
       <span class="label">Tổng khối lượng</span>
       <span class="val"><span class="money">${fmtQty(totalChi / 10)}</span> lượng</span>
     </div>` +
    (withCost.length
      ? `<div class="stat">
           <span class="label">Lãi/lỗ (${withCost.length}/${rows.length} mục có giá vốn)</span>
           <span class="val ${plCls}"><span class="money">${totalPl >= 0 ? "+" : ""}${fmtMoney(totalPl)} ₫</span>${
             plPct === null ? "" : ` <span>(${plPct >= 0 ? "+" : ""}${plPct.toFixed(2)}%)</span>`
           }</span>
         </div>`
      : "");
}

// kind = "warn": cảnh báo đơn vị, không chặn — đổi màu để khỏi lẫn với lỗi thật.
function setHoldError(msg, kind) {
  const el = document.getElementById("holdError");
  el.textContent = msg || "";
  el.hidden = !msg;
  el.classList.toggle("warn", kind === "warn" && !!msg);
}

function wireHoldings() {
  document.getElementById("holdForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sel = document.getElementById("holdType");
    const code = sel.value;
    const name = sel.options[sel.selectedIndex]?.textContent || code;
    const qtyEl = document.getElementById("holdQty");
    const costEl = document.getElementById("holdCost");
    const qty = parseAmount(qtyEl.value);
    const costRaw = costEl.value.trim();
    const cost = costRaw ? parseAmount(costRaw) : null;

    if (!code) return setHoldError("Chưa nạp được bảng giá — thử lại khi bảng hiện số.");
    if (qty === null || qty <= 0) return setHoldError("Số lượng phải là số lớn hơn 0.");
    if (costRaw && (cost === null || cost <= 0)) return setHoldError("Giá vốn phải là số lớn hơn 0, hoặc để trống.");

    if (cost !== null) {
      const warn = costConfirm.guard(`add|${code}|${cost}`, cost, marketCostFor(code), COST_GUARD_OPTS);
      if (warn) return setHoldError(warn, "warn");
    }

    setHoldError("");
    await Store.add(HOLDINGS_COLLECTION, {
      code,
      name,
      qty,
      unit: document.getElementById("holdUnit").value,
      cost, // triệu ₫/lượng; null = không theo dõi lãi/lỗ
      date: document.getElementById("holdDate").value || null,
      updatedAt: new Date().toISOString(),
    });
    goldState.holdings = await Store.list(HOLDINGS_COLLECTION);
    qtyEl.value = "";
    costEl.value = "";
    renderHoldings();
  });

  document.getElementById("holdTableBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const tr = btn.closest("tr[data-hid]");
    const id = tr.dataset.hid;

    if (btn.dataset.act === "edit") {
      goldState.editingId = id;
      goldState.confirmDeleteId = null;
      renderHoldings(); // dòng cũ đã bị thay, phải tìm lại dòng mới để focus
      document.querySelector(`tr[data-hid="${id}"] [data-edit="qty"]`)?.focus();
      return;
    }

    if (btn.dataset.act === "cancel") {
      goldState.editingId = null;
      costConfirm.reset(); // bỏ dở thì nhịp xác nhận cũng phải quên
      setHoldError("");
      renderHoldings();
      return;
    }

    if (btn.dataset.act === "save") {
      const qty = parseAmount(tr.querySelector('[data-edit="qty"]').value);
      const costRaw = tr.querySelector('[data-edit="cost"]').value.trim();
      const cost = costRaw ? parseAmount(costRaw) : null;
      const date = tr.querySelector('[data-edit="date"]').value || null;
      if (qty === null || qty <= 0) return setHoldError("Số lượng phải là số lớn hơn 0.");
      if (costRaw && (cost === null || cost <= 0)) return setHoldError("Giá vốn phải là số lớn hơn 0, hoặc để trống.");

      if (cost !== null) {
        const h = goldState.holdings.find((x) => String(x.id) === id);
        const warn = costConfirm.guard(
          `edit|${id}|${cost}`,
          cost,
          h ? marketCostFor(h.code) : null,
          COST_GUARD_OPTS
        );
        if (warn) return setHoldError(warn, "warn");
      }

      setHoldError("");
      await Store.update(HOLDINGS_COLLECTION, id, { qty, cost, date, updatedAt: new Date().toISOString() });
      goldState.holdings = await Store.list(HOLDINGS_COLLECTION);
      goldState.editingId = null;
      renderHoldings();
      return;
    }

    if (btn.dataset.act === "del") {
      // Hai nhịp thay vì confirm(): xoá không hoàn tác được và nút nằm ngay
      // cạnh nút Sửa.
      if (goldState.confirmDeleteId !== id) {
        goldState.confirmDeleteId = id;
        renderHoldings();
        setTimeout(() => {
          if (goldState.confirmDeleteId === id) {
            goldState.confirmDeleteId = null;
            renderHoldings();
          }
        }, 4000);
        return;
      }
      goldState.confirmDeleteId = null;
      await Store.remove(HOLDINGS_COLLECTION, id);
      goldState.holdings = await Store.list(HOLDINGS_COLLECTION);
      renderHoldings();
    }
  });

  document.getElementById("holdTableBody").addEventListener("keydown", (e) => {
    if (!goldState.editingId) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.closest("tr")?.querySelector('[data-act="save"]')?.click();
    } else if (e.key === "Escape") {
      e.target.closest("tr")?.querySelector('[data-act="cancel"]')?.click();
    }
  });
}
