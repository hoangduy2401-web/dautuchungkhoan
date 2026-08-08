# Bài học đã đóng — lưu trữ

> Tách khỏi `CLAUDE.md` ngày 08/08/2026. Đây là các sự cố **đã sửa xong và kiến
> trúc hiện tại đã phản ánh**, không còn chi phối quyết định hằng ngày — nên
> không cần nạp vào context mỗi phiên. Giữ nguyên văn để tra khi cần.
>
> Bài học **còn hiệu lực** vẫn nằm ở `CLAUDE.md` mục 7. Nếu định "tối ưu lại"
> phần cache/limiter, luồng tải đầu, hay đụng vào chart chỉ số — đọc file này
> trước: mấy thứ đó đã được đo và chốt, không phải chưa ai nghĩ tới.

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

### Chart cho chỉ số — XONG 04/08 (giữ lại phần cần biết)

Bước A + B đã xong (nhật ký ở `docs/NHATKY.md`). Ba điều đừng "sửa lại cho đúng":
1. `/api/price/index-history` trả `{date, close, volume}` — **không có OHLC** vì
   `DailyIndex` không có. `chartModule` tự nhận ra và vẽ đường.
2. **Chunk 30 ngày là bắt buộc**, không phải chọn lựa (`CLAUDE.md` mục 7).
3. **Timeout của chỉ số phải riêng**, đừng gộp lại với `getHistory` (`CLAUDE.md` mục 7).

Việc còn có thể làm thêm, chưa ai yêu cầu: sizing ô heatmap theo vốn hóa, và
`Ceilings`/`Floors` (số mã trần/sàn) — đã có sẵn trong row `DailyIndex`, chỉ
việc thêm vào payload như 5 trường của bước A.

<details>
<summary>Khảo sát gốc trước khi làm (giữ để đối chiếu ước lượng)</summary>

Design cho phép **bấm thẻ chỉ số → nạp chart chỉ số đó + cuộn xuống**. Chưa làm
vì backend chưa có đường dữ liệu: `/api/price/history` chạy `DailyOhlc` (chỉ mã
CK). Gắn click bây giờ chỉ hiện `—`, phạm luật vàng ở mục 3.

**Bước A XONG 04/08** (nhật ký ở `docs/NHATKY.md`): đã thăm dò `DailyIndex` và đã có 5
trường thống kê trong `/api/price/indices`. Mọi ẩn số về dữ liệu đã đóng — chi
tiết đo đạc ở `CLAUDE.md` mục 7.

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
- Cuộn xuống chart: **tính offset tay**, đừng dùng `scrollIntoView` (`docs/NHATKY.md`,
  phiên 03/08).

**Ước lượng bước B: 50–75k token, ~35–50 phút.** Đụng `server/` → Render deploy
lại, phải kiểm `/health` sau khi push.

Đối chiếu thực tế: bước B rơi vào **khoảng giữa** ước lượng. Phần phát sinh ngoài
dự kiến là lỗi timeout ở trên — không nằm trong khảo sát vì nó chỉ lộ ra khi bấm
nhanh giữa hai chỉ số, không lộ khi test từng cái một.

</details>
