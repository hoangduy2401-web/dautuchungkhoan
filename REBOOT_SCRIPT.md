# ===================================================================
# REBOOT SCRIPT — DỰ ÁN DASHBOARD CHỨNG KHOÁN CÁ NHÂN (BẢNG ĐIỆN)
# ===================================================================
# Dán toàn bộ nội dung file này làm prompt đầu tiên của chat mới
# để tiếp tục dự án mà không mất bối cảnh.
# ===================================================================

## 1. MỤC TIÊU CUỐI CÙNG

Xây dựng một **dashboard theo dõi chứng khoán cá nhân** dạng web tĩnh
(HTML/CSS/JS thuần, không cần build tool), truy cập qua link công khai
(GitHub Pages), có khả năng kết nối API dữ liệu thật (SSI FastConnect,
TCBS, CafeF RSS) qua một backend proxy Node.js nhỏ deploy trên Render.com.

Dashboard gồm các tính năng:
- Dải ticker giá chạy liên tục (kiểu bảng điện sàn giao dịch)
- Bảng chỉ số thị trường (VNINDEX, HNX, VN30...)
- Watchlist tùy biến (thêm/bỏ mã)
- Biểu đồ nến chuyên nghiệp (TradingView Lightweight Charts) với:
  MA10/MA20, Bollinger Bands (20, 2σ), Khối lượng, RSI(14),
  vẽ trendline thủ công 2 điểm, zoom/pan mượt
- Chỉ số cơ bản doanh nghiệp (P/E, P/B, ROE, EPS, DT YoY...)
- Tin tức tài chính liên quan (theo mã)
- Lịch sử giao dịch cá nhân (mua/bán), tính lãi/lỗ tự động (localStorage)

---

## 2. TRẠNG THÁI HIỆN TẠI

**Phase hoàn thành: Toàn bộ codebase front-end + backend proxy ĐẦY ĐỦ đã xong.**

- ✅ Tất cả file front-end đã viết xong, chạy được với dữ liệu mock
- ✅ Biểu đồ nến đã nâng cấp lên TradingView Lightweight Charts v4.1.3
- ✅ Bollinger Bands đã bổ sung
- ✅ Backend proxy (server/index.js) ĐÃ VIẾT ĐẦY ĐỦ (không còn 501 placeholder):
  - `/api/price/history` — SSI FCData DailyOhlc, chia 1000, đổi dd/mm/yyyy→yyyy-mm-dd, sort tăng dần
  - `/api/price/indices` — SSI FCData IndexList
  - `/api/price/quote` — SSI SecuritiesDetails (route MỚI, app.js gọi qua DataService.getQuote)
  - `/api/fundamentals/:symbol` — TCBS overview + financialratio
  - `/api/news` — CafeF RSS (2 feed), lọc theo mã bằng regex whole-word
  - Cache in-memory theo TTL: quote 10s, indices 15s, history 60s, fundamentals 6h, news 5 phút
- ✅ Đã thêm server/package.json, server/.env.example, server/.gitignore
- ✅ Hướng dẫn deploy GitHub Pages đã viết (README + chat)

**Bước tiếp theo người dùng cần tự làm (thứ tự tối ưu để không kẹt chờ SSI):**
1. Deploy frontend lên GitHub Pages (vẫn mock, có link web ngay)
2. Deploy backend lên Render.com — test trước 2 route KHÔNG cần SSI:
   `/api/fundamentals/VNM` và `/api/news?symbols=VNM,FPT`
3. Ra quầy SSI đăng ký FastConnect Data (mang CCCD) → lấy ConsumerID/Secret
4. Điền key vào Render (tab Environment) → test 3 route SSI (history/indices/quote)
5. Đổi USE_MOCK=false + cập nhật baseUrl trong config.js → git push

---

## 3. QUYẾT ĐỊNH KỸ THUẬT & RÀNG BUỘC ĐÃ XÁC LẬP

- **Không dùng framework/build tool** (React, Vite, Webpack...) — chỉ HTML/CSS/JS
  thuần để deploy tĩnh lên GitHub Pages không cần CI/CD phức tạp
- **Chart.js đã bị loại bỏ**, thay bằng **TradingView Lightweight Charts v4.1.3**
  (CDN: `https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js`)
  vì cần nến OHLC + zoom/pan native
- **Trendline** vẽ trên `<canvas>` phủ lên chart (id="trendOverlay"), neo theo
  time/price để bám đúng vị trí khi pan/zoom
- **RSI** render trong chart phụ riêng (id="rsiChartContainer"), đồng bộ
  trục thời gian 2 chiều với chart chính qua `subscribeVisibleLogicalRangeChange`
- **Bollinger Bands** tắt mặc định (checkbox "Bollinger" bật lên), 3 series riêng:
  Upper (Dashed), Basis (Dotted), Lower (Dashed), màu #1baf7a
- **Giá đơn vị nghìn đồng VND** (theo chuẩn HOSE) — SSI FastConnect trả đơn vị
  đồng, cần chia 1000 khi nhận về
- **CORS blocker**: tất cả API chứng khoán VN chặn gọi thẳng từ trình duyệt
  → bắt buộc cần backend proxy (server/index.js)
- **localStorage** lưu lịch sử giao dịch (key: `vn_dashboard_transactions_v1`)
- **Giá vốn bình quân gia quyền (FIFO)** cho tính lãi/lỗ danh mục
- **Font**: Space Grotesk (display), Be Vietnam Pro (body), JetBrains Mono (numbers)
  — tải từ Google Fonts
- **Theme tối**: nền #0a0f1c, accent #f2a93b (amber), xanh #17d980, đỏ #ff4d5e
- **Route `/api/price/quote`** (MỚI): app.js gọi DataService.getQuote cho từng mã
  trong watchlist → backend phải có route này (README cũ chưa liệt kê trong contract)
- **Backend stack**: Node/Express + cors + dotenv + rss-parser. Node >=18 (dùng
  global `fetch` sẵn có, không cần node-fetch)
- **Cache in-memory** trong server (Map key→{data, expiresAt}) — TTL riêng từng route
- **Fundamentals dùng TCBS public API** (apipubaws.tcbs.com.vn) — không chính thức,
  marketCap chia 1e12 (→nghìn tỷ), eps chia 1000, roe/roa/growth nhân 100 (%)
- **News lọc whole-word** bằng regex `\bMÃ\b` để tránh khớp nhầm (vd VNM ⊄ VNMIDAS)

---

## 4. CẤU TRÚC FILE (9 files)

```
dashboard-chungkhoan/
├── index.html          ← layout chính, nạp script theo thứ tự cụ thể
├── style.css           ← toàn bộ CSS, design tokens tại :root
├── config.js           ← USE_MOCK, REFRESH_INTERVAL_MS, baseUrl các provider
├── mockData.js         ← COMPANY_INFO, generateHistory/Fundamentals/News/Indices
├── dataService.js      ← adapter: mock vs real API, mọi widget gọi qua đây
├── portfolio.js        ← Portfolio.list/add/remove/computeHoldings (localStorage)
├── chartModule.js      ← ChartModule IIFE: init/setData/toggleSeries/trendline
├── app.js              ← state + render functions cho mọi widget
└── server/
    └── index.js        ← Node/Express proxy template + SSI API code thật
```

**Thứ tự nạp script trong index.html (quan trọng):**
```html
<script src="https://unpkg.com/lightweight-charts@4.1.3/..."></script>
<script src="config.js"></script>
<script src="mockData.js"></script>
<script src="dataService.js"></script>
<script src="portfolio.js"></script>
<script src="chartModule.js"></script>
<script src="app.js"></script>
```

---

## 5. VẤN ĐỀ CHƯA GIẢI QUYẾT / BƯỚC TIẾP THEO

- [ ] **Người dùng chưa thực hiện** việc đẩy code lên GitHub và bật Pages
- [ ] **Người dùng chưa đăng ký** SSI FastConnect Data (cần ra quầy SSI)
- [ ] **Chưa deploy backend lên Render** — code đã đầy đủ, chưa test trên môi trường thật
- [ ] **3 chỗ `NOTE:` trong server/index.js cần xác nhận khi có key SSI thật:**
      (1) shape của auth response (accessToken casing),
      (2) tên endpoint DailyOhlc / IndexList / SecuritiesDetails,
      (3) field casing (OpenPrice/Open...) — SSI đổi giữa các phiên bản FCData.
      → Khi test lỗi, dán response lỗi cho Claude sửa khớp.
- [x] **server/index.js đã viết đầy đủ** (không còn 501 placeholder) — 5 route xong
- [x] **Tin tức đã cải thiện lọc theo mã** (regex whole-word) — vẫn có thể tích hợp
      thêm Vietstock RSS nếu muốn phủ rộng hơn
- [ ] **Chỉ số cơ bản** vẫn dùng TCBS public API không chính thức — cân nhắc chuyển
      sang SSI FCData khi có key nếu TCBS đổi/chặn
- [ ] **Gói Render.com miễn phí ngủ sau 15 phút** — cần ping định kỳ bằng
      UptimeRobot hoặc nâng gói nếu muốn response nhanh
- [ ] **Chưa có MACD** — người dùng đã xem Bollinger Bands, chưa yêu cầu MACD
      nhưng README đã gợi ý cách thêm
- [ ] **Lịch sử giao dịch không đồng bộ đa thiết bị** — localStorage chỉ local;
      nếu muốn sync cần thêm backend DB (Postgres/MongoDB)

---

## 6. TOÀN BỘ CODE CÁC FILE (phiên bản mới nhất)

### index.html
```html
<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Bảng Điện — Dashboard Chứng Khoán</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=Be+Vietnam+Pro:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="style.css" />
</head>
<body>
  <div class="ticker-tape">
    <span class="live-dot">LIVE</span>
    <span class="ticker-track" id="tickerTrack"></span>
  </div>
  <header class="app-header">
    <div class="brand">
      <div class="mark">BẢNG<span>ĐIỆN</span></div>
      <div class="sub">Dashboard tổng hợp cổ phiếu &amp; danh mục cá nhân</div>
    </div>
    <div class="header-right">
      <span class="mock-badge" id="mockBadge">DỮ LIỆU MẪU — XEM config.js</span>
      <span class="clock" id="clock"></span>
    </div>
  </header>
  <section class="index-strip" id="indexStrip"></section>
  <main class="main-grid">
    <div class="panel">
      <div class="panel-head"><h2>Danh mục theo dõi</h2></div>
      <form id="addSymbolForm" class="watchlist-add">
        <input id="newSymbol" placeholder="Mã CK, vd: VIC" maxlength="10" />
        <button type="submit">+ Thêm</button>
      </form>
      <div id="watchlist"></div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Biểu đồ giá &amp; chỉ số cơ bản</h2></div>
      <div class="panel-body">
        <div class="symbol-title" id="symbolTitle"></div>
        <div class="chart-toolbar">
          <div class="range-tabs" id="rangeTabs"></div>
          <label class="chk"><input type="checkbox" id="chkMA10" checked/><span class="sw" style="background:#2a78d6;"></span>MA10</label>
          <label class="chk"><input type="checkbox" id="chkMA20" checked/><span class="sw" style="background:#4a3aa7;"></span>MA20</label>
          <label class="chk"><input type="checkbox" id="chkBB"/><span class="sw" style="background:#1baf7a;"></span>Bollinger</label>
          <label class="chk"><input type="checkbox" id="chkVol" checked/>KL</label>
          <label class="chk"><input type="checkbox" id="chkRSI" checked/>RSI</label>
          <button type="button" id="drawTrendBtn" class="btn-outline">Vẽ trendline</button>
          <button type="button" id="clearTrendBtn" class="btn-outline">Xóa</button>
        </div>
        <div class="chart-stack">
          <div class="chart-wrap" id="priceChartContainer"></div>
          <canvas id="trendOverlay" class="trend-overlay"></canvas>
        </div>
        <div class="chart-wrap-rsi" id="rsiChartContainer"></div>
        <div class="fund-grid" id="fundGrid"></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head"><h2>Tin tức liên quan</h2></div>
      <div id="newsList"></div>
    </div>
  </main>
  <section class="portfolio-section">
    <div class="portfolio-grid">
      <div class="panel">
        <div class="panel-head"><h2>Thêm giao dịch</h2></div>
        <div class="panel-body">
          <form id="txForm" class="tx-form">
            <div><label>Mã CK</label><input name="symbol" placeholder="VNM" required maxlength="10" /></div>
            <div><label>Loại lệnh</label><select name="type"><option value="buy">Mua</option><option value="sell">Bán</option></select></div>
            <div><label>Khối lượng</label><input name="qty" type="number" min="1" step="1" required /></div>
            <div><label>Giá (nghìn đồng)</label><input name="price" type="number" min="0" step="0.01" required /></div>
            <div><label>Ngày</label><input name="date" type="date" /></div>
            <div><label>Ghi chú</label><input name="note" placeholder="Tùy chọn" /></div>
            <button type="submit" class="btn btn-submit">Lưu giao dịch</button>
          </form>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>Danh mục &amp; lịch sử giao dịch</h2></div>
        <div class="holdings-summary" id="holdingsSummary"></div>
        <div class="panel-body" id="holdingsTable"></div>
        <div class="panel-head"><h2>Lịch sử giao dịch</h2></div>
        <div class="panel-body" id="txTable"></div>
      </div>
    </div>
  </section>
  <footer class="app-footer">
    Dữ liệu giá/tin tức hiện đang ở chế độ <code>mock</code>.
    Xem <code>config.js</code> và thư mục <code>server/</code> để nối API thật.
    Lịch sử giao dịch lưu trong localStorage của trình duyệt.
  </footer>
  <script src="https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js"></script>
  <script src="config.js"></script>
  <script src="mockData.js"></script>
  <script src="dataService.js"></script>
  <script src="portfolio.js"></script>
  <script src="chartModule.js"></script>
  <script src="app.js"></script>
</body>
</html>
```

### config.js
```javascript
const APP_CONFIG = {
  USE_MOCK: true,
  REFRESH_INTERVAL_MS: 15000,
  DEFAULT_WATCHLIST: ["VNM", "FPT", "SSI", "VCB", "HPG", "MWG"],
  priceProvider:        { name: "SSI FCData", baseUrl: "/api/price" },
  fundamentalsProvider: { name: "TCBS",       baseUrl: "/api/fundamentals" },
  newsProvider:         { name: "CafeF RSS",  baseUrl: "/api/news" },
  currency: "VND",
};
if (typeof module !== "undefined") module.exports = APP_CONFIG;
```

### chartModule.js
(Toàn bộ — IIFE, ~230 dòng, xem section bên dưới)

### Để kết nối API thật — chỉ cần 3 thay đổi:

**config.js:**
```javascript
USE_MOCK: false,
priceProvider:        { baseUrl: "https://TEN.onrender.com/api/price" },
fundamentalsProvider: { baseUrl: "https://TEN.onrender.com/api/fundamentals" },
newsProvider:         { baseUrl: "https://TEN.onrender.com/api/news" },
```

**server/.env (KHÔNG đẩy lên GitHub):**
```
SSI_CONSUMER_ID=xxx
SSI_CONSUMER_SECRET=yyy
PORT=3001
```

**Format dữ liệu mà dataService.js chờ đợi từ backend:**
```javascript
// GET /api/price/history?symbol=VNM&days=90
// Trả về mảng:
[{ date: "2026-04-01", open: 67.2, high: 68.5, low: 66.8, close: 68.1, volume: 1240000 }, ...]

// GET /api/price/indices
// Trả về mảng:
[{ code: "VNINDEX", value: 1252.4, changePct: 0.68 }, ...]

// GET /api/fundamentals/VNM
// Trả về object:
{ marketCap, pe, pb, eps, roe, roa, dividendYield, revenueYoY, netProfitYoY, debtToEquity }

// GET /api/news?symbols=VNM,FPT,SSI
// Trả về mảng:
[{ symbol, title, source, time (ISO string), url }, ...]
```

---

## 7. HƯỚNG DẪN TIẾP TỤC TRONG CHAT MỚI

Nếu cần tiếp tục, hãy yêu cầu Claude:

**A. Hoàn thiện server/index.js với SSI thật:**
> "Tôi đã có ConsumerID và ConsumerSecret SSI FastConnect.
>  Hãy viết hoàn chỉnh server/index.js để lấy OHLCV, chỉ số thị trường,
>  chỉ số cơ bản (TCBS), và parse RSS CafeF — đúng format mà dataService.js chờ."

**B. Thêm chỉ báo MACD:**
> "Hãy bổ sung MACD (12,26,9) vào chartModule.js theo khuôn mẫu RSI đã có
>  (chart phụ riêng, đồng bộ trục thời gian, có checkbox bật/tắt trong toolbar)."

**C. Thêm tính năng đồng bộ giao dịch đa thiết bị:**
> "Hãy thay portfolio.js bằng phiên bản gọi API tới backend (Postgres qua Supabase),
>  giữ nguyên chữ ký hàm list/add/remove/computeHoldings."

**D. Cải thiện lọc tin tức theo mã:**
> "Hãy cải thiện route /api/news trong server/index.js để lọc tin CafeF RSS
>  chính xác hơn theo mã chứng khoán, hoặc tích hợp thêm Vietstock RSS."

**E. Thêm alert giá:**
> "Hãy thêm tính năng đặt cảnh báo giá (price alert) — khi giá vượt ngưỡng
>  thì hiện toast notification trong dashboard."
