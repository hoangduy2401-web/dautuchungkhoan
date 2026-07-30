# CLAUDE.md — Dự án "Bảng Điện" (Dashboard chứng khoán cá nhân)

## 1. Mục tiêu

Dashboard chứng khoán Việt Nam cá nhân: web tĩnh (HTML/CSS/JS thuần,
không build tool), host GitHub Pages, lấy dữ liệu thật qua backend proxy
Node.js/Express trên Render.com (nguồn chính: SSI FastConnect Data API).

Tính năng: ticker tape chạy liên tục, bảng chỉ số thị trường (VNINDEX, HNX,
VN30...), watchlist tùy biến, biểu đồ nến (Lightweight Charts: MA10/MA20,
Bollinger Bands, khối lượng, RSI14, trendline vẽ tay), chỉ số cơ bản doanh
nghiệp, tin tức theo mã, lịch sử giao dịch cá nhân tính lãi/lỗ (localStorage).

## 2. Quy ước làm việc (BẮT BUỘC)

- Trả lời bằng **tiếng Việt**. Comment trong code bằng **tiếng Anh**.
- Code thẳng, ít giải thích dài dòng — trừ task phức tạp/rủi ro.
- KHÔNG hỏi xác nhận trước khi sửa file, kể cả nhiều file cùng lúc.
- CHỈ hỏi xác nhận khi: xóa file/tính năng, hoặc đổi cấu trúc lớn (đổi kiến
  trúc module, đổi thư viện chart, đổi format dữ liệu giữa `dataService.js` ↔
  `app.js` ↔ `server`).
- Sau thay đổi lớn: tự cập nhật "Trạng thái hiện tại" + "Việc cần làm
  tiếp theo" trong file này, không cần hỏi. Vá lỗi nhỏ: khỏi cần.
- **KHÔNG commit `server/.env`** hay credentials nào.

## 3. Ràng buộc kỹ thuật đã chốt (KHÔNG tự ý đổi)

- Không dùng React/Vite/Webpack — chỉ HTML/CSS/JS thuần, script tag.
- Chart: **TradingView Lightweight Charts v4.1.3** qua CDN
  (`https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js`).
  Không quay lại Chart.js.
- Trendline vẽ trên `<canvas id="trendOverlay">` phủ lên chart, neo theo
  time/price, bám đúng vị trí khi pan/zoom.
- RSI ở chart phụ riêng (`#rsiChartContainer`), đồng bộ trục thời gian 2 chiều
  với chart chính qua `subscribeVisibleLogicalRangeChange`. MACD (nếu thêm)
  theo đúng khuôn mẫu này.
- Bollinger Bands (20, 2σ) tắt mặc định, bật qua checkbox; 3 series
  Upper/Basis/Lower màu `#1baf7a`.
- **Đơn vị giá: nghìn đồng VND.** SSI trả đồng → chia 1000 ở backend.
- CORS: API chứng khoán VN chặn gọi thẳng từ trình duyệt → backend proxy
  bắt buộc, không tùy chọn.
- `localStorage` keys: `vn_dashboard_transactions_v1` (lịch sử giao dịch),
  `vn_dashboard_watchlist_v1` (watchlist). Lãi/lỗ tính theo **giá vốn bình
  quân gia quyền**.
- `DEFAULT_WATCHLIST` trong `config.js` chỉ seed lần đầu; sau đó watchlist
  đọc/ghi localStorage. Danh sách rỗng: tôn trọng, không tự nạp lại seed.
- Font: Space Grotesk (display) / Be Vietnam Pro (body) / JetBrains Mono (số).
- Theme tối: nền `#0a0f1c`, amber `#f2a93b`, xanh `#17d980`, đỏ `#ff4d5e`.
- Mọi widget lấy dữ liệu qua `dataService.js` — không `fetch()` thẳng trong
  `app.js`.

## 4. Cấu trúc file

Thứ tự nạp script trong `index.html` (đừng đổi):
lightweight-charts → `config.js` → `mockData.js` → `dataService.js` →
`portfolio.js` → `signals.js` → `chartModule.js` → `app.js`

> Lưu ý: repo còn `index.js` + `package.json` ở thư mục gốc — bản sao server
> để Render deploy từ root. Nguồn sự thật: `server/index.js`; sửa xong phải
> chạy `cp server/index.js index.js` (và `package.json` nếu đổi dependency)
> để đồng bộ.

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

Endpoint debug (chỉ dò format SSI, không dùng ở frontend):
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
  **phải gia hạn hàng năm** — hết hạn: dashboard chết, GitHub không cảnh báo.
- DNS: A `@` → `185.199.108.153` (GitHub Pages còn 3 IP dự phòng
  `.109/.110/.111.153` nhưng Mắt Bão chỉ cho 1 bản ghi A — 1 IP đủ chạy, chỉ
  mất lớp dự phòng); CNAME `www` → `hoangduy2401-web.github.io.`
- File **`CNAME` ở gốc repo bắt buộc** — xóa: mất tên miền, trang rơi về URL
  cũ. GitHub tự tạo file này khi khai báo custom domain (Settings → Pages),
  đừng commit trùng (bị 1 lần, phải `git reset --hard`).
- HTTPS: chứng chỉ Let's Encrypt do GitHub cấp và tự gia hạn.
- **Secrets sống 2 nơi tách biệt**: `server/.env` (local only, `.gitignore`
  chặn) và Environment vars ở Render dashboard. Sửa nơi này không ảnh hưởng
  nơi kia.
- Git: PAT lưu macOS osxkeychain, cần scope `repo` **và `workflow`**
  (thiếu `workflow`: push đụng `.github/workflows/` bị từ chối).
- **Enforce HTTPS bị chặn**: GitHub báo "domain is not properly
  configured" vì tên miền gốc chỉ có **1 bản ghi A** (`185.199.108.153`) —
  GitHub đòi đủ 4 IP (`.108/.109/.110/.111.153`). Trang vẫn chạy HTTPS
  (chứng chỉ đã cấp), chỉ chưa ép được `http://` → `https://`.
  Mắt Bão có vẻ chỉ cho 1 bản ghi A → nếu đúng, phải chuyển nameserver sang
  Cloudflare mới thêm đủ.
- **Cache 10 phút**: GitHub Pages trả `cache-control: max-age=600` cho JS/CSS.
  Xử lý bằng cache busting: thẻ `<script>`/`<link>` nội bộ trong `index.html`
  mang `?v=YYYYMMDD`. **Sửa JS/CSS nào cũng phải bump version này**, không thì
  user chạy code cũ tới 10 phút (từng mất 1 vòng debug vì vậy).

## 6. Key learnings (đừng lặp lại sai lầm cũ)

- Regex `\b` **không hoạt động với tiếng Việt** → dùng lookaround Unicode
  `(?<![\p{L}\p{N}])SYM(?![\p{L}\p{N}])` với cờ `u`.

### Format SSI thật (đã xác nhận 22/07/2026 — hết mơ hồ)

- Rows luôn ở `raw.data` (mảng), **PascalCase**, giá trị là chuỗi →
  phải `Number()`. Không thấy `dataList` hay lowercase đâu.
- `PageSize` **chỉ nhận 10 / 20 / 50 / 100 / 1000** — số khác trả lỗi
  `"Size of a page must 10, 20, 50, 100 or 1000"`.
- `DailyOhlc`: `{Symbol, Market, TradingDate:"dd/mm/yyyy", Time, Open, High,
  Low, Close, Volume, Value}` — trả **giảm dần theo ngày**.
- `DailyIndex`: `{IndexId, IndexName, IndexValue, TradingDate, Change,
  RatioChange, TotalMatchVol, Advances/Declines/Ceilings/Floors, ...}`.
  **`IndexId=ALL` trả `NoDataFound`** → phải gọi từng mã một.
  Dùng `RatioChange` làm `changePct`; **`Change` bị scale sai** (-0.6203 cho
  cú giảm -62.03 điểm) — đừng dùng.
  - **QUAN TRỌNG — intraday `IndexValue=0` (fix 24/07/2026):** trong phiên
    (`TradingSession` = `LO`/`ATO`) SSI trả row hôm nay với `IndexValue="0"`
    nhưng `RatioChange` LÀ SỐ LIVE. Giá trị điểm thật chỉ có sau đóng cửa
    (`TradingSession="C"`). → `computeIndices` tái tạo giá trị intraday =
    **đóng cửa hôm qua × (1 + RatioChange/100)** (RatioChange là % so đóng cửa
    phiên trước, đã verify 30.85/1668.53=1.85%). Sau đóng cửa dùng thẳng
    `IndexValue`. **Đừng chỉ lấy "row mới nhất có value>0"** — trong phiên nó
    trả số đóng cửa hôm qua, đứng im, trông như "không cập nhật".
- `DailyStockPrice` (đã dùng ở `computeQuote`) trả **cả khối ngoại trong cùng
  row**: `ForeignBuyValTotal`, `ForeignSellValTotal` (VND), `ForeignBuyVolTotal`,
  `ForeignSellVolTotal`, `ForeignCurrentRoom`, `NetBuySellVal/Vol`. Mua ròng ngoại
  = `ForeignBuyValTotal − ForeignSellValTotal` (verify VNM 24/07: 73.93 − 50.36 =
  +23,57 tỷ, khớp `NetBuySellVal`). → tab Khối ngoại **0 call SSI thêm**, chỉ nhét
  `netForeignVal` (tỷ) vào payload quote.
- `IndexList` chỉ trả `{IndexCode, IndexName, Exchange}`, không có giá trị.
  Mã thật: HOSE = `VNINDEX, VN30, VN100, VNMIDCAP, VNSMALLCAP, VNDIAMOND,
  VNFINLEAD, VNX50...`; HNX = `HNXIndex, HNX30, HNXUpcomIndex`.
- `DailyOhlc` giới hạn **tối đa 30 ngày/lần gọi** (chỉ ghi trong PDF v2.2)
  → phải chia đoạn (`fetchOhlcChunked`), phân trang `PageIndex/PageSize`.
- Token TTL **8 giờ** (không phải 6h như một số nguồn ghi), xác nhận qua
  `/api/debug/token`.
- Giá SSI là VND thô → chia 1000. Giá trị chỉ số thì **không** chia.
- `extractRows()`/`pickField()` giữ dù format đã rõ: ngắn, rẻ, lớp đệm
  phòng SSI đổi version.
- **TCBS đã bỏ**: chặn request server-to-server (404) kể cả có header giả trình duyệt.
- SSI **FCData lẫn FCTrading đều không có** fundamentals. FCTrading chỉ đặt/
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

### Tín hiệu FiinTrade — 5 chỗ CỐ Ý làm khác tài liệu (user chốt 25/07/2026)

Nằm trong `signals.js`. **Đừng "sửa lại cho đúng tài liệu"** — cả 5 đều đã cân
nhắc và user duyệt từng cái:

1. **ROC(9) dùng ngưỡng 0**, không phải 30/70. Tài liệu chép nhầm từ dòng RSI
   ngay trên: ROC không bị chặn 0–100, nó dao động quanh 0. Để 30 thì gần như
   không mã nào ra tín hiệu.
2. **RSI cắt 30/70 có cửa sổ 3 phiên** (chỉnh được ở UI). Đúng nghĩa đen thì tín
   hiệu chỉ sống 1 phiên, cả bảng luôn Trung tính. Hệ quả nhìn thấy được: một mã
   RSI 26,9 vẫn có thể gắn nhãn "Tăng" vì nó vừa cắt lên 30 rồi tụt lại.
3. **Không có khối lượng ước lượng trong phiên.** FiinTrade quy đổi KL hiện tại
   ra cả phiên (`KL × tổng giờ / giờ đã trôi`). `DailyStockPrice` chỉ có snapshot
   cuối ngày → mọi so sánh KL dùng phiên gần nhất ĐÃ đóng cửa. Muốn bản trong
   phiên phải chuyển sang FastConnect Streaming (xem mục 8, Tier 4).
4. **"Thủng đáy" dùng `giá < đáy`.** Tài liệu viết `giá > đáy` — mâu thuẫn với
   chính định nghĩa của nó ở đoạn trên ("xuống dưới đáy").
5. **Đỉnh/đáy so theo GIÁ ĐÓNG CỬA**, không phải giá cao/thấp nhất trong phiên.
   Đo thật trên VN30 khung 1 tháng (bỏ lọc KL): theo đóng cửa ra 10 mã thủng
   đáy, theo giá thấp nhất phiên chỉ ra 1 mã.

Hai ràng buộc kiến trúc đi kèm, đừng phá:
- **Cửa sổ tính tín hiệu cố định `SIG_DAYS = 180`, KHÔNG dùng `state.range`.**
  RSI(14)/CMF(20) cho số khác nhau ở 1M vs 6M — cùng một mã cùng một ngày mà ra
  2 badge khác nhau thì user mất niềm tin vào cả tính năng.
- **Quét cả rổ KHÔNG nằm trong `refreshAll()`.** Vòng 45s nạp lại 30–50 mã sẽ
  dựng lại đúng vòng xoáy throttle đã sửa hôm 23/07. Fetch phải lazy + do user
  bấm nút, tuần tự (limiter concurrency=1), cache theo phiên trong `state.sigBars`.
- Badge của mã đang chọn gọi **sau** khi chart có dữ liệu và không `await` —
  đặt trước sẽ chen hàng ở limiter và làm chậm đúng thứ user đang nhìn.

### Lightweight Charts — 4 cạm bẫy (phát hiện 25/07/2026)

- **Đừng `fitContent()` rồi mới đổi width.** Bar spacing tính theo width tại lúc
  fit; đổi width sau đó để nến dồn sát mép phải, chừa khoảng trắng bên trái.
  → `resize()` trước, `fitContent()` sau; và fit lại trong mỗi `resize()`.
- **Callback `subscribeVisibleLogicalRangeChange` chạy BẤT ĐỒNG BỘ.** Cờ
  `syncing = true/false` bao quanh lời gọi `setVisibleLogicalRange` là vô dụng
  (cờ đã reset trước khi pane kia trả lời) → 2 pane ghi đè lẫn nhau, **trục thời
  gian khóa cứng**: `fitContent`, `setVisibleLogicalRange`, zoom, pan đều không
  ăn. Sửa: chỉ ghi khi range 2 bên thực sự khác (`sameRange` sai số 0.005).
- **Canvas overlay `pointer-events: auto` cố định nuốt hết chuột** → chart không
  zoom/pan được. Chỉ bật `auto` khi đang bật công cụ vẽ/đo, còn lại `none`.
- **Chart tạo lúc container width = 0** (tab nền, panel chưa layout) hỏng vĩnh
  viễn — `applyOptions({width})` sau đó không cứu được. Luôn cho width fallback
  (`clientWidth || 600`).
- Đo số nến chính xác: dùng `timeScale().coordinateToLogical(x)` (làm tròn +
  clamp vào `[0, bars.length-1]`) thay vì `coordinateToTime`, rồi neo lại bằng
  `logicalToCoordinate(index)` để bám nến khi pan/zoom.

### Lần tải đầu chậm + số sai (fix 30/07/2026)

Triệu chứng: mở trang lần đầu chờ rất lâu, khi hiện ra thì mọi chỉ số đều sai,
phải F5 thêm lần nữa mới đúng.

**Nguyên nhân 1 — keep-alive GitHub Actions KHÔNG chạy đúng nhịp.** Cron khai
báo `*/10 * * * *` nhưng lịch chạy thật (GitHub API, 12 lần liên tiếp): 13:01 ·
11:22 · 09:16 · 06:39 · 04:10 · 00:59 · 23:37 · 22:33 · 21:30 · 20:34 · 19:38 ·
18:02 — khoảng cách **56–191 phút, không lần nào ≤15 phút**. GitHub bóp cron trên
runner free rất nặng. Render Free ngủ sau 15 phút → backend thực tế ngủ gần như
suốt. Lần tải đầu = cold start 30–60s. **Đừng tin cron GitHub để giữ service
thức** — phải dùng pinger ngoài (cron-job.org / UptimeRobot) mỗi 5 phút.

**Nguyên nhân 2 — mock fallback im lặng biến cold start thành số bịa.** Mọi call
abort ở `T_FAST=6000` → `withFallback` trả `generateQuote()`/`generateIndices()`.
Badge `mockBadge` chỉ hiện khi `USE_MOCK: true`, fallback thì không báo gì → user
nhìn số ngẫu nhiên tưởng là giá thật.

Đã sửa (frontend-only):
- `dataService.js` `wakeBackend(budgetMs)`: probe `/health` (timeout 25s, retry
  mỗi 2s, tổng 90s) **trước** khi nạp dữ liệu; cache "đang thức" 60s để vòng
  refresh 45s không probe lại. `markAsleep()` để huỷ cache đó khi call lỗi.
- `livePrice()` thay `withFallback()` cho **indices / quote / history** — KHÔNG
  fallback mock nữa, lỗi thì reject. `FALLBACK_TO_MOCK_ON_ERROR` giờ chỉ còn áp
  cho fundamentals + news. **Đừng gắn lại mock cho giá**: một giá bịa trên màn
  hình không thể phân biệt với giá thật.
- `T_FAST` 6s → **10s**. Đo thật: 30 quote song song cache ấm 0,14–0,25s mỗi cái;
  15 quote cache rỗng song song tối đa 1,9s. 6s không đủ biên an toàn.
- `app.js`: `bootData()` (probe + đếm giây + `#backendStatus`) chạy thay
  `refreshAll()` lúc `DOMContentLoaded`; `refreshCycle()` bọc vòng 45s để probe
  lại nếu instance ngủ tiếp. Ô thiếu quote hiện `—`, **không phải `0,00`**.
- Guard bắt buộc vì giá giờ reject được: `loadSelectedSymbol` (quote + history),
  form thêm mã (`.catch`), `loadIndices` (empty state).

**Không phải nguyên nhân — đừng sửa lại:** limiter concurrency=1 và 30 request
song song từ browser. Đã đo trực tiếp trên backend live, cả hai đều nhanh. Gộp
30 quote thành endpoint batch là tối ưu vô ích.

### Hiệu năng — SSI throttle & kiến trúc cache (fix 23/07/2026)

Triệu chứng: dashboard load >5 phút. Đo trực tiếp backend live:

- **SSI bóp băng thông theo cả đồng thời lẫn tần suất.** 6 quote gọi song song →
  3 xong nhanh (~4s), **3 kẹt 32–33s**. Gọi tuần tự & thưa: chỉ ~1–2s/call,
  ổn định. Nện dồn dập (warm-up 40s/lần) cũng làm mọi call phình 10–30s.
- `fetch()` (Node/undici) **không timeout mặc định** → 1 call SSI kẹt = treo
  cả request. Đã bọc `fetchWithTimeout` (AbortController): SSI 18s, VNDirect/RSS 8s.
  Frontend `dataService.fetchJson` timeout riêng 12s.
- Frontend cũ `setInterval(refreshAll, 15s)` **không chặn chồng lấn** → vòng
  mới đè vòng cũ đang kẹt → nhân đôi call song song → vòng xoáy tự bóp nghẹt
  (thủ phạm chính của "5 phút"). Đã đổi sang vòng lặp tự lên lịch
  (`scheduleRefreshLoop`) + cờ `refreshInFlight`, chu kỳ 15s→45s.
- Backend: mọi call SSI qua **limiter concurrency=1** (`ssiLimit`, env
  `SSI_CONCURRENCY`) để né throttle đồng thời — mỗi call về lại ~1–2s.
- Backend cache đổi sang **stale-while-revalidate + dedup** (`withCache`): entry
  còn hạn → trả luôn; hết hạn nhưng trong `staleMs` (10 phút) → **trả bản cũ ngay
  + làm mới nền**; chỉ lần đầu tuyệt đối phải chờ. → user gần như không bao giờ
  chờ SSI. TTL quote/indices 45s.
- **Warm-up cache nền 5 phút/lần** (`warmCache`, env `WARM_INTERVAL_MS`,
  `DISABLE_WARM=1` để tắt) dùng `revalidate` (không xoá cache, user vẫn dùng
  bản cũ khi làm mới). **Đừng để interval ngắn** (từng thử 40s) — nện SSI dày
  làm throttle theo tần suất, phản tác dụng.
- Kết quả: cold load ~15s (tuần tự, tất cả OK), load lại cache ấm ~0.002s.
- Mỗi endpoint tách `computeX()` (thuần logic) khỏi route (`withCache` + trả JSON)
  để warm-up gọi lại được logic mà không qua HTTP.

## 7. Trạng thái hiện tại (cập nhật 24/07/2026)

**Dự án hoàn thành, chạy dữ liệu thật end-to-end tại
https://dashboardstock.io.vn** — `USE_MOCK: false`,
`FALLBACK_TO_MOCK_ON_ERROR: true` vẫn bật làm lưới an toàn.
Cache busting hiện `?v=20260730a` (bump mỗi lần sửa JS/CSS).

**Phiên 30/07/2026 — fix lần tải đầu chậm + số sai (frontend-only):** probe
`/health` trước khi nạp dữ liệu, bỏ mock fallback cho giá/chỉ số/history, badge
`#backendStatus`. Chi tiết + số đo trong mục 6. **Việc còn lại của user: dựng
pinger ngoài mỗi 5 phút** — cron GitHub không đủ tin cậy (đo được gap 191 phút).

**Thêm phiên 25/07/2026 (frontend-only):**
- **Thước đo trên chart** (nút "Đo"): 2 click → số nến + % biến động + khoảng
  ngày, neo theo index nến. Loại trừ nhau với "Vẽ trendline"; "Xóa" xóa cả hai.
- **Card accordion "Tài khoản SSI · Giao dịch · Lịch sử"**: gộp 3 khối cuối
  trang, mặc định thu gọn, "Xem thêm" xổ 3 tab; trạng thái lưu localStorage
  (`vn_dashboard_account_more_v1`, `vn_dashboard_account_tab_v1`).
- `ChartModule.setData(history, "SYM|range")` — refresh 45s cùng dataset không
  xóa nét vẽ nữa.
- 4 lỗi chart có sẵn đã sửa — xem "Lightweight Charts — 4 cạm bẫy" ở mục 6.
- Bollinger 3 đường và 2 biên RSI 70/30 dày 1px → **2px** (biên RSI đổi màu
  `rgba(90,102,125,0.85)` cho rõ hơn).

**Thêm phiên 26/07/2026 — Tín hiệu FiinTrade Tier 1 (frontend-only):**
- `signals.js` (mới): `sma/rsi/cmf/roc`, `compute` (ma trận 3×3), `streaks`,
  `volRatio/extremes/periodReturn/avgVolume`, `toWeekly`. Dùng chung cho badge
  và tab quét rổ. **5 sai lệch cố ý so với tài liệu — xem mục 6.**
- **Badge tín hiệu** cạnh tên mã trong panel chart (`#symbolSignal`).
- **Tab "Tín hiệu"** (thứ 5) trong card thị trường, 3 tab con: Tổng hợp (bảng 9
  cột, đổi khung ngày/tuần, chỉnh cửa sổ RSI) / Giá–KL / Chiến lược. Click mã
  bất kỳ → `selectSymbol()` nhảy sang chart mã đó.
- `config.js` thêm rổ **`HOSE_LIQUID`** — 49 mã HOSE có KL trung bình 5 phiên
  ≥3 triệu (27 mã ngoài VN30). Danh sách TĨNH, cách dựng lại ghi trong comment.
- `style.css`: token `--up-strong`/`--down-strong`/`--on-strong` cho **cả 2
  theme** (5 mức tín hiệu phải phân biệt được ở Sáng lẫn Tối); bảng 9 cột cuộn
  ngang trong `.sig-table-wrap` ở ≤640px (KHÔNG stack như bảng tài khoản — các
  cột đều là số, đọc theo hàng).
- Backend không đụng. Đã đo: vòng refresh 45s vẫn chỉ 1 call history như trước.
- Bollinger 3 đường và 2 biên RSI 70/30 dày 1px → **2px** (biên RSI đổi màu
  `rgba(90,102,125,0.85)` cho rõ hơn).

**Tính năng thêm phiên 24/07/2026:**
- **Ticker tape chạy rổ VN30** (30 mã, tách khỏi watchlist). Config `APP_CONFIG.VN30`;
  `renderTickerTape` lặp VN30; `loadTapeQuotes` fetch VN30 ∪ watchlist (dedup).
  Backend `WARM_SYMBOLS` = cả 30 mã → tape phục vụ từ cache. Tốc độ cuộn CSS
  `scroll-left` 90s (chỉnh ở đây nếu muốn nhanh/chậm).
- **Bản đồ nhiệt VN30** (`renderHeatmap`, section dưới index-strip): 30 ô màu
  xanh/đỏ theo %, đậm theo biên độ (clamp ±3%), sort tăng→giảm, click ô = load
  chart. Dùng lại quote đã warm, 0 call thêm. **Chưa** làm sizing theo vốn hóa
  (hoãn — cần 30 call fundamentals, gộp khi làm dòng tiền).
- **Chart thêm khung 1Y + 5Y** (`renderRangeTabs`: 30/90/180/365/1825 ngày).
  Timeout history frontend co giãn (1Y 30s, 5Y 75s). Backend history TTL co giãn
  (30 phút cho khung >270 ngày) để 1Y/5Y không refresh nền hàng loạt call SSI.
- **Tài khoản SSI mobile**: bảng 7 cột stack thành thẻ label:value ở ≤640px
  (mỗi `<td>` có `data-label`), bảng giao dịch tay scroll ngang.
- **Watchlist kéo thả**: burger ☰ mỗi mã + pointer-drag reorder (chuột+cảm ứng),
  lưu localStorage. CSS dùng `:first-of-type` cho khối tên (không phải
  `:first-child` — handle span chiếm mất).

**Fix quan trọng phiên 24/07/2026:**
- **Index intraday** (xem mục 6): VNINDEX/VN30 từng hiện đóng cửa hôm qua đứng im
  trong phiên. Đã tái tạo giá trị live từ đóng cửa hôm qua × RatioChange.
- **Rà soát code**: escape regex mã trong news (né 502), escape XSS tin tức +
  chặn `javascript:` URL, timeout cho trade call FCTrading.

**Keep-alive**: `.github/workflows/keep-alive.yml` ping `/health` mỗi 10 phút
24/7. Lưu ý: GitHub **tự tắt scheduled workflow sau 60 ngày repo không có
commit** → vào tab Actions bấm *Enable workflow*.

### Việc cần làm tiếp theo

1. **Tính năng #3 — Theo dõi dòng tiền** (user đã chọn, chưa làm): phát hiện
   đột biến khối lượng/giá trị giao dịch (spike vs trung bình 20 phiên). Sẽ đụng
   `server/index.js` (endpoint mới, `cp` sang root). Gộp luôn: sizing heatmap
   theo vốn hóa (cần marketcap VN30 — thêm endpoint warmed 1 call thay 30) và
   nhóm "giá – khối lượng" của FiinTrade (xem `HANDOFF.md` mục 5) — cùng bản chất.
2. (Cải tiến) Portfolio thủ công: mã ngoài watchlist+VN30 dùng giá vốn làm giá
   hiện tại (P&L=0) vì `state.quotes` không có — fetch thêm quote nếu muốn P&L live.
3. Thêm 3 bản ghi A còn thiếu (hoặc chuyển DNS sang Cloudflare) → bật
   **Enforce HTTPS**
4. Bật tự động gia hạn tên miền ở Mắt Bão

## 8. Ý tưởng dài hạn (chưa yêu cầu cụ thể)

- **Chỉ báo theo phương pháp luận FiinTrade** — khảo sát 25/07/2026, phân 4 tầng
  khả thi trong `HANDOFF.md` mục 5. **Tier 1 ĐÃ LÀM XONG 26/07** (xem mục 7).
  Còn lại:
  - Momentum Score (A–F) đủ dữ liệu — dùng lại `netForeignVal` trong quote.
  - Value/Growth Score cần mở rộng `financial_statements`; Growth thiếu hẳn
    "kế hoạch lợi nhuận ĐHCĐ" (không có nguồn).
  - **Nhóm "tín hiệu nhiễu" (mua trần–bán sàn, hủy lệnh, đè/đẩy giá, BU/SD,
    chốt phiên) KHÔNG làm được** — cần order book cấp 2 real-time qua
    FastConnect Streaming (WebSocket, gói đăng ký khác). Đừng thử lại bằng
    `DailyStockPrice`: endpoint đó chỉ có snapshot cuối ngày.
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
- PIN/OTP **không bao giờ** lưu ở frontend; user nhập khi backend trả
  428, mã chuyển thẳng cho SSI trong một lần login.
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
- Token cache ra `os.tmpdir()/ssi-trade-token.json` (mode 600) để restart
  khỏi nhập lại OTP. **Render ngủ dậy = instance mới = mất cache** → tài khoản
  Smart OTP phải nhập lại mỗi lần server cold start. Muốn tự động hoàn toàn:
  phải chuyển sang xác thực PIN.
- Sai OTP quá 5 lần → SSI khóa tạm dịch vụ. Đừng đoán mò.

**Đã kiểm chứng số liệu**: tổng giá trị cổ phiếu + tiền mặt khớp chính xác
`totalAssets` do SSI trả về.

**GĐ2 — đặt lệnh: CHƯA làm, cố ý chưa làm.** Cần chữ ký RSA-SHA256 bằng
private key PEM; server không giữ private key nào, nên lộ `DASHBOARD_API_KEY`
kẻ tấn công cũng chỉ đọc được, không giao dịch được. Trước GĐ2 phải có: xác
nhận 2 bước trên UI, giới hạn giá trị lệnh, nút hủy khẩn cấp, log mọi lệnh.

**Không có môi trường UAT/paper trading** — lệnh test ở GĐ2 đều là lệnh
thật, tiền thật. Xin OTP quá 5 lần không xác thực → SSI khóa tạm dịch vụ.