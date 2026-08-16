// ============================================================
// PORTFOLIO — personal transaction log. Backed by Store (collection
// `tx_stock`), so it follows Store from localStorage to Supabase in phase 5
// without any page having to change.
//
// Public API is stable: list / add / remove / computeHoldings — do not change
// the signatures.
//
// Why there is an in-memory cache: Store is async (it has to be — Supabase is),
// but `list()` and `computeHoldings()` are called from render functions that run
// synchronously. So the rows are held in memory and `load()` hydrates them once
// at boot. Reads stay synchronous; writes go through Store and refresh the cache.
//
// CALLERS MUST `await Portfolio.load()` BEFORE THE FIRST RENDER, otherwise the
// first paint shows an empty portfolio and only fills in on the next refresh.
// ============================================================

const Portfolio = (function () {
  const COLLECTION = "tx_stock";
  let cache = [];
  let loaded = false;

  // Normalise on the way in so callers cannot store a half-typed transaction.
  function normalise(tx) {
    return {
      symbol: String(tx.symbol || "").trim().toUpperCase(),
      type: tx.type === "sell" ? "sell" : "buy",
      qty: Number(tx.qty) || 0,
      price: Number(tx.price) || 0,
      date: tx.date || new Date().toISOString().slice(0, 10),
      note: tx.note || "",
    };
  }

  async function load() {
    cache = await Store.list(COLLECTION);
    loaded = true;
    return cache;
  }

  function list() {
    if (!loaded) console.warn("[Portfolio] list() gọi trước load() — trả rỗng");
    return cache;
  }

  // tx: {symbol, type: "buy"|"sell", qty, price, date, note}
  async function add(tx) {
    const row = await Store.add(COLLECTION, normalise(tx));
    cache = await Store.list(COLLECTION);
    return row;
  }

  async function remove(id) {
    const ok = await Store.remove(COLLECTION, id);
    cache = await Store.list(COLLECTION);
    return ok;
  }

  // Returns [{symbol, qty, avgCost, currentPrice, marketValue,
  //           unrealizedPL, unrealizedPLPct, realizedPL}]
  // for symbols currently held (qty > 0). Pure computation over the cache.
  function computeHoldings(currentPrices) {
    const bySymbol = {};

    // Process chronologically so weighted-average cost is correct.
    const txs = cache.slice().sort((a, b) => new Date(a.date) - new Date(b.date));

    txs.forEach((t) => {
      const s = (bySymbol[t.symbol] = bySymbol[t.symbol] || {
        symbol: t.symbol,
        qty: 0,
        avgCost: 0,
        realizedPL: 0,
      });

      if (t.type === "buy") {
        // New weighted-average cost after adding shares.
        const totalCost = s.avgCost * s.qty + t.price * t.qty;
        s.qty += t.qty;
        s.avgCost = s.qty > 0 ? totalCost / s.qty : 0;
      } else {
        // Sell: realize P&L against current average cost; qty unchanged cost.
        const sellQty = Math.min(t.qty, s.qty);
        s.realizedPL += (t.price - s.avgCost) * sellQty;
        s.qty -= sellQty;
        if (s.qty <= 0) {
          s.qty = 0;
          s.avgCost = 0;
        }
      }
    });

    return Object.values(bySymbol)
      .filter((s) => s.qty > 0 || s.realizedPL !== 0)
      .map((s) => {
        // THIẾU GIÁ THÌ TRẢ null, KHÔNG rơi về giá vốn.
        //
        // Bản cũ dùng `|| s.avgCost`: mã không có quote (ngoài watchlist và
        // VN30) được định giá bằng chính giá vốn, nên lãi/lỗ ra đúng 0 và giá
        // trị danh mục trông vẫn hợp lý. Con số tổng vì thế SAI mà không có
        // một dấu hiệu nào — đúng loại lỗi mà "luật vàng" ở mục 3 cấm.
        //
        // Chỗ gọi phải tự xử null: hiện "—" và loại khỏi phép cộng.
        // GIÁ 0 CŨNG LÀ "KHÔNG CÓ GIÁ", không phải giá bằng không.
        //
        // SSI trả `{price: 0, changePct: 0, volume: 0}` cho mã không tồn tại
        // thay vì báo lỗi — đã đo với mã bịa "ZZZ" (16/08). Nhận 0 làm giá thật
        // thì mã đó hiện lỗ -100% và kéo tụt tổng danh mục đúng bằng giá vốn.
        // Cổ phiếu đang giao dịch không bao giờ có giá 0.
        const raw = currentPrices ? currentPrices[s.symbol] : undefined;
        const n = raw === undefined || raw === null ? NaN : Number(raw);
        const currentPrice = Number.isFinite(n) && n > 0 ? n : null;
        const marketValue = currentPrice === null ? null : (s.qty * currentPrice) / 1000; // -> triệu đồng
        const unrealizedPL =
          currentPrice === null ? null : (s.qty * (currentPrice - s.avgCost)) / 1000;
        const unrealizedPLPct =
          currentPrice === null || !(s.avgCost > 0)
            ? null
            : ((currentPrice - s.avgCost) / s.avgCost) * 100;
        return {
          symbol: s.symbol,
          qty: s.qty,
          avgCost: s.avgCost,
          currentPrice,
          marketValue,
          unrealizedPL,
          unrealizedPLPct,
          realizedPL: s.realizedPL / 1000, // -> triệu đồng
        };
      })
      .filter((h) => h.qty > 0 || h.realizedPL !== 0);
  }

  return { load, list, add, remove, computeHoldings };
})();

if (typeof module !== "undefined") module.exports = Portfolio;
