// ============================================================
// MOTION — small shared animation helpers. Everything here is presentation
// only: it never changes a number, only how a change is shown, and every
// effect is skipped under prefers-reduced-motion.
//
//   Motion.flash(key, value)   -> " flash-up" | " flash-down" | ""
//       Class to put on a price cell rendered by innerHTML. Remembers the last
//       value shown per key; first render and unchanged values return "".
//   Motion.countUp(key, el, to, format)
//       Tweens a total from the last value shown (0 the first time) to `to`
//       in ~0.6s. Skipped in privacy mode (the digits are masked anyway, and
//       a changing width would hint at them) and under reduced motion.
//   Motion.toast(message)
//       Short confirmation bottom-centre ("Đã lưu …").
//   Motion.swap(el)
//       Replays a short fade on `el` (chart container when the dataset
//       changes, pane switches).
//   Row enter (automatic): any direct child row with [data-hid] (holdings
//   tables) or .watch-item[data-symbol] (watchlist) that was not there on
//   the previous render slides in. First population never animates.
// ============================================================

const Motion = (function () {
  const mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  const reduced = () => !!(mq && mq.matches);

  // ---- Price flash --------------------------------------------------------
  const lastShown = new Map();
  function flash(key, value) {
    const prev = lastShown.get(key);
    lastShown.set(key, value);
    if (reduced() || prev == null || value == null || !Number.isFinite(value) || value === prev) return "";
    return value > prev ? " flash-up" : " flash-down";
  }

  // ---- Count-up -----------------------------------------------------------
  const counted = new Map();
  function countUp(key, el, to, format, ms = 600) {
    const from = counted.has(key) ? counted.get(key) : 0;
    counted.set(key, to);
    if (!el || !Number.isFinite(to)) return;
    const privacy = document.documentElement.classList.contains("privacy");
    if (reduced() || privacy || !Number.isFinite(from) || from === to) {
      el.textContent = format(to);
      return;
    }
    const start = performance.now();
    const step = (now) => {
      const p = Math.min(1, (now - start) / ms);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      // Always land on the exact value: the tween is only the way there.
      el.textContent = p < 1 ? format(from + (to - from) * eased) : format(to);
      if (p < 1 && el.isConnected) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // ---- Toast --------------------------------------------------------------
  let toastHost = null;
  function toast(message) {
    if (!toastHost) {
      toastHost = document.createElement("div");
      toastHost.className = "toast-host";
      toastHost.setAttribute("role", "status");
      toastHost.setAttribute("aria-live", "polite");
      document.body.appendChild(toastHost);
    }
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = message;
    toastHost.appendChild(t);
    setTimeout(() => t.classList.add("out"), 2200);
    setTimeout(() => t.remove(), 2600);
  }

  // ---- Replay a fade ------------------------------------------------------
  function swap(el) {
    if (!el || reduced()) return;
    el.classList.remove("motion-swap");
    void el.offsetWidth; // restart the animation
    el.classList.add("motion-swap");
  }

  // ---- Row enter ----------------------------------------------------------
  const ROW_SEL = ":scope > [data-hid], :scope > .watch-item[data-symbol]";
  const rowKey = (r) => r.dataset.hid || r.dataset.symbol;
  const known = new WeakMap(); // container -> Set of row keys last rendered
  const observer = new MutationObserver((mutations) => {
    const seen = new Set();
    for (const m of mutations) {
      const box = m.target;
      if (seen.has(box) || !(box instanceof Element)) continue;
      seen.add(box);
      const rows = [...box.querySelectorAll(ROW_SEL)];
      if (!rows.length && !known.has(box)) continue; // not a row container (yet)
      const prev = known.get(box);
      known.set(box, new Set(rows.map(rowKey)));
      if (!prev || reduced()) continue; // first population: no animation
      rows.forEach((r, i) => {
        if (!prev.has(rowKey(r))) {
          r.style.animationDelay = `${Math.min(i, 6) * 30}ms`;
          r.classList.add("row-enter");
        }
      });
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  return { reduced, flash, countUp, toast, swap };
})();
