// ============================================================
// TỔNG GIA SẢN — GĐ 6.1 · 6.2 · 6.5.
//
// Phép cộng nằm ở `core/networth.js`. File này chỉ lo vẽ, và việc vẽ có đúng
// một ưu tiên: **kênh không tính được phải nổi hơn con số tổng**. Một trang
// tổng cộng thiếu một kênh mà không báo gì sẽ đưa ra con số tài sản sai — mà
// đây là con số user dùng để ra quyết định (QUYHOACH 6.5).
//
// Vì vậy dải cảnh báo đặt TRÊN con số tổng, không phải dưới, và không thu gọn
// được. Cùng lý do với dải cảnh báo đáo hạn ở trang Tiết kiệm.
// ============================================================

const fmtVnd = (n) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : Math.round(n).toLocaleString("vi-VN") + " ₫";

const fmtPct = (n) =>
  n === null || n === undefined || Number.isNaN(n)
    ? "—"
    : (n >= 0 ? "+" : "") + n.toLocaleString("vi-VN", { maximumFractionDigits: 2 }) + "%";

const plClass = (n) => (n === null ? "flat" : n > 0 ? "up" : n < 0 ? "down" : "flat");

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
  );
}

// Dải cảnh báo 6.5. Hai mức, khác nhau về bản chất chứ không phải mức độ:
//   ĐỎ  — kênh KHÔNG được cộng vào tổng. Con số dưới đây thiếu hẳn một mảng.
//   CAM — kênh có cộng nhưng thiếu vài dòng. Con số gần đúng, không phải sai hẳn.
function renderAlerts(res) {
  const host = document.getElementById("nwAlerts");
  if (!host) return;

  const parts = [];

  if (res.missing.length) {
    const ten = res.missing.map((m) => `<strong>${esc(m.label)}</strong>`).join(", ");
    const chiTiet = res.missing
      .filter((m) => m.reason)
      .map((m) => `${esc(m.label)}: ${esc(m.reason)}`)
      .join(" · ");
    parts.push(
      `<div class="nw-alert nw-alert-error">` +
        `Chưa tính được kênh ${ten} — <strong>số tổng bên dưới đang THIẾU kênh này</strong>, ` +
        `không phải là toàn bộ tài sản.` +
        (chiTiet ? `<br><span class="nw-alert-detail">${chiTiet}</span>` : "") +
        `</div>`
    );
  }

  if (res.partial.length) {
    const chiTiet = res.partial
      .map((p) => `<strong>${esc(p.label)}</strong>: ${esc(p.detail)}`)
      .join("<br>");
    parts.push(
      `<div class="nw-alert nw-alert-warn">Tính thiếu một phần:<br>${chiTiet}</div>`
    );
  }

  host.innerHTML = parts.join("");
}

function renderTotals(res) {
  const host = document.getElementById("nwTotals");
  if (!host) return;
  const t = res.total;
  const dayDu = !res.missing.length && !res.partial.length;

  host.innerHTML =
    `<div class="nw-total">` +
    `<div class="label">${dayDu ? "Tổng tài sản ròng" : "Tổng tài sản ròng (chưa đủ)"}</div>` +
    `<div class="val"><span class="money">${fmtVnd(t.value)}</span></div>` +
    `</div>` +
    `<div class="nw-total">` +
    `<div class="label">Lãi/lỗ so với giá vốn</div>` +
    `<div class="val ${plClass(t.pl)}">` +
    `<span class="money">${t.pl === null ? "—" : fmtVnd(t.pl)}</span>` +
    `<small> ${fmtPct(t.plPct)}</small></div>` +
    `</div>`;
}

// Phân bổ tài sản (GĐ 6.3 + 6.7).
//
// KHÔNG phải biểu đồ tròn dù quy hoạch ghi vậy — **thanh xếp chồng ngang** đọc
// dễ hơn cho việc này: 5 kênh, tên tiếng Việt dài, và so sánh tỷ trọng trên một
// trục thẳng chính xác hơn nhiều so với so sánh góc quạt. Muốn quay lại hình
// tròn thì đổi ở đây, phần tính toán không đụng gì.
//
// Màu gán CỐ ĐỊNH theo kênh, không theo thứ hạng: giá biến động thì bảng màu
// vẫn đứng yên. Đã chạy validator cho cả nền sáng lẫn nền tối (xem base.css).
//
// 6.7: số tiền tuyệt đối bọc trong `.money` nên tự biến mất khi bật chế độ
// riêng tư; phần trăm và chính thanh màu vẫn hiện — đúng mục 3.5, vì tỷ trọng
// không tiết lộ quy mô tài sản.
function renderAllocation(res) {
  const host = document.getElementById("nwAlloc");
  if (!host) return;

  const tong = res.total.value || 0;
  const phan = res.channels.filter((c) => c.ok && c.value > 0);

  if (!tong || !phan.length) {
    host.innerHTML = "";
    return;
  }

  const bar = phan
    .map((c) => {
      const pct = (c.value / tong) * 100;
      return `<span style="width:${pct.toFixed(2)}%;background:var(--series-${c.key})" title="${esc(c.label)} ${pct.toFixed(1)}%"></span>`;
    })
    .join("");

  const legend = phan
    .map((c) => {
      const pct = (c.value / tong) * 100;
      return (
        `<li><i style="background:var(--series-${c.key})"></i>` +
        `${esc(c.label)} <b>${pct.toLocaleString("vi-VN", { maximumFractionDigits: 1 })}%</b>` +
        `<span class="money">${fmtVnd(c.value)}</span></li>`
      );
    })
    .join("");

  host.innerHTML =
    `<div class="nw-alloc"><div class="nw-alloc-bar">${bar}</div>` +
    `<ul class="nw-alloc-legend">${legend}</ul></div>`;
}

// Nhãn nguồn + giả định định giá của cả 5 kênh, gom một chỗ ở cuối trang.
//
// Mục 1.5 bắt buộc mọi con số phải nói rõ đến từ đâu — nhưng KHÔNG bắt buộc nó
// phải nằm sát con số. Đặt dưới từng tên kênh thì cột đầu phình ra và đẩy cột
// Lãi/lỗ khỏi khung nhìn (đã dính 16/08). Gom xuống đây: bảng đọc thoáng, nhãn
// vẫn còn nguyên. **Đừng bỏ khối này đi cho gọn.**
function renderSources(res) {
  const host = document.getElementById("nwSources");
  if (!host) return;

  const rows = res.channels
    .filter((c) => c.source || c.note)
    .map(
      (c) =>
        `<li><strong>${esc(c.label)}</strong>` +
        (c.source ? ` — nguồn: ${esc(c.source)}` : "") +
        (c.note ? `<br><span class="nw-src-note">${esc(c.note)}</span>` : "") +
        `</li>`
    )
    .join("");

  host.innerHTML = rows
    ? `<details class="nw-sources"><summary>Nguồn dữ liệu &amp; cách định giá từng kênh</summary>` +
      `<ul>${rows}</ul></details>`
    : "";
}

function renderChannels(res) {
  const body = document.getElementById("nwTableBody");
  if (!body) return;

  const tong = res.total.value || 0;

  body.innerHTML = res.channels
    .map((c) => {
      if (!c.ok) {
        return (
          `<tr class="nw-row-bad"><td>${esc(c.label)}</td>` +
          `<td colspan="4">Chưa tính được${c.error ? ` — ${esc(c.error)}` : ""}</td></tr>`
        );
      }
      if (!c.count) {
        return (
          `<tr class="nw-row-empty"><td>${esc(c.label)}</td>` +
          `<td colspan="4" class="muted">Chưa có dữ liệu</td></tr>`
        );
      }
      const tyTrong = tong ? (c.value / tong) * 100 : null;
      // Nhãn nguồn + giả định định giá KHÔNG nằm ở đây nữa mà gom xuống cuối
      // trang (`renderSources`). Chúng dài, và đặt dưới từng tên kênh thì đẩy
      // cột Lãi/lỗ khỏi khung nhìn. Nhãn nguồn vẫn BẮT BUỘC có mặt (mục 1.5),
      // chỉ đổi chỗ — đừng bỏ hẳn cho gọn.
      return (
        `<tr><td>${esc(c.label)}</td>` +
        `<td class="num">${c.count}</td>` +
        `<td class="num"><span class="money">${fmtVnd(c.value)}</span></td>` +
        `<td class="num">${tyTrong === null ? "—" : fmtPct(tyTrong).replace("+", "")}</td>` +
        `<td class="num ${plClass(c.pl)}">` +
        `<span class="money">${c.pl === null ? "—" : fmtVnd(c.pl)}</span>` +
        `<div class="nw-note">${fmtPct(c.plPct)}</div></td></tr>`
      );
    })
    .join("");

  renderSources(res);

  // Lãi tiết kiệm đứng riêng, KHÔNG nằm trong tổng — xem chú thích ở networth.js.
  const sav = res.channels.find((c) => c.key === "savings");
  const foot = document.getElementById("nwFoot");
  if (foot) {
    foot.innerHTML =
      sav && sav.duKienLai
        ? `<p class="build-note">Lãi tiết kiệm dự kiến khi giữ hết kỳ hạn: ` +
          `<span class="money">${fmtVnd(sav.duKienLai)}</span> — ` +
          `<strong>chưa cộng vào tổng</strong>, vì rút trước hạn thì gần như mất phần này.</p>`
        : "";
  }
}

// ---- Khoá chế độ riêng tư bằng mã 6 số ------------------------------------
//
// Phần logic (băm, hỏi mã, chặn chiều hiện số) nằm ở `nav.js` vì nút con mắt có
// mặt trên cả 6 trang. Đây chỉ là chỗ đặt/đổi/gỡ mã.
//
// Nói thẳng mức bảo vệ ngay trên giao diện: đây là trang tĩnh, người biết mở
// DevTools gỡ được lớp này. Nó chặn người đứng cạnh nhìn màn hình, không chặn
// được kẻ có kỹ thuật. Viết ra để không ai nhầm nó là lớp bảo vệ dữ liệu.
async function renderPinPanel() {
  const host = document.getElementById("pinPanel");
  if (!host) return;

  const daDatMa = !!(await Nav.getPinHash());

  host.innerHTML =
    `<div class="panel"><div class="panel-head"><h2>Khoá chế độ riêng tư</h2></div>` +
    `<div class="panel-body">` +
    `<p class="build-note">` +
    (daDatMa
      ? `Đang bật. Bấm nút con mắt để <strong>hiện</strong> lại số tiền sẽ phải nhập mã 6 số. ` +
        `Bấm để <strong>che</strong> thì không hỏi gì — che luôn được phép.`
      : `Chưa đặt mã. Nút con mắt hiện che/hiện tự do. Đặt mã 6 số để người khác ` +
        `cầm máy không bỏ che được.`) +
    `</p>` +
    `<p class="build-note nw-src-note">Mức bảo vệ: lớp này chặn <strong>người đứng cạnh</strong>, ` +
    `không chặn được người biết mở công cụ lập trình của trình duyệt. Lớp chặn thật ` +
    `cho dữ liệu vẫn là đăng nhập + phân quyền trên Supabase.</p>` +
    `<div class="watchlist-add">` +
    (daDatMa
      ? `<button type="button" class="btn-outline" id="pinChange">Đổi mã</button> ` +
        `<button type="button" class="btn-outline" id="pinClear">Gỡ mã</button>`
      : `<input type="password" id="pinNew" class="edit-input" inputmode="numeric" ` +
        `maxlength="6" placeholder="6 chữ số" autocomplete="off" />` +
        `<input type="password" id="pinNew2" class="edit-input" inputmode="numeric" ` +
        `maxlength="6" placeholder="nhập lại" autocomplete="off" />` +
        `<button type="button" id="pinSave">Đặt mã</button>`) +
    `</div>` +
    `<p class="build-note" id="pinMsg"></p>` +
    `</div></div>`;

  const msg = document.getElementById("pinMsg");

  if (!daDatMa) {
    document.getElementById("pinSave").addEventListener("click", async () => {
      const a = document.getElementById("pinNew").value.trim();
      const b = document.getElementById("pinNew2").value.trim();
      if (!/^\d{6}$/.test(a)) return (msg.textContent = "Mã phải gồm đúng 6 chữ số.");
      if (a !== b) return (msg.textContent = "Hai lần nhập không khớp.");
      await Nav.setPin(a);
      await renderPinPanel();
      document.getElementById("pinMsg").textContent =
        "Đã đặt mã. Từ giờ muốn hiện lại số tiền phải nhập mã này.";
    });
    return;
  }

  // Đổi và gỡ đều phải qua mã hiện tại. Không có thì ai cầm máy cũng gỡ được,
  // và lớp khoá thành trang trí.
  document.getElementById("pinChange").addEventListener("click", async () => {
    if (!(await Nav.askPin())) return;
    await Nav.setPin(null);
    await renderPinPanel();
    document.getElementById("pinMsg").textContent = "Mã cũ đã gỡ. Đặt mã mới ở ô trên.";
  });

  document.getElementById("pinClear").addEventListener("click", async () => {
    if (!(await Nav.askPin())) return;
    await Nav.setPin(null);
    await renderPinPanel();
    document.getElementById("pinMsg").textContent =
      "Đã gỡ mã. Nút con mắt che/hiện tự do trở lại.";
  });
}

async function loadNetWorth() {
  const host = document.getElementById("nwPanel");
  if (!host) return;
  const status = document.getElementById("nwStatus");
  if (status) status.textContent = "Đang tính…";

  try {
    const res = await NetWorth.compute();
    renderAlerts(res);
    renderTotals(res);
    renderAllocation(res);
    renderChannels(res);
    if (status) {
      status.textContent = `Cập nhật ${new Date(res.at).toLocaleTimeString("vi-VN")}`;
    }
  } catch (err) {
    if (status) status.textContent = "";
    const alerts = document.getElementById("nwAlerts");
    if (alerts) {
      alerts.innerHTML =
        `<div class="nw-alert nw-alert-error">Không tính được tổng tài sản: ` +
        `${esc(err.message)}. Không có con số nào hiện ra còn hơn hiện một con số sai.</div>`;
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  initChrome(); // theme toggle + glass slider + clock
  Auth.render(); // đăng nhập magic link (GĐ 5.3)
  Backup.render(); // nút xuất JSON (GĐ 5.6)
  Migrate.render(); // màn hình nhập dữ liệu cũ (GĐ 5.5)
  renderPinPanel(); // khoá mã 6 số cho nút con mắt

  loadNetWorth();
  const btn = document.getElementById("nwReload");
  if (btn) btn.addEventListener("click", loadNetWorth);
});
