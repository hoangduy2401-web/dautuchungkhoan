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
      const ghiChu = [c.source ? `nguồn: ${c.source}` : "", c.note || ""]
        .filter(Boolean)
        .join(" · ");
      return (
        `<tr><td>${esc(c.label)}<div class="nw-note">${esc(ghiChu)}</div></td>` +
        `<td class="num">${c.count}</td>` +
        `<td class="num"><span class="money">${fmtVnd(c.value)}</span></td>` +
        `<td class="num">${tyTrong === null ? "—" : fmtPct(tyTrong).replace("+", "")}</td>` +
        `<td class="num ${plClass(c.pl)}">` +
        `<span class="money">${c.pl === null ? "—" : fmtVnd(c.pl)}</span>` +
        `<div class="nw-note">${fmtPct(c.plPct)}</div></td></tr>`
      );
    })
    .join("");

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

  loadNetWorth();
  const btn = document.getElementById("nwReload");
  if (btn) btn.addEventListener("click", loadNetWorth);
});
