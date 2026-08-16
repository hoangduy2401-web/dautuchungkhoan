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
  dựng lại đúng vòng xoáy throttle đã sửa hôm 23/07 (`docs/BAIHOC-CU.md`). Fetch phải lazy + do user
  bấm nút, tuần tự (limiter concurrency=1), cache theo phiên trong `state.sigBars`.
- Badge của mã đang chọn gọi **sau** khi chart có dữ liệu và không `await` — đặt
  trước sẽ chen hàng ở limiter và làm chậm đúng thứ user đang nhìn.
