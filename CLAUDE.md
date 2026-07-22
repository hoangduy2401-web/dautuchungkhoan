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
- `localStorage` keys: `vn_dashboard_transactions_v1` (lịch sử giao dịch),
  `vn_dashboard_watchlist_v1` (watchlist). Lãi/lỗ tính theo **giá vốn bình
  quân gia quyền**.
- `DEFAULT_WATCHLIST` trong `config.js` chỉ là **seed lần đầu**; sau đó
  watchlist đọc/ghi localStorage. Danh sách rỗng được tôn trọng, không tự nạp
  lại seed.
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

## 5b. Hạ tầng & tên miền

| Thành phần | Địa chỉ |
|---|---|
| Dashboard (GitHub Pages) | **https://dashboardstock.io.vn** |
| URL cũ (301 → tên miền mới) | https://hoangduy2401-web.github.io/dautuchungkhoan |
| Backend proxy (Render Free) | https://dashboard-chung-khoan.onrender.com |
| Repo | github.com/hoangduy2401-web/dautuchungkhoan (nhánh `main`) |

- Tên miền `dashboardstock.io.vn` mua tại **Mắt Bão** (nameserver `ns1/ns2.matbao.vn`),
  **phải gia hạn hàng năm** — hết hạn là dashboard chết, GitHub không cảnh báo.
- DNS: A `@` → `185.199.108.153` (GitHub Pages còn 3 IP dự phòng
  `.109/.110/.111.153` nhưng giao diện Mắt Bão chỉ cho 1 bản ghi A — 1 IP là đủ
  chạy, chỉ mất lớp dự phòng); CNAME `www` → `hoangduy2401-web.github.io.`
- File **`CNAME` ở gốc repo là bắt buộc** — xóa là mất tên miền, trang rơi về
  URL cũ. GitHub tự tạo file này khi khai báo custom domain trong Settings →
  Pages, nên đừng commit trùng (đã bị một lần, phải `git reset --hard`).
- HTTPS: chứng chỉ Let's Encrypt do GitHub cấp và tự gia hạn.
- **Secrets sống ở 2 nơi tách biệt**: `server/.env` (chỉ ở máy local, bị
  `.gitignore` chặn) và Environment vars trong Render dashboard. Sửa nơi này
  không ảnh hưởng nơi kia.
- Git: PAT lưu trong macOS osxkeychain, cần cả scope `repo` **và `workflow`**
  (thiếu `workflow` thì mọi push đụng `.github/workflows/` đều bị từ chối).
- **Enforce HTTPS đang bị chặn**: GitHub báo "domain is not properly
  configured" vì tên miền gốc mới chỉ có **1 bản ghi A** (`185.199.108.153`) —
  GitHub đòi đủ 4 IP (`.108/.109/.110/.111.153`). Trang vẫn chạy HTTPS
  (chứng chỉ đã cấp), chỉ là chưa ép được `http://` chuyển sang `https://`.
  Giao diện DNS Mắt Bão có vẻ chỉ cho 1 bản ghi A → nếu đúng vậy thì phải
  chuyển nameserver sang Cloudflare mới thêm đủ được.
- **Cache 10 phút**: GitHub Pages trả `cache-control: max-age=600` cho JS/CSS.
  Đã xử lý bằng cache busting: mọi thẻ `<script>`/`<link>` nội bộ trong
  `index.html` mang `?v=YYYYMMDD`. **Sửa file JS/CSS nào cũng phải bump số
  version này**, nếu không người dùng vẫn chạy code cũ tới 10 phút (đã mất một
  vòng debug vì chuyện đó).

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
- `DailyOhlc` giới hạn **tối đa 30 ngày/lần gọi** (chỉ ghi trong PDF v2.2)
  → phải chia đoạn (`fetchOhlcChunked`), phân trang `PageIndex/PageSize`.
- Token TTL **8 giờ** (không phải 6h như một số nguồn ghi), xác nhận qua
  `/api/debug/token`.
- Giá SSI là VND thô → chia 1000. Giá trị chỉ số thì **không** chia.
- `extractRows()`/`pickField()` vẫn giữ dù format đã rõ: ngắn, không tốn gì,
  và là lớp đệm nếu SSI đổi version.
- **TCBS đã bỏ**: chặn request server-to-server (404) kể cả có header giả trình duyệt.
- SSI **FCData lẫn FCTrading đều không có** fundamentals. FCTrading chỉ có đặt/
  sửa/hủy lệnh + truy vấn tài khoản (orderBook, stockPosition, cashAcctBal...).
- Fundamentals dùng **VNDirect finfo** (public, không cần key, cho gọi
  server-to-server), ghép từ 2 nguồn:
  - `/v4/ratios/latest` — chỉ 8 ratioCode dùng được: `MARKETCAP,
    PRICE_TO_EARNINGS, PRICE_TO_BOOK, DIVIDEND_YIELD, ROAE_TR_AVG5Q (ROE),
    ROAA_TR_AVG5Q (ROA), EPS_TR, BVPS_CR`. Tên kiểu `ROE`, `EPS`,
    `DEBT_EQUITY`, `*_GROWTH` đều trả rỗng.
  - `/v4/financial_statements` — tự tính `revenueYoY`, `netProfitYoY`
    (ANNUAL, năm mới nhất vs năm trước) và `debtToEquity` (QUARTER mới nhất).
- Catalog itemCode nằm ở `/v4/financial_models?q=codeList:<mã>` (trả
  `itemCode` + `itemVnName` + `companyForm`). Code đang dùng:
  `21001` Doanh thu thuần (NON_FINANCE), `421701` Tổng thu nhập hoạt động
  (BANK), `23000` LNST công ty mẹ, `13000` Nợ phải trả, `14000` Vốn CSH.
  **`13000/14000/23000` giống nhau ở mọi companyForm**, chỉ dòng doanh thu khác.
- Render Free tier ngủ sau 15 phút → giữ thức bằng GitHub Actions (xem mục 7).

## 7. Trạng thái hiện tại (cập nhật 22/07/2026)

**Dự án đã hoàn thành và chạy dữ liệu thật end-to-end tại
https://dashboardstock.io.vn** — `USE_MOCK: false`,
`FALLBACK_TO_MOCK_ON_ERROR: true` vẫn bật làm lưới an toàn.

Đã kiểm chứng trên production (Render, 22/07/2026):

| Endpoint | Kết quả |
|---|---|
| `/api/debug/token` | auth SSI OK |
| `/api/price/history` | FPT 30 ngày → 23 nến; 180 ngày → 121 nến, chunking không trùng lặp |
| `/api/price/indices` | VNINDEX 1668.53 (-3.58%), VN30, HNXINDEX, UPCOM |
| `/api/price/quote` | FPT 64.6 (-0.31%), VNM 59.1 (+1.20%) |
| `/api/fundamentals/:symbol` | đủ 10/10 chỉ số — FPT, VCB, HPG, MWG, VNM, SSI |
| `/api/news` | CafeF, lọc mã tiếng Việt đúng |

**Keep-alive**: `.github/workflows/keep-alive.yml` ping `/health` mỗi 10 phút
24/7. Lưu ý GitHub **tự tắt scheduled workflow sau 60 ngày repo không có
commit** → khi đó vào tab Actions bấm *Enable workflow*.

**Watchlist đã lưu localStorage** (22/07/2026): trước đó `state.watchlist` chỉ
nằm trong RAM nên mỗi lần F5 là về lại `DEFAULT_WATCHLIST`. Đã xác nhận chạy
đúng trên Edge sau hard refresh (`typeof saveWatchlist === "function"`).

`REBOOT_SCRIPT.md` đã xóa — mô tả trạng thái tiền-viết-lại (TCBS làm
fundamentals, backend chưa test), dễ khiến phiên sau đi sai hướng.

### Việc cần làm tiếp theo

1. Thêm 3 bản ghi A còn thiếu (hoặc chuyển DNS sang Cloudflare) → bật
   **Enforce HTTPS**
2. Mở dashboard trong giờ giao dịch (9h-15h, T2-T6) để kiểm tra
   ticker/watchlist/chart với dữ liệu động — mọi test tới giờ đều ngoài giờ
   khớp lệnh nên bảng điện đứng yên
3. Bật tự động gia hạn tên miền ở Mắt Bão
4. (Cân nhắc) Gắn `?v=N` vào thẻ script trong `index.html` để khỏi phải hard
   refresh sau mỗi lần deploy

## 8. Ý tưởng dài hạn (chưa yêu cầu cụ thể)

- MACD (12,26,9) theo khuôn mẫu RSI.
- Đồng bộ lịch sử giao dịch đa thiết bị: thay `portfolio.js` bằng bản gọi API
  tới backend có DB (Postgres/Supabase), giữ nguyên chữ ký
  `list/add/remove/computeHoldings`.
- Lọc tin tức chính xác hơn / thêm nguồn Vietstock RSS.
- Alert giá — toast khi vượt ngưỡng.
- **SSI FastConnect Trading** (credentials đã có, chưa dùng) — xem mục 9.

## 9. FastConnect Trading — GĐ1 chỉ đọc (ĐÃ triển khai)

Base URL: `https://fc-tradeapi.ssi.com.vn` (khác hẳn FCData).

**Đã làm — chỉ đọc, không thể đặt lệnh:**

```
POST /api/account/otp        → xin OTP (tài khoản dùng SMS/Email OTP)
POST /api/account/login {code} → tạo phiên bằng PIN/OTP
GET  /api/account/portfolio  → { positions[], cash{}, fetchedAt }
```

- `positions`: `{symbol, qty, sellableQty, avgCost, marketPrice, marketValue,
  unrealizedPL, unrealizedPLPct}` — giá nghìn VND, giá trị triệu VND.
- `cash`: `{cashBal, withdrawable, purchasingPower, debt, totalAssets}` —
  triệu VND.
- Nguồn: `Trading/stockPosition` + `Trading/cashAcctBal`, token TTL 8h.

**Bảo mật (khác hẳn các route giá):**
- Bắt buộc header `x-dashboard-key` khớp `DASHBOARD_API_KEY`, so sánh bằng
  `crypto.timingSafeEqual`. **Không set env = tính năng tắt hoàn toàn (503)**.
- Origin allowlist: chỉ `dashboardstock.io.vn`, `hoangduy2401-web.github.io`,
  localhost. Origin lạ → 403.
- PIN/OTP **không bao giờ** lưu ở frontend; người dùng nhập khi backend trả
  428, mã được chuyển thẳng cho SSI trong một lần login.
- Frontend lưu `DASHBOARD_API_KEY` ở localStorage `vn_dashboard_api_key_v1` —
  đây là khóa của dashboard, KHÔNG phải credential SSI.
- Dữ liệu tài khoản **không bao giờ fallback sang mock** (khác các route giá):
  bảng trống còn hơn số liệu bịa.

**Cạm bẫy FCTrading đã gặp (dữ liệu thật, 22/07/2026):**
- **Trả HTTP 200 kèm lỗi trong body** — outcome thật nằm ở `status` (200 = ok)
  và `message`. Chỉ check `res.ok` là nuốt lỗi im lặng → `assertTradeOk()`.
- **Số tài khoản phải đủ 7 chữ số**: 6 số mã KH + hậu tố `1` (cơ sở) / `8`
  (phái sinh). Thiếu hậu tố → `"Account is not exist."`.
  `normalizeAccount()` tự nối `1` khi thấy 6 số.
- **`marketPrice = 0` ngoài giờ giao dịch** → mọi mã hiện lỗ -100%. Đã fallback
  sang giá đóng cửa gần nhất của FCData qua `fetchQuote()`.
- **`GetOTP` trả "2FA type is invalid" với tài khoản Smart OTP** — endpoint này
  chỉ dành cho SMS/Email OTP. Smart OTP thì lấy mã trong app rồi gọi thẳng
  `AccessToken`.
- Token cache ra `os.tmpdir()/ssi-trade-token.json` (mode 600) để restart không
  phải nhập OTP lại. **Render ngủ dậy = instance mới = mất cache** → tài khoản
  Smart OTP phải nhập lại mỗi lần server cold start. Muốn tự động hoàn toàn thì
  phải chuyển sang xác thực PIN.
- Sai OTP quá 5 lần → SSI khóa tạm dịch vụ. Đừng đoán mò.

**Đã kiểm chứng số liệu**: tổng giá trị cổ phiếu + tiền mặt khớp chính xác
`totalAssets` do SSI trả về.

**GĐ2 — đặt lệnh: CHƯA làm và cố ý chưa làm.** Cần chữ ký RSA-SHA256 bằng
private key PEM; server hiện không giữ private key nào, nên kể cả bị lộ
`DASHBOARD_API_KEY` thì kẻ tấn công cũng chỉ đọc được, không giao dịch được.
Trước khi làm GĐ2 phải có: xác nhận 2 bước trên UI, giới hạn giá trị lệnh,
nút hủy khẩn cấp, và log mọi lệnh.

**Không có môi trường UAT/paper trading** — mọi lệnh test ở GĐ2 sẽ là lệnh
thật, tiền thật. Xin OTP quá 5 lần không xác thực thì SSI khóa tạm dịch vụ.
