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

  // ---- Khoá mã 6 số cho chế độ riêng tư ------------------------------------
  //
  // NÓI THẲNG VỀ MỨC BẢO VỆ, đừng để ai hiểu nhầm: đây là trang tĩnh, mọi thứ
  // chạy trong trình duyệt. Người biết mở DevTools gỡ được lớp này trong mười
  // giây. Nó chặn NGƯỜI ĐỨNG CẠNH nhìn màn hình, không chặn được kẻ có ý đồ và
  // có kỹ thuật. Lớp chặn thật cho dữ liệu vẫn là đăng nhập + RLS.
  //
  // Vì vậy: **chỉ hỏi mã khi HIỆN số, không hỏi khi ẩn số.** Che thì luôn cho
  // phép — nếu bắt nhập mã mới che được thì lúc cần che gấp lại loay hoay, mà
  // che có hại gì đâu. Hỏi mã lúc ẩn cũng vô nghĩa: người lạ chỉ cần bấm con
  // mắt lần nữa là hiện lại.
  //
  // Mã lưu dạng BĂM SHA-256 kèm chuỗi muối, không lưu số trần. Không phải vì
  // nó chống được tấn công (6 chữ số thì dò hết trong tích tắc) mà vì mã này
  // đồng bộ lên Supabase — không có lý do gì để nó nằm đó ở dạng đọc được.
  const PIN_SETTING = "privacyPinHash";
  const PIN_SALT = "vn_gs_privacy_v1:";

  async function hashPin(pin) {
    const buf = new TextEncoder().encode(PIN_SALT + pin);
    const digest = await crypto.subtle.digest("SHA-256", buf);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function getPinHash() {
    return Store.getSetting(PIN_SETTING, null);
  }

  async function setPin(pin) {
    await Store.setSetting(PIN_SETTING, pin ? await hashPin(pin) : null);
  }

  async function checkPin(pin) {
    const saved = await getPinHash();
    if (!saved) return true;
    return (await hashPin(pin)) === saved;
  }

  // Hộp nhập mã. Tự dựng thay vì `prompt()`: prompt() bị chặn trong nhiều
  // trình duyệt trên điện thoại, và không đặt được inputmode số.
  function askPin() {
    return new Promise((resolve) => {
      const wrap = document.createElement("div");
      wrap.className = "pin-overlay";
      wrap.innerHTML =
        `<div class="pin-box" role="dialog" aria-modal="true" aria-label="Nhập mã mở khoá">` +
        `<div class="pin-title">Nhập mã 6 số để hiện lại số tiền</div>` +
        `<input type="password" id="pinInput" class="edit-input" inputmode="numeric" ` +
        `autocomplete="off" maxlength="6" placeholder="••••••" />` +
        `<div class="pin-err" id="pinErr"></div>` +
        `<div class="pin-actions">` +
        `<button type="button" class="btn-outline" id="pinCancel">Thôi</button>` +
        `<button type="button" class="btn" id="pinOk">Mở</button>` +
        `</div></div>`;
      document.body.appendChild(wrap);

      const input = wrap.querySelector("#pinInput");
      const err = wrap.querySelector("#pinErr");
      input.focus();

      const done = (ok) => {
        wrap.remove();
        resolve(ok);
      };

      const submit = async () => {
        const pin = input.value.trim();
        if (!/^\d{6}$/.test(pin)) {
          err.textContent = "Mã gồm đúng 6 chữ số.";
          return;
        }
        if (await checkPin(pin)) return done(true);
        err.textContent = "Mã không đúng.";
        input.value = "";
        input.focus();
      };

      wrap.querySelector("#pinOk").addEventListener("click", submit);
      wrap.querySelector("#pinCancel").addEventListener("click", () => done(false));
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") submit();
        if (e.key === "Escape") done(false);
      });
      wrap.addEventListener("click", (e) => {
        if (e.target === wrap) done(false);
      });
    });
  }

  async function togglePrivacy() {
    const next = !document.documentElement.classList.contains("privacy");

    // Chỉ chặn ở chiều HIỆN số. Chiều ẩn đi luôn cho qua.
    if (!next && (await getPinHash())) {
      const ok = await askPin();
      if (!ok) return; // giữ nguyên trạng thái đang che
    }

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

  return {
    render, applyPrivacy, currentPage, renderLoginWarning, PAGES,
    // Trang Tổng gia sản dùng để đặt / đổi / gỡ mã.
    getPinHash, setPin, checkPin, askPin,
  };
})();
