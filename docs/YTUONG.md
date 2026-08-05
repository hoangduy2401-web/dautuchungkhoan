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
