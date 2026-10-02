// ============================================================
// GỬI TIẾT KIỆM — bảng lãi suất 29 ngân hàng + công cụ so sánh + sổ nhập tay.
//
// CÔNG THỨC LÃI: lãi cuối kỳ, KHÔNG tái tục, KHÔNG trừ thuế/phí:
//     lãi = gốc × (lãi suất %/năm ÷ 100) × số tháng ÷ 12
// Đây là cách ngân hàng Việt Nam trả cho sổ có kỳ hạn nhận lãi cuối kỳ. Sổ lĩnh
// lãi hàng tháng hay tự động tái tục cho con số khác — trang ghi rõ giả định
// thay vì im lặng, vì một con số lãi sai vẫn trông y hệt con số đúng (mục 3).
//
// NHÃN THỜI GIAN LÀ "LẤY LÚC", KHÔNG PHẢI "CẬP NHẬT LÚC": file nguồn của CafeF
// không mang thời điểm ngân hàng đổi lãi suất, chỉ có lúc server này tải về.
// ============================================================

const svState = {
  terms: [], // ["0T","1T",...] đã sắp theo số tháng ở backend
  banks: [], // [{name, symbol, icon, rates:{kỳ hạn: %/năm | null}}]
  fetchedAt: null,
  stale: false,
  snapshotAt: null,
  cachedAt: null, // savedAt of the board saved in THIS browser; null = live numbers
  search: "",
  sortTerm: "12T", // kỳ hạn dùng để sắp bảng
  // Cảnh báo đáo hạn user đã ẩn: "idSổ:mức" (mức = d30|d15|d7|past). Ẩn theo
  // TỪNG MỨC chứ không ẩn vĩnh viễn: ẩn lúc còn 30 ngày thì tới mốc 15 ngày,
  // 7 ngày, ngày đáo hạn nó vẫn hiện lại — không để lỡ ngày đáo hạn thật.
  // Lưu qua Store (đồng bộ mọi thiết bị đã đăng nhập).
  dismissed: new Set(),
  books: [], // sổ tiết kiệm, collection savings_accounts
  editingId: null,
  confirmDeleteId: null,
};

const BOOKS_COLLECTION = "savings_accounts"; // tên đã chốt ở docs/QUYHOACH.md 3.4

// Mốc cảnh báo đáo hạn (ngày). Ba mức vì việc cần làm khác nhau: 30 ngày là lúc
// bắt đầu tìm lãi suất mới, 7 ngày là lúc phải quyết.
const ALERT_DAYS = [30, 15, 7];
const ALERT_DISMISS_SETTING = "svAlertDismissed";

const hasVal = (n) => n !== null && n !== undefined && Number.isFinite(Number(n));
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtMoney = (n) => Number(n).toLocaleString("vi-VN", { maximumFractionDigits: 0 });
const fmtRate = (n) => (hasVal(n) ? Number(n).toFixed(2) + "%" : "—");

// "12T" -> 12. Kỳ hạn phải so theo SỐ THÁNG, so theo chuỗi thì "12T" < "1T".
function termMonths(t) {
  const m = String(t || "").match(/(\d+)/);
  return m ? Number(m[1]) : 0;
}
function termLabel(t) {
  const n = termMonths(t);
  return n === 0 ? "Không kỳ hạn" : `${n} tháng`;
}

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
    cleaned = raw.replace(/\./g, ""); // "100.000.000"
  } else {
    cleaned = raw;
  }
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

// Lãi cuối kỳ. Xem ghi chú công thức ở đầu file.
function interestOf(amount, ratePct, months) {
  if (!hasVal(amount) || !hasVal(ratePct) || !hasVal(months)) return null;
  return (amount * (ratePct / 100) * months) / 12;
}

// Ngày đáo hạn = ngày gửi + số tháng. `setMonth` tự dồn ngày 31 sang cuối tháng
// ngắn hơn (31/01 + 1 tháng = 03/03), nên kẹp lại về ngày cuối tháng đích —
// đó cũng là cách ngân hàng ghi trên sổ.
function maturityDate(startStr, months) {
  if (!startStr) return null;
  const d = new Date(startStr + "T00:00:00");
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

const MS_DAY = 24 * 3600 * 1000;
function daysUntil(date) {
  if (!date) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / MS_DAY);
}
const fmtDate = (d) => (d ? d.toLocaleDateString("vi-VN") : "—");

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  initChrome();

  // Store bất đồng bộ: nạp sổ TRƯỚC lần vẽ đầu, nếu không bảng hiện rỗng rồi
  // mới nhảy số.
  svState.books = (await Store.list(BOOKS_COLLECTION)) || [];
  svState.dismissed = new Set((await Store.getSetting(ALERT_DISMISS_SETTING, [])) || []);
  document.getElementById("holdDate").value = new Date().toISOString().slice(0, 10);

  wireTable();
  wireCalc();
  wireBooks();
  wireAlerts();
  renderBooks(); // sổ đọc được ngay cả khi máy chủ chưa trả lời

  bootData();
});

function setBackendStatus(text, kind) {
  const el = document.getElementById("backendStatus");
  if (!el) return;
  el.textContent = text || "";
  el.className = "backend-status" + (kind ? ` ${kind}` : "");
  el.style.display = text ? "inline-block" : "none";
}

async function bootData() {
  const t0 = Date.now();
  const tick = setInterval(() => {
    const s = Math.round((Date.now() - t0) / 1000);
    setBackendStatus(s < 5 ? "Đang kết nối máy chủ…" : `Máy chủ đang khởi động (thường 30–50s)… ${s}s`, "warn");
  }, 500);

  // Last good board from this browser, painted now and labelled as old while
  // Render wakes (30-50s). The live answer replaces it.
  const cache = DataService.loadPageCache("savings");
  if (cache && applyRates(cache.data)) {
    svState.cachedAt = cache.savedAt;
    setSnapshotNote(cache.savedAt);
  }

  const awake = await DataService.wakeBackend();
  clearInterval(tick);

  if (!awake) {
    setBackendStatus("Máy chủ không phản hồi — tải lại trang để thử lại", "err");
    if (svState.cachedAt) {
      // Keep the labelled old numbers: real data with a date beats an empty table.
      setSnapshotNote(svState.cachedAt, true);
      Motion.settleSkeletons("Chưa lấy được dữ liệu.");
    } else {
      setTableError("Không kết nối được máy chủ.");
    }
    return; // không vẽ gì: bảng trống hơn hẳn bảng số bịa
  }

  setBackendStatus("", "");
  await loadRates();
}

/* ============================================================
   BẢNG LÃI SUẤT
   ============================================================ */
// Draw the board from one /savings answer — live, or the saved copy at boot.
// Returns false when there is nothing to draw.
function applyRates(d) {
  svState.terms = Array.isArray(d.terms) ? d.terms : [];
  svState.banks = Array.isArray(d.banks) ? d.banks : [];
  svState.fetchedAt = d.fetchedAt || null;
  svState.stale = !!d.stale;
  svState.snapshotAt = d.snapshotAt || null;
  if (!svState.terms.includes(svState.sortTerm)) svState.sortTerm = svState.terms[svState.terms.length - 1] || "";

  renderSource();
  fillTermSelects();
  fillBankList();
  renderTable();
  renderCalc();
  renderBooks(); // giờ mới gợi ý được lãi suất theo bảng
  return svState.banks.length > 0;
}

async function loadRates() {
  try {
    const d = await DataService.getSavingsRates();
    if (applyRates(d)) DataService.savePageCache("savings", d);
    svState.cachedAt = null;
    setSnapshotNote(null);
  } catch (err) {
    console.warn("[tiet-kiem] lãi suất lỗi:", err.message);
    DataService.markAsleep();
    if (svState.cachedAt) {
      // Keep the labelled old numbers: real data with a date beats an empty table.
      setSnapshotNote(svState.cachedAt, true);
      Motion.settleSkeletons("Chưa lấy được dữ liệu.");
    } else {
      setTableError("Nguồn lỗi — chưa lấy được bảng lãi suất.");
    }
  }
}

function renderSource() {
  const when = svState.fetchedAt ? new Date(svState.fetchedAt) : null;
  const stamp =
    when && !Number.isNaN(when.getTime())
      ? ` · lấy lúc ${when.toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}`
      : "";
  document.getElementById("svSource").textContent = `CafeF${stamp}`;

  // Bản chụp cũ = số của ngày khác. Phải nói ra, nếu không user đọc như số hôm nay.
  const el = document.getElementById("svStale");
  if (svState.stale && svState.snapshotAt) {
    const snap = new Date(svState.snapshotAt);
    el.textContent = `Nguồn đang lỗi — đây là bản chụp lấy lúc ${snap.toLocaleString("vi-VN")}. Lãi suất có thể đã đổi.`;
    el.hidden = false;
  } else {
    el.hidden = true;
  }
}

// Set once loading has failed: later re-renders (search, unit/sort switch)
// keep the error instead of going back to an endless shimmer.
let boardError = null;
function setTableError(msg) {
  boardError = msg;
  setTableMessage(msg);
  Motion.settleSkeletons("Chưa lấy được dữ liệu.");
}

// Waiting for the board: header + rows as shimmer bars. CafeF lists 8 terms;
// the exact count only matters for the first paint.
const SV_SK_TERMS = 8;
// Logo square + name, like the real bank cell (the logo makes the row taller).
const SV_SK_BANK =
  '<span class="sv-bank-in"><span class="sk" style="width:18px;height:18px;border-radius:4px;flex:0 0 18px"></span><span class="sk" style="width:110px"></span></span>';
function setTableSkeleton() {
  if (boardError) return setTableMessage(boardError);
  const bar = '<span class="sk" style="width:70%"></span>';
  document.getElementById("svHead").innerHTML =
    `<th>Ngân hàng</th>` + `<th class="num">${bar}</th>`.repeat(SV_SK_TERMS);
  document.getElementById("svBody").innerHTML =
    Motion.skeletonRows(10, [{ cls: "sv-bank", html: SV_SK_BANK }, ...Array(SV_SK_TERMS).fill("num")]);
}

function setTableMessage(msg) {
  document.getElementById("svHead").innerHTML = "";
  document.getElementById("svBody").innerHTML =
    `<tr><td class="empty-state">${escapeHtml(msg)}</td></tr>`;
}

// Lãi suất cao nhất của mỗi kỳ hạn — dùng để tô nổi bật (việc 4.3).
function bestByTerm() {
  const best = {};
  for (const t of svState.terms) {
    let max = null;
    for (const b of svState.banks) {
      const v = b.rates[t];
      if (hasVal(v) && (max === null || v > max)) max = v;
    }
    best[t] = max;
  }
  return best;
}

function visibleBanks() {
  const q = svState.search.trim().toLowerCase();
  const rows = svState.banks.filter(
    (b) => !q || b.name.toLowerCase().includes(q) || String(b.symbol || "").toLowerCase().includes(q)
  );
  const t = svState.sortTerm;
  // Sắp giảm dần theo kỳ hạn đang chọn; ngân hàng không niêm yết kỳ hạn đó
  // xuống cuối, không coi là 0%.
  return rows.sort((a, b) => {
    const va = a.rates[t];
    const vb = b.rates[t];
    if (!hasVal(va) && !hasVal(vb)) return a.name.localeCompare(b.name, "vi");
    if (!hasVal(va)) return 1;
    if (!hasVal(vb)) return -1;
    return vb - va;
  });
}

// Điện thoại: bảng 9 cột rộng gấp đôi màn hình, và kỳ hạn đang dùng để sắp
// (mặc định 12T) nằm tít bên phải, phải vuốt mới thấy (đo 26/09: 548px trên
// khung 305px). Trên màn hình hẹp đưa kỳ hạn đó lên ngay sau tên ngân hàng.
// Màn hình rộng giữ thứ tự kỳ hạn tự nhiên — đổi thứ tự cột khi bấm tiêu đề
// sẽ làm người dùng máy tính mất phương hướng.
const narrowMq = window.matchMedia("(max-width: 640px)");
narrowMq.addEventListener("change", () => renderTable());
function orderedTerms() {
  if (!narrowMq.matches || !svState.terms.includes(svState.sortTerm)) return svState.terms;
  return [svState.sortTerm, ...svState.terms.filter((t) => t !== svState.sortTerm)];
}

function renderTable() {
  if (!svState.banks.length) {
    setTableSkeleton();
    return;
  }
  const terms = orderedTerms();

  document.getElementById("svHead").innerHTML =
    `<th>Ngân hàng</th>` +
    terms
      .map(
        (t) =>
          `<th class="num sv-term${t === svState.sortTerm ? " on" : ""}" data-term="${escapeHtml(t)}">${escapeHtml(t)}</th>`
      )
      .join("");

  const best = bestByTerm();
  const rows = visibleBanks();
  document.getElementById("svBody").innerHTML = rows.length
    ? rows
        .map((b) => {
          const cells = terms
            .map((t) => {
              const v = b.rates[t];
              const top = hasVal(v) && best[t] !== null && v >= best[t];
              return `<td class="num${top ? " sv-best" : ""}">${fmtRate(v)}</td>`;
            })
            .join("");
          return `<tr>
            <td class="sv-bank"><span class="sv-bank-in">
              ${b.icon ? `<img class="sv-logo" src="${escapeHtml(b.icon)}" alt="" onerror="this.remove()" />` : ""}
              <span>${escapeHtml(b.name)}</span>
            </span></td>${cells}
          </tr>`;
        })
        .join("")
    : `<tr><td class="empty-state" colspan="${svState.terms.length + 1}">Không có ngân hàng nào khớp.</td></tr>`;

  document.getElementById("svNote").innerHTML =
    `Ô tô đậm là lãi suất cao nhất của kỳ hạn đó. Bấm tiêu đề kỳ hạn để sắp lại bảng. ` +
    `Ô trống nghĩa là ngân hàng <strong>không niêm yết</strong> kỳ hạn đó, không phải 0%/năm.`;
}

function wireTable() {
  const search = document.getElementById("svSearch");
  search.addEventListener("input", () => {
    svState.search = search.value;
    renderTable();
  });

  const sel = document.getElementById("svSortTerm");
  sel.addEventListener("change", () => {
    svState.sortTerm = sel.value;
    renderTable();
  });

  // Uỷ quyền: hàng tiêu đề vẽ lại mỗi lần render.
  document.getElementById("svHead").addEventListener("click", (e) => {
    const th = e.target.closest("th[data-term]");
    if (!th) return;
    svState.sortTerm = th.dataset.term;
    document.getElementById("svSortTerm").value = svState.sortTerm;
    renderTable();
  });
}

function fillTermSelects() {
  const opts = svState.terms.map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(termLabel(t))}</option>`).join("");
  for (const [id, keep] of [
    ["svSortTerm", svState.sortTerm],
    ["calcTerm", "12T"],
    ["holdTerm", "12T"],
  ]) {
    const sel = document.getElementById(id);
    const prev = sel.value || keep;
    sel.innerHTML = opts;
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }
}

function fillBankList() {
  document.getElementById("bankList").innerHTML = svState.banks
    .map((b) => `<option value="${escapeHtml(b.name)}"></option>`)
    .join("");
}

/* ============================================================
   CÔNG CỤ "GỬI X TIỀN, Y THÁNG — Ở ĐÂU LỜI NHẤT" (việc 4.7)
   ============================================================ */
function wireCalc() {
  document.getElementById("calcAmount").addEventListener("input", renderCalc);
  document.getElementById("calcTerm").addEventListener("change", renderCalc);
}

function renderCalc() {
  const host = document.getElementById("calcTop");
  const amount = parseAmount(document.getElementById("calcAmount").value);
  const term = document.getElementById("calcTerm").value;
  if (amount === null || amount <= 0) {
    host.innerHTML = `<div class="empty-state">Nhập số tiền để xem ngân hàng nào lời nhất.</div>`;
    return;
  }
  if (!svState.banks.length && boardError) {
    host.innerHTML = `<div class="empty-state">Chưa có bảng lãi suất để so sánh.</div>`;
    return;
  }
  if (!svState.banks.length) {
    // Amount typed before the board arrived: shimmer the top-5 list.
    const bar = (w) => `<span class="sk" style="width:${w}%"></span>`;
    host.innerHTML = [62, 48, 70, 54, 66]
      .map(
        (w, i) => `<div class="sv-top-row" aria-hidden="true">
          <span class="sv-top-rank">${i + 1}</span>
          <span class="sv-top-name">${bar(w)}</span>
          <span class="sv-top-rate">${bar(80)}</span>
          <span class="sv-top-interest">${bar(90)}</span>
        </div>`
      )
      .join("");
    return;
  }

  const months = termMonths(term);
  const rows = svState.banks
    .filter((b) => hasVal(b.rates[term]))
    .map((b) => ({ name: b.name, icon: b.icon, rate: b.rates[term], interest: interestOf(amount, b.rates[term], months) }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, 5);

  if (!rows.length) {
    host.innerHTML = `<div class="empty-state">Không ngân hàng nào niêm yết kỳ hạn này.</div>`;
    return;
  }

  const bestInterest = rows[0].interest;
  host.innerHTML =
    rows
      .map(
        (r, i) => `<div class="sv-top-row${i === 0 ? " first" : ""}">
          <span class="sv-top-rank">${i + 1}</span>
          <span class="sv-top-name">
            ${r.icon ? `<img class="sv-logo" src="${escapeHtml(r.icon)}" alt="" onerror="this.remove()" />` : ""}
            ${escapeHtml(r.name)}
          </span>
          <span class="sv-top-rate">${fmtRate(r.rate)}</span>
          <span class="sv-top-interest money">+${fmtMoney(r.interest)} ₫</span>
        </div>`
      )
      .join("") +
    `<div class="sv-calc-note">Lãi ${termLabel(term).toLowerCase()} cho <span class="money">${fmtMoney(amount)} ₫</span>,
      tính lãi cuối kỳ, chưa trừ thuế/phí và không tái tục.
      Chênh giữa hạng 1 và hạng ${rows.length}: <strong class="money">${fmtMoney(bestInterest - rows[rows.length - 1].interest)} ₫</strong>.</div>`;
}

/* ============================================================
   SỔ TIẾT KIỆM (collection `savings_accounts`)

   Cùng khuôn danh mục của ba trang tài sản kia: danh sách sửa tại chỗ, không
   phải sổ giao dịch. Lãi suất lưu theo con số ĐÃ CHỐT LÚC GỬI, không đọc lại
   từ bảng — bảng là lãi suất đang niêm yết hôm nay, còn sổ đã khoá lãi suất từ
   ngày gửi. Lấy số hôm nay áp cho sổ cũ là con số sai.
   ============================================================ */
function bookRow(b) {
  const amount = Number(b.amount) || 0;
  const rate = hasVal(b.rate) ? Number(b.rate) : null;
  const months = termMonths(b.term);
  const mat = maturityDate(b.date, months);
  const interest = interestOf(amount, rate, months);
  return { ...b, amount, rate, months, maturity: mat, daysLeft: daysUntil(mat), interest };
}

function renderBooks() {
  const body = document.getElementById("holdTableBody");
  const rows = svState.books.map(bookRow);

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-state">Chưa có sổ nào. Thêm ở ô phía trên.</td></tr>`;
    document.getElementById("holdSummary").innerHTML = "";
    renderAlerts([]);
    return;
  }

  body.innerHTML = rows.map((r) => (r.id === svState.editingId ? editRowHtml(r) : viewRowHtml(r))).join("");
  renderBookSummary(rows);
  renderAlerts(rows);
}

// Mức cảnh báo của một sổ theo số ngày còn lại.
function alertLevel(daysLeft) {
  if (daysLeft === null) return null;
  if (daysLeft < 0) return "past";
  if (daysLeft <= 7) return "d7";
  if (daysLeft <= 15) return "d15";
  if (daysLeft <= 30) return "d30";
  return null;
}

function viewRowHtml(r) {
  const lvl = alertLevel(r.daysLeft);
  const delLabel = r.id === svState.confirmDeleteId ? "Chắc chứ?" : "Xoá";
  const left =
    r.daysLeft === null
      ? ""
      : r.daysLeft < 0
      ? `<span class="sv-days past">đã đáo hạn</span>`
      : `<span class="sv-days${lvl ? " " + lvl : ""}">còn ${r.daysLeft} ngày</span>`;

  return `<tr data-hid="${r.id}"${lvl && lvl !== "past" ? ` class="row-${lvl}"` : ""}>
    <td>${escapeHtml(r.bank || "—")}</td>
    <td class="num"><span class="money">${fmtMoney(r.amount)}</span></td>
    <td class="num muted">${escapeHtml(termLabel(r.term))}</td>
    <td class="num">${fmtRate(r.rate)}</td>
    <td class="col-date muted">${escapeHtml(r.date || "—")}</td>
    <td class="col-date">${fmtDate(r.maturity)} ${left}</td>
    <td class="num">${r.interest === null ? "—" : `<span class="money">+${fmtMoney(r.interest)}</span>`}</td>
    <td class="act">
      <button type="button" class="row-btn" data-act="edit">Sửa</button>
      <button type="button" class="row-btn danger" data-act="del">${delLabel}</button>
    </td>
  </tr>`;
}

// Sửa tại chỗ: số tiền, lãi suất, ngày gửi. Đổi ngân hàng hay kỳ hạn thì xoá
// rồi thêm lại — đó là một sổ khác.
function editRowHtml(r) {
  return `<tr data-hid="${r.id}">
    <td>${escapeHtml(r.bank || "—")}</td>
    <td class="num"><input class="edit-input" inputmode="numeric" data-num="int" data-edit="amount" value="${fmtMoney(r.amount)}" /></td>
    <td class="num muted">${escapeHtml(termLabel(r.term))}</td>
    <td class="num"><input class="edit-input" inputmode="decimal" data-num="dec" data-edit="rate" value="${r.rate === null ? "" : NumInput.formatNumber(r.rate, "dec")}" placeholder="%/năm" /></td>
    <td class="col-date"><input class="edit-input" type="date" data-edit="date" value="${escapeHtml(r.date || "")}" /></td>
    <td class="col-date muted">—</td>
    <td class="num muted">—</td>
    <td class="act">
      <button type="button" class="row-btn save" data-act="save">Lưu</button>
      <button type="button" class="row-btn" data-act="cancel">Huỷ</button>
    </td>
  </tr>`;
}

function renderBookSummary(rows) {
  const total = rows.reduce((s, r) => s + r.amount, 0);
  const withInt = rows.filter((r) => r.interest !== null);
  const totalInt = withInt.reduce((s, r) => s + r.interest, 0);
  // Lãi quy năm: tổng lãi cả kỳ chia số tháng rồi nhân 12 — so được giữa các sổ
  // kỳ hạn khác nhau, khác hẳn "tổng lãi" vốn dài kỳ nào lớn kỳ đó.
  const yearly = withInt.reduce((s, r) => s + (r.months ? (r.interest / r.months) * 12 : 0), 0);

  document.getElementById("holdSummary").innerHTML =
    `<div class="stat"><span class="label">Tổng gốc</span><span class="val"><span class="money">${fmtMoney(total)} ₫</span></span></div>
     <div class="stat"><span class="label">Tổng lãi cả kỳ (${withInt.length}/${rows.length} sổ)</span><span class="val up"><span class="money">+${fmtMoney(totalInt)} ₫</span></span></div>
     <div class="stat"><span class="label">Lãi quy ra một năm</span><span class="val up"><span class="money">+${fmtMoney(yearly)} ₫</span></span></div>`;
}

// Cảnh báo đáo hạn (việc 4.6) — nằm trên cùng trang, không giấu trong bảng.
function renderAlerts(rows) {
  const host = document.getElementById("svAlerts");
  const soon = rows
    .filter((r) => r.daysLeft !== null && r.daysLeft <= ALERT_DAYS[0])
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const key = (r) => `${r.id}:${alertLevel(r.daysLeft)}`;
  const shown = soon.filter((r) => !svState.dismissed.has(key(r)));

  if (!shown.length) {
    host.hidden = true;
    host.innerHTML = "";
    return;
  }

  host.hidden = false;
  host.innerHTML =
    shown
      .map((r) => {
        const lvl = alertLevel(r.daysLeft);
        const when =
          r.daysLeft < 0
            ? `đã đáo hạn ${fmtDate(r.maturity)}`
            : r.daysLeft === 0
            ? `đáo hạn HÔM NAY`
            : `đáo hạn sau ${r.daysLeft} ngày (${fmtDate(r.maturity)})`;
        return `<div class="sv-alert ${lvl}" data-hid="${escapeHtml(key(r))}">
        <span class="sv-alert-text"><strong>${escapeHtml(r.bank || "Sổ tiết kiệm")}</strong> — ${escapeHtml(when)},
        gốc <span class="money">${fmtMoney(r.amount)} ₫</span>, lãi <span class="money">+${fmtMoney(r.interest || 0)} ₫</span></span>
        <button type="button" class="sv-alert-x" data-dismiss="${escapeHtml(key(r))}" title="Ẩn cảnh báo này (sẽ hiện lại ở mốc kế tiếp)" aria-label="Ẩn cảnh báo">✕</button>
      </div>`;
      })
      .join("") +
    (shown.length > 1
      ? `<button type="button" class="sv-alert-all" data-dismiss-all="1">Ẩn tất cả ${shown.length} cảnh báo</button>`
      : "");
}

// Ẩn một (hoặc tất cả) cảnh báo đáo hạn ở mức hiện tại.
async function dismissAlerts(keys, rowEls) {
  await Promise.all(rowEls.map((el) => Motion.leave(el)));
  keys.forEach((k) => svState.dismissed.add(k));
  // Chỉ giữ khoá của sổ còn tồn tại, để danh sách không phình mãi.
  const alive = new Set(svState.books.map((b) => String(b.id)));
  const keep = [...svState.dismissed].filter((k) => alive.has(k.split(":")[0]));
  svState.dismissed = new Set(keep);
  renderBooks();
  await Store.setSetting(ALERT_DISMISS_SETTING, keep);
}

function wireAlerts() {
  document.getElementById("svAlerts").addEventListener("click", (e) => {
    const one = e.target.closest("[data-dismiss]");
    if (one) return dismissAlerts([one.dataset.dismiss], [one.closest(".sv-alert")]);
    if (e.target.closest("[data-dismiss-all]")) {
      const els = [...document.querySelectorAll("#svAlerts .sv-alert")];
      return dismissAlerts(els.map((el) => el.dataset.hid), els);
    }
  });
}

function setHoldError(msg) {
  const el = document.getElementById("holdError");
  el.textContent = msg || "";
  el.hidden = !msg;
}

function wireBooks() {
  // Gợi ý lãi suất theo ngân hàng + kỳ hạn đang chọn — user vẫn sửa được, vì
  // lãi suất thật trên sổ có thể khác bảng niêm yết (ưu đãi, số tiền lớn…).
  const suggest = () => {
    const rateEl = document.getElementById("holdRate");
    if (rateEl.dataset.touched === "1") return;
    const bank = svState.banks.find((b) => b.name === document.getElementById("holdBank").value);
    const v = bank ? bank.rates[document.getElementById("holdTerm").value] : null;
    // VN format ("5,9"), not String(5.9): the field groups digits live and
    // would read a dot as a thousands separator once the user edits it.
    rateEl.value = hasVal(v) ? NumInput.formatNumber(Number(v), "dec") : "";
  };
  document.getElementById("holdBank").addEventListener("change", suggest);
  document.getElementById("holdTerm").addEventListener("change", suggest);
  document.getElementById("holdRate").addEventListener("input", (e) => {
    e.target.dataset.touched = e.target.value ? "1" : "";
  });

  document.getElementById("holdForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const bank = document.getElementById("holdBank").value.trim();
    const amountEl = document.getElementById("holdAmount");
    const rateEl = document.getElementById("holdRate");
    const amount = parseAmount(amountEl.value);
    const rate = parseAmount(rateEl.value);
    const date = document.getElementById("holdDate").value;

    if (!bank) return setHoldError("Nhập tên ngân hàng.");
    if (amount === null || amount <= 0) return setHoldError("Số tiền phải là số lớn hơn 0.");
    if (rate === null || rate <= 0) return setHoldError("Lãi suất phải là số lớn hơn 0.");
    if (!date) return setHoldError("Chọn ngày gửi.");

    setHoldError("");
    await Store.add(BOOKS_COLLECTION, {
      bank,
      amount,
      term: document.getElementById("holdTerm").value,
      rate, // %/năm ĐÃ CHỐT lúc gửi — không đọc lại từ bảng niêm yết
      date,
      updatedAt: new Date().toISOString(),
    });
    Motion.toast("Đã lưu sổ tiết kiệm");
    svState.books = await Store.list(BOOKS_COLLECTION);
    amountEl.value = "";
    rateEl.value = "";
    rateEl.dataset.touched = "";
    renderBooks();
  });

  document.getElementById("holdTableBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const tr = btn.closest("tr[data-hid]");
    const id = tr.dataset.hid;

    if (btn.dataset.act === "edit") {
      svState.editingId = id;
      svState.confirmDeleteId = null;
      renderBooks(); // dòng cũ đã bị thay, phải tìm lại dòng mới để focus
      document.querySelector(`tr[data-hid="${id}"] [data-edit="amount"]`)?.focus();
      return;
    }

    if (btn.dataset.act === "cancel") {
      svState.editingId = null;
      setHoldError("");
      renderBooks();
      return;
    }

    if (btn.dataset.act === "save") {
      const amount = parseAmount(tr.querySelector('[data-edit="amount"]').value);
      const rate = parseAmount(tr.querySelector('[data-edit="rate"]').value);
      const date = tr.querySelector('[data-edit="date"]').value;
      if (amount === null || amount <= 0) return setHoldError("Số tiền phải là số lớn hơn 0.");
      if (rate === null || rate <= 0) return setHoldError("Lãi suất phải là số lớn hơn 0.");
      if (!date) return setHoldError("Chọn ngày gửi.");

      setHoldError("");
      await Store.update(BOOKS_COLLECTION, id, { amount, rate, date, updatedAt: new Date().toISOString() });
      svState.books = await Store.list(BOOKS_COLLECTION);
      svState.editingId = null;
      renderBooks();
      return;
    }

    if (btn.dataset.act === "del") {
      // Hai nhịp thay vì confirm(): xoá không hoàn tác được và nút nằm ngay
      // cạnh nút Sửa.
      if (svState.confirmDeleteId !== id) {
        svState.confirmDeleteId = id;
        renderBooks();
        setTimeout(() => {
          if (svState.confirmDeleteId === id) {
            svState.confirmDeleteId = null;
            renderBooks();
          }
        }, 4000);
        return;
      }
      svState.confirmDeleteId = null;
      await Motion.leave(btn.closest("tr")); // slide the row out, then delete
      await Store.remove(BOOKS_COLLECTION, id);
      svState.books = await Store.list(BOOKS_COLLECTION);
      renderBooks();
    }
  });

  document.getElementById("holdTableBody").addEventListener("keydown", (e) => {
    if (!svState.editingId) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.closest("tr")?.querySelector('[data-act="save"]')?.click();
    } else if (e.key === "Escape") {
      e.target.closest("tr")?.querySelector('[data-act="cancel"]')?.click();
    }
  });
}
