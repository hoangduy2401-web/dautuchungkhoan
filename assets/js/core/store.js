// ============================================================
// STORE — the ONLY way any page reads or writes user data.
//
// Pages never touch localStorage or Supabase directly. That indirection is the
// whole point: the driver underneath swaps from localStorage to Supabase in
// phase 5 of docs/QUYHOACH.md, and no page has to change.
//
// EVERY method returns a Promise, including on the localStorage driver where it
// is not technically needed. Supabase is async; if callers were written against
// synchronous returns now, every one of them would need rewriting later. This is
// the single easiest thing to get wrong here, and the most expensive to fix.
//
// Collections (see QUYHOACH 3.4):
//   tx_stock · holdings_gold · holdings_fx · holdings_crypto
//   savings_accounts · cash_flows · settings
// ============================================================

const Store = (function () {
  const PREFIX = "vn_gs_"; // gia san

  // Legacy keys from the single-page dashboard. Kept so existing users do not
  // lose their watchlist/transactions when the app becomes multi-page.
  const LEGACY_KEYS = {
    tx_stock: "vn_dashboard_transactions_v1",
    watchlist: "vn_dashboard_watchlist_v1",
  };

  const listeners = new Map(); // collection -> Set<handler>

  function keyFor(collection) {
    return LEGACY_KEYS[collection] || PREFIX + collection;
  }

  function readRaw(collection) {
    try {
      const raw = localStorage.getItem(keyFor(collection));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      // Corrupt JSON must not take the page down with it.
      console.warn(`[Store] ${collection} hỏng, coi như rỗng:`, err.message);
      return [];
    }
  }

  function writeRaw(collection, rows) {
    localStorage.setItem(keyFor(collection), JSON.stringify(rows));
    emit(collection, rows);
  }

  function emit(collection, rows) {
    const set = listeners.get(collection);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(rows);
      } catch (err) {
        console.warn("[Store] listener lỗi:", err.message);
      }
    }
  }

  // Ids only have to be unique within one browser, so a timestamp plus a random
  // suffix is enough — no need to pull in a uuid library.
  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // ---- Public API (all async on purpose — see header) ----

  async function list(collection) {
    return readRaw(collection);
  }

  async function add(collection, row) {
    const rows = readRaw(collection);
    const withId = { id: row.id || newId(), ...row };
    rows.push(withId);
    writeRaw(collection, rows);
    return withId;
  }

  async function update(collection, id, patch) {
    const rows = readRaw(collection);
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return null;
    rows[i] = { ...rows[i], ...patch, id };
    writeRaw(collection, rows);
    return rows[i];
  }

  async function remove(collection, id) {
    const rows = readRaw(collection);
    const next = rows.filter((r) => r.id !== id);
    if (next.length === rows.length) return false;
    writeRaw(collection, next);
    return true;
  }

  // Replace the whole collection. Needed for ordered lists (watchlist drag) and
  // for the phase-5 import; prefer add/update/remove for everything else.
  async function replace(collection, rows) {
    writeRaw(collection, Array.isArray(rows) ? rows : []);
    return rows;
  }

  function onChange(collection, handler) {
    if (!listeners.has(collection)) listeners.set(collection, new Set());
    listeners.get(collection).add(handler);
    return () => listeners.get(collection).delete(handler); // unsubscribe
  }

  // ---- Settings: single object, not a list ----
  async function getSetting(name, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + "settings");
      const obj = raw ? JSON.parse(raw) : {};
      return name in obj ? obj[name] : fallback;
    } catch {
      return fallback;
    }
  }

  async function setSetting(name, value) {
    let obj = {};
    try {
      const raw = localStorage.getItem(PREFIX + "settings");
      obj = raw ? JSON.parse(raw) : {};
    } catch {
      obj = {};
    }
    obj[name] = value;
    localStorage.setItem(PREFIX + "settings", JSON.stringify(obj));
    emit("settings", obj);
    return value;
  }

  // Full dump / restore. The escape hatch that keeps the data portable no
  // matter which driver is active — used by the phase-5 migration and by the
  // manual backup button.
  async function exportAll() {
    const out = {};
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX) || Object.values(LEGACY_KEYS).includes(k)) {
        out[k] = localStorage.getItem(k);
      }
    }
    return { exportedAt: new Date().toISOString(), data: out };
  }

  return {
    driver: "localStorage",
    list,
    add,
    update,
    remove,
    replace,
    onChange,
    getSetting,
    setSetting,
    exportAll,
  };
})();

if (typeof module !== "undefined") module.exports = Store;
