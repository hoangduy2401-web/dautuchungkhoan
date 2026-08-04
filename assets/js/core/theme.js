// ============================================================
// THEME — Sáng/Tối toggle + header clock.
// Shared by every page; moved out of the stock page in phase 0 so the other
// five pages get identical chrome without copying code.
// Reskin Fey 03/08/2026: bề mặt phẳng đục, không còn kính -> slider Trong/Đục
// (và biến --glass-a) đã bỏ hẳn. Mặc định giờ là TỐI, theo design.
// ============================================================

let currentTheme = document.documentElement.getAttribute("data-theme") || "dark";

function setTheme(t) {
  currentTheme = t;
  document.documentElement.setAttribute("data-theme", t);
  const dark = document.getElementById("tDark");
  const light = document.getElementById("tLight");
  if (dark) dark.classList.toggle("on", t === "dark");
  if (light) light.classList.toggle("on", t === "light");
  // Chart colours (grid/text) come from CSS vars — re-apply after theme swap.
  // `typeof ChartModule` guard, not just the method: pages without a chart never
  // load chartModule.js, and a bare `ChartModule.x` there is a ReferenceError
  // that kills the rest of the boot sequence.
  if (typeof ChartModule !== "undefined" && typeof ChartModule.applyTheme === "function") {
    ChartModule.applyTheme();
  }
}

function wireThemeControls() {
  const light = document.getElementById("tLight");
  const dark = document.getElementById("tDark");
  if (light) light.addEventListener("click", () => setTheme("light"));
  if (dark) dark.addEventListener("click", () => setTheme("dark"));
  setTheme(currentTheme); // sync button state to the initial theme
}

function tickClock() {
  const el = document.getElementById("clock");
  if (el) el.textContent = new Date().toLocaleString("vi-VN");
}

// Pages that only need the standard chrome (no data loading) can stop here.
function initChrome() {
  wireThemeControls();
  tickClock();
  setInterval(tickClock, 1000);
}
