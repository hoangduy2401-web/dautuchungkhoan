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
//   Motion.leave(el)  -> Promise
//       Fades/slides a row out (~200ms); await it BEFORE deleting, then
//       re-render as usual. Resolves at once under reduced motion.
//   Motion.flip(container, mutate)
//       FLIP reorder: records child positions, runs `mutate` (which moves
//       DOM nodes), then glides every displaced child from its old spot.
//       Used by the watchlist drag.
//   Sliding tab ink (automatic): .market-tabs, .range-tabs, .ov-ex and
//       .segmented get one pill behind the active button that slides to the
//       newly active one, instead of the background jumping.
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

  // ---- Row leave ----------------------------------------------------------
  function leave(el) {
    if (!el || reduced()) return Promise.resolve();
    return new Promise((resolve) => {
      el.classList.add("row-leave");
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve();
      };
      el.addEventListener("animationend", finish, { once: true });
      setTimeout(finish, 320); // safety net if animationend never fires
    });
  }

  // ---- FLIP reorder -------------------------------------------------------
  function flip(container, mutate) {
    if (reduced()) return mutate();
    const kids = [...container.children];
    const before = new Map(kids.map((k) => [k, k.getBoundingClientRect().top]));
    mutate();
    for (const k of container.children) {
      if (!before.has(k) || k.classList.contains("dragging")) continue;
      const dy = before.get(k) - k.getBoundingClientRect().top;
      if (!dy) continue;
      k.style.transition = "none";
      k.style.transform = `translateY(${dy}px)`;
      requestAnimationFrame(() => {
        k.style.transition = "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)";
        k.style.transform = "";
      });
    }
  }

  // ---- Sliding tab ink ----------------------------------------------------
  // One absolutely placed pill per tab bar, moved under the active button.
  // Re-placed when a button's class changes, when buttons are re-rendered,
  // and when the bar is resized (e.g. its pane is shown after being hidden,
  // when every offset was 0).
  const TAB_BARS = [
    [".market-tabs", "button.active"],
    [".range-tabs", "button.active"],
    [".ov-ex", "button.active"],
    [".segmented", "button.on"],
  ];
  function inkTabs(bar, activeSel) {
    if (bar.dataset.ink) return;
    bar.dataset.ink = "1";
    bar.classList.add("has-ink");
    const ink = document.createElement("span");
    ink.className = "tab-ink";
    ink.setAttribute("aria-hidden", "true");
    let placed = false;
    const place = () => {
      if (!ink.isConnected) bar.prepend(ink); // bar.innerHTML was re-rendered
      const a = bar.querySelector(activeSel);
      if (!a || !a.offsetWidth) {
        ink.style.opacity = "0";
        return;
      }
      // First placement (and after being hidden) jumps; later ones slide.
      ink.style.transition = placed && !reduced() ? "" : "none";
      ink.style.opacity = "1";
      ink.style.transform = `translate(${a.offsetLeft}px, ${a.offsetTop}px)`;
      ink.style.width = `${a.offsetWidth}px`;
      ink.style.height = `${a.offsetHeight}px`;
      placed = true;
    };
    place();
    new MutationObserver(place).observe(bar, { subtree: true, childList: true, attributes: true, attributeFilter: ["class"] });
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        placed = false;
        place();
      }).observe(bar);
    }
  }
  function scanTabs() {
    for (const [sel, active] of TAB_BARS) document.querySelectorAll(sel).forEach((bar) => inkTabs(bar, active));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scanTabs);
  else scanTabs();

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

  return { reduced, flash, countUp, toast, swap, leave, flip };
})();
