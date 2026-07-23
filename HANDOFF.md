# HANDOFF — Dashboard "Bảng Điện" (cập nhật 23/07/2026)

> Dán file này làm prompt đầu tiên của phiên mới để tiếp tục không mất bối cảnh.
> **`CLAUDE.md` ở cùng repo là tài liệu kỹ thuật đầy đủ** (format API, cạm bẫy,
> hạ tầng). File này tóm tắt trạng thái + việc đang mở.

---

## 0. Truy cập nhanh

| Thành phần | Địa chỉ |
|---|---|
| Dashboard (live) | **https://dashboardstock.io.vn** |
| Mock Liquid Glass (đang chờ duyệt) | https://dashboardstock.io.vn/mock-liquid-glass.html |
| Backend proxy | https://dashboard-chung-khoan.onrender.com |
| Repo | github.com/hoangduy2401-web/dautuchungkhoan (nhánh `main`) |
| Repo local | /Users/duyhoang/Claude/dautuchungkhoan |

Tên miền mua ở Mắt Bão (`ns1/ns2.matbao.vn`). Backend deploy Render Free,
frontend GitHub Pages. Không build tool — HTML/CSS/JS thuần.

---

## 1. Quy ước làm việc (BẮT BUỘC)

- Trả lời **tiếng Việt**, comment code **tiếng Anh**.
- KHÔNG hỏi xác nhận trước khi sửa file. CHỈ hỏi khi: xóa file/tính năng, đổi
  cấu trúc lớn (đổi kiến trúc module, thư viện chart, format dữ liệu giữa
  `dataService.js` ↔ `app.js` ↔ `server`).
- **Sửa file JS/CSS xong PHẢI bump `?v=YYYYMMDD`** trong `index.html` (hiện
  `20260723`), nếu không người dùng chạy code cũ tới 10 phút do cache Pages.
- **Nguồn sự thật server là `server/index.js`**; sau mỗi lần sửa chạy
  `cp server/index.js index.js` (Render deploy từ root).
- KHÔNG commit `server/.env`. Đã có `.gitignore` chặn.
- Sau thay đổi lớn: tự cập nhật mục trạng thái trong `CLAUDE.md` + file này.

---

## 2. Trạng thái hiện tại — ĐÃ XONG & chạy thật

Toàn bộ dashboard chạy dữ liệu thật end-to-end (`USE_MOCK: false`,
`FALLBACK_TO_MOCK_ON_ERROR: true` làm lưới an toàn):

| Tính năng | Nguồn | Ghi chú |
|---|---|---|
| Giá / nến / chỉ số | SSI FastConnect **Data** | chunking 30 ngày, index dùng `DailyIndex` từng mã |
| Chỉ số cơ bản (10/10 ô) | VNDirect finfo | ratios + tự tính YoY & nợ/VCSH từ financial_statements |
| Tin tức theo mã | CafeF RSS | đã sửa regex tiếng Việt (`\b` không dùng được) |
| Watchlist | localStorage `vn_dashboard_watchlist_v1` | seed đầu = `DEFAULT_WATCHLIST` |
| Lịch sử giao dịch nhập tay | localStorage `vn_dashboard_transactions_v1` | giá vốn bình quân gia quyền |
| **Danh mục thật SSI (chỉ đọc)** | SSI FastConnect **Trading** | GĐ1, xem mục 3 |
| Keep-alive | GitHub Actions ping `/health` mỗi 10 phút | chống Render ngủ |
| Tên miền + HTTPS | dashboardstock.io.vn | chứng chỉ Let's Encrypt tự cấp |

Đã kiểm chứng số liệu tài khoản khớp: giá trị cổ phiếu + tiền mặt = `totalAssets`
SSI báo (149,3 tr). Holdings thật hiện tại: ACB 4.364cp, SSI 2.240cp.

**Fix hiệu năng (23/07/2026):** dashboard từng load >5 phút. Nguyên nhân: SSI
throttle call song song/dồn dập (6 quote đồng thời → 3 cái kẹt ~32s), không có
timeout, và `setInterval` refresh 15s chồng lấn tạo vòng xoáy tự bóp nghẹt. Đã
sửa: backend limiter concurrency=1 + cache stale-while-revalidate + warm-up nền
5 phút + timeout; frontend chặn refresh chồng lấn + chu kỳ 45s + timeout 12s.
Chi tiết trong `CLAUDE.md` mục 6 (Hiệu năng). Cold load ~15s, load lại ~tức thì.

---

## 3. SSI Trading GĐ1 (chỉ đọc) — đã xong, đang chạy

Endpoint: `POST /api/account/otp`, `POST /api/account/login {code}`,
`GET /api/account/portfolio`. Bảo mật: header `x-dashboard-key` khớp
`DASHBOARD_API_KEY` (timingSafeEqual) + origin allowlist. Không set env = tắt.

**Cạm bẫy đã xử lý** (chi tiết trong `CLAUDE.md` mục 9):
- FCTrading trả HTTP 200 kèm lỗi trong body → check `status`, không chỉ `res.ok`.
- Số tài khoản phải 7 chữ số (6 số + hậu tố `1` cơ sở / `8` phái sinh) →
  `normalizeAccount()` tự nối `1`.
- `marketPrice = 0` ngoài giờ giao dịch → fallback giá đóng cửa FCData.
- Tài khoản dùng **Smart OTP** → `GetOTP` báo "2FA type is invalid"; lấy mã
  trong app SSI rồi gọi thẳng `AccessToken`. Mỗi lần Render cold start phải
  nhập OTP lại (token cache ở `os.tmpdir()` mất khi instance mới).

**GĐ2 (đặt lệnh) — CHƯA làm, cố ý.** Cần chữ ký RSA-SHA256 + private key PEM;
server hiện không giữ key nào nên kể cả lộ `DASHBOARD_API_KEY` cũng chỉ đọc
được. Trước khi làm GĐ2 phải có: xác thực backend đã có sẵn + xác nhận 2 bước
UI + giới hạn giá trị lệnh + nút hủy khẩn cấp + log lệnh. Không có UAT/paper
trading → mọi lệnh test là tiền thật.

`server/.env` (local) và env vars Render đều đã điền:
`SSI_TRADING_CONSUMER_ID/SECRET`, `SSI_ACCOUNT` (6 số), `SSI_TRADING_2FA_TYPE=1`,
`DASHBOARD_API_KEY`. Không dùng `SSI_TRADING_PIN` (Smart OTP).

---

## 4. ĐANG CHỜ QUYẾT ĐỊNH — Liquid Glass redesign

**Đã dựng mock để duyệt, CHƯA áp vào file thật:**
`mock-liquid-glass.html` → https://dashboardstock.io.vn/mock-liquid-glass.html

- Phong cách Liquid Glass của Apple (HIG): panel kính trong mờ
  `backdrop-filter: blur+saturate`, lớp aurora trôi phía sau, highlight mép,
  bo góc lớn, control pill/segmented kiểu iOS.
- Font: **Inter** (thay SF Pro — SF không cấp phép web; Inter giống nhất + đủ
  tiếng Việt có dấu), số `tabular-nums`.
- Giữ accent amber; màu tăng/giảm theo hệ iOS (`#30d158`/`#ff453a`).
- Có nút Sáng/Tối, dữ liệu mẫu, không nối backend.

**4 câu hỏi đã gửi user, chờ phản hồi:**
1. Tổng thể OK không, muốn kính đục/trong hơn, aurora rõ/mờ hơn?
2. Mặc định Tối hay Sáng?
3. Quầng teal/xanh lá ở giữa — giữ hay đổi (xanh lá trùng màu "tăng giá")?
4. Có chỗ nào chữ khó đọc trên thiết bị của user?

**CẬP NHẬT 23/07/2026 — user đã duyệt & mình đã tinh chỉnh `mock-liquid-glass.html`
(ĐÃ PUSH, live tại https://dashboardstock.io.vn/mock-liquid-glass.html):**
- Kính trong hơn + thêm **thanh trượt độ trong/đục** dưới nút Sáng/Tối.
- Mặc định **Sáng**.
- **Bỏ hẳn quầng teal/xanh lá** (đổi palette aurora sang amber + indigo/tím, dịu hơn).
- **BẢNG ĐIỆN** thêm dấu cách.
- Biểu đồ đổi sang **nến** (mặc định) + khối chart thành kính trong.
- Thêm **trục giá** (phải) + **nhãn giá hiện tại** + **trục ngày** (đáy).
- Thêm bộ chọn **khung 1M / 3M / 6M** (mặc định 3M).
→ Việc còn lại: user xem bản mock mới trên thiết bị thật, chốt xong thì áp phong
cách vào `style.css`/`index.html` thật rồi push.

**Khi user duyệt xong** → áp phong cách vào `style.css` + `index.html` thật,
giữ nguyên 100% chức năng, chỉ thay lớp giao diện, rồi bump `?v=`.

> Lưu ý kỹ thuật: trình chụp headless không dựng đúng `backdrop-filter` ở
> viewport thứ 2 (hiện đen). Không phải lỗi thật — kiểm tra trên trình duyệt
> thật. Nền panel dùng `rgba` nên kể cả backdrop-filter fail vẫn thấy thẻ tối.

---

## 5. VIỆC NHỎ CÒN TREO (không chặn)

1. **Enforce HTTPS chưa bật được**: tên miền gốc mới có 1 bản ghi A
   (`185.199.108.153`); GitHub đòi đủ 4 (`.108/.109/.110/.111.153`). Giao diện
   DNS Mắt Bão có vẻ chỉ cho 1 bản ghi A → nếu đúng phải chuyển nameserver sang
   Cloudflare mới thêm đủ. `http://` hiện vẫn trả 200 (chưa ép sang https).
2. **Bật tự động gia hạn tên miền** ở Mắt Bão (quên = dashboard chết, không ai báo).
3. GitHub tự tắt scheduled workflow sau 60 ngày repo không commit → vào tab
   Actions bấm *Enable workflow* khi cần.

---

## 6. Ý TƯỞNG DÀI HẠN (chưa yêu cầu)

- SSI Trading GĐ2 — đặt lệnh (xem mục 3, rủi ro cao).
- MACD (12,26,9) theo khuôn mẫu RSI.
- Đồng bộ giao dịch đa thiết bị: thay localStorage bằng backend + DB, giữ chữ
  ký hàm `Portfolio.list/add/remove/computeHoldings`.
- Alert giá (toast khi vượt ngưỡng).
- Lấy thêm `revenueYoY/netProfitYoY/debtToEquity` sâu hơn, hoặc nguồn Vietstock.

---

## 7. Môi trường máy local

- Không có `gh` CLI. Git push dùng PAT lưu trong osxkeychain (scope `repo` +
  `workflow`). Push chạy thẳng không cần nhập lại.
- Không có Homebrew.
- Node v24, npm 11. Shell zsh (lưu ý: `read -p` không chạy như bash, dùng
  `printf "..."; read -s VAR`).
- Test server local: `cd server && PORT=3999 node index.js`. Serve frontend:
  `python3 -m http.server 5599` từ thư mục repo.
