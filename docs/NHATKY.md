# Nhật ký theo phiên — lưu trữ

> Tách khỏi `CLAUDE.md` ngày 04/08/2026. `CLAUDE.md` mục 9 chỉ giữ 2 phiên gần
> nhất; phần còn lại nằm đây. `git log` cũng phục dựng được phần lớn nội dung này
> — commit message của dự án viết rất chi tiết.
> **`/handoff` ghi phiên mới vào `CLAUDE.md`, và đẩy phiên cũ xuống file này.**

**08/08/2026 (phiên 9) — đổi theme mặc định + sửa lỗi so sánh khối lượng ngày nghỉ.**
Bump `?v=20260808a` → **`?v=20260808b`**. **Có đụng `server/`** (thêm 1 trường),
Render đã deploy lại, đã kiểm live.

- **Theme mặc định đổi TỐI → SÁNG** theo yêu cầu user. Mặc định nằm ở
  `data-theme` của thẻ `<html>` **trong từng trang** nên phải sửa cả 6 file HTML;
  `theme.js` chỉ là lưới an toàn khi thẻ đó thiếu. Sửa mỗi `theme.js` thì mỗi
  trang mở ra một màu. Nút Sáng/Tối vẫn đổi được như cũ.
- **Lỗi số liệu phát hiện khi kiểm theme:** tab Tổng quan hiện "Khối lượng phiên
  +0,0%" với hai con số y hệt — chi tiết ở mục 7. Đã sửa: `/api/price/indices`
  trả thêm `tradingDate`, client so theo ngày đó thay vì theo đồng hồ máy.
  Đo lại: VNINDEX 647,7 triệu vs 578,9 triệu = **+11,9%**, nhãn "phiên 07-08 so
  với 06-08", ghi chú đổi thành "Thị trường đang nghỉ".

Đã kiểm mắt cả trang chứng khoán, tiết kiệm và coin ở nền sáng: bảng, biểu đồ,
logo, thanh độ rộng thị trường đều đọc được; bản live cũng đã kiểm.

**08/08/2026 (phiên 8) — GĐ 4 trang Gửi tiết kiệm: XONG CẢ 8 ĐẦU VIỆC.**
Bump `?v=20260807c` → **`?v=20260808a`** (56 chỗ trong 6 file HTML). **Có đụng
`server/`** → Render đã deploy lại, đã kiểm live. **Website giờ đủ 6 trang.**

**Đã đo nguồn TỪ RENDER trước khi xây trang** (bài học Yahoo + CoinGecko ở mục
7): CafeF trả 29 ngân hàng × 8 kỳ hạn bình thường từ IP Render, không bị chặn.

- `/api/savings/rates`: proxy file JSON tĩnh của CafeF, cache 6h, **giữ bản chụp
  gần nhất trong bộ nhớ** — nguồn chết thì trả bản cũ kèm `stale: true` +
  `snapshotAt`, trang hiện dải cảnh báo ghi rõ bản chụp lấy lúc nào.
- Kỳ hạn sắp theo **số tháng**, không theo chuỗi: sắp chuỗi thì "12T" đứng trước
  "1T" và bảng đọc thành vô nghĩa.
- Ô lãi suất cao nhất mỗi kỳ hạn tô đậm; ngân hàng không niêm yết kỳ hạn đang
  sắp thì **xuống cuối**, không coi là 0%.
- **Cảnh báo đáo hạn 30/15/7 ngày đặt TRÊN CÙNG trang**, không giấu trong bảng —
  đây là giá trị thực tế cao nhất của trang. Ba mức vì việc cần làm khác nhau:
  30 ngày là lúc bắt đầu tìm lãi suất mới, 7 ngày là lúc phải quyết.

**Hai quyết định về số liệu, đừng "sửa lại":**
1. **Lãi suất của sổ lưu theo con số ĐÃ CHỐT LÚC GỬI**, không đọc lại từ bảng
   niêm yết. Bảng là lãi suất hôm nay; sổ đã khoá lãi suất từ ngày gửi. Ô nhập
   tự điền gợi ý theo bảng nhưng user gõ vào là thôi tự động (ưu đãi, số tiền
   lớn… cho lãi suất khác bảng).
2. **Công thức là lãi cuối kỳ, không tái tục, chưa trừ thuế/phí:**
   `lãi = gốc × (%năm ÷ 100) × số tháng ÷ 12`. Sổ lĩnh lãi hàng tháng hay tự
   động tái tục cho con số khác — trang ghi rõ giả định thay vì im lặng.

`setMonth` tự dồn ngày 31 sang tháng sau (31/01 + 1 tháng = 03/03) nên ngày đáo
hạn kẹp lại về ngày cuối tháng đích — đúng như cách ngân hàng ghi trên sổ.

Đã kiểm trên trình duyệt thật (local rồi bản live): 100.000.000 ₫ kỳ hạn 12
tháng → Shinhan 7,50% = +7.500.000 ₫, chênh hạng 1 với hạng 5 là 800.000 ₫; sổ
500tr 5,9% gửi 14/8/2025 → đáo hạn 14/8/2026, còn 6 ngày, lãi +29.500.000 ₫,
cảnh báo đỏ hiện trên cùng; sửa thành 600tr @6,1% → +36.600.000 ₫; nhập lãi
suất 0 báo lỗi; nút con mắt che 16 ô `.money` kể cả trong dải cảnh báo; mobile
375px không tràn ngang.

**07/08/2026 (phiên 7) — tab "Tổng quan thị trường" + logo coin + gỡ CoinMarketCap.**
Bump `?v=20260807b` → **`?v=20260807c`**. **Có đụng `server/`** (thêm 2 trường),
Render đã deploy lại, đã kiểm live.

**Gộp một tab, không tách hai** (user yêu cầu đánh giá trước): hai biểu đồ cùng
trả lời một câu hỏi — "hôm nay so với kỳ trước thế nào" — cùng nguồn dữ liệu,
cùng nhịp làm mới. Tách đôi thành nút tab **thứ bảy** sẽ tràn hàng trên màn hình
hẹp và bắt user bấm qua lại giữa hai thứ phải đọc cùng lúc.

**KHÔNG thêm endpoint nào.** Khối lượng + độ rộng phiên hôm nay đã nằm trong
`/api/price/indices` (số LIVE trong phiên); khối lượng các phiên trước lấy từ
`/api/price/index-history` vốn đã trả `volume`. Chuỗi lịch sử **nạp lười một lần
mỗi sàn rồi cache cả phiên** — nó chỉ đổi sau khi đóng cửa. Khối lượng mã đang
chọn dùng lại `state.selectedBars` (chuỗi nến biểu đồ vừa tải), 0 request thêm.
Thanh so sánh vẽ bằng **CSS**, không dùng Lightweight Charts: chỉ có hai cặp số,
và tránh luôn hai lỗi vẽ ở mục 7.

Backend thêm `ceilings`/`floors` vào `/api/price/indices` — cùng row `DailyIndex`,
0 call thêm. **Đi theo bộ với `advances`**: VN30 trả breadth 0/0/0 (đã gom thành
null) nhưng vẫn có Ceilings 2 / Floors 0, tức hai trường này không cùng phạm vi
rổ; không rõ đếm trên rổ hay trên sàn nên breadth null thì để null luôn.

**Lỗi đã sửa khi kiểm:** chuỗi lịch sử của **HNX có lẫn dòng HÔM NAY** (khác
VNINDEX), khiến "phiên trước" hoá ra chính là hôm nay — bảng hiện +0,0% với hai
con số y hệt. Lọc bỏ dòng của ngày hiện tại, và tính ngày theo **giờ Việt Nam**
(`toISOString()` trả ngày UTC, lệch một ngày trong khoảng 00:00–07:00 giờ VN).

**Logo coin:** Binance không trả ảnh nên bảng coin toàn ô trống. Lấy từ CDN icon
theo ticker, **ảnh tải thẳng từ trình duyệt** nên không dính vụ chặn IP. Hai CDN
vì không cái nào phủ đủ: jsDelivr `cryptocurrency-icons@0.18.1` thiếu mọi coin
sau 2021 (SUI/APT/ARB/PEPE đều 404), CoinCap phủ những coin đó. Thử lần lượt,
hết nguồn thì hiện vòng tròn chữ cái đầu.
**Lỗi đã sửa:** `loading="lazy"` khiến MỌI logo đứng mãi ở trạng thái đang tải —
trong bảng này ảnh không bao giờ được coi là lọt vào tầm nhìn.

**CoinMarketCap đã gỡ hết** khỏi `server/index.js` và nhãn ở trang coin: gói có
API key là gói trả phí. Đừng dựng lại.

**07/08/2026 (phiên 6) — GĐ 3 trang Coin: XONG CẢ 4 ĐẦU VIỆC.**
Bump `?v=20260806b` → `?v=20260807a` → **`?v=20260807b`** (47 chỗ trong 5 file
HTML). **Có đụng `server/`** → Render đã deploy lại, đã kiểm live.

**Nguồn giá phải đổi giữa chừng: CoinGecko chặn IP của Render.** Đo 07/08:
`/api/crypto/*` trên Render trả `CoinGecko HTTP 429` ba lần liên tiếp, trong khi
cùng request đó từ máy local trả 200. Y hệt vụ Yahoo ở GĐ 1 — **thử nguồn ở máy
local KHÔNG chứng minh được nó chạy ở production.**

User chốt hướng: **Binance + tỷ giá của chính dự án.**
- Giá USD từ Binance `/ticker/24hr`; VND = USD × tỷ giá USD/VND lấy từ
  `fxTimeseries` (**liên ngân hàng**, không phải giá bán lẻ VCB có biên mua-bán).
- Payload có `vndFrom {rate, rateDate, source}`; trang ghi **"VND quy đổi"** cạnh
  tên nguồn và hiện dải giải thích. Số quy đổi là số **khác loại** với giá báo
  trực tiếp — nhãn nguồn của biểu đồ cũng đọc từ payload, không viết cứng.
- Lịch sử: Binance `/klines` × tỷ giá **của chính ngày đó**. Dùng một tỷ giá duy
  nhất cho cả năm sẽ biến biến động tỷ giá thành biến động giá coin. Cuối tuần
  thị trường ngoại hối đóng nên lấy tỷ giá gần nhất trước đó (coin chạy 24/7).
- Tìm kiếm: bảng nội bộ ~40 coin khi CoinGecko không trả lời.

**CoinMarketCap đã thêm nhưng TẮT** cho tới khi có `CMC_API_KEY` (mọi endpoint
CMC trả 401 `error_code 1002 "API key missing"` — không có đường dùng thử). Khi
có key thì CMC được ưu tiên. Hai điều chưa chắc: gói free có convert VND hay
không (chưa có key để đo), và CMC định danh theo **ticker** nên chỉ trả lời được
coin nằm trong `CRYPTO_SYMBOLS` — thiếu một mã là bỏ qua cả lượt, vì bảng thiếu
coin của user thì tệ hơn.

**Ba lỗi Binance đã sửa:** `symbols` phải là mảng JSON **URL-encode toàn bộ** (kể
cả dấu ngoặc vuông) nếu không trả 400; **USDT không có cặp `USDTUSDT`** nên để
nó lọt vào lô là Binance trả 400 cho **cả lô**, mất giá của mọi coin khác (xử lý
riêng: `usd = 1` theo định nghĩa cặp); và dòng note dự phòng cũ ghi "chỉ có giá
USD" nay không còn đúng.

**Hai lỗi của biểu đồ, xem mục 7.**

**Tái cấu trúc kèm theo:** CSS khung biểu đồ (`.chart-stack` / `.chart-wrap` /
`.trend-overlay` / `.chart-wrap-rsi`) chuyển từ `chung-khoan.css` sang
`base.css`. Để riêng ở đó thì trang ngoại tệ và coin **mất
`.trend-overlay { position: absolute }`**, lớp canvas phủ rơi xuống dưới và đẩy
`.chart-stack` từ 260px thành 524px. Đã kiểm lại cả ba trang có biểu đồ.

Đã kiểm trên trình duyệt thật (local rồi bản live): 5 coin mặc định ra đủ giá
VND/USD/24h; tìm "cardano" → thêm vào danh sách, lưu qua `Store`; xoá khỏi danh
sách; đổi coin và đổi khung; danh mục 0,05 BTC giá vốn 1.500.000.000 →
84.234.733 ₫, lãi 9.234.733 ₫ (+12,31%), sửa thành 0,1 → nhân đôi đúng; số âm
báo lỗi; xoá 2 nhịp; nút con mắt che 7 ô `.money`.

**06/08/2026 (phiên 5) — GĐ 2 trang Vàng: XONG CẢ 6 ĐẦU VIỆC.**
Bump `?v=20260806a` → **`?v=20260806b`** (37 chỗ trong 4 file HTML). **Có đụng
`server/`** → Render đã deploy lại, đã kiểm live.

**Việc 2.1 — đơn vị giá, đo bằng ba nguồn độc lập, không suy đoán:**

| Nguồn | SJC mua / bán | Quy ra lượng |
|---|---|---|
| PNJ `giamua/giaban` | 13.970 / 14.270 | 139,7 / 142,7 triệu |
| BTMC `@pb/@ps` | 14.030.000 / 14.330.000 | 140,3 / 143,3 triệu |
| Báo chí cùng ngày | — | 138,8 / 141,8 triệu |

→ **PNJ trả nghìn đồng/CHỈ, BTMC trả đồng thô/CHỈ.** Route thống nhất về
**nghìn đồng/chỉ**, BTMC chia 1000. Đừng đổi hệ số mà không đo lại.

- `/api/gold/prices`: PNJ chính, BTMC dự phòng, TTL 5 phút. Payload luôn ghi
  `source`, và thêm `note` khi bản dự phòng trả lời — hai tiệm báo giá khác
  nhau, đổi nguồn mà không ghi nhãn thì trông như thị trường biến động.
- Hai cạm bẫy của nguồn: PNJ để `giaban: ""` cho 2 mã vàng nguyên liệu (chỉ
  mua, không bán) → `null` chứ không phải 0. BTMC đánh số hậu tố **theo dòng**
  (`@n_7`, `@pb_7`) nên phải đọc qua `@row`; mỗi sản phẩm xuất hiện 2 lần, giữ
  bản `@d_` mới nhất; feed có cả **bạc**, phải lọc bỏ.
- Trang: bảng đổi đơn vị lượng/chỉ/gram, quy đổi khối lượng + thành tiền 2
  chiều, danh mục `holdings_gold` (cùng khuôn `holdings_fx`).
- **Bảng mặc định chỉ hiện 7 loại chính.** 13 loại vàng tuổi thấp (18K trở
  xuống) có chênh lệch mua-bán 9–21%, trộn vào sẽ kéo lệch mọi so sánh — nằm
  sau checkbox.
- **Ngưỡng cảnh báo chênh lệch 5% là MỐC TẠM.** Đo 06/08 nhóm 999.9 nằm trong
  2,10–3,54%; chưa có chuỗi lịch sử để chốt ngưỡng thật. Soát lại khi có dữ
  liệu nhiều ngày.

**Tái cấu trúc kèm theo:** `.src-badge` / `.asset-table` / `.hold-*` /
`.row-btn` / `.edit-input` chuyển từ `ngoai-te.css` sang `base.css` (khối
"TRANG TAI SAN") để 5 trang tài sản dùng chung; `.fx-table` đổi tên thành
`.asset-table`. Đã kiểm lại trang ngoại tệ sau khi đổi: 20 dòng, padding/font/
nhãn nguồn/biểu đồ nguyên vẹn.

Đã kiểm trên trình duyệt thật (local rồi bản live): SJC 139.700.000 /
13.970.000 / 3.725.333 theo lượng/chỉ/gram; 2 lượng = 20 chỉ = 75 g =
279.400.000 ₫ bán cho tiệm; danh mục 3,5 lượng giá vốn 141,5 tr → −6.300.000 ₫
(−1,27%); số âm báo lỗi; xoá 2 nhịp; nút con mắt che 8 ô `.money`. Ép PNJ lỗi →
BTMC trả 9 dòng kèm dải cảnh báo nguồn dự phòng.

**05–06/08/2026 (phiên 4) — GĐ 1 trang Ngoại tệ: XONG CẢ 8 ĐẦU VIỆC.**
Bump `?v=20260804a` → `?v=20260805a` → **`?v=20260806a`** (28 chỗ trong 3 file
HTML). **Có đụng `server/`** → Render đã deploy lại, đã kiểm live.

Làm xong toàn bộ bảng GĐ 1 của `docs/QUYHOACH.md`.

**Danh mục cá nhân (mục 1.7)** — collection `holdings_fx`, row
`{code, amount, cost|null, updatedAt}`:
- **Là danh sách nắm giữ sửa trực tiếp, KHÔNG phải sổ giao dịch** như
  `portfolio.js`. User cầm một số dư ngoại tệ, khi nó đổi thì sửa thẳng con số
  đó chứ không ghi thêm lệnh mua/bán. Nên **giá vốn là một ô nhập**, không phải
  kết quả bình quân gia quyền. Đừng "sửa lại cho giống trang chứng khoán".
- Cho phép **nhiều dòng cùng một mã** (nhiều lô giá vốn khác nhau); tổng cộng
  dồn, không gộp dòng.
- Giá vốn để trống → không hiện lãi/lỗ (`—`), không suy ra 0. Thiếu tỷ giá →
  giá trị `—` và tổng ghi rõ "thiếu tỷ giá N mã".
- Xoá phải bấm **hai nhịp** ("Xoá" → "Chắc chứ?", tự huỷ sau 4s): nút xoá nằm
  ngay cạnh nút Sửa và thao tác không hoàn tác được.
- Số tiền + số lượng nắm giữ đã bọc `.money`; giá vốn / giá quy đổi / % lãi lỗ
  cố ý **không** che (mục 3b). Lúc đang sửa tại chỗ thì ô input hiện số thật —
  chấp nhận, đó là thao tác chủ động của chủ nhân.

- Backend: `/api/fx/rates` (parse XML Vietcombank bằng regex, không thêm
  dependency, TTL 10 phút vì nguồn ghi "1 request/5 phút") và `/api/fx/history`.
- **Nguồn lịch sử đổi khỏi quy hoạch: Yahoo Finance → FXRatesAPI.** Yahoo chặn
  theo IP, kể cả IP của Render — chi tiết + số đo ở mục 7. `docs/QUYHOACH.md`
  mục 2.10 đã sửa lại cho khớp.
- Frontend: `ngoai-te.html`, `assets/css/ngoai-te.css`,
  `assets/js/pages/ngoai-te.js`; `dataService.getFxRates/getFxHistory`;
  `config.fxProvider`; `nav.js` bỏ nhãn "sắp có" ở mục Ngoại tệ.
- `.chk` / `.sw` (chip bật/tắt đường vẽ) chuyển từ `chung-khoan.css` sang
  `base.css` để hai trang dùng chung → **đã kiểm lại trang chứng khoán**, chip
  vẫn đúng (`border-radius 999px`, nền `rgba(240,169,78,0.14)` khi bật).
- **Khung 5Y bỏ có chủ đích** (user chốt trong phiên): gói free của FXRatesAPI
  chỉ có 366 ngày. Backend trả 400 `range_too_long` thay vì lặng lẽ cắt còn 1
  năm — chuỗi thật dưới nhãn sai cũng đánh lừa y như số bịa. Trang ghi rõ lý do.

Đã kiểm trên trình duyệt thật (local rồi bản live) — không phải chỉ đọc code:
bảng 20 mã khớp số VCB; ô trống DKK/INR/… hiện `—`; sắp xếp theo `buyCash` đẩy
mã trống xuống cuối; ghim ★ lưu qua `Store` và nổi lên đầu sau reload; tìm kiếm
theo tên tiếng Việt ("yen" → JPY); chart USD 3M/1Y và JPY 3M ra đủ điểm; quy đổi
2 chiều đúng cả `1.000.000`, `1,000,000`, `1.234,5`; theme Sáng/Tối; nút con mắt.

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
