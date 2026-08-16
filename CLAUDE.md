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

Cache busting hiện **`?v=20260816k`** (73 chỗ trong 6 file HTML).

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
- DNS: **đủ 4 bản ghi A** `@` → `185.199.108/109/110/111.153`; CNAME `www` →
  `hoangduy2401-web.github.io.` **Mắt Bão CHO nhiều bản ghi A** — ghi chú cũ
  "chỉ cho 1, phải chuyển sang Cloudflare" là phỏng đoán sai, đã bác bỏ 15/08.
- File **`CNAME` ở gốc repo bắt buộc** — xóa: mất tên miền, trang rơi về URL cũ.
  GitHub tự tạo file này khi khai báo custom domain (Settings → Pages), đừng
  commit trùng (bị 1 lần, phải `git reset --hard`).
- HTTPS: chứng chỉ Let's Encrypt do GitHub cấp và tự gia hạn.
- **Enforce HTTPS: ĐÃ BẬT 15/08/2026.** Trước đó bị chặn vì tên miền gốc chỉ có
  1 bản ghi A (GitHub đòi đủ 4). Thêm 3 IP còn lại ở Mắt Bão là ô Enforce HTTPS
  hết mờ, tích được ngay — không phải chuyển nameserver đi đâu cả.
  Kiểm: `dig +short dashboardstock.io.vn A` ra 4 dòng, và
  `curl -sI http://dashboardstock.io.vn` trả **301** (trước là 200).
- `config.js` vẫn giữ `forceHttps()` chuyển hướng phía trình duyệt làm **lưới
  thứ hai**. Nay thừa vì đã có 301 ở tầng máy chủ, nhưng vô hại và cứu được nếu
  ai đó lỡ tắt Enforce HTTPS. Cửa thoát `?http-ok=1` để đọc kho `http://` cũ.
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

### Chế độ riêng tư để lọt GIÁ VỐN ở cả 4 trang danh mục (16/08/2026)

**Triệu chứng.** Không ai báo — tìm ra khi rà soát 6.6.

**Cách rà, phần đáng tái sử dụng.** Đừng nhìn mắt. Nạp dữ liệu với mọi con số
đều chứa một chuỗi nhận dạng (`777`), bật riêng tư, rồi với TỪNG Ô trong bảng
danh mục kiểm xem nó có nằm trong `.money` không:
```js
[...document.querySelectorAll('.hold-table tbody tr td, #holdTableBody tr td')]
  .map(td => ({ txt: td.textContent.trim(),
                money: !!td.querySelector('.money') || td.classList.contains('money') }))
```
Cách này bắt được cả ô mà mắt lướt qua, và bắt được đều trên mọi trang.

**Nguyên nhân.** Cột giá vốn chưa bao giờ được bọc `.money`, ở CẢ BỐN trang:
`vang.js` "77,7 tr/lượng" · `ngoai-te.js` "24.777,00" · `coin.js`
"1.777.000.000" · `chung-khoan.js` "Giá vốn TB" (2 chỗ). Số lượng, giá trị và
lãi/lỗ đều che đúng — sót đúng một cột, và sót giống nhau ở mọi trang vì các
trang chép khuôn của nhau.

**Vì sao đó là lỗi.** Giá vốn là dữ liệu giao dịch riêng, không phải giá thị
trường. Mục đích nút con mắt là mở trang cho người khác xem mà không lộ tài
chính cá nhân; lộ điểm mua vào là hỏng đúng phần đó. Giá THỊ TRƯỜNG thì vẫn phải
hiện (141.000.000 bảng vàng, 25.950 tỷ giá VCB, 68,30 của FPT) — mục 3.5.

**Cố ý KHÔNG che, đừng "sửa nốt":** ô `<input>` khi bấm Sửa một dòng vẫn hiện số
thật. `.money` che nội dung văn bản, không che `value` của input. Người bấm Sửa
chính là chủ máy; che ô đang sửa thì không nhập được.

### Khoá mã 6 số KHÔNG phải bảo mật — biết trước kẻo hiểu nhầm (16/08/2026)

User yêu cầu thêm lớp mã cho nút con mắt. Đã làm, nhưng phải nói rõ mức bảo vệ
và đã viết câu này ngay trên giao diện: **đây là trang tĩnh, người biết mở
DevTools gỡ lớp này trong mười giây** (xoá một class trên `<html>`). Nó chặn
NGƯỜI ĐỨNG CẠNH, không chặn kẻ có kỹ thuật. Lớp chặn thật cho dữ liệu vẫn là
đăng nhập + RLS.

**Chỉ hỏi mã khi HIỆN số, không hỏi khi ẩn — đừng đổi thành hỏi cả hai chiều.**
Hỏi lúc ẩn vừa vô dụng (người lạ bấm con mắt lần nữa là hiện lại) vừa có hại
(cần che gấp thì lại loay hoay gõ 6 số).

Mã lưu dạng **băm SHA-256 + chuỗi muối**, không lưu số trần. Không phải vì băm
chống được dò — 6 chữ số dò hết tức thì — mà vì mã đồng bộ lên Supabase, không
có lý do gì để nó nằm đó ở dạng đọc được. Quên mã thì xoá khoá `privacyPinHash`
trong bảng `settings` trên Supabase.

### Part-to-whole: thanh xếp chồng, KHÔNG phải biểu đồ tròn (16/08/2026)

`docs/QUYHOACH.md` 6.3 ghi "biểu đồ tròn phân bổ tài sản". **Đã làm thanh xếp
chồng ngang thay thế — đừng đổi ngược lại mà không đọc đoạn này.** Lý do: 5 kênh,
tên tiếng Việt dài, và mắt người đọc CHIỀU DÀI chính xác hơn đọc GÓC nhiều. Đổi
lại hình tròn chỉ cần sửa `renderAllocation()`, phần tính toán không dính gì.

**Bảng màu đã chạy qua validator ở đúng hai nền của dự án, đừng đổi bằng mắt:**

| | Sáng `#ffffff` | Tối `#121212` |
|---|---|---|
| Màu | `#2a78d6 #eb6834 #1baf7a #eda100 #e87ba4` | `#3987e5 #d95926 #199e70 #c98500 #d55181` |
| ΔE mù màu (≥8) | 9,1 | 8,4 |
| ΔE mắt thường (≥15) | 19,6 | 19,3 |

Nền sáng có cảnh báo tương phản < 3:1 — **được phép vì đã có cả chú giải có nhãn
lẫn bảng số ngay dưới**, không phụ thuộc màu để phân biệt. Bỏ một trong hai thứ
đó đi là cảnh báo thành lỗi thật.

Màu gán **cố định theo kênh, không theo thứ hạng**: giá biến động thì bảng màu
vẫn đứng yên. Gán theo thứ hạng là mỗi lần tính lại màu nhảy lung tung.

### `Portfolio.computeHoldings()` lấy giá vốn làm giá hiện tại khi thiếu quote

Không phải lỗi mới, nhưng là bẫy sẽ cắn lại ở GĐ 7. `portfolio.js` khi không có
quote cho một mã thì dùng `avgCost` làm `currentPrice` → lãi/lỗ ra đúng 0 và
`marketValue` trông vẫn hợp lý. Tổng tài sản vì thế SAI mà không có dấu hiệu gì.

`core/networth.js` **cố ý không dùng đường đó**: nó tự hỏi quote từng mã, mã nào
không có thì đếm riêng và khai báo vào `partial`. Đừng "tối ưu" bằng cách gọi lại
`computeHoldings` cho gọn.

Lưu ý đơn vị: `computeHoldings` trả `marketValue` theo **triệu đồng**, còn
`networth.js` làm việc bằng **VND**. Trộn hai cái là sai một triệu lần.

### SSI trả GIÁ 0 cho mã không tồn tại, không báo lỗi (16/08/2026)

**Triệu chứng.** Danh mục tay chứng khoán có mã bịa "ZZZ" hiện lỗ -100% và kéo
tụt tổng danh mục đúng bằng giá vốn.

**Nguyên nhân.** `DataService.getQuote('ZZZ')` trả `{price: 0, changePct: 0,
volume: 0}` — SSI không phân biệt "mã không tồn tại" với "giá bằng 0". Đo trực
tiếp, không phải đoán.

**Cách sửa.** Ở `portfolio.js`: coi `giá <= 0` là "không có giá" (trả null),
không phải giá bằng không. Cổ phiếu đang giao dịch không bao giờ có giá 0.

**Đây là lỗi THỨ HAI chồng lên lỗi cũ.** Lỗi cũ: `computeHoldings` dùng
`currentPrices[sym] || avgCost` — mã thiếu quote được định giá bằng chính giá
vốn, P&L ra 0, tổng vẫn cộng con số giả (đúng loại "lặng lẽ tính sai" mà luật
vàng mục 3 cấm). Cả hai nay trả null; chỗ gọi hiện "—"/"chưa có giá" và loại
khỏi phép cộng, tiêu đề đổi thành "Giá trị danh mục (chưa đủ)".

**Đo sau khi sửa, 3 mã cùng lúc:** FPT (VN30) 68,30 +8,3; SZC (ngoài cả 2 rổ)
19,50 -21,0 — `loadHoldingQuotes()` lấy được; ZZZ (bịa) "—" loại khỏi tổng.
Lãi/lỗ tạm tính -12,7 = 8,3-21,0 (trước khi sửa là -17,7 vì nuốt -5,0 giả của
ZZZ).

**Ghi chú mục 10 cũ ĐÃ SAI, đã sửa:** nó viết "mã ngoài watchlist+VN30 dùng giá
vốn... fetch thêm quote nếu muốn P&L live" — nhưng `loadHoldingQuotes()` ĐÃ đi
fetch từ trước, chú thích của nó nói y hệt. Lỗ hổng thật chỉ ở ĐƯỜNG THẤT BẠI
của lần fetch đó. `networth.js` (trang tổng) không dính vì nó cố ý tự hỏi quote
riêng, biết trước cái bẫy này.

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

**ĐÃ CẮN LẦN THỨ HAI cùng ngày, tốn thêm gần một buổi.** Sau khi bật
`STORE_ENABLED`, máy tính hiện 6 mã còn điện thoại hiện 5. Đã đi lạc qua hai giả
thuyết sai trước khi tìm ra: (a) trình duyệt nhúng trong app Gmail — sai, user
mở đúng Safari; (b) PKCE trói link vào trình duyệt gửi yêu cầu — đúng về lý
thuyết nhưng không phải nguyên nhân lần này. Sự thật: **máy tính đang mở tab
`http://`** còn lại từ lúc lấy bản sao lưu, chưa đăng nhập ở origin đó, nên mã
mới rơi vào localStorage của `http://` và không bao giờ lên DB.

**Đã sửa tận gốc 15/08:** thêm đủ 4 bản ghi A ở Mắt Bão → bật được Enforce HTTPS
→ `http://` nay trả 301. Thêm `forceHttps()` trong `config.js` làm lưới thứ hai.
Xem mục 6.

**Bài học rộng hơn — thứ đáng nhớ nhất của phiên này:** khi hai thiết bị hiện hai
kết quả khác nhau, ĐỪNG đoán. Không có cách nào mở DevTools trên iPhone, nên đã
làm hẳn **bảng chẩn đoán trong panel Tài khoản** (`auth.js`, `renderDiag`) in ra
origin · phiên bản JS · driver đang dùng · watchlist đọc THẲNG từ Supabase. Bảng
đó chỉ ra nguyên nhân trong một lần nhìn, sau khi hai giả thuyết đã đi lạc. Giữ
lại bảng đó.

### Magic link bị trói vào trình duyệt đã bấm nút gửi — PKCE (15/08/2026)

**Triệu chứng.** Bấm "Gửi liên kết đăng nhập" trên máy tính, mở link trong email
bằng điện thoại → không đăng nhập được, và tốn một lượt trong hạn mức 2 thư/giờ.

**Nguyên nhân.** `auth.js` đặt `flowType: "pkce"`. Luồng đó sinh một *code
verifier* và lưu vào bộ nhớ của **trình duyệt gửi yêu cầu**; lúc mở link phải có
đúng mã đó mới đổi được phiên. Tài liệu Supabase nói thẳng: *"the code exchange
must be initiated on the same browser and device where the flow was started."*

**Cách dùng đúng.** Muốn đăng nhập thiết bị nào thì bấm nút gửi **từ chính thiết
bị và trình duyệt đó**. Sao chép link sang máy khác không cứu được — thứ thiếu
không phải link mà là mã nằm trong bộ nhớ máy kia.

**Đừng đổi sang implicit cho tiện.** PKCE được chọn có lý do: token không bao giờ
nằm trong URL. Fragment `#access_token=` của implicit lọt vào lịch sử trình duyệt
và các tiện ích mở rộng đọc được. Ràng buộc cùng-trình-duyệt là cái giá phải trả.

**Thêm một bẫy phụ trên iPhone:** bấm link trong app Gmail mở bằng trình duyệt
nhúng của app đó, không phải Safari — lại là một kho lưu trữ khác. Giữ ngón vào
link → *Sao chép* → dán vào Safari.

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
2. **Chunk 30 ngày là bắt buộc** cho `index-history`, không phải chọn lựa (xem
   "Format SSI thật" ở `docs/BAIHOC-CU.md`). Lưu ý: giới hạn này CHỈ còn ở
   `DailyIndex`; `DailyOhlc` (cổ phiếu) đã bỏ chunk 30 từ 15/08 — mục 7.
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

### Tín hiệu FiinTrade — 5 chỗ CỐ Ý làm khác tài liệu → `docs/BAIHOC-CU.md`

`signals.js` cố ý làm khác tài liệu FiinTrade 5 chỗ (ROC ngưỡng 0 không phải
30/70; RSI cắt có cửa sổ 3 phiên; không có KL ước lượng trong phiên; "thủng đáy"
dùng `giá < đáy`; đỉnh/đáy theo giá đóng cửa). **Đừng "sửa lại cho đúng tài
liệu"** — cả 5 đã cân nhắc, user duyệt, và đo thật. Ba ràng buộc kiến trúc kèm
theo (SIG_DAYS=180 cố định; quét rổ lazy ngoài `refreshAll`; badge gọi sau chart)
cũng ở đó. **Chi tiết + số đo: `docs/BAIHOC-CU.md`. Đọc trước khi động vào
`signals.js`.**

---

## 8. FastConnect Trading — GĐ1 chỉ đọc (ĐÃ triển khai, đang chạy)

Endpoint `/api/account/{otp,login,portfolio}`, chỉ đọc, không đặt lệnh được.
Bảo mật riêng (`x-dashboard-key` + origin allowlist), 5 cạm bẫy FCTrading đã gặp,
và lý do GĐ2 (đặt lệnh) cố ý chưa làm: **`docs/SSI-TRADING.md`**.
**Đọc file đó trước khi động vào phần tài khoản SSI.**

## 9. Trạng thái hiện tại

**Chạy dữ liệu thật end-to-end tại https://dashboardstock.io.vn** — `USE_MOCK: false`.
Cache busting `?v=20260816k`. Nhánh `main` sạch, đã push, backend đã deploy bản
mới nhất (đã kiểm 15/08 trên Render: `/api/price/history` sau khi bỏ chunk 30
ngày, job snapshot ghi được vào Supabase).

**Dữ liệu đọc từ Supabase** (`STORE_ENABLED: true` từ 15/08). Mỗi thiết bị đăng
nhập một lần rồi ở lại lâu. localStorage vẫn giữ nguyên làm đường lui — chưa xoá.

**Website đủ 6 trang chạy thật**, kể cả `/` (tổng gia sản) từ 16/08.


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
| **Tổng gia sản** (`/`) | `core/networth.js` | gom 5 kênh về VND; kênh lỗi nguồn **không cộng vào tổng** và phải nói tên ra |
| **Phân bổ tài sản** | — | thanh xếp chồng ngang (không phải biểu đồ tròn — mục 7); màu cố định theo kênh |
| **Dòng tiền vào/ra** | `Store` (`cash_flows`) | tách "tăng do giá" khỏi "nạp thêm tiền" |
| **Khoá mã 6 số** | `nav.js` + `settings` | chỉ hỏi mã khi HIỆN số; **không phải bảo mật thật** — mục 7 |
| **Momentum Score A–F** | `signals.js` `momentum` | tab Tín hiệu, cột "Đà"; phân vị TRONG RỔ, không phải ngưỡng tuyệt đối |
| **Đột biến khối lượng** | `signals.js` `volSpike` | tab Giá–KL; KL phiên cuối ≥2× TB 20 phiên; tách giá lên/xuống |
| **Snapshot giá hàng ngày** | job trong `server/index.js` | ghi `price_snapshots` mỗi giờ, upsert 1 hàng/ngày/loại; cần `SUPABASE_SECRET_KEY` trong env Render |

### Nhật ký theo phiên

**16/08/2026 (phiên 12) — 3 việc treo của trang Chứng khoán: XONG HẾT.**
Bump `?v=20260816g` → **`?v=20260816k`** (4 lần trong phiên). **KHÔNG đụng
`server/`** — cả 3 việc tính được từ dữ liệu đã có.

Quyết định mở phiên: **hoãn GĐ 7 (Binance)**, làm 3 việc trang Chứng khoán
trước. Lý do: user xác nhận mới chỉ dùng trang chứng khoán, chưa giữ coin nào —
GĐ 7 tự động hoá một việc chưa từng làm, còn 3 việc này nằm trên trang dùng
hằng ngày và việc 3 là một lỗi đang chạy.

- **Việc 3** (`portfolio.js` + `chung-khoan.js`): mã thiếu quote không còn được
  định giá bằng giá vốn. HAI lỗi chồng nhau — xem mục 7.
- **Việc 2** (`signals.js`): Momentum Score A–F, phân vị trong rổ. Không thêm
  lần gọi mạng nào.
- **Việc 1** (`signals.js`): `volSpike()` — đột biến KL vs TB 20 phiên. Hoá ra
  KHÔNG cần `server/` như mục 10 cũ ghi; phần cần server (marketcap heatmap) đã
  tách ra, còn nợ.

Cả 3 đều cùng một tinh thần với GĐ 6.5: thiếu dữ liệu thì nói ra, không bịa.

**16/08/2026 (phiên 11) — GĐ 6 XONG CẢ 7 ĐẦU VIỆC. Trang tổng chạy thật.**
Bump `?v=20260815e` → **`?v=20260816g`** (bump 7 lần trong phiên, mỗi lần deploy
một lần). **KHÔNG đụng `server/`** — toàn bộ là frontend.

- `core/networth.js` mới: gom định giá 5 kênh về VND. **Mục 6.5 là linh hồn của
  file, không phải phép cộng** — `Promise.allSettled`, kênh chết không kéo kênh
  khác chết, kênh không định giá được thì không cộng và phải nói tên ra.
- 6.3: **thanh xếp chồng ngang, KHÔNG phải biểu đồ tròn** như quy hoạch ghi —
  lý do + bảng màu đã validate ở mục 7.
- 6.4: dòng tiền vào/ra, tách "tăng do giá" khỏi "nạp thêm tiền".
- 6.6: rà riêng tư cả 6 trang, **tìm ra lỗi thật** — mục 7.
- 6.7: gần như miễn phí nhờ `.money` có sẵn.

**Hai việc user thêm ngoài quy hoạch:**
- **Khoá mã 6 số** cho nút con mắt (`nav.js`). Chỉ hỏi mã khi HIỆN số, không hỏi
  khi ẩn. Mức bảo vệ thật ghi ở mục 7 — đọc trước khi ai đó tưởng nó là bảo mật.
- **Nhãn nguồn dồn xuống cuối trang tổng** thay vì dưới từng tên kênh (mục 1.5
  bắt buộc có nhãn, không bắt buộc đặt sát con số).

Đối chiếu tay toàn bộ phép cộng: vàng 2 lượng = 20 chỉ × 14.100 × 1000 =
282.000.000; FPT 1.000 cp × 68,30 = 68.300.000; tổng 1.701.659.517 với giá vốn
1.745.000.000 ra −2,48%. Khớp.

Các phiên trước đó: **`docs/NHATKY.md`**.

## 10. Việc còn treo

### BẮT ĐẦU TỪ ĐÂU (phiên sau đọc mục này trước)

Cây làm việc sạch, đã push, bản live đã kiểm. **GĐ 6 xong (16/08). Ba việc treo
của trang Chứng khoán cũng xong (16/08, phiên 12).**

Quy hoạch chính thức còn đúng **GĐ 7** là hết. Nhưng có hai việc nhỏ đáng cân
nhắc trước, và một quyết định về GĐ 7 cần nhắc lại (xem ngay dưới).

#### GĐ 7 đã được HOÃN có chủ ý (phiên 12) — đọc trước khi bắt tay

User xác nhận **mới chỉ dùng trang Chứng khoán, chưa giữ coin nào** (bản sao lưu
không có một dòng crypto). GĐ 7 tự động hoá đồng bộ số dư Binance — một việc user
chưa từng làm — nên đã hoãn để làm 3 việc trang Chứng khoán trước. **Đừng tự khởi
động GĐ 7; hỏi user đã mở tài khoản Binance và mua coin chưa.** Khi thật sự cần,
quy hoạch vẫn nguyên ở `docs/QUYHOACH.md`.

#### Hai việc nhỏ còn nợ, không cần user làm gì

1. **Sizing bản đồ nhiệt VN30 theo vốn hóa** — cần endpoint marketcap ở
   `server/` (1 endpoint warmed thay 30 call). Việc DUY NHẤT còn lại phải deploy
   lại Render, nên để dành gộp chung nếu có đợt sửa server khác.
2. ~~Dọn bài học tháng 7~~ — **ĐÃ LÀM 16/08.** `Format SSI thật` và `Lightweight
   Charts 4 cạm bẫy` chuyển sạch sang `docs/BAIHOC-CU.md`; `Tín hiệu FiinTrade`
   giữ con trỏ ở mục 7 (vì tính "đừng sửa lại"), bản đầy đủ ở BAIHOC-CU.

#### Nếu làm GĐ 7: đồng bộ số dư Binance

Đọc `docs/QUYHOACH.md` bảng GĐ 7 (3 đầu việc). Khuôn bảo mật đã có sẵn: làm y
như `/api/account/*` đang chạy (mục 8) — header `x-dashboard-key` so bằng
`timingSafeEqual`, origin allowlist, không set env là tắt hẳn 503.

**⚠ USER TỰ LÀM TRƯỚC KHI BẮT ĐẦU:**
1. Tạo API key trên Binance, **CHỈ bật "Enable Reading"**. Tắt Spot Trading, tắt
   Withdrawals. Bật khoá IP về IP tĩnh của Render nếu Binance cho.
2. Đặt key vào **env của Render**, không bao giờ vào repo, không bao giờ ra
   frontend. Tên biến sẽ chốt khi làm 7.2.

**Cạm bẫy đã biết của GĐ 7 — đọc trước khi code:** số dư đọc từ sàn và danh mục
nhập tay ở trang Coin là HAI NGUỒN CHO CÙNG MỘT TÀI SẢN. Cộng cả hai vào tổng là
đếm trùng, và trang tổng sẽ báo tài sản gấp đôi. Quy hoạch 7.3 nói rõ phải xử lý;
`core/networth.js` hiện chỉ đọc `holdings_crypto`, nên khi thêm nguồn sàn phải
sửa ở đó chứ không phải cộng thêm một kênh thứ sáu.

#### Ba chỗ của GĐ 6 — đừng "sửa lại cho đúng quy hoạch"

1. **Thanh xếp chồng thay biểu đồ tròn** (6.3) — lý do + bảng màu đã validate ở
   mục 7. Đổi màu thì phải chạy lại validator, đừng chỉnh bằng mắt.
2. **Tiết kiệm tính theo TIỀN GỐC**, không cộng lãi dự kiến vào tổng tài sản.
   Lãi chưa nhận không phải tài sản đã có, và rút trước hạn thì gần như mất sạch
   phần đó. Lãi dự kiến vẫn hiện riêng dưới bảng.
3. **"Tăng do giá" (6.4) KHÁC "Lãi/lỗ" (6.2)** — đừng sửa cho khớp nhau. Lãi/lỗ
   so với giá vốn của phần ĐANG nắm giữ; tăng do giá so với TIỀN THẬT đã bỏ vào
   kênh, nên tính cả phần đã bán, đã rút, phí. Hai câu hỏi khác nhau.

Thêm: **vàng định giá theo giá tiệm MUA VÀO**, ngoại tệ theo giá NH **mua chuyển
khoản** — tức số thực nhận nếu bán ngay, không phải giá niêm yết bán ra.

#### Cạm bẫy `?v=` — đã dính một lần 15/08, giữ trong quy trình handoff

```bash
git diff --name-only <commit-bump-cuoi>..HEAD -- 'assets/**' | grep -E '\.(js|css)$'
```
Ra file nào tức là file đó đang phục vụ dưới một chuỗi `?v=` đã cũ. Phiên 15/08
phải bump 5 lần, phiên 16/08 bump 7 lần — **bump mỗi lần deploy, đừng gộp**.

#### Đăng nhập — hai điều phải nhớ

1. **Bấm "Gửi liên kết đăng nhập" từ chính trình duyệt sẽ mở link đó** (PKCE —
   mục 7). Gửi từ máy tính rồi mở trên điện thoại là hỏng, và mất một lượt.
2. **Hạn mức 2 thư/giờ**, SMTP dựng sẵn của Supabase, chỉ gửi tới địa chỉ thuộc
   dự án. Đã thử SMTP riêng qua Brevo rồi **tắt** — gắn vào báo lỗi gửi, và khi
   nguyên nhân thật (hai origin) lộ ra thì nó cũng không còn cần. Tài khoản Brevo
   vẫn còn, muốn bật lại thì các ô trong Supabase vẫn nguyên. `Auth → Rate Limits`
   chỉ có tác dụng khi đang bật SMTP riêng.

**Bảng chẩn đoán trong panel Tài khoản** (`auth.js`, `renderDiag`) in ra origin ·
phiên bản JS · driver đang dùng · watchlist đọc thẳng từ Supabase. Hai thiết bị
hiện hai kết quả khác nhau thì mở nó ra trước, đừng đoán — xem mục 7.

#### Còn nợ nhỏ

- `docs/QUYHOACH.md` vẫn ghi "schema 7 bảng" — thực tế **9**. Sửa khi tiện.
- Job snapshot: đường **upsert đã chứng minh chạy đúng** (đo 15/08, 7 tiếng rưỡi
  sau lượt đầu: vẫn đúng 3 dòng, `id` không tăng, nhưng `fx` và `savings` mang
  mốc thời gian mới hơn hẳn — tức đè tại chỗ, không nhân dòng). `gold` giữ
  nguyên mốc 09:21 là ĐÚNG: đó là giờ PNJ niêm yết bảng, cả ngày không đổi.
  **Cách kiểm lại sau này:** đọc `price_snapshots` bằng publishable key (bảng
  này ai đọc cũng được), phải đúng 1 dòng mỗi loại mỗi ngày.

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
| 5 | **Supabase + đăng nhập** — khó nhất | ✅ 15/08 (8/8) |
| 6 | **Tổng gia sản** — gom 5 kênh về VND, phân bổ, dòng tiền | ✅ 16/08 (7/7) |
| **7** | **Đồng bộ số dư Binance** — key chỉ-đọc, ký HMAC, tránh đếm trùng | ▶ **kế tiếp — hết quy hoạch** |

Chi tiết GĐ 5: cả 8 đầu việc 5.1–5.8 đã xong và đã kiểm trên 2 thiết bị.
Chi tiết GĐ 6: 6.1 gom định giá ✅ · 6.2 tổng + lãi/lỗ ✅ · 6.3 phân bổ ✅ ·
6.4 dòng tiền ✅ · 6.5 kênh lỗi nguồn ✅ · 6.6 rà riêng tư ✅ · 6.7 ẩn số tuyệt đối ✅.

Việc chen ngang đã làm ngoài quy hoạch: reskin Fey (03/08), chart chỉ số
(04/08), tab Tổng quan thị trường (07/08), theme mặc định Sáng (08/08),
biểu đồ nhanh gấp 2 + cảnh báo đơn vị giá vốn (15/08), khoá mã 6 số cho nút con
mắt + dồn nhãn nguồn xuống cuối trang tổng (16/08).

### Tính năng chứng khoán — 3 việc treo ĐÃ XONG (16/08, phiên 12)
1. ✅ Theo dõi dòng tiền — `volSpike()` bắt đột biến KL ≥2× TB 20 phiên, tab
   Giá–KL. **Chỉ còn nợ sizing heatmap theo vốn hóa** — phần DUY NHẤT cần
   `server/` (endpoint marketcap VN30 warmed thay 30 call). Để phiên sau hoặc
   gộp vào đợt sửa server khác.
2. ✅ Momentum Score A–F — `signals.js` `momentum` + `grader`, tab Tín hiệu.
3. ✅ Mã thiếu quote không còn định giá bằng giá vốn — xem mục 7 (SSI giá 0).

### Việc nhỏ (không chặn) — user tự làm
1. **Bật tự động gia hạn tên miền ở Mắt Bão** (quên = dashboard chết, không ai báo).
2. **Enforce HTTPS — ĐANG LÀM DỞ, ưu tiên cao nhất.** Đây là thứ đã ăn mất gần
   một buổi ngày 15/08 (mục 7). Đã có lớp vá `forceHttps()` trong `config.js`
   nhưng lớp sửa thật gồm hai bước, **user tự làm**:
   1. Vào DNS ở **Mắt Bão**, tên miền `dashboardstock.io.vn`, thêm **3 bản ghi A**
      còn thiếu cho tên gốc `@`: `185.199.109.153`, `185.199.110.153`,
      `185.199.111.153`. Giữ nguyên bản ghi `185.199.108.153` đang có và CNAME
      `www`. Chờ 15–60 phút.
   2. GitHub → repo → **Settings → Pages** → chờ ô **Enforce HTTPS** hết mờ rồi
      tích vào. Trước khi đủ 4 IP thì ô này bị khoá.

   Kiểm bằng: `dig +short dashboardstock.io.vn A` phải ra đủ 4 dòng, và
   `curl -sI http://dashboardstock.io.vn` phải trả 301 thay vì 200.
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
