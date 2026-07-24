# HANDOFF — Dashboard "Bảng Điện" (cập nhật 24/07/2026, phiên 2)

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
- **Sửa file JS/CSS xong PHẢI bump `?v=YYYYMMDD<chữ>`** trong `index.html` (hiện
  `20260724h`), nếu không người dùng chạy code cũ tới 10 phút do cache Pages.
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
| Giá / nến / chỉ số | SSI FastConnect **Data** | chunking 30 ngày; index intraday tái tạo từ đóng cửa × RatioChange (xem CLAUDE mục 6) |
| Chart khung thời gian | — | 1M / 3M / 6M / **1Y** / **5Y** (30/90/180/365/1825 ngày) |
| **Ticker tape (chạy đầu trang)** | rổ **VN30** | tách khỏi watchlist; cuộn 90s; backend warm cả 30 mã |
| **Bản đồ nhiệt VN30** | quote VN30 (đã warm) | 30 ô màu %, click = load chart; chưa sizing theo vốn hóa |
| Chỉ số cơ bản (10/10 ô) | VNDirect finfo | ratios + tự tính YoY & nợ/VCSH từ financial_statements |
| Tin tức theo mã | CafeF RSS | đã sửa regex tiếng Việt (`\b` không dùng được) |
| Watchlist | localStorage `vn_dashboard_watchlist_v1` | seed đầu = `DEFAULT_WATCHLIST`; burger ☰ kéo thả sắp xếp |
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

**Ticker tape → rổ VN30 (24/07/2026):** thanh chạy đầu trang giờ hiển thị đủ 30
mã VN30, **tách khỏi watchlist cá nhân** (watchlist chỉ dùng cho panel bên dưới).
- `app.js`: `renderTickerTape` lặp `APP_CONFIG.VN30`; `loadTapeQuotes` fetch quote
  cho VN30 ∪ watchlist (deduped) qua hàm chung `loadQuotesFor`.
- `config.js`: thêm mảng `APP_CONFIG.VN30` (30 mã, cập nhật khi VN30 rebalance ~2 lần/năm).
- `server/index.js`: `WARM_SYMBOLS` default mở rộng 6 → cả 30 mã VN30 → tape phục
  vụ từ cache, không nện SSI mỗi load. **Nhớ `cp server/index.js index.js`.**
- Cold load lần đầu tape có thể chậm ~30–60s (30 quote tuần tự qua limiter
  concurrency=1) trước khi warm sweep đầu chạy; sau đó tức thì.
- **Tốc độ cuộn:** track dài gấp ~5 nên `style.css` `scroll-left` chỉnh 32s → **90s**
  (chỉnh ở đây nếu muốn nhanh/chậm hơn). Hover vào tape vẫn pause.
- `style.css.pre-glass.bak` đã thêm vào `.gitignore`.

**Thêm phiên 24/07 (phiên 2):**
- **Heatmap VN30** (`renderHeatmap`, section dưới index-strip): 30 ô màu %,
  `heatColor` clamp ±3%, sort tăng→giảm, click ô = load chart. 0 call thêm.
  Chưa sizing theo vốn hóa (hoãn — gộp khi làm dòng tiền, cần marketcap VN30).
- **Chart 1Y + 5Y** (`renderRangeTabs`). Timeout history frontend co giãn
  (`dataService.getHistory`: 1Y 30s, 5Y 75s); backend TTL co giãn (>270 ngày = 30 phút).
  Cold load 5Y ~40 call SSI (~60s), sau đó cache.
- **Tài khoản SSI mobile**: ≤640px bảng 7 cột → thẻ label:value (`data-label` mỗi td).
- **Watchlist kéo thả**: burger ☰ + `enableWatchlistDrag` (pointer, chuột+cảm ứng),
  lưu localStorage. CSS khối tên dùng `:first-of-type` (handle span là first child).

**Fix quan trọng phiên 2:**
- **Index intraday** (`computeIndices`): trong phiên SSI trả `IndexValue=0` +
  RatioChange live → tái tạo value = đóng cửa hôm qua × (1+ratio/100). Trước đó
  hiện đóng cửa hôm qua đứng im. Verify live: VNINDEX 1684.77 -0.86%. (CLAUDE mục 6.)
- **Rà soát code**: escape regex mã trong news (né 502 khi mã có ký tự regex),
  escape XSS tin tức + chặn `javascript:` URL, timeout FCTrading trade call.

**Redesign phiên 3 (24/07) — bám mock `Stock Dashboard Redesign` (Phase 1+2):**
- **Phase 1 (reskin, thuần CSS + 1 hàm màu):** accent đổi amber → cam
  `#f5811f`/`#ff9d47`; hover index-card nhấc `-5px` nền tối `#14171f` chữ trắng;
  `heatColor` đổi sang HSL độ sáng theo |%| (hue 150 xanh / 355 đỏ, sáng 92→45)
  — mã biến động lớn nổi đậm; chip chỉ báo (MA/BB/KL/RSI) thành pill dùng
  `:has(input:checked)`.
- **RSI (`chartModule.js`):** đường đậm 2px màu accent (đọc `--amber`, đổi theo
  theme); ghim `rightPriceScale.minimumWidth:58` cho cả 2 chart → vùng vẽ khớp,
  trục thời gian song song; ẩn trục thời gian pane RSI (`timeScale.visible:false`)
  bỏ lặp ngày; **RSI dùng whitespace point `{time}` cho 14 nến null đầu** (thay vì
  `.filter(Boolean)`) để 2 chart cùng số nến — trước đó logical-range lệch 14 nến,
  RSI hụt mép phải, không tới ngày mới nhất.
- **Phase 2:** `main-grid` → `260px minmax(420px,1fr) 260px`, breakpoint stack
  1080 → **1180px**; **sparkline watchlist** (SVG 56×22, 24 close gần nhất, màu
  theo xu hướng) — `loadSparklines` fetch `getHistory(sym,40)`, cache `state.sparks`,
  chỉ fetch mã thiếu.
- **Phase 3 (24/07):** heatmap-section → **card tabbed** (`renderSectors`,
  `renderRankings`, `wireMarketTabs`, `state.marketTab`). 3 tab thuần client-side,
  dùng lại quote VN30 đã warm — 0 call backend thêm:
  - **Bản đồ nhiệt** (giữ nguyên).
  - **Theo ngành** — `SECTOR_MAP` (VN30→ngành), %TB mỗi ngành, bar `|avg|/max`, sort desc.
  - **Top tăng/giảm** — top5 tăng/giảm trong VN30, click row = chọn mã.
  - Tab thứ 4 **Khối ngoại** CHƯA làm (Phase 4).
- **Phase 4 khối ngoại (24/07) — ĐÃ làm:** tab thứ 4 "Khối ngoại" (`renderForeign`,
  `#foreignList`). Mua/bán ròng ngoại theo mã VN30 (tỷ đồng), bar `|net|/max`, xanh
  mua ròng / đỏ bán ròng, sort |net| desc, top 15. **Nguồn:** `DailyStockPrice` đã
  gọi sẵn ở `computeQuote` — thêm `netForeignVal=(ForeignBuyValTotal−ForeignSellValTotal)/1e9`
  vào payload quote → **0 call SSI thêm**. Verify live backend: HPG +87.2 tỷ, VHM/VPB
  −77.7 tỷ. **Đụng `server/index.js` → đã `cp` sang `index.js` gốc, Render deploy khi push.**
  Mock `generateQuote` cũng thêm `netForeignVal` cho fallback.
- **HNX/UPCoM rankings (24/07) — ĐÃ làm:** tab Top tăng/giảm thêm switcher 3 sàn
  (`#rankExchanges`, `state.rankExchange`, `wireRankExchanges`, `loadRankPool`,
  `rankBasket`). Rổ `APP_CONFIG.HNX30` (15 mã) + `APP_CONFIG.UPCOM` (15 mã) trong
  `config.js` — xếp hạng **trong rổ** (không phải cả sàn). HNX/UPCoM **lazy-fetch
  quote lần đầu mở tab** (không warm, giữ load mặc định nhẹ), cache sau. Dùng lại
  endpoint quote sẵn có — **frontend-only, 0 đổi backend**. Verify live: HNX TNG
  +3.55%/BVS −7.12%, UPCoM BSR +2.78%/BVB −4.21%. Cập nhật rổ khi sàn rebalance.

Version hiện `?v=20260724p`.

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

## 4. Liquid Glass redesign — ĐÃ XONG (23/07)

Đã áp full vào dashboard thật (không còn chờ duyệt): `style.css` (tokens glass +
aurora + light default + `[data-theme]`), `index.html` (font Inter, aurora div,
toggle Sáng/Tối + slider Trong/Đục), `app.js` (`setTheme`/`setGlass`/
`wireThemeControls`), `chartModule.js` (`applyTheme()`). Giữ 100% chức năng.
Backup CSS cũ `style.css.pre-glass.bak` (local, đã `.gitignore`).
Mock gốc vẫn còn: https://dashboardstock.io.vn/mock-liquid-glass.html

> Lưu ý: trình chụp headless không dựng đúng `backdrop-filter` ở viewport thứ 2
> (hiện đen). Không phải lỗi thật — kiểm tra trên trình duyệt thật.

---

## 5. VIỆC CÒN TREO

**Tính năng tiếp theo (user đã chọn, CHƯA làm):**
- **#3 Theo dõi dòng tiền** — phát hiện đột biến khối lượng/giá trị (spike vs
  TB 20 phiên). Đụng `server/index.js` (endpoint mới + `cp` sang root). Gộp luôn
  **sizing heatmap theo vốn hóa** (thêm 1 endpoint marketcap VN30 warmed thay 30 call).

**Việc nhỏ (không chặn):**
1. **Enforce HTTPS chưa bật được**: tên miền gốc mới có 1 bản ghi A
   (`185.199.108.153`); GitHub đòi đủ 4 (`.108/.109/.110/.111.153`). DNS Mắt Bão
   có vẻ chỉ cho 1 bản ghi A → phải chuyển nameserver sang Cloudflare. `http://`
   hiện vẫn trả 200.
2. **Bật tự động gia hạn tên miền** ở Mắt Bão (quên = dashboard chết, không ai báo).
3. GitHub tự tắt scheduled workflow sau 60 ngày repo không commit → tab Actions
   bấm *Enable workflow* khi cần.
4. (Cải tiến) Portfolio thủ công: mã ngoài watchlist+VN30 dùng giá vốn làm giá
   hiện tại (P&L=0) vì `state.quotes` thiếu — fetch thêm quote nếu muốn P&L live.

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
