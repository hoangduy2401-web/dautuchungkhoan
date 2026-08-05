# CLAUDE.md — Dự án "Bảng Điện" (Dashboard chứng khoán cá nhân)

> File này nạp vào context **mỗi phiên** — giữ nó gọn là việc thường xuyên, không
> phải việc một lần. Cuối phiên chạy **`/handoff`** để cập nhật mục 9 + 10.
>
> Nội dung không cần đọc mỗi phiên đã tách sang `docs/` (04/08/2026):
> `NHATKY.md` (nhật ký phiên cũ) · `SSI-TRADING.md` (FastConnect chi tiết) ·
> `YTUONG.md` (ý tưởng dài hạn) · `QUYHOACH.md` (kế hoạch website gia sản).
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

Cache busting hiện **`?v=20260804a`** (đã kiểm: 18 chỗ trong 2 file HTML, bản live
cũng đang phục vụ đúng chuỗi này).

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
  16, viền hairline. Theme Sáng/Tối qua `[data-theme]`, **mặc định TỐI**.
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
lightweight-charts → `config.js` → `store.js` → `theme.js` → `nav.js` →
`mockData.js` → `dataService.js` → `portfolio.js` → `signals.js` →
`chartModule.js` → `pages/<trang>.js`

`store.js` phải đứng trước `nav.js` và `portfolio.js` — cả hai gọi `Store`.

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
     totalVol, totalVal, advances, declines, noChanges }, ...]
   value: điểm (KHÔNG chia 1000) · totalVol: cổ phiếu · totalVal: VND (thô)
   advances/declines/noChanges: SỐ MÃ, hoặc null khi SSI không có (xem mục 7)

GET /api/price/quote?symbol=X
→ { price, changePct, volume, netForeignVal }

GET /api/fundamentals/:symbol
→ { marketCap, pe, pb, eps, roe, roa, dividendYield, revenueYoY, netProfitYoY, debtToEquity }

GET /api/news?symbols=A,B,C
→ [{ symbol, title, source, time (ISO), url }, ...]
```

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

- Regex `\b` **không hoạt động với tiếng Việt** → dùng lookaround Unicode
  `(?<![\p{L}\p{N}])SYM(?![\p{L}\p{N}])` với cờ `u`.

### Class `.mtab-pane` dùng chung 2 nơi → tab thị trường nuốt accordion (03/08/2026)

**Triệu chứng.** Mở accordion "Tài khoản SSI · Giao dịch · Lịch sử" thì thấy
hàng sub-tab nhưng **thân thẻ trống trơn**. Bấm lại một sub-tab là hiện bình
thường. Không có lỗi console.

**Số đo.** Sau khi bấm bất kỳ tab thị trường nào: cả 3 pane
`[data-apane]` (`ssi`/`add`/`manual`) đều có `hidden === true`,
`offsetHeight === 0`, trong khi `localStorage.vn_dashboard_account_tab_v1` vẫn
đúng bằng `"ssi"` và nút "Danh mục SSI" vẫn đang `.active` — nút và pane lệch
trạng thái nhau.

**Nguyên nhân.** `wireMarketTabs` quét `document.querySelectorAll(".mtab-pane")`
rồi gán `p.hidden = p.dataset.pane !== state.marketTab`. Accordion tài khoản
**dùng lại đúng class đó** (cố ý, để khỏi viết lại CSS `[hidden]`), mà 3 pane của
nó không có thuộc tính `data-pane` → `undefined !== "heatmap"` → ẩn sạch.

**Đã loại trừ** (đừng điều tra lại): không phải localStorage cũ (đã đọc, giá trị
đúng); không phải `setAcctTab` sai (nó dùng `[data-apane]`, đúng); không phải do
reskin CSS (luật `.mtab-pane[hidden] { display: none }` giữ nguyên từ 31/07).
Lỗi có từ phiên 25/07 khi gộp 3 khối cuối trang thành accordion, chỉ là không ai
bấm tab thị trường **trước** khi mở accordion nên chưa lộ.

**Cách sửa.** Quét `[data-pane]` thay cho `.mtab-pane`. Luật chung: **chọn theo
thuộc tính dữ liệu, đừng chọn theo class trình bày** khi class đó cố ý dùng chung.

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

Endpoint `/api/account/{otp,login,portfolio}`, chỉ đọc, không đặt lệnh được.
Bảo mật riêng (`x-dashboard-key` + origin allowlist), 5 cạm bẫy FCTrading đã gặp,
và lý do GĐ2 (đặt lệnh) cố ý chưa làm: **`docs/SSI-TRADING.md`**.
**Đọc file đó trước khi động vào phần tài khoản SSI.**

## 9. Trạng thái hiện tại

**Chạy dữ liệu thật end-to-end tại https://dashboardstock.io.vn** — `USE_MOCK: false`.
Cache busting `?v=20260804a`. Nhánh `main` sạch, đã push, backend đã deploy bản
mới nhất (đã kiểm 04/08: `/api/price/indices` có đủ 5 trường thống kê và
`/api/price/index-history` trả dữ liệu).

Website hiện có **2 trang**: `/` (tổng gia sản, mới là khung) và
`/chung-khoan.html` (đầy đủ). 4 trang còn lại chưa làm — xem mục 10.

| Tính năng | Nguồn | Ghi chú |
|---|---|---|
| Giá / nến / chỉ số | SSI FCData | chunking 30 ngày; index intraday tái tạo từ RatioChange |
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
| **Nút con mắt** (ẩn số tiền) | — | toàn site, xem mục 3b |
| Giao diện | Fey design system | tối mặc định, **không còn Liquid Glass** — mục 3 |
| Keep-alive | pinger ngoài 5 phút + Actions dự phòng | xem mục 6 |

### Nhật ký theo phiên

**04/08/2026 (phiên 3) — chỉ soát tài liệu, KHÔNG đụng code.**
Không sửa file `.js/.css/.html` nào → **không bump `?v=`**, vẫn `20260804a`.
Không đụng `server/`. Đã đối chiếu tài liệu với thực tế và sửa 4 chỗ lệch:
- Mục 0 và mục 9 còn ghi `?v=20260803a` trong khi thực tế đã là `20260804a`.
  Đây là lỗi có hậu quả thật: phiên sau đọc "hiện là 03a" rồi bump lên "04a" là
  **trùng chuỗi đã deploy**, user tiếp tục chạy code cũ tới 10 phút mà không ai
  biết. Đã sửa cả hai.
- Bảng tính năng mục 9 còn ghi watchlist/giao dịch lưu ở `localStorage` — thực
  tế đã qua `Store` từ 31/07. Đã bổ sung: chart chỉ số, nút con mắt, giao diện
  Fey, và ghi rõ website hiện có 2 trang.
- `docs/CLAUDE.moi.md` còn ghi font Inter + slider Trong/Đục; `docs/QUYHOACH.md`
  còn mô tả `base.css` là "tokens glass, aurora". Cả hai là bản nháp cho site đa
  kênh nên sai ở đây sẽ dẫn phiên sau dựng lại thứ đã cố ý bỏ. Đã sửa.

Kiểm chứng trạng thái trước khi ghi (không phải suy đoán):
- `git status` sạch, `main` == `origin/main` tại `437bdff`.
- Backend live đã có cả bước A lẫn bước B: `/api/price/indices` trả đủ
  `totalVol/totalVal/advances/declines/noChanges` (VNINDEX 140/122/63, VN30
  `null`), `/api/price/index-history?code=VNINDEX&days=30` trả `{date, close,
  volume}`.
- Frontend live phục vụ đúng `?v=20260804a`; `/` và `/chung-khoan.html` đều 200.
- `config.js` đã trỏ lại `onrender.com` (phiên 2 từng tạm trỏ `localhost:3999`).

Các phiên trước đó: **`docs/NHATKY.md`**.

## 10. Việc còn treo

### BẮT ĐẦU TỪ ĐÂU (phiên sau đọc mục này trước)

Không có việc nào đang dở. Cây làm việc sạch, đã push, backend đã deploy.

Việc kế tiếp theo quy hoạch là **GĐ 1 — trang Ngoại tệ** (3 phiên). Đọc
`docs/QUYHOACH.md` mục 2.1 + 2.10 (nguồn) và bảng GĐ 1 (8 đầu việc). Tóm tắt
để khỏi mở file: route `/api/fx/rates` parse XML Vietcombank (**cache ≥5 phút**,
nguồn ghi rõ 1 request/5 phút), route `/api/fx/history` lấy Yahoo Finance kèm
**tỷ giá chéo** cho JPY/CNY/AUD, biểu đồ 1M/3M/6M/1Y/5Y, danh mục ngoại tệ nhập
tay qua `Store`.

**Cạm bẫy đã biết trước của GĐ 1, đừng bỏ qua:** bảng (Vietcombank, giá bán lẻ)
và biểu đồ (Yahoo, giá liên ngân hàng) **lệch nhau ~0,8% và sẽ không bao giờ
khớp** — đo 30/07: Yahoo 26.300 vs VCB mua 26.080 / bán 26.490. Bắt buộc ghi
nhãn nguồn cạnh mỗi con số, nếu không user tự so hai số rồi tưởng hệ thống lỗi.

Ba việc chen ngang đã làm xong ngoài quy hoạch (03–04/08): reskin Fey, bước A và
bước B của chart chỉ số. Không ảnh hưởng thứ tự GĐ 1–7.

### Ưu tiên — quy hoạch mới
Website quản lý gia sản đa kênh: `docs/QUYHOACH.md`. 8 giai đoạn, ~23 phiên,
~11 tuần. **GĐ 0 đã xong hết ngày 31/07** (mục 0.1–0.9: tách `style.css`, dời JS
vào `assets/`, `nav.js`, `store.js` — xem nhật ký mục 9).

### Chart cho chỉ số — XONG 04/08 (giữ lại phần cần biết)

Bước A + B đã xong, xem nhật ký mục 9. Ba điều đừng "sửa lại cho đúng":
1. `/api/price/index-history` trả `{date, close, volume}` — **không có OHLC** vì
   `DailyIndex` không có. `chartModule` tự nhận ra và vẽ đường.
2. **Chunk 30 ngày là bắt buộc**, không phải chọn lựa (mục 7).
3. **Timeout của chỉ số phải riêng**, đừng gộp lại với `getHistory` (mục 7).

Việc còn có thể làm thêm, chưa ai yêu cầu: sizing ô heatmap theo vốn hóa, và
`Ceilings`/`Floors` (số mã trần/sàn) — đã có sẵn trong row `DailyIndex`, chỉ
việc thêm vào payload như 5 trường của bước A.

<details>
<summary>Khảo sát gốc trước khi làm (giữ để đối chiếu ước lượng)</summary>

Design cho phép **bấm thẻ chỉ số → nạp chart chỉ số đó + cuộn xuống**. Chưa làm
vì backend chưa có đường dữ liệu: `/api/price/history` chạy `DailyOhlc` (chỉ mã
CK). Gắn click bây giờ chỉ hiện `—`, phạm luật vàng ở mục 3.

**Bước A XONG 04/08** (xem nhật ký mục 9): đã thăm dò `DailyIndex` và đã có 5
trường thống kê trong `/api/price/indices`. Mọi ẩn số về dữ liệu đã đóng — chi
tiết đo đạc ở mục 7.

**Bước B còn lại:**

- Backend: `computeIndexHistory(code, days)` — **bắt buộc chunk 30 ngày**, dùng
  lại y khuôn `fetchOhlcChunked` (1Y ≈ 13 call, 5Y ≈ 61 call, tuần tự qua
  `ssiLimit`). Thêm `GET /api/price/index-history?code=&days=` + `withCache`,
  TTL co giãn như `/history` (>270 ngày = 30 phút). **Cân nhắc chặn 5Y cho chỉ
  số** hoặc cho nó TTL dài hơn nữa — 61 call tuần tự × ~150ms là ~10s trong
  điều kiện tốt, chưa tính throttle.
- `chartModule.js`: **thêm chế độ đường** (`DailyIndex` không có OHLC). MA10/
  MA20/RSI vẫn chạy vì tính trên close; nến / khối lượng / Bollinger phải ẩn
  khi đang chọn chỉ số. Đây là phần tốn nhất của bước B.
- `dataService.getIndexHistory` (~15 dòng, nhân bản `getHistory`).
- `chung-khoan.js`: thẻ chỉ số bấm được; `state.selected` nhận mã chỉ số; rẽ
  nhánh trong `loadSelectedSymbol` (bỏ qua fundamentals/tin/tín hiệu, dùng 5
  trường mới cho lưới chỉ số cơ bản); rà các chỗ ngầm giả định
  `selected ∈ watchlist ∪ VN30` (sparkline, badge tín hiệu, tin theo mã).
  Nhớ hiện `—` khi `advances/declines` là `null` (VN30).
- Cuộn xuống chart: **tính offset tay**, đừng dùng `scrollIntoView` (mục 9,
  phiên 03/08).

**Ước lượng bước B: 50–75k token, ~35–50 phút.** Đụng `server/` → Render deploy
lại, phải kiểm `/health` sau khi push.

Đối chiếu thực tế: bước B rơi vào **khoảng giữa** ước lượng. Phần phát sinh ngoài
dự kiến là lỗi timeout ở trên — không nằm trong khảo sát vì nó chỉ lộ ra khi bấm
nhanh giữa hai chỉ số, không lộ khi test từng cái một.

</details>

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
- Serve frontend: `python3 -m http.server 5599` từ thư mục repo.
