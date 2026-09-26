// ============================================================
// NUM INPUT — live thousands grouping while typing, Vietnamese style:
// "." groups thousands, "," is the decimal mark ("1.234.567,5").
//
// Opt-in per field with an attribute, so nothing else on the page changes:
//   data-num="int"  whole numbers (VND amounts, share counts)
//   data-num="dec"  decimals allowed (coin/gold quantity, % rate, price)
// One delegated listener on `document` covers fields created later (the
// inline edit inputs in holdings tables), so templates only add the attribute.
//
// The formatted text is exactly what every page's parseAmount()/parseVnd()
// already reads (they accept "1.234.567,5"), so the read side is unchanged.
//
// In "dec" fields the user never types grouping dots (they are inserted
// automatically), so a typed "." is taken as the decimal mark and turned
// into "," — phones on an English keyboard only offer "." on the decimal pad.
// Pasted text is parsed as a whole (it may carry its own separators) and
// re-formatted.
// ============================================================

const NumInput = (function () {
  const group = (digits) =>
    digits.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");

  // Loose parser shared by paste handling and callers without their own
  // parseAmount: accepts "1.234,5" (VN), "1,234.5" (EN), "1.000.000", "26.5".
  function parse(s) {
    const raw = String(s ?? "").trim().replace(/\s/g, "");
    if (!raw) return null;
    const commas = (raw.match(/,/g) || []).length;
    let cleaned;
    if (commas === 1 && raw.lastIndexOf(",") > raw.lastIndexOf(".")) {
      cleaned = raw.replace(/\./g, "").replace(",", "."); // VN: dot groups
    } else if (commas > 0) {
      cleaned = raw.replace(/,/g, ""); // EN: comma groups
    } else if (/^\d{1,3}(\.\d{3})+$/.test(raw)) {
      cleaned = raw.replace(/\./g, ""); // "1.000.000"
    } else {
      cleaned = raw;
    }
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : null;
  }

  // Format already-typed text (grouping dots + at most one decimal comma).
  function formatText(text, mode) {
    if (mode === "int") return group(String(text).replace(/\D/g, ""));
    const s = String(text);
    const i = s.indexOf(",");
    const intDigits = (i < 0 ? s : s.slice(0, i)).replace(/\D/g, "");
    if (i < 0) return group(intDigits);
    const decDigits = s.slice(i + 1).replace(/\D/g, "");
    return (intDigits ? group(intDigits) : "0") + "," + decDigits;
  }

  // Format a number (used after paste).
  function formatNumber(n, mode) {
    if (n === null) return "";
    if (mode === "int") return group(String(Math.round(Math.abs(n))));
    const [i, d] = String(Math.abs(n)).split(".");
    return group(i) + (d ? "," + d : "");
  }

  // Count digits and commas before `pos` — the characters that survive
  // formatting — so the caret can be put back after the same ones.
  const significantBefore = (s, pos) => (s.slice(0, pos).match(/[\d,]/g) || []).length;
  function caretAfter(s, count) {
    if (count === 0) return 0;
    let seen = 0;
    for (let k = 0; k < s.length; k++) {
      if (/[\d,]/.test(s[k]) && ++seen === count) return k + 1;
    }
    return s.length;
  }

  function onInput(e) {
    const el = e.target;
    const mode = el && el.dataset && el.dataset.num;
    if (mode !== "int" && mode !== "dec") return;

    let value = el.value;
    let caret = el.selectionStart ?? value.length;

    if (e.inputType === "insertFromPaste" || e.inputType === "insertFromDrop") {
      el.value = formatNumber(parse(value), mode);
      el.setSelectionRange(el.value.length, el.value.length);
      return;
    }
    // In a decimal field a "." the user inserted is the decimal mark (see
    // header). Find what was inserted by diffing against the value captured
    // in `beforeinput` — works whether the browser delivers one char or a
    // whole string per event (IME, autofill, some keyboards). Grouping dots
    // that were already there are left alone. If a comma already exists the
    // extra dot is simply dropped by formatText.
    if (mode === "dec") {
      const prev = el._numPrev ?? "";
      let a = 0;
      while (a < prev.length && a < value.length && prev[a] === value[a]) a++;
      let bp = prev.length;
      let bv = value.length;
      while (bp > a && bv > a && prev[bp - 1] === value[bv - 1]) {
        bp--;
        bv--;
      }
      const inserted = value.slice(a, bv);
      const outside = value.slice(0, a) + value.slice(bv);
      if (inserted.includes(".") && !outside.includes(",") && !inserted.includes(",")) {
        value = value.slice(0, a) + inserted.replace(".", ",") + value.slice(bv);
      }
    }

    // Deleting a grouping dot alone would be undone by re-formatting (the
    // caret just hops over it). Treat it as deleting the digit next to it.
    const prev = el._numPrev ?? "";
    if (prev.length === value.length + 1 && prev[caret] === "." && prev.slice(0, caret) + prev.slice(caret + 1) === value) {
      if (e.inputType === "deleteContentBackward" && caret > 0) {
        value = value.slice(0, caret - 1) + value.slice(caret);
        caret -= 1;
      } else if (e.inputType === "deleteContentForward") {
        value = value.slice(0, caret) + value.slice(caret + 1);
      }
    }

    const count = significantBefore(value, caret);
    const next = formatText(value, mode);
    if (next === el.value) return;
    el.value = next;
    const pos = caretAfter(next, count);
    try {
      el.setSelectionRange(pos, pos);
    } catch (err) {
      /* input types without selection support — nothing to restore */
    }
  }

  // Remember the value BEFORE each edit so onInput can tell which characters
  // were just inserted.
  document.addEventListener(
    "beforeinput",
    (e) => {
      const el = e.target;
      if (el && el.dataset && el.dataset.num) el._numPrev = el.value;
    },
    true
  );
  document.addEventListener("input", onInput, true);

  return { parse, formatText, formatNumber };
})();
