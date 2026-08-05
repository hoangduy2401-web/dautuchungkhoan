# SSI FastConnect Trading — GĐ1 chỉ đọc

> Tách khỏi `CLAUDE.md` ngày 04/08/2026: chỉ cần đọc khi động vào phần tài khoản
> SSI, không cần nạp mỗi phiên. **Đọc file này trước khi sửa `/api/account/*`.**


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
