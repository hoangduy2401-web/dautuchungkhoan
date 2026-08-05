---
description: Cập nhật CLAUDE.md cuối phiên — trạng thái, việc còn treo, bài học mới
---

Cập nhật `CLAUDE.md` để phiên sau đọc là hiểu ngay, không cần hỏi lại gì.

## Cách làm

1. **Đọc `CLAUDE.md`** và xem `git log --oneline -15` + `git status` để biết
   phiên này đã đụng những gì.

2. **Mục "Trạng thái hiện tại"** — thêm một khối mới cho phiên hôm nay theo đúng
   khuôn các phiên trước: ngày, việc đã làm, file nào đụng, có đụng backend
   không, số phiên bản `?v=` hiện tại.

   **Mục 9 chỉ giữ 2 phiên gần nhất.** Thêm phiên mới thì đẩy phiên cũ nhất
   xuống đầu `docs/NHATKY.md` (giữ nguyên văn, không viết lại). File `CLAUDE.md`
   nạp vào context mỗi phiên, nên nhật ký dài làm mọi phiên sau trả giá; `git log`
   cũng phục dựng được phần lớn vì commit message của dự án viết rất chi tiết.

3. **Mục "Việc còn treo"** — xoá việc đã xong, thêm việc mới phát sinh. Việc nào
   cần user tự làm (bấm nút trên dashboard bên thứ ba, mua tên miền, tạo API
   key…) phải ghi rõ **"user tự làm"** kèm các bước.

4. **Mục "Key learnings"** — chỉ thêm khi phiên này phát hiện cạm bẫy thật, đã
   đo được. Mỗi mục phải có: triệu chứng → nguyên nhân → cách sửa → **kèm số đo
   thật**. Không ghi suy đoán. Ghi rõ cả những thứ **đã loại trừ** để phiên sau
   không điều tra lại.

5. **Kiểm tra chéo trước khi ghi:**
   - Sửa JS/CSS mà chưa bump `?v=YYYYMMDD<chữ>` trong HTML? → nhắc.
   - Sửa `server/` mà chưa đồng bộ bản deploy? → nhắc.
   - Có file nào đang dở, chưa commit? → liệt kê.

## Nguyên tắc viết

- Tiếng Việt, gọn, không lặp lại thứ đã có trong file.
- **Ghi cả cái KHÔNG phải nguyên nhân**, kèm cách đã loại trừ. Đây là phần tiết
  kiệm thời gian nhất cho phiên sau.
- Số đo thật > mô tả định tính. "30 quote song song 0,14–0,25s" hơn hẳn "nhanh".
- Quyết định cố ý làm khác chuẩn/tài liệu: ghi rõ **lý do**, kèm dòng
  "đừng sửa lại" — nếu không phiên sau sẽ "sửa cho đúng" và làm hỏng.
- Đừng viết lại lịch sử: các phiên cũ giữ nguyên, chỉ thêm phần mới.

## Sau khi ghi xong

Báo lại ngắn gọn: đã thêm/sửa mục nào, và còn việc gì user phải tự làm.
Không tự commit — hỏi user trước.
