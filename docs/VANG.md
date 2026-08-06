# Vàng — nguồn, đơn vị, và những chỗ cố ý làm khác

> Tách riêng vì chỉ cần đọc khi động vào trang vàng. Trạng thái và nhật ký ở
> `CLAUDE.md` mục 9; kế hoạch ở `docs/QUYHOACH.md` bảng GĐ 2 (đã xong 06/08/2026).

## 1. ĐƠN VỊ — đã xác minh 06/08/2026, đừng đo lại

Đây là việc 2.1 của kế hoạch, làm trước mọi thứ khác, vì cùng loại lỗi với giá
VND thô của SSI (phải chia 1000). Ba nguồn độc lập, cùng một ngày:

| Nguồn | Trường | SJC mua / bán | Quy ra 1 lượng |
|---|---|---|---|
| PNJ | `giamua` / `giaban` | 13.970 / 14.270 | 139,7 / 142,7 triệu |
| BTMC | `@pb_n` / `@ps_n` | 14.030.000 / 14.330.000 | 140,3 / 143,3 triệu |
| Báo chí cùng ngày | — | — | 138,8 / 141,8 triệu |

**Kết luận:**
- **PNJ trả nghìn đồng / CHỈ.**
- **BTMC trả đồng thô / CHỈ.**
- `1 lượng = 10 chỉ = 37,5 gram`.

`/api/gold/prices` thống nhất về **nghìn đồng/chỉ**; BTMC chia 1000 cho khớp.
Nếu con số trên màn hình lệch hệ số 10 hay 1000 thì kiểm chỗ này trước.

Nếu là giá theo *lượng* thì SJC sẽ là 14 triệu/lượng — mức của năm 2020, vô lý
với thị trường hiện tại. Đó là phép thử nhanh nhất.

## 2. Nguồn

### PNJ — chính
```
GET https://edge-api.pnj.io/ecom-frontend/v1/get-gold-price
```
JSON, free, không key. Trả `{data:[{masp, tensp, giaban, giamua}], updateDate,
chinhanh}`. 20 loại, `updateDate` là giờ niêm yết thật (dd/MM/yyyy HH:mm:ss,
giờ VN, không có offset trong chuỗi → phải đóng `+07:00` tường minh).

**Cạm bẫy:** hai mã cuối `RAW_9999` / `RAW_9900` (vàng nguyên liệu mua ngoài) có
`giaban: ""` — PNJ chỉ MUA, không bán. Trả `null`, không phải 0.

`chinhanh: "hochiminh"` — bảng giá theo chi nhánh, UI có hiện tên chi nhánh.

### BTMC — dự phòng, và là nguồn duy nhất có bạc
```
GET http://api.btmc.vn/api/BTMCAPI/getpricebtmc?key=<key công khai>
```
**Format xấu, đọc kỹ trước khi sửa parser:**
- Mọi tên trường mang **hậu tố là số dòng**: `@n_7`, `@pb_7`, `@ps_7`, `@d_7`.
  Phải đọc qua `row["@row"]`, không đọc theo tên cố định được.
- Mỗi sản phẩm xuất hiện **hai lần** với `@d_` khác nhau → giữ bản mới nhất.
- Feed có **cả bạc lẫn vàng** (1703 dòng, 9 loại vàng). Route lọc bỏ tên chứa
  `BẠC`. Nếu sau này làm trang bạc thì lấy ở đây.
- Key nằm công khai trong trang web của BTMC và họ có thể đổi bất cứ lúc nào —
  đó là lý do BTMC là dự phòng chứ không phải nguồn chính.

### SJC trực tiếp — KHÔNG DÙNG ĐƯỢC
`sjc.com.vn/giavang/textContent.php` trả Cloudflare JS challenge khi gọi
server-to-server. **Đừng thử lại bằng header giả trình duyệt** — không phải lọc
User-Agent. Giống hệt trường hợp TCBS đã bỏ.

## 3. Những chỗ cố ý làm khác — đừng "sửa cho gọn"

1. **Bảng mặc định chỉ hiện 7 loại chính** (`PNJ_MAIN` trong `vang.js`). 13 loại
   vàng tuổi thấp (18K trở xuống) có chênh lệch mua-bán **9–21%**; trộn chung sẽ
   kéo lệch trung bình và làm mọi so sánh vô nghĩa. Chúng nằm sau checkbox.
2. **Nguồn dự phòng trả lời thì phải hiện dải cảnh báo.** Hai tiệm báo giá khác
   nhau; đổi nguồn mà im lặng thì user thấy số nhảy và tưởng thị trường biến
   động. Payload có sẵn `source` + `note` cho việc này.
3. **Danh mục định giá theo giá tiệm MUA VÀO**, không phải giá bán ra — đó là số
   tiền thật sự thu về khi bán lại. Cùng logic với danh mục ngoại tệ (dùng giá
   mua chuyển khoản của VCB).
4. **Giá vốn nhập theo triệu đồng/lượng**, số lượng nhập theo lượng/chỉ/gram tuỳ
   chọn. Người Việt nhớ giá vàng theo "triệu một lượng"; bắt nhập nghìn/chỉ là
   mời gọi nhập sai một hệ số 10. Hằng số quy đổi: `COST_TO_PER_CHI = 100`.
5. **Danh sách nắm giữ sửa tại chỗ, không phải sổ giao dịch** — cùng lý do và
   cùng khuôn với `holdings_fx`, xem `CLAUDE.md` mục 9.

## 4. Việc còn treo

- **Ngưỡng cảnh báo chênh lệch mua-bán đang để 5% và đó là MỐC TẠM.** Cơ sở duy
  nhất: một lần đo 06/08/2026, nhóm vàng 999.9 của PNJ nằm trong 2,10% (SJC) đến
  3,54%. Cần chuỗi nhiều ngày mới chốt được ngưỡng thật.
- Chưa có biểu đồ lịch sử giá vàng: cả PNJ lẫn BTMC đều **chỉ có giá hiện tại**.
  Muốn có chart phải tự tích luỹ bản chụp hàng ngày (hợp với GĐ 5, khi đã có
  Supabase) hoặc tìm nguồn thứ ba.
- Bạc: BTMC có sẵn dữ liệu, chưa ai yêu cầu.
