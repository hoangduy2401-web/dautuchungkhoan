# QUY HOẠCH — Website Quản lý Gia sản Cá nhân

> Lập ngày 30/07/2026. Mở rộng dự án "Bảng Điện" (dashboard chứng khoán) thành
> website quản lý gia sản đa kênh. Tài liệu này là bản quy hoạch để duyệt —
> chưa code gì.

---

## 1. Bức tranh tổng thể

Hiện tại: 1 trang duy nhất, phủ 1 kênh (chứng khoán VN).
Mục tiêu: 6 trang, phủ 5 kênh đầu tư + 1 trang tổng hợp.

| Trang | Đường dẫn | Kênh | Nguồn giá | Nguồn danh mục |
|---|---|---|---|---|
| Tổng gia sản | `/` | tất cả | tổng hợp nội bộ | tổng hợp nội bộ |
| Chứng khoán VN | `/chung-khoan.html` | cổ phiếu | SSI FastConnect | SSI Trading (đọc) + nhập tay |
| Vàng | `/vang.html` | vàng miếng, nhẫn | PNJ edge-api | nhập tay |
| Ngoại tệ | `/ngoai-te.html` | USD/EUR/JPY… | Vietcombank XML | nhập tay |
| Coin | `/coin.html` | crypto | CoinGecko | API sàn (chỉ đọc) |
| Gửi tiết kiệm | `/tiet-kiem.html` | tiền gửi NH | CafeF JSON | nhập tay |

**Quyết định đã chốt với user (30/07/2026):**
1. Lưu trữ: **backend + Supabase Postgres + đăng nhập**. Không dùng localStorage
   làm nguồn sự thật lâu dài.
2. Coin: **đồng bộ API sàn chỉ-đọc**. Sàn = **Binance**.
3. Tiết kiệm: **có bảng so sánh lãi suất các ngân hàng**, lấy từ nguồn báo chí.
4. Trang tổng: **phân bổ tài sản hiện tại** + **dòng tiền vào/ra**.
   KHÔNG làm biểu đồ tài sản ròng theo thời gian, KHÔNG làm mục tiêu tỷ trọng.
5. **Nút con mắt ẩn/hiện số tiền** trên trang tổng — user cần khoe được sản phẩm
   mà không lộ tài sản. Xem 3.7, đây là yêu cầu xuyên suốt chứ không phải nút lẻ.
6. Ngoại tệ **có biểu đồ lịch sử** 1M/3M/6M/1Y/5Y giống trang chứng khoán.
   Đổi phạm vi GĐ 1 — Vietcombank không có lịch sử, xem 2.10.
7. Tên miền: **giữ `dashboardstock.io.vn`**. Sẽ mua tên miền mới cho phần còn
   lại rồi 301 chuyển sang. Không chặn việc code — chỉ là cấu hình DNS về sau.
8. **Một người dùng duy nhất.** Schema Supabase không cần cột `user_id` chia sẻ,
   không cần mời thành viên. RLS vẫn bật (rẻ, và là lớp chặn nếu lộ khoá).
9. Chỉ đọc toàn hệ thống. Không đặt lệnh chứng khoán, không giao dịch Binance.

---

## 2. Nguồn dữ liệu — ĐÃ DÒ THẬT ngày 30/07/2026

Tất cả các dòng dưới đây đều đã gọi thử và có phản hồi thật, không phải suy đoán.

### 2.1 Ngoại tệ — Vietcombank (CHẠY)

```
GET https://portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx
```
XML, free, không cần key. Trả `<Exrate CurrencyCode Buy Transfer Sell />` cho
~20 ngoại tệ + `<DateTime>`.

**Cạm bẫy:** header đầu file ghi rõ `Only one request every 5 minutes!` →
TTL cache backend **tối thiểu 5 phút, khuyến nghị 10 phút**. Warm-up hiện tại
chạy 5 phút/lần là vừa khít, đừng gọi dày hơn.

Nguồn này **chỉ có tỷ giá hiện tại, không có lịch sử** — xem 2.10 cho phần lịch sử.

### 2.10 Lịch sử tỷ giá — Yahoo Finance (CHẠY)

User yêu cầu biểu đồ 1M/3M/6M/1Y/5Y. Vietcombank không có lịch sử nên cần nguồn
thứ hai:

```
GET https://query1.finance.yahoo.com/v8/finance/chart/USDVND=X?range=5y&interval=1d
```
Free, không key, 0,46s. Trả `timestamp[]` + `indicators.quote[0].close[]`.
`range` nhận `1mo/3mo/6mo/1y/5y` — **khớp đúng 5 mốc của trang chứng khoán**.

**Độ phủ KHÔNG đều — đã đo ngày 30/07/2026:**

| Cặp | Trực tiếp | Kết luận |
|---|---|---|
| `USDVND=X` | 1306 điểm / 5 năm | Dùng thẳng |
| `EURVND=X`, `GBPVND=X` | 23 điểm / 1 tháng | Không đủ |
| `JPYVND=X`, `CNYVND=X` | **1 điểm** | Vô dụng |
| `AUDVND=X` | **không tồn tại** | — |

**Giải pháp: tỷ giá chéo.** Mọi cặp chính với USD đều có đủ 1300 điểm / 5 năm
(`EURUSD`, `GBPUSD`, `AUDUSD`, `USDJPY`, `USDCNY`). Quy tắc:

```
XXX/VND = XXXUSD × USDVND        (khi Yahoo niêm yết XXX/USD: EUR, GBP, AUD)
XXX/VND = USDVND ÷ USDXXX        (khi Yahoo niêm yết USD/XXX: JPY, CNY)
```

Đã đối chiếu 2 chiều ngày 30/07/2026:
- AUD chéo = 0,7018 × 26.300 = **18.457** — nằm gọn trong khoảng VCB mua 17.836
  / bán 18.593. Đúng.
- CNY chéo = 26.300 ÷ 6,7413 = **3.901** vs Yahoo trực tiếp 3.888. Lệch 0,3%.
- EUR chéo = 1,1521 × 26.300 = **30.290** vs trực tiếp 30.256. Lệch 0,1%.

**CẠM BẪY LỚN NHẤT CỦA TRANG NGOẠI TỆ — hai loại tỷ giá khác nhau.**
Bảng tỷ giá (Vietcombank) và biểu đồ lịch sử (Yahoo) **không phải cùng một con
số** và sẽ không bao giờ khớp:
- Yahoo = tỷ giá **thị trường liên ngân hàng**, một giá duy nhất.
- Vietcombank = tỷ giá **bán lẻ niêm yết**, có biên mua-bán.

Đo thật ngày 30/07/2026: Yahoo USD/VND ≈ 26.300, VCB mua 26.080 / bán 26.490.
Lệch tới **0,8%** so với giá bán.

→ Giao diện **bắt buộc ghi rõ nguồn ngay cạnh mỗi con số**: bảng ghi "Tỷ giá
Vietcombank", biểu đồ ghi "Tỷ giá thị trường (Yahoo Finance)". Để user tự so hai
số rồi tưởng có lỗi là thất bại thiết kế. Đây cùng bản chất với luật "không hiển
thị số bịa" — số đúng nhưng dán nhầm nhãn cũng dẫn tới quyết định sai.

### 2.2 Vàng — PNJ (CHẠY, nguồn chính)

```
GET https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price
```
JSON, free, không key, không giới hạn thấy được. Trả mảng
`{masp, tensp, giaban, giamua}`:
- `SJC` — Vàng miếng SJC 999.9
- `N24K` — Nhẫn Trơn PNJ 999.9
- `KB` — Vàng Kim Bảo 999.9
- `TL` — Vàng Phúc Lộc Tài 999.9

**PHẢI XÁC MINH TRƯỚC KHI HIỂN THỊ — ĐƠN VỊ.** Giá trị thô đo được ngày
30/07/2026: `giaban: 14170`. Suy đoán là **nghìn đồng/chỉ** (14,17 triệu/chỉ =
141,7 triệu/lượng). Đây đúng là loại lỗi đã từng dính với SSI (giá VND thô phải
chia 1000). Việc đầu tiên của GĐ 2 là đối chiếu với giá niêm yết công khai rồi
mới quyết hệ số quy đổi, ghi lại vào tài liệu.

### 2.3 Vàng — BTMC (CHẠY, nguồn dự phòng + bạc)

```
GET http://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=3kd8ub1llcg9t45hnoh8hmn7t5kc2v
```
Có cả **vàng lẫn bạc**, kèm timestamp từng dòng (`@d_1`). Format xấu: mỗi dòng
đánh số hậu tố riêng (`@n_1/@pb_1/@ps_1`, `@n_2/@pb_2/@ps_2`…) nên parser phải
duyệt theo `@row` chứ không đọc tên trường cố định được.

### 2.4 Vàng — SJC trực tiếp (KHÔNG DÙNG ĐƯỢC)

`sjc.com.vn/giavang/textContent.php` trả **Cloudflare challenge** (`Just a
moment...`) khi gọi server-to-server. Giống hệt trường hợp TCBS đã bỏ.
**Đừng thử lại bằng header giả trình duyệt** — đây là JS challenge, không phải
lọc User-Agent.

### 2.5 Coin — CoinGecko (CHẠY, nguồn chính)

```
GET https://api.coingecko.com/api/v3/simple/price
      ?ids=bitcoin,ethereum&vs_currencies=usd,vnd&include_24hr_change=true
```
Free, không key. **Trả thẳng giá VND** — không phải tự nhân tỷ giá, đỡ một
nguồn sai số. Giới hạn free tier ~10-30 call/phút → cache 60s là quá đủ.

### 2.6 Coin — Binance public (CHẠY, dự phòng giá)

```
GET https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT
```
Free, không key, cho giá USD + biến động 24h. Dùng khi CoinGecko lỗi hoặc cần
mã CoinGecko không có.

### 2.7 Lãi suất tiết kiệm — CafeF CDN (CHẠY)

```
GET https://cafefnew.mediacdn.vn/Images/Uploaded/DuLieuDownload/Liveboard/all_banks_interest_rates.json
```

Đây là **phát hiện quan trọng nhất của buổi khảo sát**. Trang
`cafef.vn/du-lieu/lai-suat-ngan-hang.chn` là ứng dụng Blazor WebAssembly (tải
~90 file .dll) — không cào HTML được. Nhưng nó nạp dữ liệu từ **một file JSON
tĩnh trên CDN**, gọi trực tiếp được, 0,07s, không key, không challenge.

Cấu trúc:
```json
{ "Data": [ { "id", "name": "MB Bank", "symbol": "MBB",
              "icon": "https://cafef1.mediacdn.vn/Images/mbb.jpg",
              "interestRates": [ {"time":"6T","deposit":6,"value":4.6}, ... ] } ] }
```
**28 ngân hàng × 8 kỳ hạn** (0T/1T/3T/6T/9T/12T/18T/24T), có sẵn logo.
Đối chiếu ngày 30/07/2026: Bac A Bank 6T=7,05%, Shinhan 12T=7,5%.

**Rủi ro:** đây là URL nội bộ của CafeF, không phải API công bố. Có thể đổi
đường dẫn bất cứ lúc nào mà không báo. Bắt buộc phải có: (a) cache dài (6-12
giờ, lãi suất đổi theo tuần chứ không theo phút), (b) lưu bản chụp gần nhất vào
DB để còn hiển thị khi nguồn chết, (c) hiển thị rõ "Cập nhật lúc …" để user tự
biết dữ liệu cũ.

### 2.8 Chứng khoán — giữ nguyên

SSI FastConnect Data + Trading, VNDirect finfo, CafeF RSS. Không đụng.

### 2.9 Bảng tổng kết rủi ro nguồn

| Nguồn | Ổn định | Rủi ro chính |
|---|---|---|
| Vietcombank XML | Cao | Giới hạn 1 req/5 phút |
| CoinGecko | Cao | Rate limit free tier |
| Binance public | Cao | — |
| PNJ edge-api | Trung bình | API nội bộ, không cam kết |
| BTMC | Trung bình | Format kỳ dị, key công khai có thể bị thu |
| CafeF CDN | Trung bình | URL nội bộ, có thể đổi bất cứ lúc nào |
| Yahoo Finance | Trung bình | API không công bố; độ phủ cặp VND không đều |
| SJC | **Không dùng được** | Cloudflare challenge |

Nguyên tắc: **mọi nguồn "trung bình" phải có bản chụp lưu trong DB** để trang
không trắng khi nguồn chết. Áp dụng đúng bài học 30/07: thà hiện dữ liệu cũ có
ghi rõ thời điểm, còn hơn hiện số bịa hoặc hiện trống không giải thích.

---

## 3. Kiến trúc

### 3.1 Nguyên tắc giữ nguyên từ dự án cũ

- **Không build tool.** HTML/CSS/JS thuần, script tag. Không React/Vite/Webpack.
- Frontend GitHub Pages, backend Node/Express trên Render.
- Mọi widget lấy dữ liệu qua tầng service, không `fetch()` thẳng trong trang.
- **Giá không bao giờ fallback sang số bịa** (bài học 30/07/2026).
- Cache busting `?v=YYYYMMDD<chữ>` mỗi lần sửa JS/CSS.

### 3.2 Cấu trúc thư mục sau tái cấu trúc

```
/
├── index.html              ← TRANG TỔNG (thay chỗ dashboard chứng khoán)
├── chung-khoan.html        ← dashboard hiện tại, chuyển vào đây
├── vang.html
├── ngoai-te.html
├── coin.html
├── tiet-kiem.html
├── assets/
│   ├── css/
│   │   ├── base.css        ← tokens glass, aurora, layout, nav (tách từ style.css)
│   │   └── <trang>.css     ← CSS riêng từng trang
│   └── js/
│       ├── core/
│       │   ├── config.js
│       │   ├── nav.js      ← render thanh điều hướng dùng chung
│       │   ├── store.js    ← LỚP TRỪU TƯỢNG LƯU TRỮ (xem 3.4)
│       │   ├── dataService.js
│       │   └── format.js   ← fmt/fmtPct/trendClass… (đang nằm rải trong app.js)
│       └── pages/
│           ├── tong.js
│           ├── chung-khoan.js   ← app.js hiện tại
│           ├── vang.js
│           └── …
├── server/                 ← nguồn sự thật backend
│   ├── index.js            ← app + routes chung
│   └── routes/
│       ├── stock.js  gold.js  fx.js  crypto.js  savings.js  account.js
└── docs/
    ├── QUYHOACH.md         ← file này
    ├── CHUNGKHOAN.md       ← toàn bộ CLAUDE.md hiện tại chuyển vào
    └── VANG.md  NGOAITE.md  COIN.md  TIETKIEM.md
```

### 3.3 Bỏ hack `cp server/index.js index.js`

Hiện Render deploy từ thư mục gốc nên phải copy tay file server mỗi lần sửa —
đã là nguồn lỗi tiềm tàng ngay từ bây giờ, với 5 file route thì chắc chắn sẽ
quên. **Sửa bằng cách đổi "Root Directory" của service trên Render thành
`server`**, rồi xoá `index.js` + `package.json` ở gốc. Việc này làm ở GĐ 0,
trước khi thêm bất kỳ route mới nào.

### 3.4 Lớp lưu trữ `store.js` — mấu chốt để không phải làm lại

Vấn đề: Supabase là giai đoạn khó nhất, nhưng các trang vàng/ngoại tệ/tiết kiệm
lại cần lưu danh mục ngay từ giai đoạn sớm. Nếu viết thẳng `localStorage` vào
từng trang thì tới lúc chuyển sang DB phải sửa lại cả 5 trang.

Giải pháp: định nghĩa **một giao diện duy nhất** ngay từ GĐ 0, đổi driver bên
dưới ở GĐ 5 mà không trang nào phải sửa:

```js
Store.list(collection)              // -> [rows]
Store.add(collection, row)          // -> row (có id)
Store.update(collection, id, patch)
Store.remove(collection, id)
Store.onChange(collection, handler)
```

- GĐ 0-4: driver `localStorage` (đồng bộ, nhanh, 0 hạ tầng).
- GĐ 5: driver `supabase` (bất đồng bộ). **Vì vậy mọi hàm phải trả Promise ngay
  từ đầu**, kể cả driver localStorage — nếu không, lúc đổi driver phải sửa hết
  chỗ gọi. Đây là điểm dễ làm ẩu nhất của cả kế hoạch.

Collections: `tx_stock`, `holdings_gold`, `holdings_fx`, `holdings_crypto`,
`savings_accounts`, `cash_flows`, `settings`.

### 3.5 Chế độ riêng tư — nút con mắt

Yêu cầu: user muốn mở website cho người khác xem/khoe sản phẩm **mà không lộ số
tài sản**. Đây không phải một nút trên trang tổng — nó là **ràng buộc toàn site**,
vì che số ở trang tổng mà trang vàng vẫn hiện "12 lượng SJC" thì vô nghĩa.

Thiết kế:
- Một công tắc `privacyMode` toàn cục, lưu ở `Store` (`settings`), **nút con mắt
  đặt trên thanh điều hướng dùng chung** để trang nào cũng bấm được.
- Bật = mọi **số tiền tuyệt đối** và **số lượng nắm giữ** đổi thành `••••••`.
- **Vẫn hiện bình thường:** giá thị trường, phần trăm lãi/lỗ, tỷ trọng phân bổ,
  biểu đồ. Đây mới là phần đáng khoe, và không tiết lộ gì về quy mô tài sản.
- **Biểu đồ tài sản phải bỏ nhãn trục Y** khi bật, nếu không nhìn trục là đoán
  ra ngay.
- Cách làm: mọi số nhạy cảm bọc trong `<span class="money">`, chế độ riêng tư
  bật một class trên `<html>` và CSS lo phần che. **Không sửa từng chỗ render** —
  làm thế chắc chắn sót, và sót một chỗ là hỏng cả tính năng.
- Trạng thái lưu lại giữa các lần mở trang, nhưng **mặc định là TẮT** — bật sẵn
  dễ khiến user tưởng dữ liệu chưa nạp.

Kiểm chứng bắt buộc: bật chế độ riêng tư rồi rà **cả 6 trang**, tìm bằng
`Ctrl+F` xem còn chữ số tiền nào lọt không.

### 3.6 Hợp đồng dữ liệu backend mới

```
GET /api/fx/rates                      (Vietcombank — tỷ giá bán lẻ)
→ { updatedAt, source:"Vietcombank",
    rates:[{code,name,buyCash,buyTransfer,sell}] }

GET /api/fx/history?code=USD&days=365  (Yahoo — tỷ giá thị trường, xem 2.10)
→ { source:"Yahoo Finance", method:"direct"|"cross",
    items:[{date,rate}] }

GET /api/gold/prices
→ { updatedAt, unit:"nghìn đồng/chỉ", items:[{code,name,buy,sell,source}] }

GET /api/crypto/prices?ids=bitcoin,ethereum
→ { updatedAt, items:[{id,symbol,usd,vnd,change24h}] }

GET /api/savings/rates
→ { updatedAt, terms:["1T","3T",...],
    banks:[{name,symbol,icon,rates:{"1T":3.7,"6T":4.6,...}}] }

GET /api/crypto/balances     (bảo mật như /api/account/*)
→ { updatedAt, positions:[{asset,free,locked,usd,vnd}] }
```

Mọi endpoint dùng lại `withCache` + `ssiLimit`-style limiter + `fetchWithTimeout`
đã có. **Không viết lại cơ chế cache mới.**

### 3.6 Bảo mật

- Route `/api/crypto/balances` áp đúng khuôn `/api/account/*` đang chạy: header
  `x-dashboard-key` so sánh `timingSafeEqual` + origin allowlist + không set env
  là tắt hẳn (503).
- API key sàn coin **chỉ lưu trong env Render**, không bao giờ ở frontend,
  không commit. Key phải tạo ở chế độ **chỉ đọc, không rút tiền, có khoá IP**
  nếu sàn hỗ trợ.
- Supabase: bật **Row Level Security** ngay từ lúc tạo bảng, không để sau.

---

## 4. Kế hoạch triển khai theo giai đoạn

Xếp theo **độ phức tạp tăng dần**, có điều chỉnh theo phụ thuộc kỹ thuật.
Đơn vị "phiên" = một buổi làm việc như hôm nay.
Giả định nhịp 2-3 phiên/tuần.

---

### GĐ 0 — Tái cấu trúc nền móng · ĐỘ KHÓ: THẤP · 2 phiên · Tuần 1

Không thêm tính năng nào. Chỉ dọn chỗ.

| # | Việc | Ghi chú |
|---|---|---|
| 0.1 | Đổi Root Directory trên Render sang `server`, xoá `index.js` + `package.json` ở gốc | **Bỏ hack `cp` vĩnh viễn.** Làm trước mọi thứ |
| 0.2 | Tách `style.css` → `assets/css/base.css` + `chung-khoan.css` | Giữ nguyên giao diện 100% |
| 0.3 | Chuyển JS vào `assets/js/core` + `assets/js/pages` | Giữ thứ tự nạp script |
| 0.4 | Đổi `index.html` → `chung-khoan.html`, tạo `index.html` mới rỗng cho trang tổng | Thêm redirect để link cũ không chết |
| 0.5 | Viết `nav.js` — thanh điều hướng 6 trang dùng chung + **nút con mắt** | Trang chưa làm thì hiện "sắp có". Cơ chế che số làm luôn ở đây (xem 3.5) |
| 0.6 | Viết `store.js` driver localStorage, **API trả Promise** | Xem 3.4 — làm sai ở đây là trả giá ở GĐ 5 |
| 0.7 | Chuyển `portfolio.js` sang dùng `Store` | Phép thử đầu tiên cho lớp trừu tượng |
| 0.8 | `CLAUDE.md` mới ở gốc + chuyển bản cũ vào `docs/CHUNGKHOAN.md` | |
| 0.9 | Kiểm chứng trang chứng khoán chạy y hệt trước | Đối chiếu số với bản live |

**Rủi ro:** đây là lúc dễ làm hỏng trang đang chạy tốt nhất. Bắt buộc kiểm
chứng trên trình duyệt thật trước khi push, không chỉ đọc code.

---

### GĐ 1 — Trang Ngoại tệ · ĐỘ KHÓ: TRUNG BÌNH · 3 phiên · Tuần 2

Đã tăng từ 2 lên 3 phiên: user yêu cầu thêm biểu đồ lịch sử, kéo theo nguồn thứ
hai + logic tỷ giá chéo.

| # | Việc | Ghi chú |
|---|---|---|
| 1.1 | Route `/api/fx/rates` — parse XML Vietcombank | Cache **≥5 phút** (nguồn yêu cầu) |
| 1.2 | Bảng tỷ giá đầy đủ: mua tiền mặt / mua chuyển khoản / bán | Sort, tìm kiếm mã |
| 1.3 | Route `/api/fx/history` — Yahoo + **tỷ giá chéo** cho JPY/CNY/AUD | Xem 2.10. Cache theo khung như history chứng khoán |
| 1.4 | Biểu đồ 1M/3M/6M/1Y/5Y | Dùng lại `chartModule.js`, kiểu đường thay vì nến |
| 1.5 | **Nhãn nguồn rõ ràng trên cả bảng lẫn biểu đồ** | Bắt buộc — xem cảnh báo 2.10 |
| 1.6 | Ghim mã hay dùng lên đầu | Lưu qua `Store` |
| 1.7 | Danh mục ngoại tệ nhập tay + lãi/lỗ theo giá vốn | Dùng lại bình quân gia quyền của `portfolio.js` |
| 1.8 | Công cụ quy đổi nhanh 2 chiều | |

**Việc 1.5 không được cắt cho kịp tiến độ.** Bảng và biểu đồ lệch nhau 0,8% là
chuyện bình thường của hai loại tỷ giá khác nhau, nhưng không ghi nhãn thì user
sẽ tưởng hệ thống lỗi và mất niềm tin vào toàn bộ số liệu.

---

### GĐ 2 — Trang Vàng · ĐỘ KHÓ: THẤP–TRUNG BÌNH · 2 phiên · Tuần 2-3

| # | Việc | Ghi chú |
|---|---|---|
| 2.1 | **Xác minh đơn vị giá PNJ** trước khi viết gì khác | Đối chiếu giá niêm yết công khai. Ghi kết luận vào `docs/VANG.md` |
| 2.2 | Route `/api/gold/prices` — PNJ chính, BTMC dự phòng | Hợp nhất 2 nguồn về 1 format |
| 2.3 | Bảng giá: SJC miếng, nhẫn trơn, Kim Bảo, Phúc Lộc Tài | Hiện rõ chênh lệch mua-bán (%) |
| 2.4 | Quy đổi lượng / chỉ / gram | 1 lượng = 10 chỉ = 37,5g |
| 2.5 | Danh mục vàng nhập tay: loại, số lượng, giá vốn, ngày mua | |
| 2.6 | Cảnh báo chênh lệch mua-bán bất thường | Chênh lệch giãn rộng = tín hiệu thị trường căng |

---

### GĐ 3 — Trang Coin (giá + danh mục tay) · ĐỘ KHÓ: TRUNG BÌNH · 2 phiên · Tuần 3-4

Cố ý **tách phần đồng bộ sàn ra GĐ 7**: phần giá dễ và có giá trị ngay, phần
đồng bộ khó và có rủi ro bảo mật.

| # | Việc | Ghi chú |
|---|---|---|
| 3.1 | Route `/api/crypto/prices` — CoinGecko chính, Binance dự phòng | Cache 60s |
| 3.2 | Danh sách theo dõi coin + giá VND/USD + biến động 24h | Dùng lại khuôn watchlist chứng khoán |
| 3.3 | Danh mục coin nhập tay + lãi/lỗ | Tạm thời, GĐ 7 thay bằng đồng bộ sàn |
| 3.4 | Biểu đồ giá coin | Dùng lại `chartModule.js` — cùng thư viện, cùng khuôn |

---

### GĐ 4 — Trang Gửi tiết kiệm · ĐỘ KHÓ: TRUNG BÌNH · 3 phiên · Tuần 4-5

Trang có nhiều logic tính toán nhất trong nhóm "dễ".

| # | Việc | Ghi chú |
|---|---|---|
| 4.1 | Route `/api/savings/rates` — proxy CafeF JSON | Cache 6-12h + **lưu bản chụp gần nhất** |
| 4.2 | Bảng so sánh 28 NH × 8 kỳ hạn, lọc/sort theo kỳ hạn | Có logo ngân hàng sẵn trong nguồn |
| 4.3 | Nổi bật lãi suất cao nhất mỗi kỳ hạn | |
| 4.4 | Sổ tiết kiệm nhập tay: NH, số tiền, kỳ hạn, lãi suất, ngày gửi | |
| 4.5 | Tự tính: ngày đáo hạn, lãi dự kiến, tổng lãi năm | |
| 4.6 | **Cảnh báo sổ sắp đáo hạn** (30/15/7 ngày) | Giá trị thực tế cao nhất của trang này |
| 4.7 | Công cụ "gửi X tiền, Y tháng — ngân hàng nào lời nhất" | So trực tiếp trên bảng lãi suất |
| 4.8 | Hiển thị rõ "Cập nhật lúc …" cho bảng lãi suất | Nguồn không cam kết, user phải biết độ tươi |

---

### GĐ 5 — Hạ tầng dữ liệu: Supabase + đăng nhập · ĐỘ KHÓ: **CAO NHẤT** · 5 phiên · Tuần 6-8

Giai đoạn khó nhất và rủi ro nhất. Cố ý đặt sau khi đã có 4 trang chạy được —
lúc đó đã biết chính xác schema cần gì, không phải thiết kế mò.

| # | Việc | Ghi chú |
|---|---|---|
| 5.1 | Tạo Supabase project (free tier), thiết kế schema 7 bảng | Xem 3.4 |
| 5.2 | Bật **Row Level Security** trên mọi bảng ngay lúc tạo | Không để làm sau |
| 5.3 | Đăng nhập bằng email magic link | Không mật khẩu = không có mật khẩu để lộ |
| 5.4 | Viết `store.js` driver Supabase | Cùng giao diện, đổi driver |
| 5.5 | Màn hình nhập dữ liệu cũ từ localStorage lên DB | **Không tự động, phải user bấm** + xem trước |
| 5.6 | Nút xuất toàn bộ dữ liệu ra JSON | Lối thoát khi muốn rời Supabase |
| 5.7 | Job lưu snapshot giá hàng ngày (tỷ giá, vàng, lãi suất) | Mở đường cho biểu đồ lịch sử sau này |
| 5.8 | Kiểm chứng: sửa trên máy tính, mở điện thoại thấy đúng | Đây là lý do làm cả giai đoạn này |

**Rủi ro cần nói thẳng:** đây là lúc dữ liệu tài sản thật có thể mất. Bắt buộc
xuất JSON sao lưu trước khi chạy 5.5, và giữ localStorage nguyên vẹn (không xoá)
cho tới khi xác nhận DB đúng.

---

### GĐ 6 — Trang Tổng gia sản · ĐỘ KHÓ: TRUNG BÌNH–CAO · 3 phiên · Tuần 8-9

Phụ thuộc GĐ 5 (cần đọc danh mục cả 5 kênh từ một chỗ).

| # | Việc | Ghi chú |
|---|---|---|
| 6.1 | Gom định giá 5 kênh về cùng đơn vị VND | Coin qua USD→VND, ngoại tệ qua tỷ giá VCB |
| 6.2 | Tổng giá trị ròng + lãi/lỗ từng kênh | |
| 6.3 | Biểu đồ tròn phân bổ tài sản | |
| 6.4 | Bảng dòng tiền vào/ra theo kênh | Tách "tăng do lãi" với "tăng do nạp thêm" |
| 6.5 | Xử lý kênh lỗi nguồn | Ghi rõ "chưa tính được kênh vàng", **không lặng lẽ tính thiếu** |
| 6.6 | Rà chế độ riêng tư trên **cả 6 trang** | Bật nút con mắt, tìm số tiền còn lọt. Xem 3.5 |
| 6.7 | Biểu đồ tròn bỏ nhãn số tuyệt đối khi bật riêng tư | Chỉ còn phần trăm |

**6.5 là mục quan trọng nhất cả giai đoạn.** Một trang tổng cộng thiếu một kênh
mà không báo gì sẽ đưa ra con số tài sản sai — đúng loại lỗi vừa sửa hôm 30/07,
nhưng hậu quả nặng hơn vì đây là con số user dùng để ra quyết định.

---

### GĐ 7 — Đồng bộ số dư sàn coin · ĐỘ KHÓ: CAO · 3 phiên · Tuần 10-11

Sàn đã chốt: **Binance**.

| # | Việc | Ghi chú |
|---|---|---|
| 7.1 | Tạo API key Binance **chỉ bật Enable Reading** | Tắt Spot Trading, tắt Withdrawals. Bật khoá IP về IP tĩnh của Render |
| 7.2 | Route `/api/crypto/balances` — `GET /api/v3/account` ký HMAC-SHA256 | Khuôn bảo mật giống `/api/account/*` đang chạy |
| 7.3 | Xử lý lệch đồng hồ (`recvWindow`, lỗi `-1021`) | Binance từ chối request nếu đồng hồ server lệch |
| 7.4 | Lọc bỏ số dư 0, quy đổi USD → VND | Dùng tỷ giá từ `/api/fx/rates` cho nhất quán |
| 7.5 | Hợp nhất số dư sàn với danh mục tay của GĐ 3 | **Tránh đếm trùng** — ưu tiên số dư sàn, danh mục tay chỉ giữ phần ví ngoài sàn |
| 7.6 | Xử lý coin sàn có mà CoinGecko không có | Bỏ qua kèm ghi chú, không âm thầm tính giá 0 |

**Nguyên tắc không thương lượng:** key chỉ đọc, không quyền rút tiền, không
quyền giao dịch. Giống hệt lý do FastConnect Trading dừng ở giai đoạn 1.
Binance có API đặt lệnh — **không dùng, không viết sẵn để dành**.

**Lưu ý hạ tầng:** Render Free **không có IP tĩnh**, nên khoá IP ở 7.1 chỉ làm
được nếu nâng lên gói trả phí. Nếu giữ Free thì bỏ khoá IP và bù lại bằng: key
chỉ-đọc (đã có), `DASHBOARD_API_KEY` (đã có), origin allowlist (đã có). Quyết
định này để tới GĐ 7 hẵng cân, không chặn gì bây giờ.

---

## 5. Tổng hợp timeline

| GĐ | Nội dung | Độ khó | Phiên | Tuần |
|---|---|---|---|---|
| 0 | Tái cấu trúc nền móng + nút con mắt | Thấp | 2 | 1 |
| 1 | Ngoại tệ (kèm biểu đồ lịch sử) | TB | 3 | 2 |
| 2 | Vàng | Thấp–TB | 2 | 3 |
| 3 | Coin (giá + tay) | TB | 2 | 3-4 |
| 4 | Gửi tiết kiệm | TB | 3 | 4-5 |
| 5 | **Supabase + đăng nhập** | **Cao nhất** | 5 | 6-8 |
| 6 | Trang tổng | TB–Cao | 3 | 8-9 |
| 7 | Đồng bộ Binance | Cao | 3 | 10-11 |
| | **Tổng** | | **23** | **~11 tuần** |

**Mốc dùng được thật:**
- Cuối tuần 5: 5 kênh chạy (chứng khoán, ngoại tệ, vàng, coin, tiết kiệm), dữ
  liệu còn ở từng máy riêng.
- Cuối tuần 8: đồng bộ đa thiết bị.
- Cuối tuần 9: có con số tổng gia sản + khoe được mà không lộ số.

---

## 6. Câu hỏi mở — ĐÃ CHỐT HẾT ngày 30/07/2026

| Câu hỏi | Quyết định | Hệ quả |
|---|---|---|
| Sàn coin | **Binance** | GĐ 7 ký HMAC-SHA256, key chỉ-đọc |
| Tên miền | **Giữ `dashboardstock.io.vn`**, mua tên miền mới sau rồi 301 | Không chặn code, chỉ là DNS về sau |
| Ngoại tệ | Có nắm giữ **và** cần biểu đồ lịch sử 1M/3M/6M/1Y/5Y | GĐ 1 tăng 2→3 phiên, thêm nguồn Yahoo |
| Dùng chung | **Chỉ một người** | Schema đơn giản, không cần chia sẻ/mời |
| Riêng tư | **Nút con mắt toàn site** | Làm ngay ở GĐ 0 cùng thanh điều hướng |

Không còn câu hỏi nào chặn. Có thể bắt đầu GĐ 0.

---

## 7. Những gì cố ý KHÔNG làm

- **Biểu đồ tài sản ròng theo thời gian** — user không chọn. Nhưng job 5.7 vẫn
  lưu snapshot để nếu sau này đổi ý thì có sẵn dữ liệu quá khứ.
- **Đặt lệnh Binance** — API có sẵn, cố ý không dùng, không viết sẵn để dành.
- **Mục tiêu tỷ trọng / gợi ý tái cân bằng** — user không chọn.
- **Đặt lệnh** ở bất kỳ kênh nào (chứng khoán, coin). Toàn bộ hệ thống chỉ đọc.
- **Bất động sản, trái phiếu, quỹ mở, bảo hiểm** — ngoài phạm vi đề bài.
- **Ứng dụng di động** — web responsive là đủ.
