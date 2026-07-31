# CLAUDE.md — Dự án "Bảng Điện" (Dashboard chứng khoán cá nhân)

> File duy nhất. Gộp `CLAUDE.md` + `HANDOFF.md` ngày 30/07/2026 — trước đó hai
> file trùng nhau ~50%, phải cập nhật tay cả hai mỗi phiên.
> Cuối phiên chạy **`/handoff`** để tự cập nhật mục 9 + 10.
>
> Dự án này sắp thành **một trang con** của website quản lý gia sản đa kênh —
> quy hoạch ở `docs/QUYHOACH.md`. Khi GĐ 0 bắt đầu, mục 1-8 của file này chuyển
> sang `docs/CHUNGKHOAN.md`, còn `CLAUDE.md` gốc thu về phần dùng chung cả site.

---

## 0. Truy cập nhanh

| Thành phần | Địa chỉ |
|---|---|
| Dashboard (live) | **https://dashboardstock.io.vn** |
| URL cũ (301 → tên miền mới) | https://hoangduy2401-web.github.io/dautuchungkhoan |
| Mock Liquid Glass (bản gốc) | https://dashboardstock.io.vn/mock-liquid-glass.html |
| Backend proxy (Render Free) | https://dashboard-chung-khoan.onrender.com |
| Repo | github.com/hoangduy2401-web/dautuchungkhoan (nhánh `main`) |
| Repo local | /Users/duyhoang/Claude/dautuchungkhoan |

Cache busting hiện **`?v=20260730a`**.

---

## 1. Mục tiêu

Dashboard chứng khoán Việt Nam cá nhân: web tĩnh (HTML/CSS/JS thuần, không build
tool), host GitHub Pages, lấy dữ liệu thật qua backend proxy Node.js/Express trên
Render.com (nguồn chính: SSI FastConnect Data API).

Tính năng: ticker tape chạy liên tục, bảng chỉ số thị trường (VNINDEX, HNX,
VN30...), watchlist tùy biến, biểu đồ nến (Lightweight Charts: MA10/MA20,
Bollinger Bands, khối lượng, RSI14, trendline + thước đo vẽ tay), bản đồ nhiệt
VN30, tín hiệu kỹ thuật FiinTrade, chỉ số cơ bản doanh nghiệp, tin tức theo mã,
danh mục SSI thật (chỉ đọc), lịch sử giao dịch cá nhân tính lãi/lỗ.

---

## 2. Quy ước làm việc (BẮT BUỘC)

- Trả lời bằng **tiếng Việt**. Comment trong code bằng **tiếng Anh**.
- Code thẳng, ít giải thích dài dòng — trừ task phức tạp/rủi ro.
- KHÔNG hỏi xác nhận trước khi sửa file, kể cả nhiều file cùng lúc.
- CHỈ hỏi xác nhận khi: xóa file/tính năng, hoặc đổi cấu trúc lớn (đổi kiến trúc
  module, đổi thư viện chart, đổi format dữ liệu giữa `dataService.js` ↔ `app.js`
  ↔ `server`).
- **Sửa JS/CSS xong PHẢI bump `?v=YYYYMMDD<chữ>`** trong `index.html`, không thì
  user chạy code cũ tới 10 phút do cache GitHub Pages (đã mất 1 vòng debug vì vậy).
- **Server chỉ có một bản duy nhất: `server/index.js`.** Sửa xong là xong, KHÔNG
  copy đi đâu cả. (Luật `cp server/index.js index.js` cũ đã bị xoá 31/07 — xem mục 4.)
- **KHÔNG commit `server/.env`** hay credentials nào. `.gitignore` đã chặn.
- Cuối phiên: chạy **`/handoff`** để cập nhật mục 9 + 10. Vá lỗi nhỏ thì khỏi.

---

## 3. Ràng buộc kỹ thuật đã chốt (KHÔNG tự ý đổi)

- Không dùng React/Vite/Webpack — chỉ HTML/CSS/JS thuần, script tag.
- Chart: **TradingView Lightweight Charts v4.1.3** qua CDN
  (`https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js`).
  Không quay lại Chart.js.
- Trendline + thước đo vẽ trên `<canvas id="trendOverlay">` phủ lên chart, neo
  theo chỉ số nến, bám đúng vị trí khi pan/zoom.
- RSI ở chart phụ riêng (`#rsiChartContainer`), đồng bộ trục thời gian 2 chiều
  với chart chính qua `subscribeVisibleLogicalRangeChange`. MACD (nếu thêm) theo
  đúng khuôn mẫu này.
- Bollinger Bands (20, 2σ) tắt mặc định, bật qua checkbox; 3 series
  Upper/Basis/Lower màu `#1baf7a`, dày 2px.
- **Đơn vị giá: nghìn đồng VND.** SSI trả đồng → chia 1000 ở backend.
- CORS: API chứng khoán VN chặn gọi thẳng từ trình duyệt → backend proxy bắt
  buộc, không tùy chọn.
- `localStorage` keys: `vn_dashboard_transactions_v1` (lịch sử giao dịch),
  `vn_dashboard_watchlist_v1` (watchlist), `vn_dashboard_api_key_v1` (khoá
  dashboard), `vn_dashboard_account_more_v1` + `vn_dashboard_account_tab_v1`
  (trạng thái accordion). Lãi/lỗ tính theo **giá vốn bình quân gia quyền**.
- `DEFAULT_WATCHLIST` trong `config.js` chỉ seed lần đầu; sau đó watchlist
  đọc/ghi localStorage. Danh sách rỗng: tôn trọng, không tự nạp lại seed.
- Font Inter. Theme Sáng/Tối (`[data-theme]`) + slider Trong/Đục (`--glass-a`).
- Mọi widget lấy dữ liệu qua `dataService.js` — không `fetch()` thẳng trong `app.js`.

### Luật vàng: KHÔNG BAO GIỜ HIỂN THỊ SỐ BỊA

Rút ra ngày 30/07/2026 (xem mục 7), áp cho mọi tính năng về sau:

- **Giá, chỉ số, lịch sử, số dư KHÔNG BAO GIỜ fallback sang mock.** Lỗi thì hiện
  `—`. Một giá bịa trên màn hình không thể phân biệt với giá thật.
- `FALLBACK_TO_MOCK_ON_ERROR` giờ **chỉ còn áp cho fundamentals + news**.
- **Ô trống phải nói tại sao trống** ("Đang chờ máy chủ", "Nguồn lỗi").
- Dữ liệu cũ phải ghi rõ thời điểm cập nhật.
- Mock chỉ dùng khi `USE_MOCK: true`, luôn kèm badge cảnh báo.

---

## 4. Cấu trúc file

Thứ tự nạp script trong `index.html` (đừng đổi):
lightweight-charts → `config.js` → `mockData.js` → `dataService.js` →
`portfolio.js` → `signals.js` → `chartModule.js` → `app.js`

### Backend deploy — hack `cp` đã bị xoá (31/07/2026)

Render có **Root Directory = `server`** (Dashboard → Projects → chọn service →
Settings → nhóm Build & Deploy). Nghĩa là nó chạy thẳng `server/index.js`, và
`index.js` + `package.json` ở gốc repo **chưa từng được dùng** — code chết. Luật
`cp server/index.js index.js` là thừa, không rõ từ bao giờ.

Cách xác định (git log vô dụng ở đây — chính hack `cp` làm hai file luôn bị sửa
cùng một commit): sửa **chỉ** `server/index.js`, cố ý không copy sang gốc, push,
rồi xem `/health`. Trả `startedAt` = Render chạy `server/`. Đã xác nhận
`{"ok":true,"startedAt":"2026-07-31T02:05:51.524Z","uptimeSec":8}`.

Đã xoá 2 file ở gốc. **Phụ thuộc cấu hình cần biết:** nếu ai đó xoá chữ `server`
khỏi ô Root Directory, Render sẽ tìm `package.json` ở gốc, không thấy, và deploy
hỏng. Ô đó phải luôn là `server`.

Lợi ích kèm theo: Render chỉ deploy lại khi có thay đổi **trong** `server/` —
sửa CSS/JS frontend không còn kích hoạt build backend vô ích.

Tài liệu: `docs/QUYHOACH.md` (kế hoạch mở rộng), `docs/CLAUDE.moi.md` (bản nháp
CLAUDE.md cho site đa kênh, chưa áp dụng).

---

## 5. Hợp đồng dữ liệu backend (giữ nguyên format)

```
GET /api/price/history?symbol=X&days=N
→ [{ date:"YYYY-MM-DD", open, high, low, close, volume }, ...]  (tăng dần, giá nghìn VND)

GET /api/price/indices
→ [{ code, value, changePct }, ...]

GET /api/price/quote?symbol=X
→ { price, changePct, volume, netForeignVal }

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

Chuyển mock → thật: sửa `config.js` (`USE_MOCK: false` + baseUrl trỏ
`https://dashboard-chung-khoan.onrender.com/api/...`), điền `server/.env`.

---

## 6. Hạ tầng & tên miền

- Tên miền `dashboardstock.io.vn` mua tại **Mắt Bão** (nameserver
  `ns1/ns2.matbao.vn`), **phải gia hạn hàng năm** — hết hạn: dashboard chết,
  GitHub không cảnh báo.
- DNS: A `@` → `185.199.108.153` (GitHub Pages còn 3 IP dự phòng
  `.109/.110/.111.153` nhưng Mắt Bão chỉ cho 1 bản ghi A — 1 IP đủ chạy, chỉ mất
  lớp dự phòng); CNAME `www` → `hoangduy2401-web.github.io.`
- File **`CNAME` ở gốc repo bắt buộc** — xóa: mất tên miền, trang rơi về URL cũ.
  GitHub tự tạo file này khi khai báo custom domain (Settings → Pages), đừng
  commit trùng (bị 1 lần, phải `git reset --hard`).
- HTTPS: chứng chỉ Let's Encrypt do GitHub cấp và tự gia hạn.
- **Enforce HTTPS bị chặn**: GitHub báo "domain is not properly configured" vì
  tên miền gốc chỉ có 1 bản ghi A — GitHub đòi đủ 4 IP. Mắt Bão có vẻ chỉ cho 1
  bản ghi A → nếu đúng, phải chuyển nameserver sang Cloudflare mới thêm đủ.
- **Secrets sống 2 nơi tách biệt**: `server/.env` (local only, `.gitignore` chặn)
  và Environment vars ở Render dashboard. Sửa nơi này không ảnh hưởng nơi kia.
- Git: PAT lưu macOS osxkeychain, cần scope `repo` **và `workflow`** (thiếu
  `workflow`: push đụng `.github/workflows/` bị từ chối).
- **Cache 10 phút**: GitHub Pages trả `cache-control: max-age=600` cho JS/CSS →
  bắt buộc bump `?v=` mỗi lần sửa (xem mục 2).

### Giữ backend thức — ĐỪNG TIN CRON GITHUB

`.github/workflows/keep-alive.yml` khai báo ping `/health` mỗi 10 phút, nhưng
**đo thật ngày 30/07/2026 thấy các lần chạy cách nhau 56–191 phút** (xem mục 7).
GitHub bóp cron trên runner free rất nặng.

→ Nguồn giữ thức chính là **pinger ngoài** (cron-job.org), 5 phút/lần, URL
`https://dashboard-chung-khoan.onrender.com/health`. Workflow GitHub giữ làm lớp
dự phòng, không xoá.

**Cạm bẫy đã dính:** job đầu tiên đặt URL `http://` → Render trả **301 do lớp
edge Cloudflare**, request chưa từng chạm tới app, instance vẫn ngủ. Job vẫn báo
đỏ nhưng nếu bật "Treat redirects as success" thì nó báo xanh mà vẫn vô dụng.
**Bắt buộc dùng `https://`.**

Kiểm chứng sau khi sửa: im lặng 22 phút (dài hơn ngưỡng ngủ 15 phút) rồi ping 1
lần — 0,26s là thức, 30–50s là đã ngủ.

GitHub **tự tắt scheduled workflow sau 60 ngày repo không có commit** → vào tab
Actions bấm *Enable workflow*.

---

## 7. Key learnings (đừng lặp lại sai lầm cũ)

- Regex `\b` **không hoạt động với tiếng Việt** → dùng lookaround Unicode
  `(?<![\p{L}\p{N}])SYM(?![\p{L}\p{N}])` với cờ `u`.

### Format SSI thật (đã xác nhận 22/07/2026 — hết mơ hồ)

- Rows luôn ở `raw.data` (mảng), **PascalCase**, giá trị là chuỗi → phải
  `Number()`. Không thấy `dataList` hay lowercase đâu.
- `PageSize` **chỉ nhận 10 / 20 / 50 / 100 / 1000** — số khác trả lỗi
  `"Size of a page must 10, 20, 50, 100 or 1000"`.
- `DailyOhlc`: `{Symbol, Market, TradingDate:"dd/mm/yyyy", Time, Open, High, Low,
  Close, Volume, Value}` — trả **giảm dần theo ngày**.
- `DailyIndex`: `{IndexId, IndexName, IndexValue, TradingDate, Change,
  RatioChange, TotalMatchVol, Advances/Declines/Ceilings/Floors, ...}`.
  **`IndexId=ALL` trả `NoDataFound`** → phải gọi từng mã một.
  Dùng `RatioChange` làm `changePct`; **`Change` bị scale sai** (-0.6203 cho cú
  giảm -62.03 điểm) — đừng dùng.
  - **QUAN TRỌNG — intraday `IndexValue=0` (fix 24/07/2026):** trong phiên
    (`TradingSession` = `LO`/`ATO`) SSI trả row hôm nay với `IndexValue="0"`
    nhưng `RatioChange` LÀ SỐ LIVE. Giá trị điểm thật chỉ có sau đóng cửa
    (`TradingSession="C"`). → `computeIndices` tái tạo giá trị intraday =
    **đóng cửa hôm qua × (1 + RatioChange/100)** (đã verify 30.85/1668.53=1.85%).
    **Đừng chỉ lấy "row mới nhất có value>0"** — trong phiên nó trả số đóng cửa
    hôm qua, đứng im, trông như "không cập nhật".
- `DailyStockPrice` (dùng ở `computeQuote`) trả **cả khối ngoại trong cùng row**:
  `ForeignBuyValTotal`, `ForeignSellValTotal` (VND), `ForeignBuyVolTotal`,
  `ForeignSellVolTotal`, `ForeignCurrentRoom`, `NetBuySellVal/Vol`. Mua ròng ngoại
  = `ForeignBuyValTotal − ForeignSellValTotal` (verify VNM 24/07: 73.93 − 50.36 =
  +23,57 tỷ, khớp `NetBuySellVal`) → tab Khối ngoại **0 call SSI thêm**.
- `IndexList` chỉ trả `{IndexCode, IndexName, Exchange}`, không có giá trị.
  Mã thật: HOSE = `VNINDEX, VN30, VN100, VNMIDCAP, VNSMALLCAP, VNDIAMOND,
  VNFINLEAD, VNX50...`; HNX = `HNXIndex, HNX30, HNXUpcomIndex`.
- `DailyOhlc` giới hạn **tối đa 30 ngày/lần gọi** (chỉ ghi trong PDF v2.2) → phải
  chia đoạn (`fetchOhlcChunked`), phân trang `PageIndex/PageSize`.
- Token TTL **8 giờ** (không phải 6h như một số nguồn ghi), xác nhận qua
  `/api/debug/token`.
- Giá SSI là VND thô → chia 1000. Giá trị chỉ số thì **không** chia.
- `extractRows()`/`pickField()` giữ dù format đã rõ: ngắn, rẻ, lớp đệm phòng SSI
  đổi version.
- **TCBS đã bỏ**: chặn request server-to-server (404) kể cả có header giả trình duyệt.
- SSI **FCData lẫn FCTrading đều không có** fundamentals. FCTrading chỉ đặt/sửa/
  hủy lệnh + truy vấn tài khoản (orderBook, stockPosition, cashAcctBal...).
- Fundamentals dùng **VNDirect finfo** (public, không cần key, cho gọi
  server-to-server), ghép từ 2 nguồn:
  - `/v4/ratios/latest` — chỉ 8 ratioCode dùng được: `MARKETCAP,
    PRICE_TO_EARNINGS, PRICE_TO_BOOK, DIVIDEND_YIELD, ROAE_TR_AVG5Q (ROE),
    ROAA_TR_AVG5Q (ROA), EPS_TR, BVPS_CR`. Tên kiểu `ROE`, `EPS`, `DEBT_EQUITY`,
    `*_GROWTH` đều trả rỗng.
  - `/v4/financial_statements` — tự tính `revenueYoY`, `netProfitYoY` (ANNUAL,
    năm mới nhất vs năm trước) và `debtToEquity` (QUARTER mới nhất).
- Catalog itemCode nằm ở `/v4/financial_models?q=codeList:<mã>`. Code đang dùng:
  `21001` Doanh thu thuần (NON_FINANCE), `421701` Tổng thu nhập hoạt động (BANK),
  `23000` LNST công ty mẹ, `13000` Nợ phải trả, `14000` Vốn CSH.
  **`13000/14000/23000` giống nhau ở mọi companyForm**, chỉ dòng doanh thu khác.

### Lần tải đầu chậm + số sai (fix 30/07/2026)

Triệu chứng: mở trang lần đầu chờ rất lâu, khi hiện ra thì mọi chỉ số đều sai,
phải F5 thêm lần nữa mới đúng.

**Nguyên nhân 1 — keep-alive GitHub Actions không chạy đúng nhịp.** Lịch chạy
thật (GitHub API, 12 lần liên tiếp): 13:01 · 11:22 · 09:16 · 06:39 · 04:10 ·
00:59 · 23:37 · 22:33 · 21:30 · 20:34 · 19:38 · 18:02 — cách nhau **56–191 phút,
không lần nào ≤15 phút**. Render Free ngủ sau 15 phút → backend ngủ gần như suốt
→ lần tải đầu = cold start 30–60s. Xem mục 6.

**Nguyên nhân 2 — mock fallback im lặng biến cold start thành số bịa.** Mọi call
abort ở `T_FAST=6000` → `withFallback` trả `generateQuote()`/`generateIndices()`.
Badge `mockBadge` chỉ hiện khi `USE_MOCK: true`, fallback thì không báo gì → user
nhìn số ngẫu nhiên tưởng là giá thật.

Đã sửa (frontend-only):
- `dataService.js` `wakeBackend(budgetMs)`: probe `/health` (timeout 25s, retry
  mỗi 2s, tổng 90s) **trước** khi nạp dữ liệu; cache "đang thức" 60s để vòng
  refresh 45s không probe lại. `markAsleep()` huỷ cache đó khi call lỗi.
- `livePrice()` thay `withFallback()` cho **indices / quote / history** — lỗi thì
  reject. **Đừng gắn lại mock cho giá.**
- `T_FAST` 6s → **10s**. Đo thật: 30 quote song song cache ấm 0,14–0,25s mỗi cái;
  15 quote cache rỗng song song tối đa 1,9s. 6s không đủ biên an toàn.
- `app.js`: `bootData()` (probe + đếm giây + `#backendStatus`) chạy thay
  `refreshAll()` lúc `DOMContentLoaded`; `refreshCycle()` bọc vòng 45s để probe
  lại nếu instance ngủ tiếp. Ô thiếu quote hiện `—`, **không phải `0,00`**.
- Guard bắt buộc vì giá giờ reject được: `loadSelectedSymbol` (quote + history),
  form thêm mã (`.catch`), `loadIndices` (empty state).

**KHÔNG phải nguyên nhân — đừng điều tra lại:** limiter concurrency=1 và 30
request song song từ browser. Đã đo trực tiếp trên backend live, cả hai đều
nhanh. Gộp 30 quote thành endpoint batch là tối ưu vô ích.

### Hiệu năng — SSI throttle & kiến trúc cache (fix 23/07/2026)

Triệu chứng: dashboard load >5 phút. Đo trực tiếp backend live:

- **SSI bóp băng thông theo cả đồng thời lẫn tần suất.** 6 quote gọi song song →
  3 xong nhanh (~4s), **3 kẹt 32–33s**. Gọi tuần tự & thưa: chỉ ~1–2s/call, ổn
  định. Nện dồn dập (warm-up 40s/lần) cũng làm mọi call phình 10–30s.
- `fetch()` (Node/undici) **không timeout mặc định** → 1 call SSI kẹt = treo cả
  request. Đã bọc `fetchWithTimeout` (AbortController): SSI 18s, VNDirect/RSS 8s.
- Frontend cũ `setInterval(refreshAll, 15s)` **không chặn chồng lấn** → vòng mới
  đè vòng cũ đang kẹt → nhân đôi call song song → vòng xoáy tự bóp nghẹt (thủ
  phạm chính của "5 phút"). Đã đổi sang vòng lặp tự lên lịch
  (`scheduleRefreshLoop`) + cờ `refreshInFlight`, chu kỳ 15s→45s.
- Backend: mọi call SSI qua **limiter concurrency=1** (`ssiLimit`, env
  `SSI_CONCURRENCY`) để né throttle đồng thời — mỗi call về lại ~1–2s.
- Backend cache **stale-while-revalidate + dedup** (`withCache`): entry còn hạn →
  trả luôn; hết hạn nhưng trong `staleMs` (10 phút) → **trả bản cũ ngay + làm mới
  nền**; chỉ lần đầu tuyệt đối phải chờ. TTL quote/indices 45s.
- **Warm-up cache nền 5 phút/lần** (`warmCache`, env `WARM_INTERVAL_MS`,
  `DISABLE_WARM=1` để tắt) dùng `revalidate` (không xoá cache). **Đừng để
  interval ngắn** (từng thử 40s) — nện SSI dày làm throttle theo tần suất.
- Kết quả: cold load ~15s, load lại cache ấm ~0.002s.
- Mỗi endpoint tách `computeX()` (thuần logic) khỏi route (`withCache` + trả JSON)
  để warm-up gọi lại được logic mà không qua HTTP.

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
- **RSI dùng whitespace point `{time}` cho 14 nến null đầu** (thay vì
  `.filter(Boolean)`) để 2 chart cùng số nến — trước đó logical-range lệch 14
  nến, RSI hụt mép phải, không tới ngày mới nhất.
- Ghim `rightPriceScale.minimumWidth: 58` cho cả 2 chart → vùng vẽ khớp, trục
  thời gian song song. Ẩn trục thời gian pane RSI (`timeScale.visible: false`).

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
   cuối ngày → mọi so sánh KL dùng phiên gần nhất ĐÃ đóng cửa.
4. **"Thủng đáy" dùng `giá < đáy`.** Tài liệu viết `giá > đáy` — mâu thuẫn với
   chính định nghĩa của nó ở đoạn trên ("xuống dưới đáy").
5. **Đỉnh/đáy so theo GIÁ ĐÓNG CỬA**, không phải giá cao/thấp nhất trong phiên.
   Đo thật trên VN30 khung 1 tháng (bỏ lọc KL): theo đóng cửa ra 10 mã thủng đáy,
   theo giá thấp nhất phiên chỉ ra 1 mã.

Ba ràng buộc kiến trúc đi kèm, đừng phá:
- **Cửa sổ tính tín hiệu cố định `SIG_DAYS = 180`, KHÔNG dùng `state.range`.**
  RSI(14)/CMF(20) cho số khác nhau ở 1M vs 6M — cùng một mã cùng một ngày mà ra 2
  badge khác nhau thì user mất niềm tin vào cả tính năng.
- **Quét cả rổ KHÔNG nằm trong `refreshAll()`.** Vòng 45s nạp lại 30–50 mã sẽ
  dựng lại đúng vòng xoáy throttle đã sửa hôm 23/07. Fetch phải lazy + do user
  bấm nút, tuần tự (limiter concurrency=1), cache theo phiên trong `state.sigBars`.
- Badge của mã đang chọn gọi **sau** khi chart có dữ liệu và không `await` — đặt
  trước sẽ chen hàng ở limiter và làm chậm đúng thứ user đang nhìn.

---

## 8. FastConnect Trading — GĐ1 chỉ đọc (ĐÃ triển khai, đang chạy)

Base URL: `https://fc-tradeapi.ssi.com.vn` (khác hẳn FCData).

```
POST /api/account/otp          → xin OTP (tài khoản dùng SMS/Email OTP)
POST /api/account/login {code} → tạo phiên bằng PIN/OTP
GET  /api/account/portfolio    → { positions[], cash{}, fetchedAt }
```

- `positions`: `{symbol, qty, sellableQty, avgCost, marketPrice, marketValue,
  unrealizedPL, unrealizedPLPct}` — giá nghìn VND, giá trị triệu VND.
- `cash`: `{cashBal, withdrawable, purchasingPower, debt, totalAssets}` — triệu VND.
- Nguồn: `Trading/stockPosition` + `Trading/cashAcctBal`, token TTL 8h.

**Bảo mật (khác hẳn các route giá):**
- Bắt buộc header `x-dashboard-key` khớp `DASHBOARD_API_KEY`, so sánh bằng
  `crypto.timingSafeEqual`. **Không set env = tính năng tắt hoàn toàn (503)**.
- Origin allowlist: chỉ `dashboardstock.io.vn`, `hoangduy2401-web.github.io`,
  localhost. Origin lạ → 403.
- PIN/OTP **không bao giờ** lưu ở frontend; user nhập khi backend trả 428, mã
  chuyển thẳng cho SSI trong một lần login.
- Frontend lưu `DASHBOARD_API_KEY` ở localStorage — đây là khóa của dashboard,
  KHÔNG phải credential SSI.
- Dữ liệu tài khoản **không bao giờ fallback sang mock**.

**Cạm bẫy FCTrading đã gặp (dữ liệu thật, 22/07/2026):**
- **Trả HTTP 200 kèm lỗi trong body** — outcome thật nằm ở `status` (200 = ok) và
  `message`. Chỉ check `res.ok` là nuốt lỗi im lặng → `assertTradeOk()`.
- **Số tài khoản phải đủ 7 chữ số**: 6 số mã KH + hậu tố `1` (cơ sở) / `8` (phái
  sinh). Thiếu hậu tố → `"Account is not exist."`. `normalizeAccount()` tự nối `1`.
- **`marketPrice = 0` ngoài giờ giao dịch** → mọi mã hiện lỗ -100%. Đã fallback
  sang giá đóng cửa gần nhất của FCData qua `fetchQuote()`.
- **`GetOTP` trả "2FA type is invalid" với tài khoản Smart OTP** — endpoint này
  chỉ dành cho SMS/Email OTP. Smart OTP thì lấy mã trong app rồi gọi thẳng
  `AccessToken`.
- Token cache ra `os.tmpdir()/ssi-trade-token.json` (mode 600). **Render ngủ dậy
  = instance mới = mất cache** → tài khoản Smart OTP phải nhập lại OTP mỗi lần
  cold start. Muốn tự động hoàn toàn phải chuyển sang xác thực PIN.
- Sai OTP quá 5 lần → SSI khóa tạm dịch vụ. Đừng đoán mò.

**Đã kiểm chứng số liệu**: giá trị cổ phiếu + tiền mặt khớp chính xác
`totalAssets` SSI trả (149,3 tr). Holdings thật: ACB 4.364cp, SSI 2.240cp.

`server/.env` (local) và env vars Render đều đã điền:
`SSI_TRADING_CONSUMER_ID/SECRET`, `SSI_ACCOUNT` (6 số), `SSI_TRADING_2FA_TYPE=1`,
`DASHBOARD_API_KEY`. Không dùng `SSI_TRADING_PIN` (Smart OTP).

**GĐ2 — đặt lệnh: CHƯA làm, CỐ Ý chưa làm.** Cần chữ ký RSA-SHA256 bằng private
key PEM; server không giữ private key nào, nên kể cả lộ `DASHBOARD_API_KEY` kẻ
tấn công cũng chỉ đọc được. Trước GĐ2 phải có: xác nhận 2 bước trên UI, giới hạn
giá trị lệnh, nút hủy khẩn cấp, log mọi lệnh.
**Không có môi trường UAT/paper trading** — lệnh test ở GĐ2 đều là tiền thật.

---

## 9. Trạng thái hiện tại

**Dự án hoàn thành, chạy dữ liệu thật end-to-end tại https://dashboardstock.io.vn**
— `USE_MOCK: false`. Cache busting `?v=20260730a`.

| Tính năng | Nguồn | Ghi chú |
|---|---|---|
| Giá / nến / chỉ số | SSI FCData | chunking 30 ngày; index intraday tái tạo từ RatioChange |
| Chart khung thời gian | — | 1M / 3M / 6M / 1Y / 5Y (30/90/180/365/1825 ngày) |
| Ticker tape | rổ VN30 | tách khỏi watchlist; cuộn 90s; backend warm cả 30 mã |
| Bản đồ nhiệt VN30 | quote đã warm | 30 ô màu %, click = load chart; chưa sizing theo vốn hóa |
| Theo ngành / Top tăng-giảm / Khối ngoại / Tín hiệu | quote + history | 5 tab, thuần client-side |
| Chỉ số cơ bản (10 ô) | VNDirect finfo | ratios + tự tính YoY & nợ/VCSH |
| Tin tức theo mã | CafeF RSS | đã sửa regex tiếng Việt |
| Watchlist | localStorage | burger ☰ kéo thả sắp xếp, sparkline SVG |
| Lịch sử giao dịch tay | localStorage | giá vốn bình quân gia quyền |
| Danh mục thật SSI (chỉ đọc) | SSI FCTrading | GĐ1, xem mục 8 |
| Keep-alive | pinger ngoài 5 phút + Actions dự phòng | xem mục 6 |

### Nhật ký theo phiên

**31/07/2026 — xoá hack `cp` + `/health` báo uptime.**
Phát hiện Render vốn đã có Root Directory = `server`, nên `index.js` +
`package.json` ở gốc là code chết và luật `cp` là thừa. Đã xác minh bằng phép thử
`/health` (mục 4) rồi xoá 2 file. `/health` giờ trả `startedAt` + `uptimeSec` —
kiểm tra đầu tiên khi dashboard chậm. **Không đụng frontend, không cần bump `?v=`.**

**30/07/2026 — fix lần tải đầu chậm + số sai (frontend-only, backend không đụng).**
`wakeBackend()` probe `/health` trước khi nạp dữ liệu; bỏ mock fallback cho
giá/chỉ số/history; `T_FAST` 6s→10s; badge `#backendStatus`; ô thiếu dữ liệu hiện
`—`. Chi tiết + số đo ở mục 7. Cũng trong phiên này: dựng pinger cron-job.org
(phát hiện job đầu dùng `http://` nên vô dụng — xem mục 6), lập
`docs/QUYHOACH.md` cho website gia sản đa kênh, gộp `HANDOFF.md` vào file này,
thêm lệnh `/handoff`.

**26/07/2026 — Tín hiệu FiinTrade Tier 1 (frontend-only).**
`signals.js` (mới): `sma/rsi/cmf/roc`, `compute` (ma trận 3×3), `streaks`,
`volRatio/extremes/periodReturn/avgVolume`, `toWeekly` — dùng chung cho badge lẫn
tab quét rổ. Badge tín hiệu cạnh tên mã (`#symbolSignal`), 5 mức. Tab "Tín hiệu"
(thứ 5) với 3 tab con: Tổng hợp (bảng 9 cột) / Giá–KL / Chiến lược. Rổ
`HOSE_LIQUID` trong `config.js` — 49 mã HOSE có KL TB 5 phiên ≥3 triệu (27 mã
ngoài VN30), **danh sách TĨNH**, cách dựng lại ghi trong comment `config.js`.
Nạp dữ liệu lazy + do user bấm nút, tuần tự, có thanh tiến trình, cache
`state.sigBars`. Cold VN30 ~32s/30 mã. `style.css` thêm token
`--up-strong`/`--down-strong`/`--on-strong` cho **cả 2 theme**; bảng 9 cột cuộn
ngang ở ≤640px (KHÔNG stack — các cột đều là số, đọc theo hàng).

**25/07/2026 (frontend-only).**
Thước đo trên chart (nút "Đo"): 2 click → số nến + % biến động + khoảng ngày, neo
theo chỉ số nến; loại trừ nhau với "Vẽ trendline", nút "Xóa" xóa cả hai
(`clearAll`). Card accordion "TÀI KHOẢN SSI · GIAO DỊCH · LỊCH SỬ" gộp 3 khối
cuối trang, mặc định thu gọn, giữ nguyên toàn bộ id nên `app.js` không đổi.
`ChartModule.setData(history, "SYM|range")` — refresh 45s cùng dataset không xoá
nét vẽ nữa. 4 lỗi chart có sẵn phát hiện khi làm ruler, đã sửa (mục 7).
Bollinger + 2 biên RSI 1px → 2px, biên RSI đổi màu `rgba(90,102,125,0.85)`.

**24/07/2026 (3 phiên).**
- Ticker tape chuyển sang rổ **VN30**, tách khỏi watchlist. Backend
  `WARM_SYMBOLS` mở rộng 6 → 30 mã. Tốc độ cuộn CSS `scroll-left` 32s → **90s**.
- Bản đồ nhiệt VN30 (`renderHeatmap`), `heatColor` HSL độ sáng theo |%| (hue 150
  xanh / 355 đỏ, sáng 92→45), clamp ±3%, click ô = load chart, 0 call thêm.
- Chart thêm khung 1Y + 5Y. Timeout history frontend co giãn (1Y 30s, 5Y 75s);
  backend TTL co giãn (>270 ngày = 30 phút).
- **Redesign Liquid Glass**: accent amber → cam `#f5811f`/`#ff9d47`; hover
  index-card nhấc `-5px`; chip chỉ báo thành pill dùng `:has(input:checked)`;
  `main-grid` → `260px minmax(420px,1fr) 260px`, breakpoint stack 1080 → 1180px;
  sparkline watchlist (SVG 56×22, 24 close gần nhất).
- Card thị trường tabbed: Bản đồ nhiệt / Theo ngành (`SECTOR_MAP`) / Top
  tăng-giảm / **Khối ngoại**. Khối ngoại lấy `netForeignVal` nhét vào payload
  quote → **0 call SSI thêm** (verify live: HPG +87,2 tỷ, VHM/VPB −77,7 tỷ).
- Top tăng/giảm thêm switcher 3 sàn — rổ `HNX30` (15 mã) + `UPCOM` (15 mã), xếp
  hạng **trong rổ**, lazy-fetch lần đầu mở tab. Verify live: HNX TNG +3,55% /
  BVS −7,12%; UPCoM BSR +2,78% / BVB −4,21%.
- Tài khoản SSI mobile: bảng 7 cột → thẻ label:value ở ≤640px (`data-label`).
- Watchlist kéo thả (pointer, chuột + cảm ứng). CSS khối tên dùng
  `:first-of-type` (KHÔNG `:first-child` — handle span chiếm mất).
- Fix index intraday + rà soát bảo mật: escape regex mã trong news (né 502),
  escape XSS tin tức + chặn `javascript:` URL, timeout FCTrading trade call.

**23/07/2026.** Fix hiệu năng lớn (load >5 phút → cold ~15s) — xem mục 7.
Áp full Liquid Glass vào dashboard thật: `style.css` (tokens glass + aurora +
light default + `[data-theme]`), font Inter, aurora div, toggle Sáng/Tối + slider
Trong/Đục, `chartModule.applyTheme()`. Backup `style.css.pre-glass.bak` (local,
đã `.gitignore`). Mock gốc còn ở `/mock-liquid-glass.html`.
> Trình chụp headless không dựng đúng `backdrop-filter` ở viewport thứ 2 (hiện
> đen). Không phải lỗi thật — kiểm tra trên trình duyệt thật.

---

## 10. Việc còn treo

### Ưu tiên — quy hoạch mới
Website quản lý gia sản đa kênh: `docs/QUYHOACH.md`. 8 giai đoạn, ~23 phiên,
~11 tuần. Mục 0.1 đã xong 31/07. **Việc kế tiếp: GĐ 0 mục 0.2–0.9** — tách
`style.css`, chuyển JS vào `assets/`, viết `nav.js` (kèm nút con mắt) và
`store.js`. Toàn bộ làm được ngay, không cần user bấm gì.

### Tính năng chứng khoán chưa làm
1. **Theo dõi dòng tiền** (user đã chọn từ 24/07, chưa làm): phát hiện đột biến
   khối lượng/giá trị (spike vs TB 20 phiên). Đụng `server/index.js`. Gộp luôn:
   sizing heatmap theo vốn hóa (thêm 1 endpoint marketcap VN30 warmed thay 30
   call) và nhóm "giá – khối lượng" của FiinTrade — cùng bản chất.
2. **Momentum Score A–F** (FiinTrade Tầng 2) — đủ dữ liệu, dùng lại
   `netForeignVal` + `state.sigBars` đã có.
3. Portfolio thủ công: mã ngoài watchlist+VN30 dùng giá vốn làm giá hiện tại
   (P&L=0) vì `state.quotes` thiếu — fetch thêm quote nếu muốn P&L live.

### Việc nhỏ (không chặn) — user tự làm
1. **Bật tự động gia hạn tên miền ở Mắt Bão** (quên = dashboard chết, không ai báo).
2. **Enforce HTTPS**: cần đủ 4 bản ghi A → phải chuyển nameserver sang Cloudflare.
   `http://` hiện vẫn trả 200.
3. GitHub tự tắt scheduled workflow sau 60 ngày repo không commit → tab Actions
   bấm *Enable workflow* khi cần.

---

## 11. Ý tưởng dài hạn (chưa yêu cầu cụ thể)

### Đánh giá phương pháp luận FiinTrade — 4 tầng khả thi (khảo sát 25/07/2026)

Đọc 3 tài liệu ở `github.com/mrd-bdsmetro/FiinTrade-Methodology` (scoring VGM /
technical-analysis / ranking), đối chiếu với dữ liệu đang có:

**Tầng 1 — ĐÃ LÀM XONG 26/07** (mục 9). Tín hiệu kỹ thuật tổng hợp (MA5 + RSI14 +
CMF20 + ROC9 → ma trận 3×3), giá–khối lượng, chiến lược TA trên rổ có sẵn.
`CMF = Σ(CLV×volume)/Σvolume`, `CLV = ((close−low)−(high−close))/(high−low)`;
`ROC = (giá nay/giá 9 kỳ trước − 1)×100`.

**Tầng 2 — cần thêm tính toán, không cần nguồn mới:**
- **Momentum Score (A–F)** — 5 tiêu chí, tối đa 13 điểm: RSI tăng 3 phiên liên
  tiếp & <80; SMA5/20/100 so với giá; giá tăng 2 phiên/4 tuần/4 tháng; KL TB
  tháng theo 3 ngưỡng 500k/300k/200k; **khối ngoại mua ròng** (đã có sẵn
  `netForeignVal`). Xếp hạng theo phân vị trong rổ.
- Value/Growth Score cần mở rộng `financial_statements` (EBITDA, tài sản
  ngắn/dài hạn, tiền mặt, CFO 3 năm) — tốn thêm call VNDirect. Growth còn thiếu
  hẳn "kế hoạch lợi nhuận ĐHCĐ" — không có nguồn.

**Tầng 3 — chỉ làm được bản rút gọn:** FiinTrade Ranking. 3/6 nguyên tắc không có
dữ liệu (khuyến nghị analyst, giao dịch nội bộ/tổ chức/tự doanh, EPS dự phóng).
Phần làm được: quy mô (vốn hóa + tổng tài sản), dòng tiền HĐKD 3 năm, thanh khoản
— và chỉ xếp hạng **trong rổ**, không phải toàn ngành ICB level 3.

**Tầng 4 — KHÔNG khả thi:** toàn bộ nhóm "tín hiệu nhiễu" (mua trần–bán sàn, hủy
lệnh, đè giá–đẩy giá, mua/bán chủ động BU/SD, chốt phiên). Cần **order book cấp 2
real-time** (giá/KL đặt mua-bán 1/2/3, tick khớp trong phiên) qua FastConnect
**Streaming** (WebSocket, gói đăng ký khác) — kiến trúc giữ kết nối liên tục,
không hợp cơ chế cache/warm hiện tại. **Đừng thử lại bằng `DailyStockPrice`:**
endpoint đó chỉ có snapshot cuối ngày.

### Khác
- MACD (12,26,9) theo đúng khuôn mẫu RSI.
- Alert giá — toast khi vượt ngưỡng.
- Lọc tin tức chính xác hơn / thêm nguồn Vietstock RSS.
- SSI Trading GĐ2 — đặt lệnh (mục 8, rủi ro cao).
- Đồng bộ giao dịch đa thiết bị → đã nâng thành GĐ 5 của `docs/QUYHOACH.md`.

---

## 12. Môi trường máy local

- **Không có `gh` CLI.** Git push dùng PAT lưu trong osxkeychain (scope `repo` +
  `workflow`), push chạy thẳng không cần nhập lại.
- **Không có Homebrew.**
- Node v24, npm 11. Shell zsh — lưu ý `read -p` không chạy như bash, dùng
  `printf "..."; read -s VAR`.
- Test server local: `cd server && PORT=3999 node index.js`
- Serve frontend: `python3 -m http.server 5599` từ thư mục repo.
