// ============================================================
// TỔNG GIA SẢN — placeholder page for phase 0.
// Real aggregation lands in phase 6 (docs/QUYHOACH.md); it needs all five
// channels readable from one place, which only exists after phase 5.
// ============================================================
document.addEventListener("DOMContentLoaded", () => {
  initChrome(); // theme toggle + glass slider + clock
  Auth.render(); // đăng nhập magic link (GĐ 5.3) — chưa đụng dữ liệu
  Backup.render(); // nút xuất JSON (GĐ 5.6) — lối thoát trước khi lên Supabase
  Migrate.render(); // màn hình nhập dữ liệu cũ (GĐ 5.5) — chỉ chạy khi user bấm
});
