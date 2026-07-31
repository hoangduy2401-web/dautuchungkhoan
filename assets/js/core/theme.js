// ============================================================
// THEME — Sáng/Tối toggle + Trong/Đục glass slider + header clock.
// Shared by every page; moved out of the stock page in phase 0 so the other
// five pages get identical chrome without copying code.
// ============================================================

// Per-theme glass alpha range for the slider (0 = Trong/clear, 100 = Đục).
const GLASS = {
  light: { min: 0.20, max: 0.85, raiseDelta: 0.18, def: 29 },
  dark: { min: 0.02, max: 0.22, raiseDelta: 0.045, def: 15 },
};
let currentTheme = document.documentElement.getAttribute("data-theme") || "light";

function setGlass(v) {
  const g = GLASS[currentTheme] || GLASS.light;
  const a = g.min + (g.max - g.min) * (v / 100);
  const root = document.documentElement;
  root.style.setProperty("--glass-a", a.toFixed(3));
  root.style.setProperty("--glass-raised-a", Math.min(a + g.raiseDelta, 0.98).toFixed(3));
}

function setTheme(t) {
  currentTheme = t;
  document.documentElement.setAttribute("data-theme", t);
  const dark = document.getElementById("tDark");
  const light = document.getElementById("tLight");
  if (dark) dark.classList.toggle("on", t === "dark");
  if (light) light.classList.toggle("on", t === "light");
  const range = document.getElementById("glassRange");
  if (range) { range.value = GLASS[t].def; setGlass(range.value); }
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
  const range = document.getElementById("glassRange");
  if (light) light.addEventListener("click", () => setTheme("light"));
  if (dark) dark.addEventListener("click", () => setTheme("dark"));
  if (range) range.addEventListener("input", (e) => setGlass(e.target.value));
  setTheme(currentTheme); // sync button state + slider + glass to the initial theme
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
