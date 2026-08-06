# Nhật ký theo phiên — lưu trữ

> Tách khỏi `CLAUDE.md` ngày 04/08/2026. `CLAUDE.md` mục 9 chỉ giữ 2 phiên gần
> nhất; phần còn lại nằm đây. `git log` cũng phục dựng được phần lớn nội dung này
> — commit message của dự án viết rất chi tiết.
> **`/handoff` ghi phiên mới vào `CLAUDE.md`, và đẩy phiên cũ xuống file này.**

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

**04/08/2026 (phiên 2) — bước B: chart chỉ số chạy được (ĐỤNG `server/index.js`).**
Bấm thẻ chỉ số giờ nạp chart chỉ số đó + cuộn xuống, đúng phần cuối cùng còn
thiếu của design 03/08.
- Backend: `computeIndexHistory` + `GET /api/price/index-history?code=&days=`,
  **chunk 30 ngày** (giới hạn cứng của SSI). TTL theo độ dài: ≤100 ngày 60s,
  ≤270 ngày 30 phút, dài hơn **6 giờ** — 5Y tốn 61 call, không thể để TTL ngắn.
  `INDEX_IDS` tách ra dùng chung với `computeIndices`.
- `chartModule.js`: thêm `lineSeries`. **Tự nhận dạng từ dữ liệu** — bar đầu
  không có `open` nghĩa là chỉ số → ẩn nến, hiện đường. Không thêm tham số nên
  mọi chỗ gọi `setData` cũ giữ nguyên. Màu đường = `--chart-line`.
  Cột khối lượng của chỉ số so close với **close phiên trước** (không có open).
  Thêm `ChartModule.currentKey()`.
- `chung-khoan.js`: `INDEX_CODES` + `isIndexCode`; `loadSelectedIndex` tách
  riêng khỏi `loadSelectedSymbol` (chỉ số không có info doanh nghiệp, không có
  fundamentals VNDirect, không có badge tín hiệu rổ); `renderIndexStats` 5 ô
  dùng 5 trường của bước A, `null` → `—`; `syncIndexCardActive`.
- Đo cold trên backend local: 90d 5,5s (4 call) · 1Y 8,0s (13 call) ·
  **5Y 34,9s (61 call), 1245 điểm**.
- Kiểm chứng trình duyệt (config tạm trỏ `localhost:3999`, đã trả lại):
  VNINDEX/VN30/HNX/UPCoM vẽ đường đúng, đổi khung 3M→1Y→5Y, quay lại cổ phiếu
  thì nến trở lại, VN30 hiện `—` ở 3 ô độ rộng, Sáng/Tối đổi màu đường,
  0 lỗi console.
- Version `?v=20260804a` (cả 2 trang).

**04/08/2026 (phiên 1) — bước A của chart chỉ số: thăm dò `DailyIndex` + 5 trường mới
(ĐỤNG `server/index.js` → Render deploy lại).**
Chạy script thăm dò dùng credentials ở `server/.env`, gọi thẳng SSI. Kết quả đo
được chép vào mục 7 (dump 21 trường, giới hạn 30 ngày, độ rộng chỉ có theo sàn).
`computeIndices` giờ trả thêm `totalVol / totalVal / advances / declines /
noChanges` lấy từ **đúng row đang gọi — 0 call SSI thêm**. Bộ ba độ rộng toàn-0
gom thành `null` (VN30 không có dữ liệu này).
Kiểm chứng: `PORT=3999 node index.js` + `curl /api/price/indices` — VNINDEX
129/98/58, VN30 `null`, HNX 43/30/36, UPCoM 61/31/50.
**Frontend chưa dùng 5 trường này** — chờ bước B (chart chỉ số). Thêm trường là
thay đổi cộng thêm, `loadIndices` chỉ đọc `code/value/changePct` nên không hỏng.
Không sửa JS/CSS frontend → **không cần bump `?v=`**, vẫn `20260803a`.

**03/08/2026 — reskin Fey design system (frontend-only, KHÔNG đụng `server/`).**
Nhập design `Stock Dashboard Redesign.dc.html` từ claude.ai/design (project
`f0e78ba8-9439-4af1-848b-6012fe2cc380`) qua MCP `DesignSync`, dựng lại bằng
HTML/CSS/JS thuần đang có — **không port file `.dc.html`**, nó chạy trên runtime
riêng của công cụ design (`support.js`), README handoff ghi rõ đừng import thẳng.

Đụng 7 file: `base.css`, `chung-khoan.css`, `chung-khoan.html`, `index.html`,
`theme.js`, `chartModule.js`, `pages/chung-khoan.js`. Version `?v=20260803a`
(đã bump đủ 13 chỗ ở cả 2 trang).

- **Token**: tầng token Fey thay tầng Liquid Glass ở đầu `base.css`. Tối mặc
  định; khối sáng copy nguyên văn từ `[data-theme="light"]` của file design.
- **Bỏ kính**: aurora 5 blob, `.grain`, mọi `backdrop-filter`, slider Trong/Đục
  (cả markup lẫn `GLASS`/`setGlass` trong `theme.js`). Font Inter → Roboto.
- **Component**: SegmentedControl (tab thị trường / khung thời gian / switcher
  sàn / sub-tab tài khoản) — không viền, nút chọn **đảo màu** chứ không phải nền
  cam. Nút cam chỉ còn dùng cho toggle Sáng/Tối và chip chỉ báo đang bật.
- **Bố cục**: cột 1440px căn giữa; header dải phẳng viền dưới; ticker tape
  chuyển xuống **dưới header** (đúng thứ tự design), tràn viền; index card
  `minmax(150px,1fr)`, hover đổi nền chứ không nhấc `-5px` nữa; heatmap
  `minmax(84px,1fr)`; watchlist thành hàng bo tròn 44px, bỏ kẻ ngang.
- **Heatmap**: `heatColor` đổi từ HSL đục sang **alpha tint** (`rgba` xanh/đỏ,
  α 0,10→0,44 theo |%|). Ô giờ dùng màu chữ chung — bỏ được mực ghim `#0f172a`
  vốn phải có vì nền HSL sáng ở cả 2 theme. Thêm vòng accent cho mã đang chọn,
  re-render ở cả 4 chỗ đổi lựa chọn.
- **Chart**: màu chuyển sang biến CSS `--chart-*`. Nến `#3ddc97`/`#f0625f`
  (sáng: `#1f9d68`/`#c9433f`), MA10 cam, MA20 tím, Bollinger xám nét đứt 1px,
  RSI vàng. `applyTheme()` giờ tô lại **cả series**, trước chỉ đổi lưới + chữ
  nên đổi theme xong nến vẫn giữ màu cũ.
- **`selectSymbol`** bỏ `scrollIntoView`, tính offset tay
  (`pageYOffset + rect.top - 70`) — xem mục 7.

Kiểm chứng trên trình duyệt thật (localhost, backend Render thật, dữ liệu SSI
thật): 5 tab thị trường, watchlist + sparkline, chart + RSI + fund grid, tin
tức, accordion tài khoản (cả 3 sub-tab), đổi Sáng/Tối — 0 lỗi console.

**31/07/2026 (phiên 2) — GĐ 0: tái cấu trúc đa trang.**
`style.css` tách thành `assets/css/base.css` (dùng chung) + `chung-khoan.css`.
JS chuyển vào `assets/js/core` + `assets/js/pages`. `index.html` cũ đổi tên
`chung-khoan.html`; `index.html` mới là trang tổng (placeholder tới GĐ 6).
Thêm `store.js` (lớp lưu trữ, API trả Promise), `nav.js` (thanh điều hướng 6
trang + nút con mắt), `theme.js` (tách chrome dùng chung khỏi trang chứng khoán).
`portfolio.js` và watchlist chuyển sang `Store`. Bọc 14 chỗ `<span class="money">`.
Đã kiểm chứng trên trình duyệt thật: chỉ số, tape, heatmap, watchlist, chart+RSI,
chỉ số cơ bản, tin tức, 5 tab thị trường, đổi theme, che số qua 2 trang — đều
đúng như trước. Version `?v=20260731b`.

**31/07/2026 (phiên 1) — xoá hack `cp` + `/health` báo uptime.**
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
