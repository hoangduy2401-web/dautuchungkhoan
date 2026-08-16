// ============================================================
// NET WORTH — gom định giá 5 kênh về VND (GĐ 6.1 · 6.2 · 6.5).
//
// MỤC 6.5 LÀ LINH HỒN CỦA FILE NÀY, không phải phép cộng. Một trang tổng cộng
// thiếu một kênh mà không báo gì sẽ đưa ra con số tài sản SAI — và đây là con
// số user dùng để ra quyết định. Nên mọi hàm ở đây tuân thủ ba luật:
//
//   1. Mỗi kênh định giá ĐỘC LẬP. Một kênh chết không được kéo bốn kênh kia
//      chết theo (`Promise.allSettled`, không phải `Promise.all`).
//   2. Kênh nào không định giá được thì `ok: false` và KHÔNG cộng vào tổng.
//      Trang phải nói ra tên kênh đó. Cộng 4/5 kênh rồi gọi đó là "tổng tài
//      sản" là nói dối.
//   3. Kênh cộng được nhưng THIẾU MỘT PHẦN (vài mã không có giá) thì vẫn cộng,
//      nhưng khai báo trong `partial`. Đây là loại sai nguy hiểm nhất vì con số
//      vẫn hiện ra bình thường.
//
// Cạm bẫy đã biết, đừng lặp lại: `Portfolio.computeHoldings()` LẤY GIÁ VỐN LÀM
// GIÁ HIỆN TẠI khi thiếu quote (portfolio.js) — lãi/lỗ thành 0 và tổng trông
// vẫn đẹp. Ở đây KHÔNG dùng đường đó: mã nào không có quote thì đếm riêng và
// khai báo, chứ không lặng lẽ định giá bằng giá vốn.
//
// ĐƠN VỊ — chỗ dễ sai nhất, mỗi nguồn một kiểu. Quy hết về VND ngay tại nguồn:
//   cổ phiếu  giá nghìn ₫/cp        -> qty × giá × 1000
//   vàng      giá nghìn ₫/chỉ       -> số chỉ × giá × 1000
//   ngoại tệ  tỷ giá ₫/1 đơn vị     -> số lượng × tỷ giá
//   coin      giá ₫/1 coin          -> số lượng × giá
//   tiết kiệm gốc đã là ₫           -> giữ nguyên
// ============================================================

const NetWorth = (function () {
  // Vàng: quy mọi đơn vị về CHỈ. Trùng bảng trong `vang.js` — chấp nhận lặp một
  // hằng số nhỏ còn hơn nhập hai file vào nhau chỉ vì ba con số.
  const GOLD_UNIT_TO_CHI = { luong: 10, chi: 1, gram: 1 / 3.75 };

  const num = (v) => (v === null || v === undefined || v === "" ? null : Number(v));
  const has = (v) => v !== null && v !== undefined && v !== "" && !Number.isNaN(Number(v));

  // Khung trả về của MỌI kênh. Giữ nguyên hình dạng kể cả khi hỏng, để trang
  // chỉ phải viết một đường vẽ chứ không phải hai.
  function shell(key, label) {
    return {
      key, label,
      ok: false,        // có cộng vào tổng được không
      value: null,      // giá trị thị trường, VND
      cost: null,       // giá vốn, VND — null = không đủ dữ liệu để tính lãi/lỗ
      pl: null,
      plPct: null,
      count: 0,         // số dòng nắm giữ
      partial: null,    // cộng được nhưng thiếu một phần — PHẢI hiện ra
      error: null,      // không cộng được — PHẢI hiện ra
      source: null,     // nguồn giá, để dán nhãn (mục 1.5)
      note: null,       // giả định của cách tính, nếu có
    };
  }

  // Gom giá trị + giá vốn của một danh sách dòng đã định giá.
  // `rows` là [{ value, cost }] với value/cost đã quy về VND, cho phép null.
  function sum(out, rows) {
    let value = 0;
    let cost = 0;
    let coCost = false;
    let thieuGia = 0;

    for (const r of rows) {
      if (r.value === null) {
        thieuGia++;
        continue;
      }
      value += r.value;
      if (r.cost !== null) {
        cost += r.cost;
        coCost = true;
      }
    }

    out.count = rows.length;
    out.value = value;
    // Giá vốn chỉ có nghĩa khi ÍT NHẤT một dòng khai giá vốn. Không dòng nào
    // khai mà vẫn trả cost = 0 thì lãi/lỗ hiện thành +100%, sai trắng trợn.
    out.cost = coCost ? cost : null;
    out.pl = out.cost === null ? null : value - cost;
    out.plPct = out.cost ? (out.pl / out.cost) * 100 : null;
    out.ok = true;

    if (thieuGia) {
      out.partial =
        `${thieuGia}/${rows.length} dòng không có giá thị trường nên chưa được tính vào tổng`;
    }
    return out;
  }

  // ---- Cổ phiếu ------------------------------------------------------------
  //
  // HAI nguồn cho cùng một tài sản, không được cộng cả hai (đếm trùng — cùng
  // bẫy với GĐ 7 Binance):
  //   • Danh mục THẬT SSI  — /api/account/portfolio, cần khóa dashboard đã lưu.
  //     Chính xác nhất: giá real-time, đủ vị thế, có cả tiền mặt trong tài khoản.
  //   • Danh mục TAY       — tx_stock, user tự nhập giao dịch.
  //
  // User chốt (16/08): ưu tiên SSI thật. Có khóa thì DÙNG SSI; nếu SSI lỗi thì
  // báo ra, KHÔNG lặng lẽ tụt về danh mục tay (con số tay có thể cũ hoặc rỗng,
  // và lặng lẽ đổi nguồn là đúng loại sai mà mục 6.5 cấm). Chỉ khi CHƯA từng có
  // khóa mới coi danh mục tay là nguồn.
  const API_KEY_STORAGE = "vn_dashboard_api_key_v1";

  async function stock() {
    const out = shell("stock", "Chứng khoán");

    const apiKey = (() => {
      try { return localStorage.getItem(API_KEY_STORAGE); } catch { return null; }
    })();

    if (apiKey) return stockFromSSI(out, apiKey);
    return stockFromManual(out);
  }

  // Danh mục THẬT từ tài khoản SSI. Mọi số backend trả về đơn vị TRIỆU ĐỒNG
  // (xem server/index.js /api/account/portfolio) — quy về VND bằng ×1e6.
  async function stockFromSSI(out, apiKey) {
    out.source = "SSI FCTrading (tài khoản thật)";
    let data;
    try {
      data = await DataService.getAccountPortfolio(apiKey);
    } catch (err) {
      // 428 = phiên PIN/OTP hết hạn. TUYỆT ĐỐI không bung prompt PIN ở trang
      // tổng — người dùng ra trang Chứng khoán bấm Đồng bộ để nhập mã. Ở đây
      // chỉ báo, và để kênh này `ok:false` nên nó không lẫn vào tổng.
      out.error =
        err.status === 428
          ? "Phiên tài khoản SSI hết hạn — ra trang Chứng khoán bấm Đồng bộ để nhập lại PIN/OTP"
          : err.status === 401
          ? "Khóa truy cập sai — đồng bộ lại ở trang Chứng khoán"
          : `Không lấy được tài khoản SSI: ${err.message}`;
      return out;
    }

    const positions = (data && data.positions) || [];
    const cash = (data && data.cash) || {};
    out.note =
      "tài khoản thật SSI, gồm cả tiền mặt trong tài khoản; giá real-time trong phiên";

    // Giá trị kênh = TỔNG TÀI SẢN tài khoản (cổ phiếu + tiền mặt) — đúng con số
    // user thấy khi mở app SSI. Lãi/lỗ chỉ tính trên phần cổ phiếu (tiền mặt
    // không sinh lãi/lỗ), nên giá vốn = tổng tài sản − lãi/lỗ cổ phiếu.
    const value = has(cash.totalAssets) ? Number(cash.totalAssets) * 1e6 : null;
    const pl = positions.reduce(
      (a, p) => a + (has(p.unrealizedPL) ? Number(p.unrealizedPL) * 1e6 : 0),
      0
    );

    if (value === null) {
      // Đăng nhập được nhưng backend không trả tổng tài sản — không bịa.
      out.error = "Tài khoản SSI không trả tổng tài sản";
      return out;
    }

    out.ok = true;
    out.count = positions.length;
    out.value = value;
    out.cost = value - pl;
    out.pl = pl;
    out.plPct = out.cost ? (pl / out.cost) * 100 : null;
    return out;
  }

  // Danh mục TAY — chỉ dùng khi CHƯA từng nhập khóa SSI. Hỏi giá từng mã;
  // KHÔNG dùng `marketValue` của computeHoldings vì nó rơi về giá vốn khi thiếu
  // quote (lặng lẽ tính sai).
  async function stockFromManual(out) {
    out.source = "danh mục tay";
    await Portfolio.load();
    const holds = Portfolio.computeHoldings({}).filter((h) => h.qty > 0);
    if (!holds.length) return sum(out, []);

    out.note = "giao dịch tự nhập; chưa kết nối tài khoản SSI thật";
    const quotes = await Promise.all(
      holds.map((h) =>
        DataService.getQuote(h.symbol)
          .then((q) => (q && has(q.price) ? Number(q.price) : null))
          .catch(() => null)
      )
    );

    const rows = holds.map((h, i) => {
      const gia = quotes[i]; // nghìn ₫/cp
      return {
        value: gia === null ? null : h.qty * gia * 1000,
        cost: h.avgCost ? h.qty * h.avgCost * 1000 : null,
      };
    });
    return sum(out, rows);
  }

  // ---- Vàng ----------------------------------------------------------------
  async function gold() {
    const out = shell("gold", "Vàng");
    const holds = await Store.list("holdings_gold");
    if (!holds.length) return sum(out, []);

    const data = await DataService.getGoldPrices();
    out.source = (data.items && data.items[0] && data.items[0].source) || data.source || "PNJ";
    out.note = "định giá theo giá tiệm MUA VÀO — đây là số nhận được nếu bán ngay";

    const byCode = {};
    for (const it of data.items || []) byCode[it.code] = it;

    const rows = holds.map((h) => {
      const it = byCode[h.code];
      const chi = (num(h.qty) || 0) * (GOLD_UNIT_TO_CHI[h.unit] || 1);
      const buy = it && has(it.buy) ? Number(it.buy) : null; // nghìn ₫/chỉ
      const cost = has(h.cost) ? Number(h.cost) : null; // triệu ₫/lượng
      return {
        value: buy === null ? null : chi * buy * 1000,
        // triệu ₫/lượng -> ₫/chỉ: ×1e6 ÷10
        cost: cost === null ? null : chi * cost * 1e5,
      };
    });
    return sum(out, rows);
  }

  // ---- Ngoại tệ ------------------------------------------------------------
  async function fx() {
    const out = shell("fx", "Ngoại tệ");
    const holds = await Store.list("holdings_fx");
    if (!holds.length) return sum(out, []);

    const data = await DataService.getFxRates();
    out.source = data.source || "Vietcombank";
    out.note = "định giá theo giá NH MUA CHUYỂN KHOẢN — số nhận được nếu bán cho ngân hàng";

    const byCode = {};
    for (const r of data.rates || []) byCode[r.code] = r;

    const rows = holds.map((h) => {
      const r = byCode[h.code];
      const rate = r && has(r.buyTransfer) ? Number(r.buyTransfer) : null;
      const amount = num(h.amount) || 0;
      const cost = has(h.cost) ? Number(h.cost) : null;
      return {
        value: rate === null ? null : amount * rate,
        cost: cost === null ? null : amount * cost,
      };
    });
    return sum(out, rows);
  }

  // ---- Coin ----------------------------------------------------------------
  async function crypto() {
    const out = shell("crypto", "Coin");
    const holds = await Store.list("holdings_crypto");
    if (!holds.length) return sum(out, []);

    const ids = [...new Set(holds.map((h) => h.coinId).filter(Boolean))];
    const data = await DataService.getCryptoPrices(ids);
    out.source = data.source || "Binance";
    // Giá VND của coin là số QUY ĐỔI từ USD, không phải giá niêm yết VND —
    // trang phải dán nhãn (mục 1.5).
    //
    // `data.note` đã là câu viết cho người đọc, dùng thẳng. `vndFrom` là OBJECT
    // `{rate, rateDate, source}` chứ không phải một con số — nhét thẳng vào
    // chuỗi sẽ ra "[object Object]", đã dính đúng lỗi đó khi mới viết.
    if (data.note) {
      out.note = data.note;
    } else if (data.vndFrom && has(data.vndFrom.rate)) {
      out.note =
        `giá VND quy đổi từ USD theo tỷ giá ${Math.round(data.vndFrom.rate).toLocaleString("vi-VN")}` +
        (data.vndFrom.rateDate ? ` ngày ${data.vndFrom.rateDate}` : "");
    }

    const byId = {};
    for (const it of data.items || []) byId[it.id] = it;

    const rows = holds.map((h) => {
      const it = byId[h.coinId];
      const gia = it && has(it.vnd) ? Number(it.vnd) : null; // ₫/1 coin
      const qty = num(h.qty) || 0;
      const cost = has(h.cost) ? Number(h.cost) : null;
      return {
        value: gia === null ? null : qty * gia,
        cost: cost === null ? null : qty * cost,
      };
    });
    return sum(out, rows);
  }

  // ---- Tiết kiệm -----------------------------------------------------------
  //
  // GIÁ TRỊ = TIỀN GỐC, không cộng lãi dự kiến. Quyết định có chủ ý, đừng "sửa
  // lại cho đủ": lãi chưa nhận không phải tài sản đã có, và rút trước hạn thì
  // gần như mất sạch phần lãi đó. Cộng vào là thổi phồng tài sản bằng một khoản
  // chỉ có nếu giữ đủ kỳ hạn.
  //
  // Lãi dự kiến vẫn tính và trả về ở `duKienLai` để trang hiện RIÊNG — thông
  // tin hữu ích, chỉ là không nằm trong tổng.
  async function savings() {
    const out = shell("savings", "Tiết kiệm");
    const books = await Store.list("savings_accounts");
    if (!books.length) return sum(out, []);

    out.source = "sổ tự nhập";
    out.note = "tính theo TIỀN GỐC, chưa cộng lãi dự kiến — lãi chỉ nhận đủ khi giữ hết kỳ hạn";

    let duKienLai = 0;
    const rows = books.map((b) => {
      const amount = num(b.amount) || 0;
      const rate = has(b.rate) ? Number(b.rate) : null;
      const months = Number(String(b.term || "").replace(/[^0-9]/g, "")) || 0;
      if (rate !== null && months) duKienLai += (amount * (rate / 100) * months) / 12;
      // Gốc vừa là giá trị vừa là giá vốn: gửi 500tr thì đang có 500tr, lãi/lỗ
      // bằng 0. Không phải kênh biến động giá.
      return { value: amount, cost: amount };
    });

    const res = sum(out, rows);
    res.duKienLai = duKienLai;
    return res;
  }

  // ---- Gom cả năm kênh -----------------------------------------------------
  //
  // `allSettled` chứ không phải `all`: nguồn vàng chết thì bốn kênh kia vẫn
  // phải ra số. Đây là điều kiện để mục 6.5 làm được việc của nó.
  async function compute() {
    const jobs = [
      ["stock", "Chứng khoán", stock],
      ["gold", "Vàng", gold],
      ["fx", "Ngoại tệ", fx],
      ["crypto", "Coin", crypto],
      ["savings", "Tiết kiệm", savings],
    ];

    const settled = await Promise.allSettled(jobs.map(([, , fn]) => fn()));

    const channels = settled.map((r, i) => {
      const [key, label] = jobs[i];
      if (r.status === "fulfilled") return r.value;
      const bad = shell(key, label);
      bad.error = r.reason && r.reason.message ? r.reason.message : String(r.reason);
      return bad;
    });

    const dem = channels.filter((c) => c.ok);
    const value = dem.reduce((s, c) => s + (c.value || 0), 0);
    const coCost = dem.some((c) => c.cost !== null);
    const cost = dem.reduce((s, c) => s + (c.cost || 0), 0);

    return {
      channels,
      total: {
        value,
        cost: coCost ? cost : null,
        pl: coCost ? value - cost : null,
        plPct: coCost && cost ? ((value - cost) / cost) * 100 : null,
      },
      // Hai danh sách này là hợp đồng với trang: có phần tử nào thì PHẢI vẽ ra.
      missing: channels.filter((c) => !c.ok).map((c) => ({ label: c.label, reason: c.error })),
      partial: channels.filter((c) => c.ok && c.partial).map((c) => ({ label: c.label, detail: c.partial })),
      at: new Date().toISOString(),
    };
  }

  return { compute, stock, gold, fx, crypto, savings };
})();

if (typeof module !== "undefined") module.exports = NetWorth;
