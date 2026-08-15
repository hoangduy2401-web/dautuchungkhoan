// ============================================================
// MIGRATE — chuyển dữ liệu cũ lên Supabase (GĐ 5.5 của docs/QUYHOACH.md).
//
// BỐN RÀNG BUỘC, không cái nào là tuỳ chọn:
//
//   1. KHÔNG BAO GIỜ TỰ CHẠY. Người dùng phải bấm. Một lần ghi đè im lặng lúc
//      nạp trang là mất dữ liệu mà không ai kịp nhận ra.
//   2. XEM TRƯỚC ĐƯỢC. Bảng nói rõ mỗi nhóm có bao nhiêu dòng, và sẽ ĐÈ LÊN
//      bao nhiêu dòng đang có trên DB, trước khi ghi.
//   3. KHÔNG ĐỘNG VÀO localStorage. Nhập xong dữ liệu cũ vẫn nằm nguyên đó cho
//      tới khi người dùng tự xác nhận DB đúng trên cả máy tính lẫn điện thoại.
//   4. NGUỒN NHẬP CHỌN ĐƯỢC: localStorage của chính origin này, HOẶC một file
//      sao lưu .json. Cái thứ hai không phải để cho sang: `http://` và
//      `https://` là hai kho localStorage tách biệt, dữ liệu thật có thể nằm ở
//      origin mà trang đang mở không đọc được — 15/08/2026 đã gặp đúng cảnh đó.
//      Không có đường nhập từ file thì phần dữ liệu bên kia không cách nào lên.
// ============================================================

const Migrate = (function () {
  // Khoá lưu trữ -> tên collection của Store. Đúng bộ khoá mà `exportAll()`
  // xuất ra, nên file sao lưu nạp ngược lên được, không phải đổi định dạng.
  const MAP = [
    ["vn_dashboard_transactions_v1", "tx_stock", "Giao dịch chứng khoán"],
    ["vn_dashboard_watchlist_v1", "watchlist", "Danh sách theo dõi"],
    ["vn_gs_holdings_gold", "holdings_gold", "Danh mục vàng"],
    ["vn_gs_holdings_fx", "holdings_fx", "Danh mục ngoại tệ"],
    ["vn_gs_holdings_crypto", "holdings_crypto", "Danh mục coin"],
    ["vn_gs_savings_accounts", "savings_accounts", "Sổ tiết kiệm"],
    ["vn_gs_cash_flows", "cash_flows", "Dòng tiền"],
    ["vn_gs_settings", "settings", "Cài đặt"],
  ];

  let source = null; // { label, data: {key: chuỗi JSON} }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function parse(raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function sizeOf(v) {
    if (v === null) return null; // hỏng
    if (Array.isArray(v)) return v.length;
    if (v && typeof v === "object") return Object.keys(v).length;
    return 0;
  }

  // Đọc file sao lưu. Chấp nhận cả vỏ `{app, format, data}` của nút xuất JSON
  // lẫn `{exportedAt, data}` trần, vì hai dạng đó đều từng ra khỏi máy.
  function readBackup(text) {
    const obj = parse(text);
    if (!obj) throw new Error("File không phải JSON hợp lệ.");
    const data = obj.data || obj;
    if (!data || typeof data !== "object") throw new Error("File không có phần `data`.");
    const keys = Object.keys(data).filter((k) => MAP.some(([key]) => key === k));
    if (!keys.length) throw new Error("File không chứa nhóm dữ liệu nào của ứng dụng này.");
    return data;
  }

  // So nguồn với DB. Đây là bảng người dùng nhìn trước khi bấm — nó phải nói cả
  // phần MẤT ĐI, không chỉ phần thêm vào.
  async function plan() {
    if (!source) return [];
    const rows = [];
    for (const [key, collection, label] of MAP) {
      const raw = source.data[key];
      const parsed = raw === undefined ? null : parse(raw);
      const incoming = raw === undefined ? 0 : sizeOf(parsed);

      let current = 0;
      let readError = null;
      try {
        const cur = await SupabaseDriver.list(collection);
        current = sizeOf(cur);
      } catch (err) {
        readError = err.message;
      }

      rows.push({
        key, collection, label,
        incoming: raw !== undefined && parsed === null ? null : incoming,
        current, readError,
        // Nhóm không có trong nguồn thì BỎ QUA, không ghi đè bằng rỗng. Nguồn
        // thiếu một nhóm gần như luôn là "chưa từng nhập", chứ không phải
        // "hãy xoá nhóm đó trên DB".
        skip: raw === undefined,
      });
    }
    return rows;
  }

  async function run(rows) {
    const results = [];
    for (const r of rows) {
      if (r.skip) {
        results.push({ ...r, ok: true, note: "bỏ qua — nguồn không có nhóm này" });
        continue;
      }
      if (r.incoming === null) {
        results.push({ ...r, ok: false, note: "bỏ qua — dữ liệu nguồn hỏng, không đọc được" });
        continue;
      }
      try {
        const value = parse(source.data[r.key]);
        await SupabaseDriver.replace(r.collection, value);
        const after = sizeOf(await SupabaseDriver.list(r.collection));
        // Đếm lại từ DB chứ không tin con số đã gửi đi: ghi thành công mà đọc
        // lại ra số khác là dấu hiệu ràng buộc hoặc RLS đã lặng lẽ bỏ bớt hàng.
        results.push({
          ...r, ok: after === r.incoming, after,
          note: after === r.incoming ? `đã ghi ${after} dòng` : `ghi ${r.incoming}, đọc lại ${after}`,
        });
      } catch (err) {
        results.push({ ...r, ok: false, note: err.message });
      }
    }
    return results;
  }

  // ---- Giao diện ----------------------------------------------------------

  function planTable(rows) {
    const body = rows
      .map((r) => {
        const inTxt = r.skip ? "—" : r.incoming === null ? "hỏng" : r.incoming;
        const overwrite =
          r.skip ? "giữ nguyên"
          : r.current === 0 ? "—"
          : `<strong>đè lên ${r.current} dòng</strong>`;
        return (
          `<tr><td>${esc(r.label)}</td><td class="num">${inTxt}</td>` +
          `<td class="num">${r.readError ? "?" : r.current}</td><td>${overwrite}</td></tr>`
        );
      })
      .join("");
    return (
      `<table class="asset-table"><thead><tr><th>Nhóm</th><th class="num">Nguồn</th>` +
      `<th class="num">Trên DB</th><th>Sẽ xảy ra</th></tr></thead><tbody>${body}</tbody></table>`
    );
  }

  async function refresh() {
    const box = document.getElementById("migPlan");
    const go = document.getElementById("migGo");
    if (!box) return;
    if (!source) {
      box.innerHTML = `<p class="build-note">Chọn nguồn dữ liệu ở trên.</p>`;
      if (go) go.disabled = true;
      return;
    }
    box.innerHTML = `<p class="build-note">Đang đối chiếu với DB…</p>`;
    try {
      const rows = await plan();
      box.innerHTML =
        `<p class="build-note">Nguồn: <strong>${esc(source.label)}</strong></p>` + planTable(rows);
      box._rows = rows;
      if (go) go.disabled = false;
    } catch (err) {
      box.innerHTML = `<p class="build-note">Không đối chiếu được: ${esc(err.message)}</p>`;
      if (go) go.disabled = true;
    }
  }

  async function render() {
    const host = document.getElementById("migratePanel");
    if (!host) return;

    const s = typeof Auth !== "undefined" ? await Auth.session() : null;
    if (!s) {
      host.innerHTML =
        `<div class="panel"><div class="panel-head"><h2>Chuyển dữ liệu lên Supabase</h2></div>` +
        `<div class="panel-body"><p class="build-note">Đăng nhập trước đã — ` +
        `dữ liệu ghi lên tài khoản nào thì phải biết tài khoản đó là ai.</p></div></div>`;
      return;
    }

    host.innerHTML =
      `<div class="panel"><div class="panel-head"><h2>Chuyển dữ liệu lên Supabase</h2></div>` +
      `<div class="panel-body">` +
      `<p class="build-note">Ghi dữ liệu cũ lên tài khoản <strong>${esc(s.user.email)}</strong>. ` +
      `Không tự chạy, không xoá dữ liệu trong trình duyệt — bản cũ vẫn nằm nguyên đó ` +
      `cho tới khi bạn tự xác nhận DB đúng trên cả máy tính lẫn điện thoại.</p>` +
      `<div class="watchlist-add">` +
      `<button type="button" class="btn-outline" id="migLocal">Lấy từ trình duyệt này</button> ` +
      `<label class="btn-outline" style="cursor:pointer">Lấy từ file sao lưu .json` +
      `<input type="file" id="migFile" accept="application/json,.json" hidden /></label>` +
      `</div>` +
      `<div id="migPlan" style="margin-top:14px"></div>` +
      `<p class="build-note" style="margin-top:14px">` +
      `<button type="button" class="btn" id="migGo" disabled>Ghi lên Supabase</button></p>` +
      `<div id="migOut"></div>` +
      `</div></div>`;

    document.getElementById("migLocal").addEventListener("click", () => {
      // exportLocal, KHÔNG phải exportAll: khi driver đã là Supabase thì
      // exportAll trả về chính DB đang định ghi vào — nguồn và đích là một.
      source = { label: "localStorage của " + location.origin, data: Store.exportLocal().data };
      refresh();
    });

    document.getElementById("migFile").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        source = { label: file.name, data: readBackup(await file.text()) };
        refresh();
      } catch (err) {
        source = null;
        document.getElementById("migPlan").innerHTML =
          `<p class="build-note">Không đọc được file: ${esc(err.message)}</p>`;
      }
    });

    document.getElementById("migGo").addEventListener("click", async (e) => {
      const box = document.getElementById("migPlan");
      const out = document.getElementById("migOut");
      const rows = box && box._rows;
      if (!rows) return;

      const willOverwrite = rows.filter((r) => !r.skip && r.current > 0);
      if (willOverwrite.length) {
        const names = willOverwrite.map((r) => `${r.label} (${r.current} dòng)`).join(", ");
        if (!confirm(`Ghi đè dữ liệu đang có trên DB: ${names}.\n\nTiếp tục?`)) return;
      }

      e.target.disabled = true;
      out.innerHTML = `<p class="build-note">Đang ghi…</p>`;
      const results = await run(rows);
      const body = results
        .map(
          (r) =>
            `<tr><td>${r.ok ? "✅" : "❌"}</td><td>${esc(r.label)}</td><td>${esc(r.note)}</td></tr>`
        )
        .join("");
      const bad = results.filter((r) => !r.ok).length;
      out.innerHTML =
        `<table class="asset-table" style="margin-top:12px"><tbody>${body}</tbody></table>` +
        `<p class="build-note">${
          bad
            ? `<strong>${bad} nhóm chưa xong.</strong> Đừng bật STORE_ENABLED khi còn dòng đỏ.`
            : `Xong. Đối chiếu lại trên điện thoại rồi mới bật STORE_ENABLED.`
        }</p>`;
      e.target.disabled = false;
      refresh();
    });

    refresh();
  }

  return { render, plan, run, readBackup };
})();

if (typeof module !== "undefined") module.exports = Migrate;
