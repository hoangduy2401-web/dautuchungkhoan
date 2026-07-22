# CLAUDE.md — Dự án "Bảng Điện" (Dashboard chứng khoán cá nhân)

## 1. Mục tiêu

Dashboard theo dõi chứng khoán Việt Nam cá nhân: web tĩnh (HTML/CSS/JS thuần,
không build tool), host trên GitHub Pages, lấy dữ liệu thật qua backend proxy
Node.js/Express deploy trên Render.com (nguồn chính: SSI FastConnect Data API).

Tính năng: ticker tape chạy liên tục, bảng chỉ số thị trường (VNINDEX, HNX,
VN30...), watchlist tùy biến, biểu đồ nến (Lightweight Charts: MA10/MA20,
Bollinger Bands, khối lượng, RSI14, trendline vẽ tay), chỉ số cơ bản doanh
nghiệp, tin tức theo mã, lịch sử giao dịch cá nhân tính lãi/lỗ (localStorage).

## 2. Quy ước làm việc (BẮT BUỘC)

- Trả lời bằng **tiếng Việt**. Comment trong code bằng **tiếng Anh**.
- Code thẳng, ít giải thích dài dòng — trừ khi task phức tạp/rủi ro.
- KHÔNG hỏi xác nhận trước khi sửa file, kể cả sửa nhiều file cùng lúc.
- CHỈ hỏi xác nhận khi: xóa file/tính năng, hoặc đổi cấu trúc lớn (đổi kiến
  trúc module, đổi thư viện chart, đổi format dữ liệu giữa `dataService.js` ↔
  `app.js` ↔ `server`).
- Sau thay đổi lớn: tự cập nhật mục "Trạng thái hiện tại" + "Việc cần làm
  tiếp theo" trong file này, không cần hỏi. Vá lỗi nhỏ thì không cần.
- **KHÔNG commit `server/.env`** hay bất kỳ credentials nào.

## 3. Ràng buộc kỹ thuật đã chốt (KHÔNG tự ý đổi)

- Không dùng React/Vite/Webpack — chỉ HTML/CSS/JS thuần, script tag.
- Chart: **TradingView Lightweight Charts v4.1.3** qua CDN
  (`https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js`).
  Không quay lại Chart.js.
- Trendline vẽ trên `<canvas id="trendOverlay">` phủ lên chart, neo theo
  time/price để bám đúng vị trí khi pan/zoom.
- RSI ở chart phụ riêng (`#rsiChartContainer`), đồng bộ trục thời gian 2 chiều
  với chart chính qua `subscribeVisibleLogicalRangeChange`. MACD (nếu thêm)
  theo đúng khuôn mẫu này.
- Bollinger Bands (20, 2σ) tắt mặc định, bật qua checkbox; 3 series
  Upper/Basis/Lower màu `#1baf7a`.
- **Đơn vị giá: nghìn đồng VND.** SSI trả đồng → chia 1000 ở backend.
- CORS: mọi API chứng khoán VN chặn gọi thẳng từ trình duyệt → backend proxy là
  bắt buộc, không phải tùy chọn.
- `localStorage` key lịch sử giao dịch: `vn_dashboard_transactions_v1`.
  Lãi/lỗ tính theo **giá vốn bình quân gia quyền**.
- Font: Space Grotesk (display) / Be Vietnam Pro (body) / JetBrains Mono (số).
- Theme tối: nền `#0a0f1c`, amber `#f2a93b`, xanh `#17d980`, đỏ `#ff4d5e`.
- Mọi widget lấy dữ liệu qua `dataService.js` — không `fetch()` thẳng trong
  `app.js`.

## 4. Cấu trúc file

```
dautuchungkhoan/
├── index.html         ← layout chính, thứ tự nạp script quan trọng
├── style.css          ← design tokens tại :root
├── config.js          ← USE_MOCK, FALLBACK_TO_MOCK_ON_ERROR, baseUrl providers
├── mockData.js        ← COMPANY_INFO, generateHistory/Fundamentals/News/Indices
├── dataService.js     ← adapter mock ↔ real API
├── portfolio.js       ← Portfolio.list/add/remove/computeHoldings
├── chartModule.js     ← ChartModule IIFE: init/setData/toggleSeries/trendline
├── app.js             ← state + render cho mọi widget
└── server/
    ├── index.js       ← Express proxy (SSI OHLC, indices, quote, news, debug)
    ├── package.json
    ├── .env.example   ← mẫu; bản thật là .env (KHÔNG commit)
    └── .env           ← SSI_CONSUMER_ID, SSI_CONSUMER_SECRET, PORT
```

Thứ tự nạp script trong `index.html` (đừng đổi):
lightweight-charts → `config.js` → `mockData.js` → `dataService.js` →
`portfolio.js` → `chartModule.js` → `app.js`

> Lưu ý: repo còn `index.js` + `package.json` **ở thư mục gốc** — bản sao của
> server để Render deploy từ root. **Nguồn sự thật là `server/index.js`**; sau
> mỗi lần sửa phải chạy `cp server/index.js index.js` (và `package.json` nếu
> đổi dependency) để giữ đồng bộ.

## 5. Hợp đồng dữ liệu backend (giữ nguyên format)

```
GET /api/price/history?symbol=X&days=N
→ [{ date:"YYYY-MM-DD", open, high, low, close, volume }, ...]  (tăng dần, giá nghìn VND)

GET /api/price/indices
→ [{ code, value, changePct }, ...]

GET /api/price/quote?symbol=X
→ { price, changePct, volume }

GET /api/fundamentals/:symbol
→ { marketCap, pe, pb, eps, roe, roa, dividendYield, revenueYoY, netProfitYoY, debtToEquity }

GET /api/news?symbols=A,B,C
→ [{ symbol, title, source, time (ISO), url }, ...]
```

Endpoint debug (chỉ để dò format SSI, không dùng ở frontend):
```
GET /health
GET /api/debug/token          → kiểm tra auth SSI
GET /api/debug/index-list     → raw IndexList (dò mã VNINDEX thật)
GET /api/debug/raw?path=/api/v2/Market/DailyOhlc&Symbol=FPT&FromDate=01/07/2026&ToDate=22/07/2026
```

Chuyển mock → thật: sửa `config.js` (`USE_MOCK: false` + 3 baseUrl trỏ
`https://dashboard-chung-khoan.onrender.com/api/...`), điền `server/.env`.

## 6. Key learnings (đừng lặp lại sai lầm cũ)

- Regex `\b` **không hoạt động với tiếng Việt** → dùng lookaround Unicode
  `(?<![\p{L}\p{N}])SYM(?![\p{L}\p{N}])` với cờ `u`.

### Format SSI thật (đã xác nhận 22/07/2026 — hết mơ hồ)

- Rows luôn nằm ở `raw.data` (mảng), **PascalCase**, **giá trị là chuỗi** →
  phải `Number()`. Không thấy `dataList` hay lowercase ở đâu.
- `PageSize` **chỉ nhận 10 / 20 / 50 / 100 / 1000** — số khác trả lỗi
  `"Size of a page must 10, 20, 50, 100 or 1000"`.
- `DailyOhlc`: `{Symbol, Market, TradingDate:"dd/mm/yyyy", Time, Open, High,
  Low, Close, Volume, Value}` — trả **giảm dần theo ngày**.
- `DailyIndex`: `{IndexId, IndexName, IndexValue, TradingDate, Change,
  RatioChange, TotalMatchVol, Advances/Declines/Ceilings/Floors, ...}`.
  **`IndexId=ALL` trả `NoDataFound`** → phải gọi từng mã một.
  Dùng `RatioChange` làm `changePct`; **`Change` bị scale sai** (-0.6203 cho
  cú giảm -62.03 điểm) — đừng dùng.
- `IndexList` chỉ trả `{IndexCode, IndexName, Exchange}`, không có giá trị.
  Mã thật: HOSE = `VNINDEX, VN30, VN100, VNMIDCAP, VNSMALLCAP, VNDIAMOND,
  VNFINLEAD, VNX50...`; HNX = `HNXIndex, HNX30, HNXUpcomIndex`.
- Token TTL 8h, xác nhận qua `/api/debug/token`.
- SSI `DailyOhlc` giới hạn **tối đa 30 ngày/lần gọi** (chỉ ghi trong PDF v2.2)
  → phải chia đoạn (`fetchOhlcChunked`). Response phân trang bằng
  `pageIndex/pageSize`.
- Token SSI TTL thực tế **8 giờ** (không phải 6h).
- Casing field response khác nhau giữa nguồn tài liệu (PascalCase trong
  `data` vs lowercase trong `dataList`) → giữ parse phòng thủ
  (`extractRows()`, `pickField()`) đến khi xác nhận format sống.
- Giá SSI là VND thô → chia 1000.
- **TCBS đã bỏ**: chặn request server-to-server (404) kể cả có header giả trình duyệt.
- SSI **FCData lẫn FCTrading đều không có** fundamentals. FCTrading chỉ có đặt/
  sửa/hủy lệnh + truy vấn tài khoản (orderBook, stockPosition, cashAcctBal...).
- Fundamentals dùng **VNDirect finfo** (`api-finfo.vndirect.com.vn/v4/ratios/latest`),
  cho phép gọi server-to-server, không cần key. Chỉ có 8 ratioCode dùng được:
  `MARKETCAP, PRICE_TO_EARNINGS, PRICE_TO_BOOK, DIVIDEND_YIELD, ROAE_TR_AVG5Q
  (ROE), ROAA_TR_AVG5Q (ROA), EPS_TR, BVPS_CR`. Các tên kiểu `ROE`, `EPS`,
  `DEBT_EQUITY`, `*_GROWTH` đều trả rỗng. `revenueYoY/netProfitYoY/debtToEquity`
  hiện trả `null` → UI hiện "—"; muốn có phải map itemCode trong
  `/v4/financial_statements`.
- Render Free tier ngủ sau 15 phút → cần ping định kỳ (UptimeRobot) hoặc nâng gói.

## 7. Trạng thái hiện tại (cập nhật 22/07/2026)

- Frontend: hoàn chỉnh, chạy tốt với mock trên GitHub Pages.
  `USE_MOCK: true` + `FALLBACK_TO_MOCK_ON_ERROR: true`.
- Backend: đã deploy `dashboard-chung-khoan.onrender.com`, `/health` OK
  (nhưng bản đang chạy là code cũ, chưa có chunking/debug).
- **Toàn bộ backend đã chạy với dữ liệu THẬT** (test local 22/07/2026,
  `server/.env` đã có credentials SSI):
  - `/api/debug/token` ✅ auth SSI OK
  - `/api/price/history` ✅ FPT 30 ngày → 23 nến; 180 ngày → 121 nến,
    chunking không trùng lặp, giá nghìn VND, sort tăng dần
  - `/api/price/indices` ✅ VNINDEX 1668.53 (-3.58%), VN30, HNXINDEX, UPCOM
  - `/api/price/quote` ✅ FPT 64.6 (-0.31%)
  - `/api/fundamentals/:symbol` ✅ VNDirect finfo (FPT, VCB)
  - `/api/news` ✅ CafeF, lọc mã tiếng Việt đúng
- **Render đã live với credentials SSI** (env vars set trong dashboard, không
  phải file `.env`): token OK, indices, history 180 ngày, quote đều chạy thật.
- **`USE_MOCK: false`** — GitHub Pages
  (https://hoangduy2401-web.github.io/dautuchungkhoan/) đang chạy dữ liệu thật.
  `FALLBACK_TO_MOCK_ON_ERROR: true` vẫn bật làm lưới an toàn.
- Git: máy đã lưu PAT trong osxkeychain, `git push` chạy thẳng không cần hỏi.

### Việc cần làm tiếp theo (ưu tiên)

1. Ping định kỳ (UptimeRobot, 10 phút/lần vào `/health`) chống Render Free ngủ
   sau 15 phút — lần tải đầu hiện mất ~30-50s nếu server đang ngủ
2. Mở dashboard trong giờ giao dịch để kiểm tra ticker/watchlist/chart với dữ
   liệu thật (mọi test tới giờ đều ngoài giờ khớp lệnh)
3. (Tùy chọn) Lấy `revenueYoY`, `netProfitYoY`, `debtToEquity` từ
   `/v4/financial_statements` của VNDirect — cần map itemCode

## 8. Ý tưởng dài hạn (chưa yêu cầu cụ thể)

- MACD (12,26,9) theo khuôn mẫu RSI.
- Đồng bộ lịch sử giao dịch đa thiết bị: thay `portfolio.js` bằng bản gọi API
  tới backend có DB (Postgres/Supabase), giữ nguyên chữ ký
  `list/add/remove/computeHoldings`.
- Lọc tin tức chính xác hơn / thêm nguồn Vietstock RSS.
- Alert giá — toast khi vượt ngưỡng.
- SSI FastConnect Trading — đặt lệnh (credentials đã có, chưa dùng).
