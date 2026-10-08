# Ý tưởng dài hạn — chưa yêu cầu cụ thể

> Tách khỏi `CLAUDE.md` ngày 04/08/2026: không phải thứ cần đọc mỗi phiên.
> Gồm đánh giá phương pháp luận FiinTrade 4 tầng và các ý tưởng khác.


### Đánh giá phương pháp luận FiinTrade — 4 tầng khả thi (khảo sát 25/07/2026)

Đọc 3 tài liệu ở `github.com/mrd-bdsmetro/FiinTrade-Methodology` (scoring VGM /
technical-analysis / ranking), đối chiếu với dữ liệu đang có:

**Tầng 1 — ĐÃ LÀM XONG 26/07** (mục 9). Tín hiệu kỹ thuật tổng hợp (MA5 + RSI14 +
CMF20 + ROC9 → ma trận 3×3), giá–khối lượng, chiến lược TA trên rổ có sẵn.
`CMF = Σ(CLV×volume)/Σvolume`, `CLV = ((close−low)−(high−close))/(high−low)`;
`ROC = (giá nay/giá 9 kỳ trước − 1)×100`.

**Tầng 2 — cần thêm tính toán, không cần nguồn mới:**
- **Momentum Score (A–F)** — 5 tiêu chí, tối đa 13 điểm: RSI tăng 3 phiên liên
  tiếp & <80; SMA5/20/100 so với giá; giá tăng 2 phiên/4 tuần/4 tháng; KL TB
  tháng theo 3 ngưỡng 500k/300k/200k; **khối ngoại mua ròng** (đã có sẵn
  `netForeignVal`). Xếp hạng theo phân vị trong rổ.
- Value/Growth Score cần mở rộng `financial_statements` (EBITDA, tài sản
  ngắn/dài hạn, tiền mặt, CFO 3 năm) — tốn thêm call VNDirect. Growth còn thiếu
  hẳn "kế hoạch lợi nhuận ĐHCĐ" — không có nguồn.

**Tầng 3 — chỉ làm được bản rút gọn:** FiinTrade Ranking. 3/6 nguyên tắc không có
dữ liệu (khuyến nghị analyst, giao dịch nội bộ/tổ chức/tự doanh, EPS dự phóng).
Phần làm được: quy mô (vốn hóa + tổng tài sản), dòng tiền HĐKD 3 năm, thanh khoản
— và chỉ xếp hạng **trong rổ**, không phải toàn ngành ICB level 3.

**Tầng 4 — KHÔNG khả thi:** toàn bộ nhóm "tín hiệu nhiễu" (mua trần–bán sàn, hủy
lệnh, đè giá–đẩy giá, mua/bán chủ động BU/SD, chốt phiên). Cần **order book cấp 2
real-time** (giá/KL đặt mua-bán 1/2/3, tick khớp trong phiên) qua FastConnect
**Streaming** (WebSocket, gói đăng ký khác) — kiến trúc giữ kết nối liên tục,
không hợp cơ chế cache/warm hiện tại. **Đừng thử lại bằng `DailyStockPrice`:**
endpoint đó chỉ có snapshot cuối ngày.

### Khác
- MACD (12,26,9) theo đúng khuôn mẫu RSI.
- Alert giá — toast khi vượt ngưỡng.
- Lọc tin tức chính xác hơn / thêm nguồn Vietstock RSS.
- SSI Trading GĐ2 — đặt lệnh (mục 8, rủi ro cao).
- Đồng bộ giao dịch đa thiết bị → đã nâng thành GĐ 5 của `docs/QUYHOACH.md`.

---

### Skeleton loading + Chatbot AI (khảo sát 02/10/2026 — user đã chốt hướng)

**Thứ tự đã chốt:** skeleton trước, chatbot sau. **Skeleton ĐÃ LÀM 02/10/2026** (CLAUDE.md mục 4); "số liệu lần trước" cho 4 trang tài sản cũng ĐÃ LÀM 02/10. Còn lại: chatbot.

**Skeleton.** ~12 chỗ còn hiện chữ ("Đang chờ máy chủ…" ở bảng 4 trang HTML tĩnh
+ `setTableMessage`; "Đang tải…" ô thống kê chart vang/coin/ngoai-te; xếp hạng
`chung-khoan.js`; bảng lãi suất `tiet-kiem.js`). Cách làm: lớp `.sk` dùng chung
trong `base.css` (tái dùng `--shimmer` + `motion-shimmer`), helper trong
`motion.js`, viết skeleton thẳng vào HTML tĩnh. Dòng skeleton cao ĐÚNG bằng dòng
thật (giữ CLS ≤0,01). **Giữ dòng trạng thái "Máy chủ đang khởi động… Ns"** —
Render ngủ 30–50s, shimmer trơn trông như treo. Hết hạn chờ → đổi sang báo lỗi,
không shimmer mãi. Kèm: mở rộng "số liệu lần trước" (như
`vn_dashboard_market_snapshot_v1`) sang Vàng/Ngoại tệ/Coin/Lãi suất.

**Chatbot — quyết định của user:**
- Phạm vi: **CHỈ dữ liệu thị trường.** KHÔNG gửi danh mục/sổ tiết kiệm/giao dịch
  cá nhân sang API AI. Đừng tự mở rộng — hỏi lại user.
- Model: ~~Haiku tra cứu + Sonnet phân tích~~ → **CHỈ `claude-haiku-5-5`** (user
  chốt 08/10/2026, Haiku 5.5 ra 07/10). Tra cứu `effort: "low"`, phân tích
  `"medium"`/`"high"` — không định tuyến 2 model. Thêm Sonnet chỉ khi thử thật
  thấy Haiku phân tích kém. Trần chi tiêu/ngày trên server vẫn giữ.
- Giá Haiku 5.5: $0,10 / $0,50 per 1M token (in/out) khi prompt ≤100K; **>100K
  nhân 5** → server phải cắt lịch sử chat + rút gọn JSON tool. Ước ~$0,002/câu
  (15K in, 800 out). Tokenizer đếm nhiều hơn Haiku 4.5 ~30%.
- Bẫy API Haiku 5.5 (400 nếu sai): KHÔNG `temperature`/`top_p`/`top_k`; KHÔNG
  prefill; thinking chỉ `adaptive` (không `budget_tokens`); đọc block theo
  `type` (thinking đứng đầu); lịch sử append-only nếu gửi lại thinking block —
  qua lượt mới chỉ lưu chữ trả lời; xử lý `stop_reason: "refusal"` (không có
  fallback server). Trước khi chốt: thử ~20 câu tiếng Việt mẫu.
- Kiến trúc dự kiến: `/api/chat` trên Render (khoá API ở env, không ra frontend),
  khuôn bảo vệ y `/api/account/*` (`x-dashboard-key` + origin allowlist + 503 khi
  thiếu env). Claude tool use gọi lại hàm dữ liệu sẵn có (quote, history, news,
  events, gold, fx, savings rates). UI: nút nổi, sheet toàn màn trên điện thoại,
  `chat.js` nạp lười khi bấm (không đụng thứ tự nạp script). Đây là đổi hợp đồng
  dữ liệu (mục 2) — user đã đồng ý hướng, chi tiết endpoint chốt khi làm.
