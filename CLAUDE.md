# CLAUDE.md — Dự án "Bảng Điện" (Dashboard chứng khoán cá nhân)

> File này nạp vào context **mỗi phiên** — giữ nó gọn là việc thường xuyên, không
> phải việc một lần. Cuối phiên chạy **`/handoff`** để cập nhật mục 9 + 10.
>
> Nội dung không cần đọc mỗi phiên đã tách sang `docs/`:
> `NHATKY.md` (nhật ký phiên cũ) · `BAIHOC-CU.md` (bài học đã đóng) ·
> `SSI-TRADING.md` (FastConnect chi tiết) · `YTUONG.md` (ý tưởng dài hạn) ·
> `QUYHOACH.md` (kế hoạch website gia sản) · `VANG.md` (nguồn + đơn vị giá vàng).
> **Đọc file tương ứng khi động vào phần đó**, đừng kéo ngược lên đây.

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
| Supabase (GĐ 5) | project `kndumltxfrhqxbjrlice` · region Singapore · gói free |

Cache busting hiện **`?v=20260815a`** — nhưng **6 file đã đổi nội dung SAU khi
chuỗi này được đặt**. Phải bump lên `20260815b` trước khi làm 5.8; lý do ở mục 10.

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
  module, đổi thư viện chart, đổi format dữ liệu giữa `dataService.js` ↔ trang
  ↔ `server`).
- **Sửa JS/CSS xong PHẢI bump `?v=YYYYMMDD<chữ>` ở MỌI trang HTML dùng file đó**,
  không thì user chạy code cũ tới 10 phút do cache GitHub Pages. Xem mục 4.
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
  đọc/ghi qua `Store`. Danh sách rỗng: tôn trọng, không tự nạp lại seed.
- **Ngôn ngữ thiết kế: Fey design system** (từ 03/08/2026, xem mục 9). Bề mặt
  PHẲNG ĐỤC, font Roboto, accent cam `#f0a94e` (tối) / `#b9740a` (sáng), radius
  16, viền hairline. Theme Sáng/Tối qua `[data-theme]`, **mặc định SÁNG** (đổi
  từ TỐI ngày 08/08/2026 theo yêu cầu user). Mặc định nằm ở `data-theme` của
  thẻ `<html>` **trong từng trang** — sửa một chỗ không đủ, phải sửa cả 6 file
  HTML, nếu không mỗi trang mở ra một màu. `theme.js` chỉ là lưới an toàn.
  **Đừng phục hồi Liquid Glass**: aurora blob, `backdrop-filter`, slider
  Trong/Đục và biến `--glass-a` đã bỏ có chủ đích — design nguồn quy định bề mặt
  đục hoàn toàn. Bản mock kính cũ vẫn xem được ở `/mock-liquid-glass.html`.
- Token màu/chữ/khoảng cách của Fey nằm ở đầu `assets/css/base.css`. Tên biến cũ
  (`--panel`, `--amber`, `--up`, `--field-bg`…) giữ lại làm **alias** trỏ vào
  token mới, nên code cũ không phải sửa — đổi da chỉ cần đổi giá trị ở một chỗ.
- **NGOẠI LỆ của luật alias**: 10 biến `chartModule.js` đọc qua
  `getComputedStyle().getPropertyValue()` phải là **hex/rgba literal, lặp lại
  trong TỪNG khối theme** — `--border`, `--text-muted`, `--amber`, và 7 biến
  `--chart-up/-down/-ma10/-ma20/-boll/-rsi/-trend`. `getPropertyValue` trả
  **chuỗi thô chưa giải**, nên viết `--border: var(--border-default)` sẽ khiến
  hàm trả đúng chuỗi `"var(--border-default)"`; Lightweight Charts nhận màu
  không hợp lệ và **im lặng** rơi về màu mặc định, không có lỗi console nào.
  (Cảnh báo này có sẵn ở đầu `base.css` từ trước, phiên 03/08 mở rộng cho 7
  biến chart mới; chưa đo lại.)
- Mọi widget lấy dữ liệu qua `dataService.js` — không `fetch()` thẳng trong trang.
- **Mọi dữ liệu người dùng đọc/ghi qua `store.js`** — không gọi thẳng
  `localStorage` từ trang. Toàn bộ API của `Store` **trả Promise**, kể cả driver
  localStorage hiện tại. Supabase (GĐ 5) là bất đồng bộ; viết đồng bộ bây giờ thì
  tới lúc đổi driver phải sửa lại mọi chỗ gọi. Đây là chỗ dễ làm ẩu nhất.
- `Portfolio` giữ cache trong bộ nhớ vì render chạy đồng bộ. **Phải
  `await Portfolio.load()` trước lần vẽ đầu tiên**, nếu không danh mục hiện rỗng
  rồi mới nhảy số.
- **Số tiền tuyệt đối và số lượng nắm giữ phải bọc `<span class="money">`** —
  xem mục 3b.

### Luật vàng: KHÔNG BAO GIỜ HIỂN THỊ SỐ BỊA

Rút ra ngày 30/07/2026 (xem mục 7), áp cho mọi tính năng về sau:

- **Giá, chỉ số, lịch sử, số dư KHÔNG BAO GIỜ fallback sang mock.** Lỗi thì hiện
  `—`. Một giá bịa trên màn hình không thể phân biệt với giá thật.
- `FALLBACK_TO_MOCK_ON_ERROR` giờ **chỉ còn áp cho fundamentals + news**.
- **Ô trống phải nói tại sao trống** ("Đang chờ máy chủ", "Nguồn lỗi").
- Dữ liệu cũ phải ghi rõ thời điểm cập nhật.
- Mock chỉ dùng khi `USE_MOCK: true`, luôn kèm badge cảnh báo.

---

## 3b. Chế độ riêng tư (nút con mắt)

Mục đích: mở website cho người khác xem mà không lộ số tài sản.

- Công tắc toàn cục, nút nằm trên thanh điều hướng dùng chung (`nav.js`), lưu qua
  `Store.setSetting("privacyMode")`. Mặc định **TẮT** — bật sẵn dễ khiến user
  tưởng dữ liệu chưa nạp.
- Bật = class `privacy` trên `<html>`; **CSS lo phần che**, không sửa từng chỗ
  render. Thêm ô hiển thị tiền mới chỉ cần bọc `<span class="money">`.
- **Che:** số tiền tuyệt đối, số lượng nắm giữ.
  **Vẫn hiện:** giá thị trường, % lãi/lỗ, tỷ trọng, hình dạng biểu đồ.
- Biểu đồ tài sản phải gắn `.hide-axis-labels` cho nhãn trục Y — nhìn trục là
  đoán ra ngay.
- Giới hạn đã biết: bề rộng ô vẫn theo số cũ nên đoán được số chữ số. Chấp nhận
  được cho mục đích khoe sản phẩm.
- **Thêm trang mới: bật nút rồi rà lại cả trang**, tìm số tiền còn lọt.

## 4. Cấu trúc file

Cây thư mục: `ls` là ra. Chỉ ghi ở đây những thứ nhìn cây thư mục không đoán được:

**Thứ tự nạp script (đừng đổi):**
lightweight-charts → **supabase-js** → `config.js` → `store.js` → `auth.js` →
`store-supabase.js` → `theme.js` → `nav.js` → `mockData.js` → `dataService.js` →
`costGuard.js` → `portfolio.js` → `signals.js` → `chartModule.js` →
`pages/<trang>.js`

`store.js` phải đứng trước `nav.js` và `portfolio.js` — cả hai gọi `Store`.
supabase-js phải đứng trước `auth.js` — `auth.js` đọc `window.supabase`.

Riêng `backup.js` + `migrate.js` chỉ nạp ở `index.html` (trang tổng).

**File của GĐ 5 — file nào lo việc gì:**

| File | Việc |
|---|---|
| `supabase/schema.sql` | 9 bảng + RLS. Chạy trong SQL Editor, chạy lại nhiều lần không hỏng |
| `core/auth.js` | CHỈ lo danh tính (magic link). Không đọc/ghi một dòng dữ liệu nào |
| `core/store.js` | Facade + chọn driver. Mọi hàm `await ready` trước khi chạm driver |
| `core/store-supabase.js` | Driver DB thật. Đổi tên trường camelCase ↔ snake_case ở đây |
| `core/backup.js` | Xuất JSON (5.6) |
| `core/migrate.js` | Nhập dữ liệu cũ (5.5). Nguồn: localStorage HOẶC file .json |
| `server/index.js` | Job snapshot (5.7) — cuối file, cạnh vòng warm cache |

**Bump `?v=` ở CẢ `index.html` LẪN `chung-khoan.html`.** Chúng dùng chung
`base.css`, `store.js`, `theme.js`, `nav.js`; bump một file là file kia chạy code
cũ. Đã dính ngay trong phiên tách file: sửa `nav.js` mà không bump, trình duyệt
phục vụ bản cũ và mất 2 vòng debug tưởng lỗi CSS.

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

GET /api/price/index-history?code=VNINDEX&days=N
→ [{ date:"YYYY-MM-DD", close, volume }, ...]   (tăng dần, close = ĐIỂM)
   KHÔNG có open/high/low — DailyIndex không trả OHLC. Đừng bịa nến từ close.
   Bỏ luôn dòng trong phiên (IndexValue=0); giá trị hôm nay lấy ở /indices.

GET /api/price/indices
→ [{ code, value, changePct,
     totalVol, totalVal, advances, declines, noChanges, ceilings, floors }, ...]
   value: điểm (KHÔNG chia 1000) · totalVol: cổ phiếu · totalVal: VND (thô)
   advances/declines/noChanges: SỐ MÃ, hoặc null khi SSI không có (xem mục 7)
   ceilings/floors: số mã trần/sàn — ĐI THEO BỘ với advances, null cùng lúc
   tradingDate: NGÀY CỦA PHIÊN đang báo cáo. Cuối tuần/ngày nghỉ SSI vẫn trả
     phiên gần nhất đã đóng — đừng coi nó là hôm nay (xem mục 7)

GET /api/price/quote?symbol=X
→ { price, changePct, volume, netForeignVal }

GET /api/fundamentals/:symbol
→ { marketCap, pe, pb, eps, roe, roa, dividendYield, revenueYoY, netProfitYoY, debtToEquity }

GET /api/news?symbols=A,B,C
→ [{ symbol, title, source, time (ISO), url }, ...]

GET /api/fx/rates                       (Vietcombank — BÁN LẺ, có biên mua-bán)
→ { updatedAt (ISO +07:00), source:"Vietcombank", kind:"retail",
    rates:[{ code, name, buyCash, buyTransfer, sell }] }   20 mã, sắp theo code
   Trường = null nghĩa là VCB KHÔNG niêm yết (XML trả "-"), không phải 0.

GET /api/fx/history?code=USD&days=365   (FXRatesAPI — LIÊN NGÂN HÀNG, một giá)
→ { source:"FXRatesAPI", kind:"interbank", method:"direct"|"cross", code,
    items:[{ date:"YYYY-MM-DD", rate }] }                  tăng dần
   days > 365 → 400 `range_too_long` (gói free chỉ có 366 ngày). Mã lạ → 400.
```

```
GET /api/gold/prices                    (PNJ chính, BTMC dự phòng)
→ { updatedAt (ISO +07:00), source:"PNJ"|"BTMC", branch, note?,
    unit:"nghìn đồng/chỉ",
    items:[{ code, name, buy, sell, karat? }] }
   ĐƠN VỊ LÀ NGHÌN ĐỒNG / CHỈ (1 lượng = 10 chỉ = 37,5 g) — đã đo, xem mục 9.
   buy/sell = null: tiệm không niêm yết chiều đó (PNJ chỉ MUA vàng nguyên liệu).
   `note` chỉ xuất hiện khi BTMC (nguồn dự phòng) trả lời — UI phải hiện nó.
```

```
GET /api/crypto/prices?ids=bitcoin,ethereum   (Binance ở production, xem mục 7)
→ { updatedAt, source:"CoinGecko"|"Binance"|"CoinMarketCap", note?,
    vndFrom?: { rate, rateDate, source },
    items:[{ id, symbol, name, image, vnd, usd, change24h, marketCap }] }
   `id` là SLUG CoinGecko ("matic-network"), không phải ticker.
   `vndFrom` có mặt = giá VND là số QUY ĐỔI từ USD, không phải giá báo trực
   tiếp — trang BẮT BUỘC ghi nhãn (đang ghi "VND quy đổi").

GET /api/crypto/history?id=bitcoin&days=90
→ { source, currency:"VND", id, note?, items:[{ date, price }] }
   days > 365 → 400 `range_too_long`.

GET /api/crypto/search?q=sol
→ [{ id, symbol, name, rank }]   CoinGecko, lùi về bảng nội bộ ~40 coin.
```

```
GET /api/savings/rates                  (CafeF — file JSON tĩnh trên CDN)
→ { fetchedAt, source:"CafeF", terms:["0T","1T",…"24T"],
    banks:[{ name, symbol, icon, rates:{ "12T": 5.9, … } }],
    stale?, snapshotAt? }
   `fetchedAt` = lúc SERVER lấy về, KHÔNG phải lúc ngân hàng đổi lãi suất —
   trang ghi "lấy lúc". `rates[kỳ hạn]` = null: ngân hàng không niêm yết kỳ hạn
   đó, không phải 0%/năm. `stale: true` = nguồn chết, đang trả bản chụp cũ.
```

**`/api/fx/rates` và `/api/fx/history` là HAI LOẠI tỷ giá khác nhau, lệch ~0,8%
vĩnh viễn** (đo 05/08: liên ngân hàng 26.259 vs VCB mua 26.050 / bán 26.460).
Mọi chỗ hiển thị phải ghi nhãn nguồn — xem mục 7.

Còn vài endpoint `/api/debug/*` chỉ để dò format SSI, không dùng ở frontend —
`grep "api/debug" server/index.js` là ra đủ.

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

> Chỉ giữ bài học **còn chi phối quyết định**. Sự cố đã sửa xong và kiến trúc
> hiện tại đã phản ánh (`.mtab-pane`, lần tải đầu chậm, throttle SSI + kiến trúc
> cache) nằm ở **`docs/BAIHOC-CU.md`** — đọc file đó trước khi định "tối ưu lại"
> phần cache/limiter hay luồng tải đầu.


- Regex `\b` **không hoạt động với tiếng Việt** → dùng lookaround Unicode
  `(?<![\p{L}\p{N}])SYM(?![\p{L}\p{N}])` với cờ `u`.

### SSI đã bỏ giới hạn 30 ngày/lần của DailyOhlc — chú thích cũ sai (15/08/2026)

**Triệu chứng.** User báo biểu đồ "khá chậm". Lấy mẫu 24 lần trong 6 phút: nền
~0,7s nhưng xen giữa là **2,2 / 2,8 / 3,3 / 5,8 / 8,1 giây**.

**Đã loại trừ — đừng điều tra lại:**
- **KHÔNG phải cold start Render.** `/health` báo `uptimeSec` 572703 = 6,6 ngày.
  Keep-alive chạy tốt. *(Đây là chỗ đầu tiên nên nhìn, nhưng lần này không phải.)*
- **KHÔNG phải SSI bóp theo tần suất.** Bắn 6 request liên tiếp không nghỉ: đều
  0,59–0,95s. Để yên 100 giây rồi gọi một phát: 0,82s. Không tái hiện được.
- **KHÔNG phải tab dashboard tự làm nặng** (45s/lần refresh 30 quote). Spike vẫn
  còn khi không mở tab nào.

**Nguyên nhân.** `server/index.js` chia lịch sử theo khối 30 ngày, theo chú thích
"DailyOhlc is capped at 30 days per call (PDF v2.2)". **Giới hạn đó không còn
đúng.** Đo lại: một lần gọi trả 65 nến cho 90 ngày, **249 nến cho 365 ngày**,
1.247 nến cho 5 năm (`PageSize=2000`). Mỗi biểu đồ vì thế bắn 3 (3M) / 13 (1Y) /
**61 (5Y)** lượt gọi SSI tuần tự qua limiter `concurrency=1`. Độ trễ SSI vốn thất
thường nên **mỗi khối là một lần rút thăm** — chỉ cần một lượt trúng lượt chậm là
cả biểu đồ đứng chờ.

**Cách sửa.** `OHLC_CHUNK_DAYS` 30 → 365, `OHLC_PAGE_SIZE` 100 → 1000; giữ vòng
chia khối + phân trang làm lưới an toàn. Hai hằng số **chỉnh được bằng biến môi
trường** — SSI siết lại thì đặt `OHLC_CHUNK_DAYS=30 OHLC_PAGE_SIZE=100` trong
Render, không cần deploy.

**Vì sao 365 chứ không phải 2000** (đủ ôm 5 năm một lần): 365 là mốc đã đối chiếu
**từng nến**. Kiểu hỏng ở đây **IM LẶNG** — trả ít nến hơn chứ không báo lỗi.
Đừng nâng lên mà không đối chiếu lại từng nến.

**Số đo** (hai bản chạy song song cùng máy, chỉ khác hai hằng số) — 90 ngày×10 mã
8,55→**4,19s**; 180 ngày 1,44→**0,59s**; 365 ngày 2,25→**1,17s**; 5 năm
10,92→**4,54s**. Dữ liệu giống hệt: FPT/VNM/SHB × 90 và 365 ngày, 0 nến lệch;
5 năm BID 1.247 nến cả hai bản, cùng dải `2021-08-16 → 2026-08-14`. Sau deploy,
10 mẫu live nằm gọn 0,48–0,66s — **hết spike**.

**Việc thứ hai, deploy TÁCH RIÊNG** (gộp một lần thì hỏng cái nào cũng khó biết):
mở một mã từng bắn **2** lần `/history` — biểu đồ xin `state.range`, huy hiệu tín
hiệu xin `SIG_DAYS`=180 — dù 180 đã chứa trọn 90. Nay xin một lần
`max(range, 180)` rồi cắt bằng `sliceLastDays`, lặp đúng công thức `end - days`
của backend nên bộ nến không đổi (1M 22=22, 3M 65=65, 1Y 249=249, 5Y 1247=1247;
huy hiệu 122 nến giống bản gọi thẳng, RSI lệch 0).

### `http://` và `https://` là HAI kho localStorage khác nhau (15/08/2026)

**Triệu chứng.** Chuẩn bị GĐ 5.5, mục 10 ghi "bảy khoá đang có dữ liệu thật cần
chuyển". User tải bản sao lưu ở `https://dashboardstock.io.vn` → **chỉ có 2 nhóm**
(watchlist 5 mã + `privacyMode`). Không có danh mục vàng/ngoại tệ/coin/tiết kiệm.

**Nguyên nhân.** localStorage tách theo **origin**, mà scheme là một phần của
origin. `http://dashboardstock.io.vn` trả 200 **trực tiếp, không chuyển hướng**
(mục 10 vẫn nợ việc enforce HTTPS), và `hoangduy2401-web.github.io` — địa chỉ cũ
trước khi có tên miền riêng — **chuyển hướng về đúng bản `http://`**. Ai từng
dùng địa chỉ cũ thì dữ liệu nằm ở kho `http://`, bản `https://` không thấy.

**Cách sửa.** `migrate.js` nhận nguồn từ **file .json** chứ không chỉ từ
localStorage của origin đang mở. Không có đường đó thì phần dữ liệu bên kia
không có cách nào lên DB. **Đừng gỡ nút "Lấy từ file sao lưu" cho gọn.**

**Kết cục thật của lần này:** kho `http://` cũng chỉ có 1 dòng vàng, và nó là
dòng user vừa gõ để thử (`updatedAt` cách lúc xuất file 20 giây). **Không có dữ
liệu cũ nào cần chuyển.** Mục 10 cũ ghi sai — đó là danh sách khoá *cần chuyển
nếu có*, chưa ai kiểm chứng. User xác nhận mới chỉ dùng trang chứng khoán.

**Hệ quả còn lại:** chừng nào chưa enforce HTTPS thì hai kho vẫn tách. Xong 5.8
(dữ liệu ở DB gắn với tài khoản, không gắn origin) thì vấn đề tự biến mất.

### Chú thích nói "không im lặng" mà code lại im lặng (15/08/2026)

**Triệu chứng.** Chưa xảy ra với user — bắt được khi rà lại đường đi của 5.8.

**Nguyên nhân.** `store.js` viết:
```js
// Chưa đăng nhập thì KHÔNG rơi về localStorage một cách im lặng...
return s ? SupabaseDriver : null;   // null CHÍNH LÀ driver localStorage
```
Chú thích và code ngược nhau. Nếu bật `STORE_ENABLED` mà không sửa: mở trên
**điện thoại chưa đăng nhập** thì trang đọc localStorage của máy đó — rỗng — rồi
hiện danh mục trống y như thật.

**Cách sửa.** Vẫn đọc localStorage (chặn hẳn thì máy mới thành trang trắng, tệ
hơn) nhưng **không im lặng**: cờ `Store.needsLogin` + dải cảnh báo cam
(`.login-warn`) do `nav.js` vẽ trên **mọi trang**. Cam chứ không đỏ — dữ liệu vẫn
đọc được, chỉ là đọc từ chỗ khác với nơi user tưởng; đỏ dành cho lỗi thật.

**Bài học rộng hơn:** chú thích mô tả *ý định* không tự nó thành *hành vi*. Khi
đọc một khối có chú thích mạnh ("KHÔNG BAO GIỜ", "phải"), kiểm code có làm đúng
thế không — ở đây chính người viết chú thích cũng viết sai code ngay dưới nó.

### Cuối tuần, SSI vẫn trả phiên gần nhất — đừng coi đó là hôm nay (08/08/2026)

**Triệu chứng.** Tab Tổng quan thị trường hiện "Khối lượng phiên **+0,0%**", kỳ
này và kỳ trước là hai con số y hệt (647,7 triệu).

**Nguyên nhân.** Hôm đó là **thứ Bảy**. `/api/price/indices` vẫn trả dòng của
phiên thứ Sáu — SSI không trả rỗng ngày nghỉ. Client lấy "hôm nay" làm mốc, lọc
lịch sử theo `date !== hôm nay`, nên phiên thứ Sáu **vẫn nằm trong lịch sử** và
trở thành "phiên trước" của chính nó.

**Cách sửa.** `/api/price/indices` trả thêm **`tradingDate`** (ngày của dòng
đang báo cáo). Client so theo `tradingDate` chứ không theo lịch máy: lọc
`date < tradingDate`, và nhãn ghi rõ "phiên 07-08 so với 06-08" thay vì "hôm
nay so với phiên trước". Ngày nghỉ thì ghi chú đổi thành "Thị trường đang nghỉ
— số liệu là của phiên …".

**Lưu ý:** đây là lỗi THỨ HAI cùng họ. Lần trước (07/08) là HNX trả dòng hôm
nay ngay trong phiên. Luật chung: **mốc thời gian phải lấy từ payload, đừng lấy
từ đồng hồ máy.**

### Lightweight Charts — hai cách làm biểu đồ không vẽ được (07/08/2026)

Cả hai đều **im lặng tuyệt đối**: trục, thang giá và nhãn giá cuối đều đúng, chỉ
thiếu ĐƯỜNG, không có lỗi console nào. Rất dễ tưởng là lỗi dữ liệu.

**1. Giá trị quá lớn.** Chuỗi BTC theo VND (~1,68e9) không vẽ; chia cùng chuỗi
đó cho 1000 là hiện lại ngay. **Đổi `priceFormat.minMove` KHÔNG cứu được** (đã
thử `minMove: 1000`) — giới hạn nằm ở độ lớn giá trị, không phải số bước giá.
→ Trang nào có giá lớn phải **tự chia bậc** trước khi gọi `setData` rồi ghi đơn
vị lên nhãn. `pages/coin.js` có `chartScaleFor()`: đưa mọi chuỗi về dưới 1e5 với
bậc đẹp (1 / nghìn / triệu) và in "trục biểu đồ: triệu ₫" cạnh tiêu đề.

**2. Lần vẽ ĐẦU TIÊN sau khi tải trang.** Ngay cả khi đã chia bậc, lần
`setData` đầu vẫn không hiện đường; gọi lại **đúng hàm vẽ đó** khi trang đã ổn
định thì bình thường. **Đã thử và KHÔNG phải nguyên nhân** (đừng thử lại):
`priceFormat.minMove`; nạp bảng giá trước rồi mới vẽ (tuần tự thay `Promise.all`);
chờ 2 khung hình (`requestAnimationFrame` lồng nhau); dựng chart lười ngay trước
lần vẽ đầu. **Căn nguyên vẫn chưa rõ.** Cách duy nhất đã kiểm chứng là chạy: vẽ
lại một lần sau 400ms — `coin.js` có khối `firstDrawDone` kèm ghi chú
"đừng xoá".

Trang chứng khoán và ngoại tệ không dính lỗi 2 (đã kiểm lại 07/08), nên đừng
thêm cách vá đó vào chúng khi chưa thấy triệu chứng.

### CoinGecko chặn IP Render — nguồn chạy ở máy local không có nghĩa là chạy ở production (07/08/2026)

`/api/crypto/*` trên Render trả **`CoinGecko HTTP 429` ba lần liên tiếp**, trong
khi cùng request đó từ máy local trả 200. Đây là lần thứ **hai** dính đúng kiểu
này (lần đầu: Yahoo Finance ở GĐ 1, xem trên).

→ **Luật rút ra: dò nguồn mới thì phải đo TỪ RENDER trước khi xây trang quanh
nó.** Đo ở máy local chỉ chứng minh nguồn còn sống, không chứng minh nó phục vụ
được IP datacenter.

Cách xoay ở trang coin: Binance cho giá USD, nhân tỷ giá USD/VND của chính dự án
(`fxTimeseries`, liên ngân hàng) — chi tiết ở mục 9.

### Yahoo Finance chặn theo IP — kể cả IP của Render (05/08/2026)

**Triệu chứng.** Mọi request `query1.finance.yahoo.com/v8/finance/chart/...` trả
`429 Too Many Requests`, ngay từ lần gọi ĐẦU TIÊN, không phải sau khi gọi nhiều.

**Số đo.** `curl` và `node fetch` từ máy local: 429 (đã đặt User-Agent trình
duyệt). Thêm cookie jar từ `fc.yahoo.com`: vẫn 429. `query2` thay `query1`: 429.
Sau khi deploy lên Render và gọi từ backend live: **cũng 429**. Cùng URL đó fetch
qua một mạng khác: **200, có đủ `chart.result[0]`**. → chặn theo IP, và IP
datacenter (Render) là loại bị chặn chắc nhất.

**Đã loại trừ** (đừng thử lại): thiếu User-Agent; thiếu cookie/crumb; sai host
`query1`/`query2`; gọi quá dày (lần gọi đầu đã 429).

**Cách sửa.** Đổi sang **FXRatesAPI** (`api.fxratesapi.com/timeseries`), free,
không cần key. **Một call trả TẤT CẢ ngoại tệ cho cả khoảng ngày** nên tỷ giá
chéo không tốn thêm request: với `base=USD`, mỗi ngày là "số đơn vị XXX trên 1
USD", nên `XXX/VND = (VND per USD) ÷ (XXX per USD)` — một công thức cho cả 20 mã,
không còn phải chia nhánh nhân/chia như kế hoạch cũ.

**Ba cạm bẫy của nguồn mới, đã dính đủ:**
1. **Phải xin `VND` trong danh sách `currencies`** — nó là vế báo giá. Thiếu nó
   thì phản hồi vẫn `200` nhưng không có dòng nào dùng được (`"returned no
   rows"`). `USD` là base nên luôn = 1 và KHÔNG xuất hiện trong phản hồi.
2. **Gói free chỉ có 366 ngày** (`start_date_too_old`), và `366` chẵn cũng đã
   400 → chốt `FX_MAX_DAYS = 365`. Vì vậy **trang ngoại tệ không có khung 5Y**.
3. Điểm mới nhất là **hôm qua**, không phải hôm nay — giá trị hôm nay lấy ở bảng
   Vietcombank. Nhãn "Mới nhất" trên trang có kèm ngày, đừng bỏ.

**Các nguồn khác đã dò và loại** (đừng dò lại): `stooq.com` bắt giải PoW bằng
JS; `frankfurter` (ECB) **không có VND**; `exchangerate.host` nay đòi
`access_key`; `cdn.jsdelivr.net/npm/@fawazahmed0/currency-api` chạy tốt nhưng
**mỗi ngày là một request** và dữ liệu chỉ có từ **2024-03-06** (2021 và 2023 trả
404) → 5Y không khả thi. Vietcombank `pXML.aspx` **bỏ qua tham số `date`**, luôn
trả bảng hôm nay, nên không dựng được lịch sử bán lẻ từ đó.

### Chart chỉ số — ba chỗ đừng "sửa lại cho đúng" (04/08/2026)

1. `/api/price/index-history` trả `{date, close, volume}` — **không có OHLC** vì
   `DailyIndex` không có. `chartModule` tự nhận ra và vẽ đường.
2. **Chunk 30 ngày là bắt buộc**, không phải chọn lựa (xem "Format SSI thật").
3. **Timeout của chỉ số phải riêng**, đừng gộp với `getHistory` (mục ngay dưới).

Khảo sát gốc + ước lượng của bước A/B: `docs/BAIHOC-CU.md`.

### Ngân sách timeout của chỉ số phải RIÊNG, không dùng chung với cổ phiếu (04/08/2026)

**Triệu chứng.** Bấm liên tiếp HNX → UPCoM → khung 1Y: tiêu đề đổi sang UPCOM và
5 ô thống kê cũng đổi, nhưng **chart vẫn là nến của mã cổ phiếu đang xem trước
đó**. Không có lỗi console.

**Số đo.** Bảng network: `index-history?code=HNXINDEX&days=90`,
`code=UPCOM&days=90`, `code=UPCOM&days=365` đều `net::ERR_ABORTED` — tức
`AbortController` của `fetchJson` hết giờ, không phải backend lỗi. Gọi thẳng
cùng URL bằng `curl` thì cả ba trả 200 đầy đủ dữ liệu.

**Nguyên nhân.** Một lần lấy lịch sử cổ phiếu = 1–2 call SSI; **một lần lấy lịch
sử chỉ số = 4–61 call** (chunk 30 ngày). Backend chạy `ssiLimit` **concurrency=1**
nên bấm chỉ số thứ hai là nó xếp hàng sau **toàn bộ** job của chỉ số thứ nhất.
Ngân sách 12s vay từ đường cổ phiếu hết giờ khi backend vẫn đang chạy — và nó
chạy xong thật, chỉ là không ai còn nghe.

**Đã loại trừ**: không phải backend lỗi (curl 200); không phải mã chỉ số sai
(cả 4 mã đều ra dữ liệu); không phải CORS.

**Cách sửa.** `getIndexHistory` có ngân sách riêng **25s / 45s / 90s** theo độ
dài, thay vì 12s/30s/75s của `getHistory`. Kèm hai lớp chống nhiễu:
- Bỏ qua phản hồi lạc hậu: chụp `code` + `range` lúc gọi, khi trả về mà
  `state.selected`/`state.range` đã khác thì không vẽ.
- `drawChartOrClear`: hỏng mà chart đang là **dataset khác** thì xoá trắng, chứ
  không để lịch sử giá của mã này nằm dưới tên mã kia (luật vàng mục 3). Hỏng
  mà **cùng key** (nhịp làm mới 45s) thì giữ nguyên chart.

### Format SSI thật (đã xác nhận 22/07/2026 — hết mơ hồ)

- Rows luôn ở `raw.data` (mảng), **PascalCase**, giá trị là chuỗi → phải
  `Number()`. Không thấy `dataList` hay lowercase đâu.
- `PageSize` **chỉ nhận 10 / 20 / 50 / 100 / 1000** — số khác trả lỗi
  `"Size of a page must 10, 20, 50, 100 or 1000"`.
- `DailyOhlc`: `{Symbol, Market, TradingDate:"dd/mm/yyyy", Time, Open, High, Low,
  Close, Volume, Value}` — trả **giảm dần theo ngày**.
- `DailyIndex`: **`IndexId=ALL` trả `NoDataFound`** → phải gọi từng mã một.
  Dùng `RatioChange` làm `changePct`; **`Change` bị scale sai** (-0.6203 cho cú
  giảm -62.03 điểm) — đừng dùng.

#### `DailyIndex` — dump thật 04/08/2026 (VNINDEX, giữa phiên)

21 trường, không thiếu trường nào:
```
IndexId IndexName IndexValue TradingDate Time Change RatioChange
TotalTrade TotalMatchVol TotalMatchVal TotalDealVol TotalDealVal
TotalVol TotalVal Advances NoChanges Declines Ceilings Floors
TypeIndex TradingSession
```

- **KHÔNG có OHLC** — chỉ `IndexValue`, một giá trị mỗi ngày. Hệ quả: **không
  vẽ nến được cho chỉ số**, phải dùng biểu đồ đường. Đừng đi tìm endpoint khác:
  `DailyStockPrice` chỉ có snapshot cuối ngày (mục 11 tầng 4).
- **Giới hạn cứng 30 ngày mỗi call.** Vượt là trả `data: []`, `totalRecord: 0`,
  `status 200` (KHÔNG phải lỗi HTTP) kèm `message`:
  `"Date time format dd/MM/yyyy and ('from date' <= 'to date') < now , max range 30 days"`.
  Đo 04/08: `days=90/400/1825` đều ra 0 dòng. Nên lịch sử chỉ số **phải chunk 30
  ngày** y như `fetchOhlcChunked` — 1Y ≈ 13 call, 5Y ≈ 61 call, tuần tự.
  Phân trang `PageSize: 1000` **không cứu được**: rào chắn nằm ở khoảng ngày,
  không phải số dòng.
- **Độ rộng thị trường (`Advances`/`Declines`/`NoChanges`) chỉ có theo SÀN,
  không theo rổ.** Đo cùng một lượt gọi: VNINDEX 124/95/64, HNX 45/30/34,
  UPCoM 61/30/49, **VN30 = 0/0/0**. `computeIndices` gom bộ ba toàn-0 thành
  `null` để UI hiện `—` — "0 mã tăng" trên 30 mã là số bịa (mục 3).
  `TotalVol`/`TotalVal` của VN30 thì có thật, vẫn dùng được.
- **`TotalVol`/`TotalVal` LÀ số trực tiếp trong phiên**, kể cả khi
  `IndexValue = 0`. Xác nhận: row 04/08 có `IndexValue "0"`,
  `TradingSession "LO"`, mà `TotalVol 76.720.564` và `Advances 128`. Nên lấy
  thống kê từ row MỚI NHẤT, đừng lấy từ row prev-close như cách chữa
  `IndexValue` — độ rộng của hôm qua dán nhãn hôm nay là số bịa.
- Dùng `TotalVol`/`TotalVal` (khớp + thỏa thuận) chứ không phải `TotalMatchVol`
  /`TotalMatchVal` — chỉ lấy phần khớp sẽ thấp hơn con số "GTGD toàn sàn" mà sàn
  công bố.
- Độ trễ đo được: 90–230ms mỗi call `DailyIndex`.
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
  dựng lại đúng vòng xoáy throttle đã sửa hôm 23/07 (`docs/BAIHOC-CU.md`). Fetch phải lazy + do user
  bấm nút, tuần tự (limiter concurrency=1), cache theo phiên trong `state.sigBars`.
- Badge của mã đang chọn gọi **sau** khi chart có dữ liệu và không `await` — đặt
  trước sẽ chen hàng ở limiter và làm chậm đúng thứ user đang nhìn.

---

## 8. FastConnect Trading — GĐ1 chỉ đọc (ĐÃ triển khai, đang chạy)

Endpoint `/api/account/{otp,login,portfolio}`, chỉ đọc, không đặt lệnh được.
Bảo mật riêng (`x-dashboard-key` + origin allowlist), 5 cạm bẫy FCTrading đã gặp,
và lý do GĐ2 (đặt lệnh) cố ý chưa làm: **`docs/SSI-TRADING.md`**.
**Đọc file đó trước khi động vào phần tài khoản SSI.**

## 9. Trạng thái hiện tại

**Chạy dữ liệu thật end-to-end tại https://dashboardstock.io.vn** — `USE_MOCK: false`.
Cache busting `?v=20260815a`. Nhánh `main` sạch, đã push, backend đã deploy bản
mới nhất (đã kiểm 15/08 trên Render: `/api/price/history` sau khi bỏ chunk 30
ngày, job snapshot ghi được vào Supabase).

**Dữ liệu vẫn đang đọc từ localStorage.** GĐ 5 đã đưa dữ liệu LÊN Supabase
(watchlist 5 mã + `settings` + 1 dòng vàng) nhưng `STORE_ENABLED: false` nên mọi
trang vẫn đọc bản trong trình duyệt. Bật cờ đó là việc 5.8 — xem mục 10.

Website hiện có **đủ 6 trang**. Năm trang kênh đầu tư đã đầy đủ:
`/chung-khoan.html`, `/ngoai-te.html`, `/vang.html`, `/coin.html`,
`/tiet-kiem.html`. Riêng `/` (tổng gia sản) vẫn là khung — chờ GĐ 5+6.

| Tính năng | Nguồn | Ghi chú |
|---|---|---|
| Giá / nến / chỉ số | SSI FCData | chunk **365 ngày** (đổi 15/08, xem mục 7); index intraday tái tạo từ RatioChange |
| **Chart chỉ số** | SSI `DailyIndex` | bấm thẻ chỉ số = vẽ **đường** (không có OHLC); 5 ô thống kê toàn sàn |
| Chart khung thời gian | — | 1M / 3M / 6M / 1Y / 5Y (30/90/180/365/1825 ngày) |
| Ticker tape | rổ VN30 | tách khỏi watchlist; backend warm cả 30 mã |
| Bản đồ nhiệt VN30 | quote đã warm | 30 ô alpha tint, có vòng accent cho mã đang chọn; chưa sizing theo vốn hóa |
| Theo ngành / Top tăng-giảm / Khối ngoại / Tín hiệu | quote + history | 5 tab, thuần client-side |
| Chỉ số cơ bản (10 ô) | VNDirect finfo | ratios + tự tính YoY & nợ/VCSH |
| Tin tức theo mã | CafeF RSS | đã sửa regex tiếng Việt |
| Watchlist | **`Store`** (driver localStorage) | kéo thả sắp xếp, sparkline SVG |
| Lịch sử giao dịch tay | **`Store`** (driver localStorage) | giá vốn bình quân gia quyền |
| Danh mục thật SSI (chỉ đọc) | SSI FCTrading | GĐ1, xem mục 8 |
| **Bảng tỷ giá** (trang Ngoại tệ) | Vietcombank XML | 20 mã, bán lẻ; ô VCB không niêm yết hiện `—` và luôn xuống cuối khi sắp xếp |
| **Chart tỷ giá** (trang Ngoại tệ) | FXRatesAPI | đường, **chỉ 1M/3M/6M/1Y** — nguồn free hết lịch sử ở 366 ngày |
| Ghim mã ngoại tệ / quy đổi 2 chiều | `Store` + bảng VCB | quy đổi dùng giá mua chuyển khoản (bán cho NH) và giá bán (mua từ NH) |
| **Danh mục ngoại tệ** | `Store` (`holdings_fx`) | danh sách nắm giữ **sửa tại chỗ**, không phải sổ giao dịch; định giá theo giá mua chuyển khoản VCB |
| **Bảng giá vàng** | PNJ (dự phòng BTMC) | 20 loại; đổi đơn vị lượng/chỉ/gram; cảnh báo chênh lệch mua-bán ≥5% |
| **Danh mục vàng** | `Store` (`holdings_gold`) | cùng khuôn `holdings_fx`; giá vốn nhập theo **triệu ₫/lượng**; định giá theo giá tiệm **mua vào** |
| **Giá coin** | Binance + tỷ giá dự án | CoinGecko **chặn IP Render** — xem mục 7. VND là số **quy đổi**, trang ghi nhãn |
| **Danh mục coin** | `Store` (`holdings_crypto`) | cùng khuôn hai trang kia; giá vốn nhập theo **₫/1 coin** |
| **Tổng quan thị trường** | `/indices` + `/index-history` | tab đầu của trang chứng khoán: KL phiên/tuần/mã chọn + độ rộng; **0 endpoint mới** |
| **Lãi suất tiết kiệm** | CafeF CDN | 29 NH × 8 kỳ hạn, có logo; ô cao nhất mỗi kỳ hạn tô đậm; nhãn **"lấy lúc"** |
| **Sổ tiết kiệm** | `Store` (`savings_accounts`) | lãi cuối kỳ; **cảnh báo đáo hạn 30/15/7 ngày** đặt trên cùng trang |
| **Nút con mắt** (ẩn số tiền) | — | toàn site, xem mục 3b |
| Giao diện | Fey design system | **sáng mặc định** (đổi 08/08), **không còn Liquid Glass** — mục 3 |
| Keep-alive | pinger ngoài 5 phút + Actions dự phòng | xem mục 6 |
| **Đăng nhập** | Supabase Auth, magic link | PKCE; tài khoản tạo sẵn trong dashboard, đã tắt tự đăng ký |
| **Cảnh báo đơn vị giá vốn** | `costGuard.js` | 3 trang tài sản; so với giá thị trường đang hiện, không ngưỡng cứng; hai nhịp |
| **Snapshot giá hàng ngày** | job trong `server/index.js` | ghi `price_snapshots` mỗi giờ, upsert 1 hàng/ngày/loại; cần `SUPABASE_SECRET_KEY` trong env Render |

### Nhật ký theo phiên

**15/08/2026 (phiên 10) — GĐ 5 xong 7/8 đầu việc + biểu đồ nhanh gấp 2.**
Bump `?v=20260811a` → **`?v=20260815a`**. **Có đụng `server/` hai lần** (bỏ giới
hạn chunk 30 ngày, thêm job snapshot) → Render đã deploy lại, đã kiểm live.

**GĐ 5 — Supabase.** Làm 5.1→5.7, chỉ còn 5.8 (bật `STORE_ENABLED` + đối chiếu
điện thoại). Thứ tự cố ý: **nút xuất JSON làm TRƯỚC mọi thứ khác** — lối thoát
phải tồn tại trước khi có bất kỳ đường ghi nào lên DB.

- `supabase/schema.sql`: **9 bảng chứ không phải 7** như quy hoạch ghi — thêm
  `watchlist` (là collection riêng trong `store.js`, khoá legacy, bảng đếm 7 bỏ
  sót) và `price_snapshots` cho 5.7. RLS bật ngay trong cùng file với lệnh tạo
  bảng. Chạy lại nhiều lần không hỏng.
- Đăng nhập magic link, **PKCE không phải implicit**; `shouldCreateUser: false`
  + đã tắt "Allow new users to sign up" trên dự án.
- `store.js` giữ facade, driver thật ở `store-supabase.js`. **Hai cờ tách riêng**
  `AUTH_ENABLED` / `STORE_ENABLED` — xem `config.js`.
- `migrate.js` (5.5) nhập được từ **localStorage HOẶC file .json**. Đường thứ hai
  không phải cho sang: xem bài học "hai origin" ở mục 7.
- 5.7: job ghi snapshot tỷ giá/vàng/lãi suất **mỗi giờ** (không phải mỗi 24h),
  upsert theo `unique(kind, taken_on)`. Đã chạy thật trên Render, 3 dòng ngày
  15-08 có dữ liệu đúng (USD bán 26.330 · SJC 14.100/14.400 nghìn đ/chỉ · 29 NH).

**Dữ liệu cũ gần như KHÔNG có** — đây là phát hiện làm đổi hẳn mức rủi ro của
5.5, và mục 10 cũ ghi sai. Chi tiết ở bài học "hai origin" mục 7. Toàn bộ tài sản
thật của user: watchlist 5 mã + `privacyMode` + 1 dòng vàng thử. User xác nhận
**mới chỉ dùng trang chứng khoán**, các trang khác chỉ xem tham khảo.

**Biểu đồ chứng khoán nhanh gấp 2** — hai thay đổi tách làm hai lần deploy, cố ý,
để hỏng cái nào còn biết. Chi tiết + số đo ở bài học mục 7.

Việc chen ngang (phiên nền riêng): `costGuard.js` — cảnh báo nhập sai đơn vị ở ô
giá vốn 3 trang tài sản, hai nhịp, so với **giá thị trường đang hiển thị** chứ
không phải ngưỡng cứng.

**08/08/2026 (phiên 9) — đổi theme mặc định + sửa lỗi so sánh khối lượng ngày nghỉ.**
Bump `?v=20260808a` → **`?v=20260808b`**. **Có đụng `server/`** (thêm 1 trường),
Render đã deploy lại, đã kiểm live.

- **Theme mặc định đổi TỐI → SÁNG** theo yêu cầu user. Mặc định nằm ở
  `data-theme` của thẻ `<html>` **trong từng trang** nên phải sửa cả 6 file HTML;
  `theme.js` chỉ là lưới an toàn khi thẻ đó thiếu. Sửa mỗi `theme.js` thì mỗi
  trang mở ra một màu. Nút Sáng/Tối vẫn đổi được như cũ.
- **Lỗi số liệu phát hiện khi kiểm theme:** tab Tổng quan hiện "Khối lượng phiên
  +0,0%" với hai con số y hệt — chi tiết ở mục 7. Đã sửa: `/api/price/indices`
  trả thêm `tradingDate`, client so theo ngày đó thay vì theo đồng hồ máy.
  Đo lại: VNINDEX 647,7 triệu vs 578,9 triệu = **+11,9%**, nhãn "phiên 07-08 so
  với 06-08", ghi chú đổi thành "Thị trường đang nghỉ".

Đã kiểm mắt cả trang chứng khoán, tiết kiệm và coin ở nền sáng: bảng, biểu đồ,
logo, thanh độ rộng thị trường đều đọc được; bản live cũng đã kiểm.

Các phiên trước đó: **`docs/NHATKY.md`**.

## 10. Việc còn treo

### BẮT ĐẦU TỪ ĐÂU (phiên sau đọc mục này trước)

Cây làm việc sạch, đã push, backend đã deploy, bản live đã kiểm.
**GĐ 5 xong 5.1–5.7. Còn đúng 5.8 và đó là việc kế tiếp.**

Dữ liệu **đã nằm trên Supabase** (watchlist 5 mã · `settings` · 1 dòng vàng)
nhưng `STORE_ENABLED: false` nên mọi trang **vẫn đọc localStorage**. Hai nguồn
đang song song, cố ý, để so được trước khi chuyển hẳn.

#### Việc kế tiếp: 5.8 — bật `STORE_ENABLED` + đối chiếu điện thoại

Đây là **lý do tồn tại của cả GĐ 5**: sửa trên máy tính, mở điện thoại thấy đúng.
Cũng là bước duy nhất còn rủi ro thật.

1. **BUMP `?v=` TRƯỚC** — xem cảnh báo ngay dưới, không làm là bước 3 vô nghĩa.
2. Đổi `STORE_ENABLED: false` → `true` trong `assets/js/core/config.js`, push.
3. Máy tính: đăng nhập → trang Chứng khoán phải ra đúng `SSI · ACB · VCB · HPG ·
   FPT`; trang Vàng ra 1 dòng SJC.
4. Điện thoại: mở trang → phải thấy **dải cảnh báo cam** → đăng nhập → phải thấy
   **cùng** 5 mã đó.
5. Thêm một mã trên máy tính → tải lại trên điện thoại → phải thấy mã mới.
6. Sai bất kỳ chỗ nào: đổi cờ về `false`, push. Quay lại localStorage ngay,
   **dữ liệu cũ còn nguyên vì chưa hề xoá**. Đừng xoá localStorage cho tới khi
   bước 5 chạy đúng ít nhất một lần.

**⚠ CHƯA BUMP `?v=` — 6 FILE ĐANG LỆCH.** Chuỗi `?v=20260815a` được đặt ở commit
`346ae45` (costGuard), rồi **ba commit sau đó vẫn sửa asset mà không bump**:

| File | Commit sửa sau khi bump |
|---|---|
| `pages/chung-khoan.js` | `fc8d246` gộp 2 lần gọi lịch sử |
| `core/store-supabase.js`, `pages/tong.js` | `a3e63db` (5.5) |
| `core/store.js`, `core/nav.js`, `css/base.css` | `0fb0b59` dải cảnh báo |

Trình duyệt nào đã tải `20260815a` giữa các lần deploy sẽ dùng bản cache cũ.
Nguy hiểm nhất là `nav.js` + `store.js`: thiếu chúng thì **không có dải cảnh báo
chưa đăng nhập** — đúng thứ bước 4 cần kiểm. Bump `20260815b` ở cả 6 file HTML
trước khi làm 5.8.

**Cách kiểm nhanh loại lỗi này** (đưa vào quy trình handoff từ nay):
```bash
git diff --name-only <commit-bump-cuoi>..HEAD -- 'assets/**' | grep -E '\.(js|css)$'
```
Ra file nào tức là file đó đang phục vụ dưới một chuỗi `?v=` đã cũ.

**Giới hạn email 2/giờ.** SMTP có sẵn của Supabase chỉ cho 2 email/giờ và họ nói
rõ nó chỉ để thử nghiệm. Bước 4 tốn một email. Hết hạn mức thì **chờ ~1 tiếng**,
đừng vội gắn SMTP riêng: `persistSession` + `autoRefreshToken` giữ đăng nhập lâu
dài, mỗi thiết bị chỉ đăng nhập một lần, nên giới hạn này chỉ khó chịu lúc đang
thử đi thử lại. Chỉnh `Auth → Rate Limits` **vô ích** nếu chưa gắn SMTP riêng.

#### Sau 5.8: GĐ 6 — Trang tổng gia sản

Lúc đó `Store` đã đọc DB nên gom 5 kênh về một chỗ mới làm được. Xem `docs/
QUYHOACH.md` bảng GĐ 6, và mục 6.5 là mục quan trọng nhất (kênh lỗi nguồn phải
ghi rõ "chưa tính được kênh X", **không lặng lẽ tính thiếu**).

#### Còn nợ trong GĐ 5

- **Đường upsert của job snapshot chưa chứng minh.** Lần ghi thứ hai trong ngày
  (đè lên hàng cũ) chỉ chạy vào lượt hàng giờ tiếp theo. Rủi ro thấp: nếu
  `merge-duplicates` không ăn thì `unique(kind, taken_on)` từ chối, job ghi log
  lỗi rồi bỏ qua — mất một lần cập nhật, không hỏng dữ liệu. **Cách kiểm:** đọc
  `price_snapshots` bằng publishable key (bảng này ai đọc cũng được), đếm phải
  đúng 1 dòng mỗi loại mỗi ngày, không nhân lên.
- `docs/QUYHOACH.md` vẫn ghi "schema 7 bảng" — thực tế **9**. Sửa khi tiện.

Khuôn mẫu nếu cần thêm trang tài sản: **trang Tiết kiệm hoặc Coin** (mới nhất).
Thành phần dùng chung (`.asset-table`, `.hold-*`, `.src-badge`, `.row-btn`,
`.edit-input`, `.chart-stack`, `.chart-wrap`, `.trend-overlay`) đã nằm ở
`base.css` — **đừng chép lại vào CSS trang mới**.

**CoinMarketCap đã bị gỡ 07/08** — gói có API key là gói trả phí, user chốt
không dùng. Đừng dựng lại.

**Việc còn nợ khi làm GĐ 6 (trang tổng):** giá trị danh mục ngoại tệ và vàng
hiện chỉ tính trong trang của chúng. Trang tổng phải đọc `holdings_fx` +
`holdings_gold` từ `Store` rồi định giá bằng `/api/fx/rates` và
`/api/gold/prices`. Logic quy đổi đang nằm trong `ngoai-te.js` và `vang.js`
(cùng tên `holdRow`, hai bản khác nhau) — khi cần dùng ở hai nơi thì tách sang
`assets/js/core/`, đừng chép bản thứ ba.

**Cần soát lại khi có dữ liệu nhiều ngày:** ngưỡng cảnh báo chênh lệch mua-bán
vàng đang để 5%, dựa trên đúng một lần đo (mục 9).

**Còn nợ ở trang Coin:** căn nguyên lỗi "lần vẽ đầu không hiện đường" chưa tìm
ra, đang vá bằng cách vẽ lại sau 400ms (mục 7). Và bảng ticker nội bộ chỉ ~40
coin — coin ngoài bảng vẫn thêm được khi CoinGecko trả lời, nhưng ở production
thì không.

**Đừng "sửa lại cho gọn" sáu chỗ sau của GĐ 5:**
1. **Hai cờ `AUTH_ENABLED` / `STORE_ENABLED` tách riêng** — không gộp. Đăng nhập
   được mà chưa chuyển kho dữ liệu là trạng thái hợp lệ và cần thiết.
2. **`shouldCreateUser: false`** trong `auth.js` — gõ nhầm email phải báo lỗi,
   không được lặng lẽ mở tài khoản rỗng thứ hai. Đã tắt tự đăng ký trên dự án.
3. **Nút "Lấy từ file sao lưu"** trong `migrate.js` — lý do ở bài học "hai origin"
   mục 7. Không phải tính năng cho sang.
4. **`Store.exportLocal()`** đọc thẳng localStorage bỏ qua driver. Màn hình nhập
   phải dùng nó; dùng `exportAll()` thì khi driver đã là Supabase, nguồn và đích
   là một — xuất ra chính cái DB rỗng đang định ghi vào.
5. **`id` trong schema để kiểu `text` chứ không phải `uuid`** — `Store.add` sinh
   id base36, đổi sang uuid là mọi id trong file sao lưu cũ thành vô nghĩa.
6. **`cost` cho phép NULL** ở 3 bảng danh mục. "Không theo dõi lãi/lỗ" khác
   "giá vốn bằng 0"; đổi thành `not null default 0` là lãi/lỗ hiện +100%.

**Đừng "sửa lại cho đúng quy hoạch" ba chỗ sau của trang Ngoại tệ:**
1. Nguồn lịch sử là **FXRatesAPI, không phải Yahoo** — Yahoo chặn IP Render
   (mục 7). `docs/QUYHOACH.md` mục 2.10 đã sửa theo.
2. **Không có nút 5Y** — nguồn free hết dữ liệu ở 366 ngày. Muốn có 5Y thì phải
   đổi nguồn (cần API key, user tự đăng ký), không phải sửa frontend.
3. Bảng và biểu đồ lệch ~0,8% là **đúng**, không phải lỗi: bán lẻ có biên
   mua-bán vs liên ngân hàng một giá. Nhãn nguồn ở cả hai chỗ là bắt buộc
   (mục 1.5), đừng gỡ cho gọn.

Ba việc chen ngang đã làm xong ngoài quy hoạch (03–04/08): reskin Fey, bước A và
bước B của chart chỉ số. Không ảnh hưởng thứ tự GĐ 1–7.

### Tiến độ quy hoạch (chi tiết ở `docs/QUYHOACH.md`)

| GĐ | Nội dung | Trạng thái |
|---|---|---|
| 0 | Tái cấu trúc nền: tách CSS/JS, `nav.js`, `store.js`, `portfolio.js` | ✅ 31/07 |
| 1 | **Ngoại tệ** — bảng VCB, biểu đồ liên ngân hàng, quy đổi, danh mục | ✅ 06/08 (8/8) |
| 2 | **Vàng** — PNJ/BTMC, quy đổi lượng-chỉ-gram, danh mục, cảnh báo chênh lệch | ✅ 06/08 (6/6) |
| 3 | **Coin** — giá VND, danh sách theo dõi, biểu đồ, danh mục | ✅ 07/08 (4/4) |
| 4 | **Gửi tiết kiệm** — bảng lãi suất, so sánh, sổ + cảnh báo đáo hạn | ✅ 08/08 (8/8) |
| **5** | **Supabase + đăng nhập** — khó nhất | ▶ **7/8** (15/08) — còn 5.8 |
| 6 | **Tổng gia sản** — gom 5 kênh về VND, biểu đồ tròn, dòng tiền | chờ 5.8 |
| 7 | **Đồng bộ số dư Binance** — key chỉ-đọc, ký HMAC, tránh đếm trùng | chờ |

Chi tiết GĐ 5: 5.1 schema ✅ · 5.2 RLS ✅ · 5.3 magic link ✅ · 5.4 driver ✅ ·
5.5 nhập dữ liệu ✅ · 5.6 xuất JSON ✅ · 5.7 snapshot ✅ · **5.8 chưa**.

Việc chen ngang đã làm ngoài quy hoạch: reskin Fey (03/08), chart chỉ số
(04/08), tab Tổng quan thị trường (07/08), theme mặc định Sáng (08/08),
biểu đồ nhanh gấp 2 + cảnh báo đơn vị giá vốn (15/08).

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
   `http://` hiện vẫn trả 200. **Ưu tiên cao hơn trước**: bản `http://` có kho
   localStorage RIÊNG và `github.io` chuyển hướng về đúng bản đó — xem bài học
   "hai origin" mục 7.
3. GitHub tự tắt scheduled workflow sau 60 ngày repo không commit → tab Actions
   bấm *Enable workflow* khi cần.

### Đã cấu hình trên dịch vụ bên thứ ba (user đã làm, đừng hỏi lại)

**Supabase** — project `kndumltxfrhqxbjrlice`, region Singapore, gói free:
- Tài khoản đăng nhập `hoangduy2401@gmail.com` tạo sẵn trong dashboard, đã bật
  Auto Confirm. **Đã TẮT "Allow new users to sign up"** — không thì ai đọc mã
  nguồn trang cũng lấy được publishable key rồi tự mở tài khoản trên dự án.
- Site URL + Redirect URLs đã đặt: `https://dashboardstock.io.vn/**`,
  `http://localhost:5599/**`, `http://127.0.0.1:5599/**`.
- `supabase/schema.sql` đã chạy: 9 bảng, `rls = true` cả 9, mỗi bảng 1 policy.
  **Kiểm lại được bằng câu tự kiểm ở cuối file đó.**

**Render** — env đã có `SUPABASE_URL` + `SUPABASE_SECRET_KEY` cho job snapshot.
Khoá `sb_secret_...` **bỏ qua RLS**, chỉ sống trong env Render, không bao giờ vào
repo và không bao giờ ra frontend. Tên biến ghi ở `server/.env.example`.

---

## 11. Ý tưởng dài hạn (chưa yêu cầu cụ thể)

Đánh giá phương pháp luận FiinTrade (4 tầng khả thi, Tầng 4 KHÔNG làm được vì
cần order book cấp 2 real-time) và các ý tưởng khác: **`docs/YTUONG.md`**.

---

## 12. Môi trường máy local

- **Không có `gh` CLI.** Git push dùng PAT lưu trong osxkeychain (scope `repo` +
  `workflow`), push chạy thẳng không cần nhập lại.
- **Không có Homebrew.**
- Node v24, npm 11. Shell zsh — lưu ý `read -p` không chạy như bash, dùng
  `printf "..."; read -s VAR`.
- Test server local: `cd server && PORT=3999 node index.js`
- Serve frontend: `python3 -m http.server 5599` từ thư mục repo. `.claude/launch.json`
  khai báo sẵn cấu hình này để mở thẳng trong trình duyệt của Claude Code.
