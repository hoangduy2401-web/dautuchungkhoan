-- ============================================================
-- SCHEMA — dautuchungkhoan (GĐ 5.1 + 5.2 của docs/QUYHOACH.md)
--
-- Chạy MỘT LẦN trong Supabase SQL Editor:
--   Dashboard -> SQL Editor -> New query -> dán toàn bộ file -> Run
--
-- File này chạy lại được nhiều lần mà không hỏng (idempotent): mọi lệnh tạo
-- đều có IF NOT EXISTS, mọi policy đều DROP trước khi CREATE.
--
-- HAI NGUYÊN TẮC KHÔNG ĐƯỢC BỎ:
--
-- 1. RLS bật NGAY trong cùng file với lệnh tạo bảng, không để làm sau.
--    Publishable key nằm công khai trong `config.js` — ai xem mã nguồn trang
--    web cũng lấy được. RLS mới là lớp chặn thật. Bảng bật RLS mà quên viết
--    policy thì đọc/ghi đều bị chặn sạch (an toàn); bảng quên bật RLS thì cả
--    Internet đọc được danh mục tài sản (không cứu được sau khi lộ).
--
-- 2. Mọi bảng có `user_id` tham chiếu `auth.users`, mặc định `auth.uid()`.
--    QUYHOACH mục 1.8 nói "một người dùng duy nhất" nên schema không cần chia
--    sẻ dữ liệu, NHƯNG cột này vẫn bắt buộc: policy RLS phải so được hàng với
--    người đang đăng nhập, không có cột thì không viết được điều kiện.
-- ============================================================


-- ============================================================
-- 1. HÀM DÙNG CHUNG
-- ============================================================

-- Tự cập nhật `updated_at` mỗi lần UPDATE. Để client tự gửi thì sớm muộn cũng
-- có một đường ghi quên gửi, và lúc đó không biết hàng nào mới hơn.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ============================================================
-- 2. BẢNG DỮ LIỆU NGƯỜI DÙNG
--
-- Tám bảng, khớp một-một với `collection` của `store.js`:
--   tx_stock · watchlist · holdings_gold · holdings_fx · holdings_crypto
--   savings_accounts · cash_flows · settings
--
-- Cột đặt theo đúng hình dạng dữ liệu các trang ĐANG ghi (đọc từ
-- assets/js/pages/*.js), không phải theo hình dung. Đây là lý do GĐ 5 cố ý
-- xếp sau GĐ 1-4.
--
-- `id` để kiểu text chứ không phải uuid: `Store.add` đang sinh id dạng
-- `Date.now().toString(36) + random`, và bản nhập dữ liệu cũ ở 5.5 phải giữ
-- nguyên id đó. Đổi sang uuid là mọi tham chiếu cũ trong file sao lưu thành vô
-- nghĩa.
-- ============================================================

-- ---- Giao dịch chứng khoán (khoá localStorage LEGACY: vn_dashboard_transactions_v1)
create table if not exists public.tx_stock (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade
                default auth.uid(),
  symbol      text not null,
  -- Ràng buộc ở DB chứ không chỉ ở JS: `portfolio.js` tính giá vốn bình quân
  -- theo type, một giá trị lạ lọt vào là cả bảng lãi/lỗ sai mà không báo gì.
  type        text not null check (type in ('buy', 'sell')),
  qty         numeric not null check (qty > 0),
  price       numeric not null check (price >= 0),
  date        date    not null,
  note        text    not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---- Danh sách theo dõi (khoá LEGACY: vn_dashboard_watchlist_v1)
-- Khác mọi bảng còn lại: localStorage lưu đây là MẢNG CHUỖI ("VNM","FPT"...),
-- không phải mảng object có id. Thứ tự là do user kéo thả nên phải lưu, và
-- `position` chính là thứ tự đó — mất cột này thì mỗi lần tải lại danh sách
-- xáo một kiểu.
--
-- Cột thứ tự đặt tên `sort_order` chứ không phải `position`: `position` là từ
-- khoá của Postgres (hàm POSITION(x IN y)) — dùng làm tên cột thì hợp lệ nhưng
-- sẽ phải bọc dấu nháy ở vài ngữ cảnh, và đó đúng loại bẫy hiện ra vào lúc bận.
create table if not exists public.watchlist (
  user_id     uuid not null references auth.users (id) on delete cascade
                default auth.uid(),
  symbol      text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  primary key (user_id, symbol)
);

-- ---- Danh mục vàng
-- `cost` cho phép null CÓ CHỦ Ý: trang vàng cho nhập số lượng mà bỏ trống giá
-- vốn ("không theo dõi lãi/lỗ cho dòng này"). Đổi thành `not null default 0` là
-- biến "không biết giá vốn" thành "giá vốn bằng 0" — lãi/lỗ hiện +100%.
create table if not exists public.holdings_gold (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade
                default auth.uid(),
  code        text not null,                    -- SJC, PNJ, DOJI...
  name        text,
  qty         numeric not null check (qty > 0),
  unit        text not null,                    -- luong | chi | gram
  cost        numeric check (cost is null or cost > 0),  -- triệu ₫/lượng
  date        date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---- Danh mục ngoại tệ
create table if not exists public.holdings_fx (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade
                default auth.uid(),
  code        text not null,                    -- USD, EUR, JPY...
  amount      numeric not null check (amount > 0),
  cost        numeric check (cost is null or cost > 0),  -- ₫/1 đơn vị ngoại tệ
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---- Danh mục coin
-- `coin_id` là slug CoinGecko ("matic-network"), KHÔNG phải mã ticker. Và nó
-- tách hẳn khỏi `id` của bản ghi — trang coin đã vấp đúng chỗ này: nhét slug
-- vào `id` thì hai dòng cùng một coin trùng khoá, sửa dòng này xoá dòng kia.
create table if not exists public.holdings_crypto (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade
                default auth.uid(),
  coin_id     text not null,
  symbol      text,
  qty         numeric not null check (qty > 0),
  cost        numeric check (cost is null or cost > 0),  -- ₫/1 coin
  date        date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---- Sổ tiết kiệm
-- `rate` là lãi suất ĐÃ CHỐT LÚC GỬI, không đọc lại từ bảng niêm yết. Bảng
-- niêm yết là lãi suất hôm nay; sổ đã khoá lãi suất từ ngày gửi (CLAUDE.md
-- mục 9, phiên 8). Vì vậy nó là cột dữ liệu, không phải giá trị tra cứu.
create table if not exists public.savings_accounts (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade
                default auth.uid(),
  bank        text not null,
  amount      numeric not null check (amount > 0),
  term        text not null,                    -- "1T", "6T", "12T"...
  rate        numeric not null check (rate > 0), -- %/năm
  date        date not null,                    -- ngày gửi
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---- Dòng tiền vào/ra (GĐ 6.4 dùng — bảng dựng sẵn, chưa có trang nào ghi)
-- Lý do tồn tại: trang tổng phải tách "tài sản tăng do lãi" với "tài sản tăng
-- do nạp thêm tiền". Không có bảng này thì nạp thêm 100 triệu trông y hệt lãi
-- 100 triệu.
create table if not exists public.cash_flows (
  id          text primary key,
  user_id     uuid not null references auth.users (id) on delete cascade
                default auth.uid(),
  channel     text not null check (channel in
                ('stock', 'gold', 'fx', 'crypto', 'savings')),
  direction   text not null check (direction in ('in', 'out')),
  amount      numeric not null check (amount > 0),  -- VND
  date        date not null,
  note        text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---- Cài đặt
-- Một hàng cho mỗi người dùng, giá trị nằm trong jsonb: privacyMode, fxPinned,
-- coinWatch... Đây là túi khoá-giá trị mở, mỗi lần thêm một cài đặt mà phải
-- chạy migration đổi cột là sai chỗ đánh đổi.
create table if not exists public.settings (
  user_id     uuid primary key references auth.users (id) on delete cascade
                default auth.uid(),
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);


-- ============================================================
-- 3. BẢNG SNAPSHOT GIÁ (GĐ 5.7)
--
-- KHÁC mọi bảng trên: đây là dữ liệu thị trường, không phải dữ liệu cá nhân,
-- nên KHÔNG có `user_id` và ai đọc cũng được. Ghi thì chỉ job của server ghi
-- (dùng secret key, bỏ qua RLS) — xem policy ở mục 4.
--
-- Mục đích: tỷ giá, giá vàng, lãi suất tiết kiệm không có nguồn lịch sử free
-- nào cho VN. Không tự lưu từ hôm nay thì một năm nữa vẫn không vẽ được biểu
-- đồ một năm.
-- ============================================================
create table if not exists public.price_snapshots (
  id          bigserial primary key,
  kind        text not null check (kind in ('fx', 'gold', 'savings')),
  taken_on    date not null default current_date,
  payload     jsonb not null,
  created_at  timestamptz not null default now(),
  -- Một bản chụp mỗi loại mỗi ngày. Job chạy lại (retry, deploy trùng giờ)
  -- không được sinh bản thứ hai — trùng ngày là biểu đồ có hai điểm cùng mốc.
  unique (kind, taken_on)
);


-- ============================================================
-- 4. ROW LEVEL SECURITY — bật cho MỌI bảng, ngay tại đây
-- ============================================================

alter table public.tx_stock          enable row level security;
alter table public.watchlist         enable row level security;
alter table public.holdings_gold     enable row level security;
alter table public.holdings_fx       enable row level security;
alter table public.holdings_crypto   enable row level security;
alter table public.savings_accounts  enable row level security;
alter table public.cash_flows        enable row level security;
alter table public.settings          enable row level security;
alter table public.price_snapshots   enable row level security;

-- Bảng cá nhân: một policy `for all` cho mỗi bảng — chủ hàng làm được mọi thứ,
-- người khác không thấy hàng đó tồn tại.
--
-- `using` lọc hàng ĐƯỢC ĐỌC/SỬA/XOÁ; `with check` chặn hàng SẮP GHI VÀO. Phải
-- có cả hai: chỉ `using` thì vẫn ghi được hàng mang user_id của người khác.
do $$
declare
  own_tables text[] := array[
    'tx_stock', 'watchlist', 'holdings_gold', 'holdings_fx',
    'holdings_crypto', 'savings_accounts', 'cash_flows', 'settings'
  ];
  t text;
begin
  foreach t in array own_tables
  loop
    execute format('drop policy if exists own_rows on public.%I', t);
    execute format(
      'create policy own_rows on public.%I
         for all
         to authenticated
         using (user_id = (select auth.uid()))
         with check (user_id = (select auth.uid()))', t);
  end loop;
end;
$$;

-- Snapshot giá: ai đọc cũng được (kể cả chưa đăng nhập — biểu đồ lịch sử là
-- phần công khai của trang). KHÔNG có policy insert/update/delete, nghĩa là
-- publishable key không ghi được gì; job snapshot ở server ghi bằng secret key
-- và secret key bỏ qua RLS.
drop policy if exists snapshots_read on public.price_snapshots;
create policy snapshots_read on public.price_snapshots
  for select
  to anon, authenticated
  using (true);


-- ============================================================
-- 5. TRIGGER updated_at
-- ============================================================
do $$
declare
  touch_tables text[] := array[
    'tx_stock', 'holdings_gold', 'holdings_fx', 'holdings_crypto',
    'savings_accounts', 'cash_flows', 'settings'
  ];
  t text;
begin
  foreach t in array touch_tables
  loop
    execute format('drop trigger if exists touch_%I on public.%I', t, t);
    execute format(
      'create trigger touch_%I before update on public.%I
         for each row execute function public.touch_updated_at()', t, t);
  end loop;
end;
$$;


-- ============================================================
-- 6. CHỈ MỤC
--
-- Mọi truy vấn của app đều lọc theo user_id (RLS tự thêm điều kiện đó vào mọi
-- câu lệnh), nên đây là cột đáng đánh chỉ mục nhất. Với một người dùng thì
-- chưa thấy khác biệt — nhưng chỉ mục thêm sau trên bảng có dữ liệu thật thì
-- phải khoá bảng.
-- ============================================================
create index if not exists tx_stock_user_date_idx
  on public.tx_stock (user_id, date desc);
create index if not exists holdings_gold_user_idx
  on public.holdings_gold (user_id);
create index if not exists holdings_fx_user_idx
  on public.holdings_fx (user_id);
create index if not exists holdings_crypto_user_idx
  on public.holdings_crypto (user_id);
create index if not exists savings_accounts_user_date_idx
  on public.savings_accounts (user_id, date desc);
create index if not exists cash_flows_user_date_idx
  on public.cash_flows (user_id, date desc);
create index if not exists watchlist_user_pos_idx
  on public.watchlist (user_id, sort_order);
create index if not exists price_snapshots_kind_date_idx
  on public.price_snapshots (kind, taken_on desc);


-- ============================================================
-- 7. TỰ KIỂM — chạy xong nhìn kết quả bảng này
--
-- Cột `rls` phải là `true` ở CẢ CHÍN dòng. Dòng nào `false` thì dừng lại sửa
-- ngay, đừng ghi dữ liệu thật lên: bảng đó đang mở cho bất kỳ ai có
-- publishable key, mà key đó nằm công khai trong mã nguồn trang web.
-- ============================================================
select
  c.relname                       as bang,
  c.relrowsecurity                as rls,
  count(p.polname)                as so_policy
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policy p on p.polrelid = c.oid
where n.nspname = 'public'
  and c.relkind = 'r'
group by c.relname, c.relrowsecurity
order by c.relname;
