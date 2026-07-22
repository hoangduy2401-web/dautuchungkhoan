# Bảng Điện — Dashboard chứng khoán cá nhân

**https://dashboardstock.io.vn**

Dashboard theo dõi chứng khoán Việt Nam, gom mọi thứ cần nhìn vào một màn hình:
ticker tape, chỉ số thị trường, watchlist, biểu đồ nến kỹ thuật, chỉ số cơ bản
doanh nghiệp, tin tức theo mã và lịch sử giao dịch cá nhân có tính lãi/lỗ.

## Dữ liệu

| Nhóm | Nguồn |
|---|---|
| Giá, nến, chỉ số thị trường | SSI FastConnect Data |
| Chỉ số cơ bản (P/E, ROE, EPS...) | VNDirect finfo |
| Tin tức | CafeF RSS |
| Lịch sử giao dịch | localStorage (chỉ nằm trên máy bạn) |

## Kiến trúc

Web tĩnh HTML/CSS/JS thuần (không build tool) trên GitHub Pages, gọi dữ liệu
qua backend proxy Node.js/Express trên Render — bắt buộc phải có proxy vì mọi
API chứng khoán Việt Nam đều chặn CORS từ trình duyệt.

Biểu đồ dùng TradingView Lightweight Charts: MA10/MA20, Bollinger Bands, khối
lượng, RSI(14) ở chart phụ đồng bộ trục thời gian, và trendline vẽ tay neo theo
giá/thời gian.

## Chạy local

```bash
cd server
cp .env.example .env   # điền SSI_CONSUMER_ID và SSI_CONSUMER_SECRET
npm install
npm start              # http://localhost:3001
```

Frontend chỉ cần mở `index.html` bằng trình duyệt. Đổi 3 `baseUrl` trong
`config.js` sang `http://localhost:3001/api/...` để dùng backend local, hoặc
đặt `USE_MOCK: true` để chạy hoàn toàn bằng dữ liệu giả.

Chi tiết kỹ thuật, ràng buộc kiến trúc và các cạm bẫy đã gặp: xem
[CLAUDE.md](CLAUDE.md).
