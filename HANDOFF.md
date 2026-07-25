# HANDOFF — Dashboard "Bảng Điện" (cập nhật 25/07/2026)

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

**Phiên 25/07/2026 — 2 việc user chốt đã LÀM XONG (frontend-only, 0 đổi backend):**
- **Công cụ đo trên biểu đồ (ruler)** — nút **"Đo"** cạnh "Vẽ trendline". Click 2
  điểm: hiện hộp mờ + đường nối + nhãn `±x.xx% (±delta)` / `N nến · dd/mm → dd/mm`.
  Xanh khi tăng, đỏ khi giảm; có preview nét đứt khi rê chuột chọn điểm 2.
  Neo theo **chỉ số nến** (`coordinateToLogical` làm tròn + clamp) nên đếm nến
  chính xác và bám đúng khi pan/zoom. "Vẽ trendline" và "Đo" loại trừ nhau; nút
  **"Xóa"** giờ xóa cả hai (`clearAll`).
- **Gộp 3 khối cuối trang thành 1 card accordion** — "TÀI KHOẢN SSI · GIAO DỊCH ·
  LỊCH SỬ". Mặc định **thu gọn** (chỉ head + 4 ô tổng tài sản), nút **"Xem thêm ▾"**
  xổ ra 3 tab: *Danh mục SSI* / *Thêm giao dịch* / *Danh mục & lịch sử tay*.
  Giữ nguyên toàn bộ id (`accountTable`, `holdingsTable`, `txTable`, `txForm`...)
  nên `app.js` render không đổi. Trạng thái mở + tab đang chọn lưu localStorage
  (`vn_dashboard_account_more_v1`, `vn_dashboard_account_tab_v1`). Bấm "Đồng bộ"
  tự mở card + nhảy về tab Danh mục SSI.

**3 lỗi biểu đồ có sẵn phát hiện khi làm ruler (đã sửa, xem CLAUDE mục 6):**
1. `fitContent()` gọi TRƯỚC `resize()` → nến dồn sát mép phải, chừa khoảng trắng
   bên trái. Đảo thứ tự + fit lại sau mỗi resize.
2. **Sync 2 chiều trục thời gian giá ↔ RSI khóa cứng trục**: callback của
   lightweight-charts chạy **bất đồng bộ** nên cờ `syncing` vô dụng, 2 pane ghi
   đè lẫn nhau — `fitContent`/`setVisibleLogicalRange`/zoom/pan đều vô hiệu. Sửa:
   chỉ ghi khi range thực sự khác nhau.
3. `.trend-overlay` để `pointer-events: auto` cố định → canvas nuốt hết chuột,
   **chart không zoom/pan được**. Sửa: mặc định `none`, chỉ bật `auto` khi đang
   bật công cụ vẽ/đo.
   Ngoài ra chart tạo lúc container rộng 0 (tab nền) hỏng vĩnh viễn → thêm
   fallback `clientWidth || 600`.

**Giữ nét vẽ khi refresh:** `ChartModule.setData(history, "SYM|range")` — vòng
refresh 45s cùng mã + cùng khung sẽ **không** xóa trendline/ruler nữa; đổi mã
hoặc đổi khung mới xóa.

**Làm đậm chỉ báo (25/07):** Bollinger 3 đường và 2 biên RSI 70/30 dày 1px →
**2px**; biên RSI đổi màu `rgba(120,130,150,0.5)` → `rgba(90,102,125,0.85)`.

Version hiện `?v=20260725b`.

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
  Gộp luôn nhóm "giá – khối lượng" của FiinTrade (xem dưới) — cùng bản chất.

### Đánh giá phương pháp luận FiinTrade (25/07/2026 — chưa làm gì, chỉ khảo sát)

Đọc 3 tài liệu ở `github.com/mrd-bdsmetro/FiinTrade-Methodology`
(scoring VGM / technical-analysis / ranking). Đối chiếu với dữ liệu đang có
(SSI FCData, VNDirect finfo). Phân 4 tầng khả thi:

**Tầng 1 — làm được ngay, frontend-only, 0 call thêm:**
- **Tín hiệu kỹ thuật tổng hợp**: MA5 + RSI14 + CMF20 + ROC9 → gộp 2 nhóm
  (TB Động / Chỉ tiêu) → ma trận 3×3 ra Strong Bullish…Strong Bearish.
  `CMF = Σ(CLV×volume)/Σvolume`, `CLV = ((close−low)−(high−close))/(high−low)`;
  `ROC = (giá nay/giá 9 kỳ trước − 1)×100`. Tính thẳng từ mảng OHLCV đã fetch.
- **Giá – khối lượng**: giá/KL tăng-giảm liên tục >3 phiên, KL tăng + giá tăng,
  KL tăng + giá giảm. Trùng ý tưởng #3 ở trên.
- **Chiến lược TA trên rổ có sẵn** (VN30/HNX30/UPCOM đã warm): vượt đỉnh/thủng
  đáy (max-min 3/6/9/12 tháng), vượt/cắt SMA20 kèm KL đột biến, biến động mạnh
  nhất theo ngày/tuần/tháng, tích lũy (KL ước lượng / KL TB 10 phiên > 2).

**Tầng 2 — cần thêm tính toán, không cần nguồn mới:**
- **Momentum Score (A–F)** — 5 tiêu chí FiinTrade, tối đa 13 điểm: RSI tăng 3
  phiên liên tiếp & <80; SMA5/20/100 so với giá; giá tăng 2 phiên/4 tuần/4 tháng;
  KL TB tháng theo 3 ngưỡng 500k/300k/200k; **khối ngoại mua ròng** (đã có sẵn
  `netForeignVal` trong payload quote). Xếp hạng theo phân vị trong rổ.
- Value/Growth Score cần mở rộng `financial_statements` (EBITDA, tài sản
  ngắn/dài hạn, tiền mặt, CFO 3 năm) — tốn thêm call VNDirect, để sau.
  Growth còn thiếu hẳn "kế hoạch lợi nhuận ĐHCĐ" — không có nguồn.

**Tầng 3 — chỉ làm được bản rút gọn:** FiinTrade Ranking. 3/6 nguyên tắc không
có dữ liệu (khuyến nghị analyst, giao dịch nội bộ/tổ chức/tự doanh, EPS dự phóng).
Phần làm được: quy mô (vốn hóa + tổng tài sản), dòng tiền HĐKD 3 năm, thanh khoản
— và chỉ xếp hạng **trong rổ 60 mã**, không phải toàn ngành ICB level 3.

**Tầng 4 — KHÔNG khả thi:** toàn bộ nhóm "tín hiệu nhiễu" (mua trần–bán sàn,
hủy lệnh, đè giá–đẩy giá, mua/bán chủ động BU/SD, chốt phiên). Cần **order book
cấp 2 real-time** (giá/KL đặt mua-bán 1/2/3, tick khớp trong phiên) qua
FastConnect **Streaming** (WebSocket, gói đăng ký khác) — kiến trúc giữ kết nối
liên tục, không hợp cơ chế cache/warm hiện tại. Đây là nhóm giá trị nhất của
FiinTrade nhưng vượt scope dashboard cá nhân.

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
