// ============================================================
// AUTH — đăng nhập bằng magic link (GĐ 5.3 của docs/QUYHOACH.md).
//
// Không mật khẩu, cố ý: không có mật khẩu thì không có mật khẩu để lộ, không
// phải làm luồng quên mật khẩu, không phải lo user đặt lại mật khẩu đã dùng ở
// chỗ khác. Đổi lại là phụ thuộc vào hộp thư — chấp nhận được với một người dùng.
//
// Module này CHỈ lo danh tính. Nó không đọc, không ghi, không đụng một dòng dữ
// liệu tài sản nào — đó là việc của `store.js` ở 5.4. Tách ra để bật đăng nhập
// mà không đặt dữ liệu vào vòng nguy hiểm: đăng nhập xong mọi trang vẫn đọc
// localStorage y như cũ.
//
// PHIÊN ĐĂNG NHẬP LƯU Ở ĐÂU: supabase-js tự lưu vào localStorage dưới khoá
// `sb-<ref>-auth-token`. Khoá đó KHÔNG bắt đầu bằng `vn_gs_` nên `exportAll()`
// không gom nó vào — file sao lưu vì thế không chứa token đăng nhập. Đây là
// tính chất phải giữ: một file sao lưu gửi qua chat mà kèm token là trao luôn
// quyền vào tài khoản.
// ============================================================

const Auth = (function () {
  const cfg = (typeof APP_CONFIG !== "undefined" && APP_CONFIG.supabase) || {};
  let client = null;
  const listeners = new Set();

  function enabled() {
    return !!(cfg.AUTH_ENABLED && cfg.url && cfg.publishableKey);
  }

  // Thư viện nạp từ unpkg trong thẻ <script>, y như lightweight-charts. Mạng
  // hỏng hoặc CDN chết thì `window.supabase` không tồn tại — phải nói ra chứ
  // không để nút bấm im lặng không phản ứng.
  function libReady() {
    return typeof window !== "undefined" && !!window.supabase;
  }

  function getClient() {
    if (!enabled() || !libReady()) return null;
    if (client) return client;
    client = window.supabase.createClient(cfg.url, cfg.publishableKey, {
      auth: {
        // PKCE thay vì implicit: mã đổi lấy phiên đi qua tham số `?code=`, token
        // không bao giờ nằm trong URL. Fragment `#access_token=...` của luồng
        // implicit lọt vào lịch sử trình duyệt và các tiện ích mở rộng đọc được.
        flowType: "pkce",
        // Tự đổi `?code=` thành phiên khi user bấm link trong email.
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    });
    client.auth.onAuthStateChange((_event, session) => {
      for (const fn of listeners) {
        try {
          fn(session);
        } catch (err) {
          console.warn("[Auth] listener lỗi:", err.message);
        }
      }
    });
    return client;
  }

  async function session() {
    const c = getClient();
    if (!c) return null;
    const { data } = await c.auth.getSession();
    return data.session || null;
  }

  async function user() {
    const s = await session();
    return s ? s.user : null;
  }

  // Gửi magic link. `emailRedirectTo` phải nằm trong Redirect URLs của dự án
  // Supabase, nếu không Supabase sẽ đá về Site URL — nghĩa là đang sửa ở
  // localhost mà bấm link lại nhảy sang bản live.
  //
  // Dùng `location.href` bỏ hash/query chứ không phải `location.origin`: trang
  // này chạy được cả ở thư mục con, và quay về đúng trang vừa bấm thì đỡ lạc.
  async function signIn(email) {
    const c = getClient();
    if (!c) throw new Error("Đăng nhập chưa bật hoặc thư viện Supabase chưa nạp được.");

    const back = location.origin + location.pathname;
    const { error } = await c.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: back,
        // false = không tự tạo tài khoản mới. Gõ nhầm địa chỉ thì báo lỗi thay
        // vì lặng lẽ mở một tài khoản rỗng khác rồi ngồi hỏi sao mất dữ liệu.
        shouldCreateUser: false,
      },
    });
    if (error) throw error;
  }

  async function signOut() {
    const c = getClient();
    if (!c) return;
    await c.auth.signOut();
  }

  function onChange(handler) {
    listeners.add(handler);
    return () => listeners.delete(handler);
  }

  // ---- Giao diện ----------------------------------------------------------
  // Tự vẽ như `nav.js` thay vì bắt mỗi trang tự dựng: đặt <div id="authPanel">
  // vào trang rồi nạp file này.

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])
    );
  }

  function shell(inner) {
    return (
      `<div class="panel">` +
      `<div class="panel-head"><h2>Tài khoản</h2></div>` +
      `<div class="panel-body">${inner}</div></div>`
    );
  }

  async function render() {
    const host = document.getElementById("authPanel");
    if (!host) return;

    if (!enabled()) {
      host.innerHTML = shell(
        `<p class="build-note">Đăng nhập chưa bật. Dữ liệu đang lưu trong trình duyệt này.</p>`
      );
      return;
    }
    if (!libReady()) {
      host.innerHTML = shell(
        `<p class="build-note">Không nạp được thư viện Supabase (mạng hoặc CDN). ` +
          `Dữ liệu vẫn đọc bình thường từ trình duyệt này — chỉ phần đăng nhập không dùng được.</p>`
      );
      return;
    }

    const s = await session();

    if (s) {
      host.innerHTML = shell(
        `<p class="build-note">Đang đăng nhập: <strong>${esc(s.user.email)}</strong>` +
          `<br>Dữ liệu vẫn đang đọc từ <strong>trình duyệt này</strong> — việc chuyển ` +
          `lên Supabase là giai đoạn 5.4/5.5, chưa làm. Đăng nhập lúc này chưa thay đổi gì.</p>` +
          `<button type="button" class="btn-outline" id="authOut">Đăng xuất</button>`
      );
      document.getElementById("authOut").addEventListener("click", async (e) => {
        e.target.disabled = true;
        await signOut();
        render();
      });
      return;
    }

    host.innerHTML = shell(
      `<p class="build-note">Đăng nhập bằng liên kết gửi qua email — không cần mật khẩu.</p>` +
        `<div class="watchlist-add">` +
        `<input type="email" id="authEmail" class="edit-input" placeholder="email@example.com" ` +
        `autocomplete="email" style="min-width:240px" />` +
        `<button type="button" id="authIn">Gửi liên kết đăng nhập</button>` +
        `</div>` +
        `<p class="build-note" id="authMsg" style="margin-top:12px"></p>`
    );

    const input = document.getElementById("authEmail");
    const btn = document.getElementById("authIn");
    const msg = document.getElementById("authMsg");

    async function submit() {
      const email = input.value.trim();
      if (!email || !email.includes("@")) {
        msg.textContent = "Nhập địa chỉ email hợp lệ.";
        return;
      }
      btn.disabled = true;
      msg.textContent = "Đang gửi…";
      try {
        await signIn(email);
        msg.textContent =
          `Đã gửi liên kết tới ${email}. Mở hộp thư và bấm vào liên kết ` +
          `(kiểm tra cả thư mục Spam). Liên kết hết hạn sau 1 giờ.`;
      } catch (err) {
        // Tài khoản phải được tạo sẵn trong dashboard — `shouldCreateUser` để
        // false nên gõ nhầm email sẽ rơi vào đây thay vì mở âm thầm một tài
        // khoản rỗng thứ hai.
        msg.textContent =
          `Không gửi được: ${err.message}. ` +
          `Nếu báo không cho đăng ký, nghĩa là email này chưa được tạo trong dự án Supabase.`;
      } finally {
        btn.disabled = false;
      }
    }

    btn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
    });
  }

  return {
    enabled, libReady, getClient, session, user,
    signIn, signOut, onChange, render,
  };
})();

if (typeof module !== "undefined") module.exports = Auth;
