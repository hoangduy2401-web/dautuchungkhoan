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

  // ---- Chọn driver (GĐ 5.4) ------------------------------------------------
  //
  // Vấn đề thứ tự: các trang gọi `Store.list()` ngay lúc DOMContentLoaded,
  // nhưng biết đã đăng nhập hay chưa lại là việc bất đồng bộ. Hỏi nhanh quá thì
  // câu trả lời là "chưa" và trang đọc nhầm localStorage trong khi dữ liệu thật
  // nằm ở DB — trông y hệt mất dữ liệu.
  //
  // Cách xử: MỌI hàm công khai chờ `ready` trước khi chạm driver. Các hàm này
  // vốn đã async từ GĐ 0 nên thêm một `await` ở đầu là không trang nào thấy
  // khác biệt — đây chính là khoản đầu tư từ GĐ 0 được dùng.
  let backend = null; // null = driver localStorage bên dưới
  let resolveReady;
  const ready = new Promise((r) => (resolveReady = r));

  function supabaseWanted() {
    return !!(
      typeof APP_CONFIG !== "undefined" &&
      APP_CONFIG.supabase &&
      APP_CONFIG.supabase.STORE_ENABLED &&
      typeof SupabaseDriver !== "undefined" &&
      typeof Auth !== "undefined"
    );
  }

  // Cờ đọc được từ ngoài: STORE_ENABLED đang bật mà chưa đăng nhập.
  //
  // Lúc đó trang VẪN đọc localStorage — chặn hẳn thì mở máy mới là trang trắng,
  // tệ hơn. Nhưng nó KHÔNG được phép im lặng: dữ liệu thật đang ở DB, còn
  // localStorage của máy này có thể là bản cũ (đọc ra thì sai) hoặc rỗng (thì
  // tưởng mất sạch). `nav.js` đọc cờ này để hiện dải cảnh báo trên mọi trang.
  let needsLogin = false;

  async function decideDriver() {
    needsLogin = false;
    if (!supabaseWanted()) return null;
    try {
      const s = await Auth.session();
      needsLogin = !s;
      return s ? SupabaseDriver : null;
    } catch (err) {
      console.warn("[Store] không hỏi được phiên đăng nhập:", err.message);
      needsLogin = true;
      return null;
    }
  }

  // Quyết định sau khi mọi script khác đã nạp (store.js đứng trước auth.js
  // trong HTML), rồi quyết lại mỗi lần đăng nhập / đăng xuất.
  function initDriver() {
    decideDriver().then((d) => {
      backend = d;
      resolveReady();
      if (supabaseWanted()) {
        Auth.onChange(async () => {
          backend = await decideDriver();
          // Đăng nhập/đăng xuất giữa chừng thì dải cảnh báo phải đổi theo, chứ
          // không đợi tải lại trang.
          if (typeof Nav !== "undefined") Nav.renderLoginWarning();
        });
      }
    });
  }

  if (typeof document !== "undefined") {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", initDriver);
    } else {
      initDriver();
    }
  } else {
    resolveReady();
  }

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
  //
  // Mỗi hàm `await ready` rồi hỏi `backend`: có driver Supabase thì giao cho
  // nó, không thì chạy phần localStorage ngay bên dưới.

  async function list(collection) {
    await ready;
    if (backend) return backend.list(collection);
    return readRaw(collection);
  }

  async function add(collection, row) {
    await ready;
    if (backend) return backend.add(collection, row);
    const rows = readRaw(collection);
    const withId = { id: row.id || newId(), ...row };
    rows.push(withId);
    writeRaw(collection, rows);
    return withId;
  }

  async function update(collection, id, patch) {
    await ready;
    if (backend) return backend.update(collection, id, patch);
    const rows = readRaw(collection);
    const i = rows.findIndex((r) => r.id === id);
    if (i === -1) return null;
    rows[i] = { ...rows[i], ...patch, id };
    writeRaw(collection, rows);
    return rows[i];
  }

  async function remove(collection, id) {
    await ready;
    if (backend) return backend.remove(collection, id);
    const rows = readRaw(collection);
    const next = rows.filter((r) => r.id !== id);
    if (next.length === rows.length) return false;
    writeRaw(collection, next);
    return true;
  }

  // Replace the whole collection. Needed for ordered lists (watchlist drag) and
  // for the phase-5 import; prefer add/update/remove for everything else.
  async function replace(collection, rows) {
    await ready;
    if (backend) return backend.replace(collection, rows);
    writeRaw(collection, Array.isArray(rows) ? rows : []);
    return rows;
  }

  // Đăng ký đồng bộ (các trang gọi lúc dựng giao diện, không await được), nên
  // gắn vào CẢ HAI driver: driver nào đang chạy thì handler vẫn được gọi.
  function onChange(collection, handler) {
    if (!listeners.has(collection)) listeners.set(collection, new Set());
    listeners.get(collection).add(handler);
    let offRemote = null;
    ready.then(() => {
      if (backend) offRemote = backend.onChange(collection, handler);
    });
    return () => {
      listeners.get(collection).delete(handler);
      if (offRemote) offRemote();
    };
  }

  // ---- Settings: single object, not a list ----
  async function getSetting(name, fallback = null) {
    await ready;
    if (backend) return backend.getSetting(name, fallback);
    try {
      const raw = localStorage.getItem(PREFIX + "settings");
      const obj = raw ? JSON.parse(raw) : {};
      return name in obj ? obj[name] : fallback;
    } catch {
      return fallback;
    }
  }

  async function setSetting(name, value) {
    await ready;
    if (backend) return backend.setSetting(name, value);
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
    await ready;
    if (backend) return backend.exportAll();
    return exportLocal();
  }

  // Đọc THẲNG localStorage, bỏ qua driver đang chạy. Màn hình nhập dữ liệu ở
  // 5.5 cần đúng thứ này: lúc đó driver đã là Supabase, mà nguồn cần nhập lại
  // nằm ở localStorage. Dùng `exportAll()` khi ấy sẽ xuất ra chính cái DB rỗng
  // đang định nhập vào — vòng tròn, và không ai nhận ra cho tới lúc mất dữ liệu.
  function exportLocal() {
    const out = {};
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith(PREFIX) || Object.values(LEGACY_KEYS).includes(k)) {
        out[k] = localStorage.getItem(k);
      }
    }
    return { exportedAt: new Date().toISOString(), data: out };
  }

  return {
    // Getter chứ không phải chuỗi cố định: driver chốt sau khi hỏi xong phiên
    // đăng nhập, nên đọc lúc nạp trang sẽ luôn ra "localStorage".
    get driver() {
      return backend ? backend.driver : "localStorage";
    },
    // true = đang đọc localStorage TRONG KHI dữ liệu thật nằm ở Supabase.
    get needsLogin() {
      return needsLogin;
    },
    ready,
    list,
    add,
    update,
    remove,
    replace,
    onChange,
    getSetting,
    setSetting,
    exportAll,
    exportLocal,
  };
})();

if (typeof module !== "undefined") module.exports = Store;
