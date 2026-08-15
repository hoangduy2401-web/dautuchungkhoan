// ============================================================
// COIN — danh sách theo dõi + biểu đồ + danh mục cá nhân.
//
// GIÁ VND LẤY THẲNG TỪ NGUỒN, không nhân tỷ giá. CoinGecko báo giá VND sẵn;
// nhân giá USD với một tỷ giá lấy ở endpoint khác là chồng sai số của nguồn thứ
// hai lên mọi con số, mà con số đó lại không mang nhãn nào nói ra điều đó.
// Khi nguồn dự phòng Binance trả lời thì cột VND để TRỐNG (`—`), không suy ra.
//
// `id` của coin là **slug CoinGecko** ("matic-network"), KHÔNG phải ticker
// ("MATIC"). Ô tìm kiếm gọi /api/crypto/search để đổi thứ user gõ thành slug.
// ============================================================

const coinState = {
  watch: [], // [id] — thứ tự do user, lưu qua Store
  items: [], // [{id, symbol, name, image, vnd, usd, change24h, marketCap}]
  source: null,
  note: null,
  vndFrom: null, // có khi giá VND là QUY ĐỔI từ USD chứ không phải giá gốc
  selected: null,
  range: 90,
  holdings: [],
  editingId: null,
  confirmDeleteId: null,
};

const WATCH_SETTING = "coinWatch";
const HOLDINGS_COLLECTION = "holdings_crypto"; // tên đã chốt ở docs/QUYHOACH.md 3.4

// Gói free của CoinGecko chỉ cho 365 ngày (`/market_chart` trả 401 code 10012
// khi vượt), nên trang này không có mốc 5Y — giống trang ngoại tệ.
const COIN_RANGES = [
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "6M", days: 180 },
  { label: "1Y", days: 365 },
];

const hasVal = (n) => n !== null && n !== undefined && Number.isFinite(Number(n));
const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const safeImg = (u) => (/^https:\/\//i.test(String(u || "")) ? String(u) : "");

// Logo coin. Binance không trả ảnh (CoinGecko thì có), nên lấy từ CDN icon theo
// ticker. Ảnh tải THẲNG TỪ TRÌNH DUYỆT của user, không qua backend, nên không
// dính vụ chặn IP datacenter.
//
// Hai CDN vì không cái nào phủ đủ: jsDelivr (cryptocurrency-icons) đẹp và nhanh
// nhưng bản 0.18.1 thiếu mọi coin sau 2021 (SUI/APT/ARB/PEPE… đều 404);
// CoinCap phủ những coin đó nhưng đo 07/08/2026 thì chỉ BTC tải về, các ticker
// khác treo. Thử lần lượt, hết nguồn thì hiện vòng tròn chữ cái đầu.
const LOGO_SOURCES = [
  (sym) => `https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color/${sym}.svg`,
  (sym) => `https://assets.coincap.io/assets/icons/${sym}@2x.png`,
];

function coinLogoHtml(c) {
  const sym = String(c.symbol || "").toLowerCase();
  const direct = safeImg(c.image); // CoinGecko có sẵn ảnh thì dùng luôn
  // KHÔNG `loading="lazy"`: trong bảng này ảnh không bao giờ được coi là lọt vào
  // tầm nhìn nên trình duyệt hoãn vô hạn — đo 07/08/2026, mọi logo đứng ở trạng
  // thái đang tải. Icon chỉ ~1KB và nhiều nhất vài chục cái, tải thẳng là xong.
  return `<img class="coin-logo" alt=""
    data-sym="${escapeHtml(sym)}" data-try="${direct ? -1 : 0}"
    src="${escapeHtml(direct || LOGO_SOURCES[0](sym))}" />`;
}

// Gắn sau mỗi lần vẽ bảng: `onerror` inline sẽ phải escape nhiều lớp, còn ở đây
// chỉ là một vòng qua các nguồn.
function wireLogoFallback(root) {
  root.querySelectorAll("img.coin-logo").forEach((img) => {
    img.addEventListener("error", () => {
      const sym = img.dataset.sym || "";
      const next = Number(img.dataset.try) + 1;
      if (next < LOGO_SOURCES.length) {
        img.dataset.try = String(next);
        img.src = LOGO_SOURCES[next](sym);
        return;
      }
      const ph = document.createElement("span");
      ph.className = "coin-logo ph";
      ph.textContent = sym.slice(0, 1).toUpperCase();
      img.replaceWith(ph);
    });
  });
}

// Giá coin trải từ vài đồng (SHIB) tới hơn tỷ đồng (BTC) — số chữ số thập phân
// phải co theo độ lớn, để nguyên 0 chữ số thì mọi altcoin rẻ đều thành "0".
function fmtVnd(n) {
  if (!hasVal(n)) return "—";
  const v = Number(n);
  const d = v >= 1000 ? 0 : v >= 1 ? 2 : 6;
  return v.toLocaleString("vi-VN", { minimumFractionDigits: d, maximumFractionDigits: d });
}
function fmtUsd(n) {
  if (!hasVal(n)) return "—";
  const v = Number(n);
  const d = v >= 1000 ? 0 : v >= 1 ? 2 : 6;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}
const fmtQty = (n) =>
  Number(n).toLocaleString("vi-VN", { minimumFractionDigits: 0, maximumFractionDigits: 8 });
const fmtMoney = (n) => Number(n).toLocaleString("vi-VN", { maximumFractionDigits: 0 });

// Vốn hoá coin lên tới hàng nghìn nghìn tỷ VND — số nguyên đầy đủ dài tới mức
// không đọc được, nên rút gọn theo bậc.
function fmtCap(n) {
  if (!hasVal(n)) return "—";
  const v = Number(n);
  if (v >= 1e15) return (v / 1e15).toFixed(2) + " triệu tỷ";
  if (v >= 1e12) return (v / 1e12).toFixed(2) + " nghìn tỷ";
  if (v >= 1e9) return (v / 1e9).toFixed(2) + " tỷ";
  return fmtMoney(v);
}

/* ============================================================
   INIT
   ============================================================ */
document.addEventListener("DOMContentLoaded", async () => {
  initChrome();

  // Store bất đồng bộ: nạp danh sách theo dõi và danh mục TRƯỚC lần vẽ đầu.
  const [watch, holdings] = await Promise.all([
    Store.getSetting(WATCH_SETTING, null),
    Store.list(HOLDINGS_COLLECTION),
  ]);
  // Danh sách rỗng là lựa chọn hợp lệ của user — chỉ seed khi CHƯA từng có
  // (null), giống luật của watchlist chứng khoán.
  coinState.watch = Array.isArray(watch) ? watch : APP_CONFIG.DEFAULT_COINS.slice();
  coinState.holdings = holdings || [];
  coinState.selected = coinState.watch[0] || null;

  document.getElementById("holdDate").value = new Date().toISOString().slice(0, 10);

  renderRangeTabs();
  wireSearch();
  wireTable();
  wireHoldings();
  wireChartToggles();
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
  // TUẦN TỰ, không Promise.all: vẽ chart trong lúc bảng giá còn trống khiến lần
  // vẽ ĐẦU TIÊN không hiện đường (trục, thang giá và nhãn giá cuối vẫn đúng —
  // chỉ thiếu đường, không có lỗi console). Gọi lại chính hàm đó sau khi bảng đã
  // render thì vẽ bình thường. Đo 07/08/2026. Nạp bảng trước cũng cho tiêu đề
  // chart có sẵn tên coin thay vì slug.
  await loadPrices();
  await loadChart();
}

/* ============================================================
   DANH SÁCH THEO DÕI
   ============================================================ */
async function loadPrices() {
  if (!coinState.watch.length) {
    coinState.items = [];
    renderTable();
    fillHoldCoins();
    renderHoldings();
    return;
  }

  try {
    const d = await DataService.getCryptoPrices(coinState.watch);
    coinState.items = Array.isArray(d.items) ? d.items : [];
    coinState.source = d.source || null;
    coinState.note = d.note || null;
    coinState.vndFrom = d.vndFrom || null;
    renderSource();
    renderTable();
    fillHoldCoins();
    updateChartTitle(); // giá về sau chart: tiêu đề đang là slug, đổi lại thành tên
    renderHoldings(); // giờ mới có giá để định giá danh mục
  } catch (err) {
    console.warn("[coin] giá lỗi:", err.message);
    DataService.markAsleep();
    setTableMessage("Nguồn lỗi — chưa lấy được giá coin.");
  }
}

function renderSource() {
  // Giá VND quy đổi từ USD là con số khác loại với giá VND báo trực tiếp — nhãn
  // phải nói ra, nếu không user so với sàn khác rồi tưởng hệ thống lệch.
  const via = coinState.vndFrom ? " · VND quy đổi" : "";
  document.getElementById("coinSource").textContent = (coinState.source || "—") + via;
  // Nguồn dự phòng = giá của sàn khác và thiếu cột VND. Phải nói ra.
  const fb = document.getElementById("coinFallback");
  fb.textContent = coinState.note || "";
  fb.hidden = !coinState.note;
}

function setTableMessage(msg) {
  document.getElementById("coinTableBody").innerHTML =
    `<tr><td colspan="6" class="empty-state">${escapeHtml(msg)}</td></tr>`;
}

function renderTable() {
  if (!coinState.watch.length) {
    setTableMessage("Danh sách trống. Thêm coin ở ô phía trên.");
    return;
  }
  if (!coinState.items.length) {
    setTableMessage("Đang chờ máy chủ…");
    return;
  }

  document.getElementById("coinTableBody").innerHTML = coinState.items
    .map((c) => {
      const ch = c.change24h;
      const cls = !hasVal(ch) ? "" : ch > 0 ? "up" : ch < 0 ? "down" : "flat";
      return `<tr data-id="${escapeHtml(c.id)}"${c.id === coinState.selected ? ' class="sel"' : ""}>
        <td class="coin-cell">
          ${coinLogoHtml(c)}
          <span class="coin-names"><strong>${escapeHtml(c.symbol)}</strong><small>${escapeHtml(c.name)}</small></span>
        </td>
        <td class="num">${fmtVnd(c.vnd)}</td>
        <td class="num muted col-usd">${fmtUsd(c.usd)}</td>
        <td class="num ${cls}">${hasVal(ch) ? (ch >= 0 ? "+" : "") + ch.toFixed(2) + "%" : "—"}</td>
        <td class="num muted col-cap">${fmtCap(c.marketCap)}</td>
        <td class="act"><button type="button" class="row-btn danger" data-del="${escapeHtml(c.id)}" title="Bỏ theo dõi">✕</button></td>
      </tr>`;
    })
    .join("");
  wireLogoFallback(document.getElementById("coinTableBody"));
}

function wireTable() {
  // Uỷ quyền sự kiện: bảng vẽ lại sau mỗi lần làm mới giá.
  document.getElementById("coinTableBody").addEventListener("click", async (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      coinState.watch = coinState.watch.filter((id) => id !== del.dataset.del);
      coinState.items = coinState.items.filter((c) => c.id !== del.dataset.del);
      if (coinState.selected === del.dataset.del) {
        coinState.selected = coinState.watch[0] || null;
        loadChart();
      }
      renderTable();
      await Store.setSetting(WATCH_SETTING, coinState.watch);
      return;
    }
    const tr = e.target.closest("tr[data-id]");
    if (tr) selectCoin(tr.dataset.id);
  });
}

/* ---- Thêm coin: phải đổi thứ user gõ thành slug CoinGecko ---- */
function wireSearch() {
  const form = document.getElementById("coinAddForm");
  const input = document.getElementById("coinSearch");
  const box = document.getElementById("coinResults");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length < 2) {
      box.innerHTML = `<div class="coin-result-msg">Gõ ít nhất 2 ký tự.</div>`;
      box.hidden = false;
      return;
    }
    box.innerHTML = `<div class="coin-result-msg">Đang tìm…</div>`;
    box.hidden = false;
    try {
      const rows = await DataService.searchCoins(q);
      if (!rows.length) {
        box.innerHTML = `<div class="coin-result-msg">Không tìm thấy coin nào.</div>`;
        return;
      }
      box.innerHTML = rows
        .map(
          (r) =>
            `<button type="button" class="coin-result" data-add="${escapeHtml(r.id)}">
               <strong>${escapeHtml(r.symbol)}</strong> ${escapeHtml(r.name)}
               ${r.rank ? `<span class="rank">#${r.rank}</span>` : ""}
             </button>`
        )
        .join("");
    } catch (err) {
      box.innerHTML = `<div class="coin-result-msg">Nguồn lỗi — chưa tìm được.</div>`;
    }
  });

  box.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-add]");
    if (!btn) return;
    const id = btn.dataset.add;
    if (!coinState.watch.includes(id)) {
      coinState.watch = [...coinState.watch, id];
      await Store.setSetting(WATCH_SETTING, coinState.watch);
      await loadPrices();
    }
    box.hidden = true;
    input.value = "";
  });
}

/* ============================================================
   BIỂU ĐỒ

   PHẢI CHIA BẬC TRƯỚC KHI VẼ. Lightweight Charts không vẽ series khi giá trị
   quá lớn: đo 07/08/2026, chuỗi BTC theo VND (~1,68e9) cho ra trục, thang giá
   và nhãn giá cuối đều đúng nhưng ĐƯỜNG KHÔNG XUẤT HIỆN và không có lỗi console
   nào; chia cùng chuỗi đó cho 1000 là hiện lại ngay. Đổi `priceFormat.minMove`
   không cứu được (đã thử 1000) — giới hạn nằm ở độ lớn giá trị.

   Nên trang này quy mọi chuỗi về dưới 1e5 rồi ghi đơn vị lên nhãn. Đừng bỏ bậc
   chia mà không kiểm lại bằng mắt trên một coin giá tỷ đồng.
   ============================================================ */

// Bậc chia + nhãn đơn vị cho biểu đồ. Bậc "đẹp" (1 / nghìn / triệu) để nhãn còn
// đọc được, không phải hệ số lẻ.
function chartScaleFor(values) {
  const max = Math.max(...values.filter(Number.isFinite).map(Math.abs), 0);
  if (max >= 1e8) return { div: 1e6, unit: "triệu ₫" };
  if (max >= 1e5) return { div: 1e3, unit: "nghìn ₫" };
  return { div: 1, unit: "₫" };
}
function renderRangeTabs() {
  const host = document.getElementById("coinRangeTabs");
  host.innerHTML = COIN_RANGES.map(
    (r) =>
      `<button type="button" data-days="${r.days}"${r.days === coinState.range ? ' class="active"' : ""}>${r.label}</button>`
  ).join("");

  host.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-days]");
    if (!btn) return;
    coinState.range = Number(btn.dataset.days);
    host.querySelectorAll("button").forEach((b) => b.classList.toggle("active", Number(b.dataset.days) === coinState.range));
    loadChart();
  });
}

function wireChartToggles() {
  const wire = (id, name) => {
    const el = document.getElementById(id);
    el.addEventListener("change", () => {
      if (chartReady) ChartModule.toggleSeries(name, el.checked);
    });
  };
  wire("chkMA10", "ma10");
  wire("chkMA20", "ma20");
}

function selectCoin(id) {
  if (!id || id === coinState.selected) return;
  coinState.selected = id;
  renderTable();
  loadChart();
}

// Chart dựng LƯỜI, ngay trước lần vẽ đầu — không dựng trong DOMContentLoaded.
// Dựng sớm thì Lightweight Charts đọc kích thước container lúc trang chưa bố
// cục xong, và lần setData đầu tiên KHÔNG VẼ ĐƯỜNG: trục, thang giá và nhãn giá
// cuối đều đúng, chỉ thiếu đường, không có lỗi console nào. Gọi lại đúng hàm vẽ
// đó sau khi trang ổn định thì bình thường (đo 07/08/2026). Cùng họ với bài học
// "chart tạo lúc container width = 0" ở CLAUDE.md mục 7.
let chartReady = false;
let firstDrawDone = false;
function ensureChart() {
  if (chartReady) return;
  ChartModule.init("priceChartContainer", "rsiChartContainer", "trendOverlay");
  // Chuỗi giá coin theo ngày không có khối lượng ở payload này, và RSI trên một
  // cặp tiền tệ không nói lên điều gì hữu ích ở đây — tắt cả hai, giữ MA.
  ChartModule.toggleSeries("volume", false);
  ChartModule.toggleSeries("rsi", false);
  ChartModule.toggleSeries("ma10", document.getElementById("chkMA10").checked);
  ChartModule.toggleSeries("ma20", document.getElementById("chkMA20").checked);
  chartReady = true;
}

// Tiêu đề chart lấy tên coin từ bảng giá. Hai lời gọi chạy song song lúc mở
// trang, nên khi chart vẽ xong bảng giá có thể chưa về — lúc đó tiêu đề tạm là
// slug và được sửa lại ngay khi giá về.
function updateChartTitle() {
  const id = coinState.selected;
  const el = document.getElementById("coinChartTitle");
  if (!id) {
    el.textContent = "—";
    return;
  }
  const meta = coinState.items.find((c) => c.id === id);
  el.textContent = meta ? `${meta.symbol} — ${meta.name}` : id;
}

async function loadChart() {
  const id = coinState.selected;
  const days = coinState.range;
  const stats = document.getElementById("coinChartStats");

  if (!id) {
    updateChartTitle();
    stats.innerHTML = "";
    if (chartReady) ChartModule.setData([], null);
    return;
  }

  updateChartTitle();
  stats.innerHTML = `<span class="muted">Đang tải…</span>`;

  try {
    const d = await DataService.getCryptoHistory(id, days);
    ensureChart();
    // Bấm nhanh sang coin/khung khác: bỏ qua phản hồi lạc hậu, nếu không dữ liệu
    // của coin cũ sẽ nằm dưới tên coin mới (CLAUDE.md mục 7).
    if (coinState.selected !== id || coinState.range !== days) return;

    const items = Array.isArray(d.items) ? d.items : [];
    if (!items.length) throw new Error("chuỗi rỗng");

    // Nhãn nguồn của biểu đồ đổi theo đường nào trả lời: CoinGecko báo giá VND
    // trực tiếp, còn Binance là giá USD đã quy đổi — hai loại số khác nhau.
    document.getElementById("coinChartSource").textContent = d.source || "—";
    document.getElementById("coinNote").innerHTML = d.note
      ? `${escapeHtml(d.note)}. Gói miễn phí chỉ có 1 năm lịch sử nên không có khung 5 năm.`
      : "Giá theo <strong>VND</strong> lấy thẳng từ nguồn, không nhân tỷ giá. " +
        "Gói miễn phí chỉ có 1 năm lịch sử nên không có khung 5 năm.";

    const scale = chartScaleFor(items.map((p) => p.price));
    // Không có OHLC — ChartModule tự nhận ra và vẽ đường khi thiếu `open`.
    const bars = items.map((p) => ({ date: p.date, close: p.price / scale.div, volume: 0 }));
    ChartModule.setData(bars, `${id}|${days}`);
    renderChartStats(items, scale);

    // VẼ LẠI MỘT LẦN — không xoá dòng này.
    // Lần vẽ ĐẦU TIÊN sau khi tải trang không hiện đường: trục, thang giá và
    // nhãn giá cuối đều đúng, chỉ thiếu đường, và không có lỗi console nào.
    // Gọi lại đúng hàm vẽ đó khi trang đã ổn định thì bình thường.
    // ĐÃ THỬ VÀ KHÔNG PHẢI NGUYÊN NHÂN (đo 07/08/2026, đừng thử lại):
    //   - độ lớn giá trị (đã chia bậc về ~2.000, vẫn không vẽ)
    //   - `priceFormat.minMove` (thử 1000, không đổi)
    //   - nạp bảng giá trước rồi mới vẽ (tuần tự thay Promise.all)
    //   - chờ 2 khung hình rồi mới vẽ
    //   - dựng chart lười ngay trước lần vẽ đầu
    // Căn nguyên vẫn chưa rõ; đây là cách duy nhất đã kiểm chứng là chạy.
    if (!firstDrawDone) {
      firstDrawDone = true;
      setTimeout(() => {
        if (coinState.selected === id && coinState.range === days) {
          ChartModule.setData(bars, `${id}|${days}`);
        }
      }, 400);
    }
  } catch (err) {
    console.warn("[coin] lịch sử lỗi:", err.message);
    DataService.markAsleep();
    if (chartReady && coinState.selected === id && coinState.range === days) {
      ChartModule.setData([], null); // xoá trắng, đừng để chuỗi coin khác nằm dưới tên này
      stats.innerHTML = `<span class="muted">Nguồn lỗi — chưa lấy được lịch sử.</span>`;
    }
  }
}

function renderChartStats(items, scale) {
  const first = items[0].price;
  const last = items[items.length - 1].price;
  const chg = first ? ((last - first) / first) * 100 : 0;
  const cls = chg > 0.001 ? "up" : chg < -0.001 ? "down" : "flat";
  const lo = Math.min(...items.map((d) => d.price));
  const hi = Math.max(...items.map((d) => d.price));
  const lastDate = new Date(items[items.length - 1].date).toLocaleDateString("vi-VN");

  // Trục biểu đồ đang theo `scale.unit`, các ô thống kê theo đồng đầy đủ — nói
  // rõ bậc của trục, nếu không user so hai con số rồi tưởng lệch.
  document.getElementById("coinChartUnit").textContent =
    scale && scale.div !== 1 ? `trục biểu đồ: ${scale.unit}` : "";

  document.getElementById("coinChartStats").innerHTML = `
    <div class="stat"><span class="label">Mới nhất (${escapeHtml(lastDate)})</span><span class="val">${fmtVnd(last)}</span></div>
    <div class="stat"><span class="label">Biến động khung</span><span class="val ${cls}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</span></div>
    <div class="stat"><span class="label">Thấp nhất</span><span class="val">${fmtVnd(lo)}</span></div>
    <div class="stat"><span class="label">Cao nhất</span><span class="val">${fmtVnd(hi)}</span></div>`;
}

/* ============================================================
   DANH MỤC CÁ NHÂN (collection `holdings_crypto`)

   Cùng khuôn với danh mục ngoại tệ và vàng: DANH SÁCH NẮM GIỮ sửa trực tiếp,
   không phải sổ giao dịch. Giá vốn nhập theo **₫/1 coin**, lãi/lỗ tính bằng VND.

   Chỉ định giá được coin đang có trong danh sách theo dõi — đó là những coin
   backend vừa lấy giá. Coin ngoài danh sách hiện `—` chứ không lấy giá cũ.
   GĐ 7 sẽ thay phần nhập tay này bằng đồng bộ số dư sàn.
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

function coinById(id) {
  return coinState.items.find((c) => c.id === id) || null;
}

function fillHoldCoins() {
  const sel = document.getElementById("holdCoin");
  const keep = sel.value;
  sel.innerHTML = coinState.items
    .map((c) => `<option value="${escapeHtml(c.id)}">${escapeHtml(c.symbol)} — ${escapeHtml(c.name)}</option>`)
    .join("");
  if ([...sel.options].some((o) => o.value === keep)) sel.value = keep;
}

function holdRow(h) {
  const c = coinById(h.coinId);
  const qty = Number(h.qty) || 0;
  const price = c && hasVal(c.vnd) ? c.vnd : null; // ₫/1 coin
  const cost = hasVal(h.cost) ? Number(h.cost) : null;
  const value = price === null ? null : qty * price;
  const pl = price === null || cost === null ? null : qty * (price - cost);
  const plPct = price === null || cost === null || !cost ? null : ((price - cost) / cost) * 100;
  return { ...h, qty, price, cost, value, pl, plPct };
}

function renderHoldings() {
  const body = document.getElementById("holdTableBody");
  const rows = coinState.holdings.map(holdRow);

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="8" class="empty-state">Chưa có coin nào. Thêm ở ô phía trên.</td></tr>`;
    document.getElementById("holdSummary").innerHTML = "";
    return;
  }

  body.innerHTML = rows.map((r) => (r.id === coinState.editingId ? editRowHtml(r) : viewRowHtml(r))).join("");
  renderHoldSummary(rows);
}

function viewRowHtml(r) {
  const plCls = r.pl === null ? "" : r.pl > 0 ? "up" : r.pl < 0 ? "down" : "flat";
  const plText =
    r.pl === null
      ? "—"
      : `<span class="money">${r.pl >= 0 ? "+" : ""}${fmtMoney(r.pl)} ₫</span> <span class="${plCls}">(${r.plPct >= 0 ? "+" : ""}${r.plPct.toFixed(2)}%)</span>`;
  const delLabel = r.id === coinState.confirmDeleteId ? "Chắc chứ?" : "Xoá";

  return `<tr data-hid="${r.id}">
    <td class="code">${escapeHtml(r.symbol || r.coinId)}</td>
    <td class="num"><span class="money">${fmtQty(r.qty)}</span></td>
    <td class="num muted">${r.cost === null ? "—" : fmtVnd(r.cost)}</td>
    <td class="num muted col-rate">${r.price === null ? "—" : fmtVnd(r.price)}</td>
    <td class="num">${r.value === null ? "—" : `<span class="money">${fmtMoney(r.value)}</span>`}</td>
    <td class="num ${plCls}">${plText}</td>
    <td class="col-date muted">${escapeHtml(r.date || "—")}</td>
    <td class="act">
      <button type="button" class="row-btn" data-act="edit">Sửa</button>
      <button type="button" class="row-btn danger" data-act="del">${delLabel}</button>
    </td>
  </tr>`;
}

// Sửa tại chỗ: số lượng, giá vốn, ngày mua. Đổi coin thì xoá rồi thêm lại —
// giá vốn cũ gắn với coin cũ.
function editRowHtml(r) {
  return `<tr data-hid="${r.id}">
    <td class="code">${escapeHtml(r.symbol || r.coinId)}</td>
    <td class="num"><input class="edit-input" data-edit="qty" value="${fmtQty(r.qty)}" /></td>
    <td class="num"><input class="edit-input" data-edit="cost" value="${r.cost === null ? "" : fmtVnd(r.cost)}" placeholder="₫/1 coin" /></td>
    <td class="num muted col-rate">${r.price === null ? "—" : fmtVnd(r.price)}</td>
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

  const withCost = rows.filter((r) => r.pl !== null);
  const totalPl = withCost.reduce((s, r) => s + r.pl, 0);
  const totalCost = withCost.reduce((s, r) => s + r.qty * r.cost, 0);
  const plPct = totalCost ? (totalPl / totalCost) * 100 : null;
  const plCls = totalPl > 0 ? "up" : totalPl < 0 ? "down" : "flat";

  document.getElementById("holdSummary").innerHTML =
    `<div class="stat">
       <span class="label">Tổng giá trị${missing ? ` (thiếu giá ${missing} coin)` : ""}</span>
       <span class="val"><span class="money">${priced.length ? fmtMoney(total) + " ₫" : "—"}</span></span>
     </div>` +
    (withCost.length
      ? `<div class="stat">
           <span class="label">Lãi/lỗ (${withCost.length}/${rows.length} coin có giá vốn)</span>
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

// Ô giá vốn trang này là **₫/1 coin** — CÙNG đơn vị với giá đang hiện ở bảng,
// không phải quy đổi gì (khác trang Vàng, nơi ô nhập là triệu ₫/lượng còn dữ
// liệu là nghìn ₫/chỉ). Lỗi hay gặp ở đây là gõ GIÁ USD vào ô VND.
// `vnd` null (nguồn lỗi) -> null -> CostGuard im lặng, không cảnh báo suông.
const costConfirm = CostGuard.makeConfirmer();
const COST_GUARD_OPTS = { unitLabel: "₫/1 coin", marketLabel: "giá hiện tại", fmt: fmtVnd };

function marketCostFor(coinId) {
  const c = coinById(coinId);
  return c && hasVal(c.vnd) ? Number(c.vnd) : null;
}

function wireHoldings() {
  document.getElementById("holdForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const sel = document.getElementById("holdCoin");
    const id = sel.value;
    const meta = coinById(id);
    const qtyEl = document.getElementById("holdQty");
    const costEl = document.getElementById("holdCost");
    const qty = parseAmount(qtyEl.value);
    const costRaw = costEl.value.trim();
    const cost = costRaw ? parseAmount(costRaw) : null;

    if (!id) return setHoldError("Chưa nạp được giá coin — thử lại khi bảng hiện số.");
    if (qty === null || qty <= 0) return setHoldError("Số lượng phải là số lớn hơn 0.");
    if (costRaw && (cost === null || cost <= 0)) return setHoldError("Giá vốn phải là số lớn hơn 0, hoặc để trống.");

    if (cost !== null) {
      const warn = costConfirm.guard(`add|${id}|${cost}`, cost, marketCostFor(id), COST_GUARD_OPTS);
      if (warn) return setHoldError(warn, "warn");
    }

    setHoldError("");
    await Store.add(HOLDINGS_COLLECTION, {
      // `coinId`, KHÔNG phải `id`: Store dùng `id` làm khoá của bản ghi
      // (`Store.add` giữ nguyên `row.id` nếu có), nên đặt slug coin vào đó sẽ
      // khiến hai dòng cùng một coin trùng khoá và sửa/xoá nhầm dòng.
      coinId: id,
      symbol: meta ? meta.symbol : id.toUpperCase(),
      qty,
      cost, // ₫/1 coin; null = không theo dõi lãi/lỗ
      date: document.getElementById("holdDate").value || null,
      updatedAt: new Date().toISOString(),
    });
    await reloadHoldings();
    qtyEl.value = "";
    costEl.value = "";
  });

  document.getElementById("holdTableBody").addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const tr = btn.closest("tr[data-hid]");
    const rowId = tr.dataset.hid;

    if (btn.dataset.act === "edit") {
      coinState.editingId = rowId;
      coinState.confirmDeleteId = null;
      renderHoldings(); // dòng cũ đã bị thay, phải tìm lại dòng mới để focus
      document.querySelector(`tr[data-hid="${rowId}"] [data-edit="qty"]`)?.focus();
      return;
    }

    if (btn.dataset.act === "cancel") {
      coinState.editingId = null;
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
        const h = coinState.holdings.find((x) => String(x.id) === rowId);
        const warn = costConfirm.guard(
          `edit|${rowId}|${cost}`,
          cost,
          h ? marketCostFor(h.coinId) : null,
          COST_GUARD_OPTS
        );
        if (warn) return setHoldError(warn, "warn");
      }

      setHoldError("");
      await Store.update(HOLDINGS_COLLECTION, rowId, { qty, cost, date, updatedAt: new Date().toISOString() });
      coinState.editingId = null;
      await reloadHoldings();
      return;
    }

    if (btn.dataset.act === "del") {
      // Hai nhịp thay vì confirm(): xoá không hoàn tác được và nút nằm ngay
      // cạnh nút Sửa.
      if (coinState.confirmDeleteId !== rowId) {
        coinState.confirmDeleteId = rowId;
        renderHoldings();
        setTimeout(() => {
          if (coinState.confirmDeleteId === rowId) {
            coinState.confirmDeleteId = null;
            renderHoldings();
          }
        }, 4000);
        return;
      }
      coinState.confirmDeleteId = null;
      await Store.remove(HOLDINGS_COLLECTION, rowId);
      await reloadHoldings();
    }
  });

  document.getElementById("holdTableBody").addEventListener("keydown", (e) => {
    if (!coinState.editingId) return;
    if (e.key === "Enter") {
      e.preventDefault();
      e.target.closest("tr")?.querySelector('[data-act="save"]')?.click();
    } else if (e.key === "Escape") {
      e.target.closest("tr")?.querySelector('[data-act="cancel"]')?.click();
    }
  });
}

async function reloadHoldings() {
  coinState.holdings = await Store.list(HOLDINGS_COLLECTION);
  renderHoldings();
}
