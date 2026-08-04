# CLAUDE.md — Website Quản lý Gia sản Cá nhân

> **BẢN NHÁP, CHƯA ÁP DỤNG.** Đây là đề xuất cho `CLAUDE.md` mới ở thư mục gốc,
> bao trùm lên dự án dashboard chứng khoán hiện tại. Chỉ đổi tên file này thành
> `/CLAUDE.md` khi GĐ 0 (tái cấu trúc) bắt đầu — xem `docs/QUYHOACH.md`.
> Nội dung `CLAUDE.md` hiện tại sẽ chuyển nguyên vẹn vào `docs/CHUNGKHOAN.md`.

## 1. Mục tiêu

Website quản lý gia sản cá nhân, phủ 5 kênh đầu tư + 1 trang tổng hợp. Web tĩnh
(HTML/CSS/JS thuần, không build tool) trên GitHub Pages, backend proxy
Node.js/Express trên Render, dữ liệu người dùng ở Supabase Postgres.

| Trang | Đường dẫn | Nguồn giá | Nguồn danh mục |
|---|---|---|---|
| Tổng gia sản | `/` | tổng hợp | tổng hợp |
| Chứng khoán VN | `/chung-khoan.html` | SSI FastConnect | SSI Trading (đọc) + tay |
| Vàng | `/vang.html` | PNJ edge-api | nhập tay |
| Ngoại tệ | `/ngoai-te.html` | Vietcombank XML + Yahoo (lịch sử) | nhập tay |
| Coin | `/coin.html` | CoinGecko | Binance API (chỉ đọc) |
| Gửi tiết kiệm | `/tiet-kiem.html` | CafeF CDN JSON | nhập tay |

Tài liệu chi tiết từng kênh nằm ở `docs/`: `CHUNGKHOAN.md`, `VANG.md`,
`NGOAITE.md`, `COIN.md`, `TIETKIEM.md`. **Đọc file của kênh đang sửa trước khi
đụng code kênh đó** — mỗi kênh có cạm bẫy riêng đã trả giá để biết.

## 2. Quy ước làm việc (BẮT BUỘC)

- Trả lời bằng **tiếng Việt**. Comment trong code bằng **tiếng Anh**.
- Code thẳng, ít giải thích dài dòng — trừ task phức tạp/rủi ro.
- KHÔNG hỏi xác nhận trước khi sửa file, kể cả nhiều file cùng lúc.
- CHỈ hỏi xác nhận khi: xoá file/tính năng, đổi cấu trúc lớn (đổi kiến trúc
  module, đổi thư viện chart, đổi format dữ liệu giữa các tầng), hoặc **bất cứ
  thao tác nào chạm tới dữ liệu tài sản thật trong Supabase**.
- **Sửa JS/CSS xong PHẢI bump `?v=YYYYMMDD<chữ>`** ở MỌI trang HTML dùng file
  đó, không thì user chạy code cũ tới 10 phút do cache GitHub Pages.
- Sau thay đổi lớn: tự cập nhật mục trạng thái ở file này + file `docs/` của kênh.
- **KHÔNG commit** `server/.env` hay bất kỳ credential nào.

## 3. Ràng buộc kỹ thuật đã chốt (KHÔNG tự ý đổi)

- Không React/Vite/Webpack — HTML/CSS/JS thuần, script tag.
- Chart: **TradingView Lightweight Charts v4.1.3** qua CDN. Không quay lại Chart.js.
  Trang coin dùng lại đúng module này, không thêm thư viện chart thứ hai.
- **Đơn vị tiền tệ nội bộ: VND.** Mỗi nguồn có hệ số quy đổi riêng, ghi rõ trong
  `docs/` của kênh đó. SSI trả đồng → chia 1000. Đơn vị giá vàng PNJ **phải xác
  minh trước khi dùng** (xem `docs/VANG.md`).
- CORS: API tài chính VN chặn gọi thẳng từ trình duyệt → backend proxy bắt buộc.
- Mọi widget lấy dữ liệu qua `dataService.js`, không `fetch()` thẳng trong trang.
- Mọi dữ liệu người dùng đọc/ghi qua `store.js`, **không gọi thẳng Supabase hay
  localStorage** từ trang. Toàn bộ API của `store.js` trả Promise.
- Font **Roboto**. Theme Sáng/Tối dùng chung mọi trang, **tối là mặc định**.
  (Cập nhật 04/08: reskin sang Fey design system ngày 03/08 đã bỏ hẳn Liquid
  Glass — không còn aurora, `backdrop-filter`, slider Trong/Đục hay `--glass-a`.
  Đừng phục hồi. Xem `CLAUDE.md` mục 3.)

## 4. Luật vàng: KHÔNG BAO GIỜ HIỂN THỊ SỐ BỊA

Bài học 30/07/2026, áp cho toàn bộ website:

- **Giá và số dư không bao giờ fallback sang dữ liệu mô phỏng.** Gọi lỗi thì
  hiện `—`, không hiện số ngẫu nhiên. Một giá bịa trên màn hình không thể phân
  biệt với giá thật.
- **Ô trống phải nói tại sao trống.** "Đang chờ máy chủ", "Nguồn vàng lỗi" —
  không để trống câm.
- **Dữ liệu cũ phải ghi rõ thời điểm.** Thà hiện bản chụp hôm qua kèm "Cập nhật
  lúc …", còn hơn hiện số mới mà sai.
- **Trang tổng thiếu một kênh phải báo ngay trên con số tổng.** Cộng thiếu mà
  im lặng là lỗi nặng nhất hệ thống có thể mắc.
- **Số đúng nhưng dán nhầm nhãn cũng là số sai.** Trang ngoại tệ hiển thị hai
  loại tỷ giá lệch nhau ~0,8% (Vietcombank bán lẻ vs Yahoo thị trường) — mỗi con
  số phải ghi rõ nguồn ngay cạnh nó.
- Mock data chỉ dùng khi `USE_MOCK: true` (phát triển), và luôn kèm badge cảnh báo.

## 4b. Chế độ riêng tư (nút con mắt)

Website này để khoe được mà không lộ tài sản. Công tắc `privacyMode` toàn cục,
nút đặt trên thanh điều hướng dùng chung.

- Bật = che mọi **số tiền tuyệt đối** và **số lượng nắm giữ** thành `••••••`.
- Vẫn hiện: giá thị trường, % lãi/lỗ, tỷ trọng phân bổ, hình dạng biểu đồ.
- Biểu đồ tài sản **phải bỏ nhãn trục Y** khi bật.
- Cách làm: bọc `<span class="money">`, bật một class trên `<html>`, CSS lo phần
  che. **Không sửa từng chỗ render** — sẽ sót, và sót một chỗ là hỏng cả tính năng.
- Mặc định TẮT. Trạng thái lưu qua `Store`.
- Thêm trang mới hoặc thêm ô hiển thị tiền: **bắt buộc rà lại chế độ này**.

## 5. Kiến trúc

### Cấu trúc file
```
/<trang>.html
/assets/css/base.css + <trang>.css
/assets/js/core/{config,nav,store,dataService,format}.js
/assets/js/pages/<trang>.js
/server/index.js + /server/routes/{stock,gold,fx,crypto,savings,account}.js
/docs/*.md
```

**Render deploy từ thư mục `server`** (Root Directory setting). Không còn hack
`cp server/index.js index.js` như dự án cũ.

### Backend — dùng lại, đừng viết mới
Mọi route mới bắt buộc dùng lại hạ tầng đã có trong `server/`:
- `withCache(key, ttl, producer)` — stale-while-revalidate + dedup in-flight.
- `createLimiter(n)` — chặn gọi song song với nguồn hay throttle.
- `fetchWithTimeout` — `fetch()` của Node **không có timeout mặc định**.
- `computeX()` tách khỏi route để warm-up gọi lại được không qua HTTP.

### Tầng lưu trữ
`store.js` là giao diện duy nhất: `list/add/update/remove/onChange`, tất cả trả
Promise. Driver đổi được (localStorage → Supabase) mà trang không phải sửa.
Collections: `tx_stock`, `holdings_gold`, `holdings_fx`, `holdings_crypto`,
`savings_accounts`, `cash_flows`, `settings`.

## 6. Nguồn dữ liệu — trạng thái đã kiểm chứng 30/07/2026

| Kênh | Endpoint | Trạng thái | Cạm bẫy |
|---|---|---|---|
| Ngoại tệ | `portal.vietcombank.com.vn/Usercontrols/TVPortal.TyGia/pXML.aspx` | Chạy | **Tối đa 1 request/5 phút**. Không có lịch sử |
| Lịch sử tỷ giá | `query1.finance.yahoo.com/v8/finance/chart/USDVND=X?range=5y` | Chạy | Chỉ USD/VND đủ sâu. JPY/CNY/AUD phải tính **tỷ giá chéo** qua USD |
| Vàng | `edge-api.pnj.io/ecom-frontend/v1/get-gold-price` | Chạy | Đơn vị giá **chưa xác minh** |
| Vàng dự phòng | `api.btmc.vn/api/BTMCAPI/getpricebtmc?key=…` | Chạy | Format `@n_1/@pb_1` theo chỉ số dòng |
| Coin | `api.coingecko.com/api/v3/simple/price` | Chạy | Trả sẵn VND, không cần tự quy đổi |
| Coin dự phòng | `api.binance.com/api/v3/ticker/24hr` | Chạy | Chỉ có USD |
| Lãi suất | `cafefnew.mediacdn.vn/…/Liveboard/all_banks_interest_rates.json` | Chạy | URL nội bộ CafeF, có thể đổi bất cứ lúc nào |
| Chứng khoán | SSI FastConnect + VNDirect + CafeF RSS | Chạy | Xem `docs/CHUNGKHOAN.md` |
| **Vàng SJC** | `sjc.com.vn/giavang/textContent.php` | **KHÔNG DÙNG ĐƯỢC** | Cloudflare JS challenge. Đừng thử header giả trình duyệt |

Nguồn không cam kết (PNJ, BTMC, CafeF) **bắt buộc lưu bản chụp gần nhất vào DB**
để trang không trắng khi nguồn chết.

## 7. Bảo mật

- Route đọc tài khoản thật (`/api/account/*`, `/api/crypto/balances`) bắt buộc:
  header `x-dashboard-key` so bằng `crypto.timingSafeEqual` + origin allowlist +
  **không set env là tắt hẳn (503)**.
- API key sàn/môi giới: chỉ ở env Render, **chỉ quyền đọc**, khoá IP nếu sàn hỗ
  trợ. Không bao giờ ở frontend.
- **Binance key: chỉ bật "Enable Reading".** Tắt Spot Trading, tắt Withdrawals.
  Binance có API đặt lệnh — không dùng, không viết sẵn để dành.
- Supabase: **Row Level Security bật ngay lúc tạo bảng**, không để làm sau.
- Toàn hệ thống **chỉ đọc**. Không đặt lệnh chứng khoán, không giao dịch coin,
  không chuyển tiền. Đây là ràng buộc thiết kế, không phải việc chưa làm.
- Trước mọi thao tác chạm dữ liệu tài sản thật: xuất JSON sao lưu trước.

## 8. Trạng thái hiện tại

**30/07/2026 — quy hoạch xong, chưa bắt đầu GĐ 0.**
Đang chạy: dashboard chứng khoán tại https://dashboardstock.io.vn (kiến trúc cũ,
một trang, localStorage). Xem `docs/CHUNGKHOAN.md`.

Kế hoạch 8 giai đoạn / ~22 phiên / ~11 tuần: `docs/QUYHOACH.md`.

### Việc tiếp theo
GĐ 0 mục 0.1 — đổi Root Directory trên Render sang `server`, xoá `index.js` +
`package.json` ở gốc. Làm trước mọi thứ khác.
