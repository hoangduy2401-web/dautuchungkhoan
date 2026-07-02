// ============================================================
// PORTFOLIO — personal transaction log in localStorage.
// P&L uses weighted-average cost basis. Public API is stable:
// list / add / remove / computeHoldings — do not change signatures
// (app.js and a future DB backend depend on them).
// ============================================================

const Portfolio = (function () {
  const KEY = "vn_dashboard_transactions_v1";

  function read() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || [];
    } catch {
      return [];
    }
  }
  function write(txs) {
    localStorage.setItem(KEY, JSON.stringify(txs));
  }

  function list() {
    return read();
  }

  // tx: {symbol, type: "buy"|"sell", qty, price, date, note}
  function add(tx) {
    const txs = read();
    txs.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      symbol: String(tx.symbol || "").trim().toUpperCase(),
      type: tx.type === "sell" ? "sell" : "buy",
      qty: Number(tx.qty) || 0,
      price: Number(tx.price) || 0,
      date: tx.date || new Date().toISOString().slice(0, 10),
      note: tx.note || "",
    });
    write(txs);
  }

  function remove(id) {
    write(read().filter((t) => t.id !== id));
  }

  // Returns [{symbol, qty, avgCost, currentPrice, marketValue,
  //           unrealizedPL, unrealizedPLPct, realizedPL}]
  // for symbols currently held (qty > 0).
  function computeHoldings(currentPrices) {
    const bySymbol = {};

    // Process chronologically so weighted-average cost is correct.
    const txs = read().slice().sort((a, b) => new Date(a.date) - new Date(b.date));

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
        const currentPrice = (currentPrices && currentPrices[s.symbol]) || s.avgCost;
        const marketValue = (s.qty * currentPrice) / 1000; // -> triệu đồng
        const unrealizedPL = (s.qty * (currentPrice - s.avgCost)) / 1000;
        const unrealizedPLPct = s.avgCost > 0 ? ((currentPrice - s.avgCost) / s.avgCost) * 100 : 0;
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

  return { list, add, remove, computeHoldings };
})();
