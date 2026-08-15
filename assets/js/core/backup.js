// ============================================================
// BACKUP — xuất toàn bộ dữ liệu người dùng ra một file JSON.
//
// Đây là việc 5.6 của GĐ 5 và nó được làm TRƯỚC 5.4/5.5 một cách có chủ ý:
// giai đoạn Supabase là lúc dữ liệu tài sản thật có thể mất, nên lối thoát
// phải tồn tại trước khi có bất kỳ đường ghi nào lên DB.
//
// Đọc qua `Store.exportAll()` chứ không đọc thẳng localStorage: khi driver
// đổi sang Supabase ở 5.4, nút này vẫn xuất đúng dữ liệu mà không phải sửa.
//
// Cách dùng: đặt <div id="backupPanel"></div> trong trang rồi nạp file này.
// ============================================================

const Backup = (function () {
  // Nhãn tiếng Việt cho từng khoá lưu trữ. Khoá nào không có ở đây vẫn được
  // xuất ra file — bảng xem trước chỉ là phần hiển thị, không phải bộ lọc.
  const LABELS = {
    vn_dashboard_transactions_v1: "Giao dịch chứng khoán",
    vn_dashboard_watchlist_v1: "Danh sách theo dõi",
    vn_gs_holdings_fx: "Danh mục ngoại tệ",
    vn_gs_holdings_gold: "Danh mục vàng",
    vn_gs_holdings_crypto: "Danh mục coin",
    vn_gs_savings_accounts: "Sổ tiết kiệm",
    vn_gs_settings: "Cài đặt",
  };

  // Đếm "có bao nhiêu mục" cho bảng xem trước. Mảng thì đếm phần tử, object
  // (settings) thì đếm số khoá. Hỏng JSON thì trả null để bảng ghi "?" thay vì
  // im lặng hiện 0 — 0 và "không đọc được" là hai chuyện hoàn toàn khác nhau.
  function countOf(raw) {
    try {
      const v = JSON.parse(raw);
      if (Array.isArray(v)) return v.length;
      if (v && typeof v === "object") return Object.keys(v).length;
      return 1;
    } catch {
      return null;
    }
  }

  function stamp(d) {
    const p = (n) => String(n).padStart(2, "0");
    return (
      `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
      `-${p(d.getHours())}${p(d.getMinutes())}`
    );
  }

  async function download() {
    const dump = await Store.exportAll();

    // Bọc thêm lớp vỏ có phiên bản: bản khôi phục ở 5.5 phải biết chắc file
    // đang cầm là định dạng nào, không đoán theo hình dạng dữ liệu.
    const payload = {
      app: "dautuchungkhoan",
      format: 1,
      driver: Store.driver,
      exportedAt: dump.exportedAt,
      data: dump.data,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dautuchungkhoan-saoluu-${stamp(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Thu hồi muộn: Safari huỷ tải dở nếu URL bị revoke ngay sau click.
    setTimeout(() => URL.revokeObjectURL(url), 60000);

    return payload;
  }

  // Bảng "trong file có gì" — hiện TRƯỚC khi bấm tải. Một nút tải trần không
  // cho user biết bản sao lưu có rỗng hay không, mà bản sao lưu rỗng thì tệ
  // hơn không có bản nào: nó tạo cảm giác an toàn sai.
  async function renderPreview(host) {
    const dump = await Store.exportAll();
    const keys = Object.keys(dump.data);

    if (!keys.length) {
      host.innerHTML =
        `<p class="build-note">Chưa có dữ liệu nào để sao lưu. ` +
        `Thêm một dòng ở trang Vàng, Ngoại tệ, Coin hoặc Tiết kiệm rồi quay lại.</p>`;
      return 0;
    }

    let total = 0;
    const rows = keys
      .sort()
      .map((k) => {
        const n = countOf(dump.data[k]);
        if (typeof n === "number") total += n;
        const kb = (dump.data[k].length / 1024).toFixed(1);
        return (
          `<tr><td>${LABELS[k] || k}</td>` +
          `<td class="num">${n === null ? "?" : n}</td>` +
          `<td class="num">${kb} KB</td></tr>`
        );
      })
      .join("");

    host.innerHTML =
      `<table class="asset-table"><thead><tr>` +
      `<th>Nhóm dữ liệu</th><th class="num">Số mục</th><th class="num">Dung lượng</th>` +
      `</tr></thead><tbody>${rows}</tbody></table>`;

    return total;
  }

  function render() {
    const host = document.getElementById("backupPanel");
    if (!host) return;

    host.innerHTML =
      `<div class="panel">` +
      `<div class="panel-head"><h2>Sao lưu dữ liệu</h2>` +
      `<button type="button" class="btn" id="backupBtn">Tải bản sao lưu (.json)</button></div>` +
      `<div class="panel-body">` +
      `<p class="build-note" id="backupWhere"></p>` +
      `<div id="backupPreview"></div>` +
      `<p class="build-note" id="backupMsg" style="margin-top:14px"></p>` +
      `</div></div>`;

    const preview = document.getElementById("backupPreview");
    const msg = document.getElementById("backupMsg");
    const btn = document.getElementById("backupBtn");

    // Câu mở đầu đổi theo driver đang chạy. Để nguyên câu "nằm trong trình
    // duyệt này" sau khi đã chuyển sang DB là nói sai với user về chỗ dữ liệu
    // thật đang nằm — và đó là câu họ dựa vào để quyết có cần sao lưu hay không.
    Store.ready.then(() => {
      const where = document.getElementById("backupWhere");
      if (!where) return;
      where.innerHTML =
        Store.driver === "supabase"
          ? `Dữ liệu đang lưu trên <strong>Supabase</strong> và đọc được từ mọi thiết bị. ` +
            `Bản sao lưu này là lối thoát khi muốn rời Supabase — tải định kỳ và giữ lại.`
          : `Toàn bộ danh mục đang nằm trong bộ nhớ của <strong>trình duyệt này</strong>. ` +
            `Xoá cache, đổi máy hay dùng cửa sổ ẩn danh là mất. Tải một bản về máy ` +
            `trước khi chuyển dữ liệu lên Supabase — và giữ lại bản đó.`;
    });

    renderPreview(preview).catch((err) => {
      preview.innerHTML = `<p class="build-note">Không đọc được dữ liệu: ${err.message}</p>`;
    });

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      try {
        const p = await download();
        const n = Object.keys(p.data).length;
        msg.textContent = `Đã tải bản sao lưu ${n} nhóm dữ liệu. Kiểm tra thư mục Downloads.`;
      } catch (err) {
        msg.textContent = `Xuất thất bại: ${err.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  }

  return { render, download, renderPreview };
})();

if (typeof module !== "undefined") module.exports = Backup;
