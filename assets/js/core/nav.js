// ============================================================
// NAV — shared navigation bar + privacy toggle for every page.
//
// Injected rather than copy-pasted into six HTML files: adding a page or
// renaming one must be a one-line change here, not a six-file sweep.
//
// Usage: put <div id="appNav"></div> at the top of the page body and load this
// script. It renders itself on DOMContentLoaded.
// ============================================================

const Nav = (function () {
  // `soon: true` renders the link greyed out with a "sắp có" tag: the roadmap
  // stays visible without leading to a 404.
  const PAGES = [
    { href: "index.html", label: "Tổng gia sản" },
    { href: "chung-khoan.html", label: "Chứng khoán" },
    { href: "vang.html", label: "Vàng" },
    { href: "ngoai-te.html", label: "Ngoại tệ" },
    { href: "coin.html", label: "Coin" },
    { href: "tiet-kiem.html", label: "Tiết kiệm" },
  ];

  const PRIVACY_SETTING = "privacyMode";
  const EYE_ON = "🙈"; // đang che
  const EYE_OFF = "👁"; // đang hiện

  // Current file name, with "" (directory root) treated as index.html.
  function currentPage() {
    const last = location.pathname.split("/").pop();
    return last === "" ? "index.html" : last;
  }

  // ---- Privacy mode -------------------------------------------------------
  // The class goes on <html> and CSS does the masking (see base.css). Doing it
  // in CSS rather than at each render site means a new money field only has to
  // wear class="money" — no JS change, and nothing to forget.
  function applyPrivacy(on) {
    document.documentElement.classList.toggle("privacy", !!on);
    const btn = document.getElementById("eyeBtn");
    if (btn) {
      btn.textContent = on ? EYE_ON : EYE_OFF;
      btn.classList.toggle("on", !!on);
      btn.title = on ? "Đang ẩn số tiền — bấm để hiện" : "Ẩn số tiền";
      btn.setAttribute("aria-pressed", String(!!on));
    }
  }

  async function togglePrivacy() {
    const next = !document.documentElement.classList.contains("privacy");
    applyPrivacy(next);
    await Store.setSetting(PRIVACY_SETTING, next);
  }

  function render() {
    const host = document.getElementById("appNav");
    if (!host) return;
    const here = currentPage();

    // The links live in their own wrapper so that on a phone only THEY scroll
    // sideways while the eye button stays put. Sticky-positioning the button
    // inside the scroller instead makes it sit on top of the link text.
    host.className = "app-nav";
    host.innerHTML =
      `<div class="nav-links">` +
      PAGES.map((p) => {
        const cls = [p.href === here ? "active" : "", p.soon ? "soon" : ""]
          .filter(Boolean)
          .join(" ");
        return `<a href="${p.href}"${cls ? ` class="${cls}"` : ""}>${p.label}</a>`;
      }).join("") +
      `</div>` +
      `<button type="button" class="eye-btn" id="eyeBtn" aria-pressed="false" title="Ẩn số tiền">${EYE_OFF}</button>`;

    document.getElementById("eyeBtn").addEventListener("click", togglePrivacy);

    // Default OFF: starting hidden reads as "data failed to load", not as a
    // deliberate privacy state.
    Store.getSetting(PRIVACY_SETTING, false).then(applyPrivacy);

    Store.ready.then(renderLoginWarning);
  }

  // Dải cảnh báo "chưa đăng nhập" — hiện trên MỌI trang khi dữ liệu thật đã
  // nằm ở Supabase mà máy này chưa đăng nhập.
  //
  // Vì sao không chặn hẳn trang: mở trên máy mới sẽ thành trang trắng, tệ hơn.
  // Vì sao không im lặng: localStorage của máy này có thể là bản cũ — đọc ra
  // thì sai; hoặc rỗng — thì tưởng mất sạch dữ liệu. Cả hai đều là con số
  // người dùng dùng để ra quyết định, nên phải nói ra chỗ nó đến từ đâu.
  function renderLoginWarning() {
    const host = document.getElementById("appNav");
    if (!host) return;
    const existing = document.getElementById("loginWarn");

    if (!Store.needsLogin) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    const bar = document.createElement("div");
    bar.id = "loginWarn";
    bar.className = "login-warn";
    bar.innerHTML =
      `Chưa đăng nhập trên máy này. Số đang hiện là bản lưu trong trình duyệt, ` +
      `<strong>không phải dữ liệu trên Supabase</strong> — có thể cũ hoặc trống. ` +
      `<a href="index.html">Đăng nhập</a> để xem đúng.`;
    host.insertAdjacentElement("afterend", bar);
  }

  document.addEventListener("DOMContentLoaded", render);

  return { render, applyPrivacy, currentPage, renderLoginWarning, PAGES };
})();
