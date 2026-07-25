/**
 * Chỉ báo & tín hiệu kỹ thuật theo phương pháp luận FiinTrade (Tier 1).
 *
 * Tách riêng khỏi `chartModule.js` và `app.js` vì cả hai đều dùng: chart cần
 * badge cho mã đang chọn, app.js cần quét cả rổ trong tab "Tín hiệu".
 *
 * Toàn bộ tính từ mảng OHLCV `[{date, open, high, low, close, volume}]` tăng
 * dần — đúng format `/api/price/history` trả về. Không gọi API nào.
 *
 * 5 chỗ cố ý làm khác tài liệu FiinTrade (user đã chốt 25/07/2026) — xem
 * CLAUDE.md mục 6 "Tín hiệu FiinTrade". Đừng "sửa lại cho đúng tài liệu".
 */

const Signals = (function () {
  const BULL = "Tăng", NEU = "Trung tính", BEAR = "Giảm";

  // Ma trận tổng hợp của FiinTrade: hàng = nhóm Chỉ tiêu (B), cột = nhóm TB Động (A).
  const MATRIX = {
    [BULL]: { [BULL]: "Tăng mạnh", [NEU]: "Tăng", [BEAR]: "Trung tính" },
    [NEU]: { [BULL]: "Tăng", [NEU]: "Trung tính", [BEAR]: "Giảm" },
    [BEAR]: { [BULL]: "Trung tính", [NEU]: "Giảm", [BEAR]: "Giảm mạnh" },
  };

  // Thứ tự để sắp xếp bảng: tích cực nhất lên đầu.
  const RANK = { "Tăng mạnh": 0, "Tăng": 1, "Trung tính": 2, "Giảm": 3, "Giảm mạnh": 4 };

  // Số nến tối thiểu để mọi chỉ báo trong bộ đều có giá trị (CMF cần 20).
  const MIN_BARS = 25;

  /* ---------------- chỉ báo ---------------- */

  function sma(values, period) {
    return values.map((_, i) => {
      if (i < period - 1) return null;
      let s = 0;
      for (let k = i - period + 1; k <= i; k++) s += values[k];
      return s / period;
    });
  }

  // Wilder RSI — giữ nguyên phép tính của `chartModule.js` để chart và bảng
  // tín hiệu không bao giờ hiện 2 con số khác nhau cho cùng một mã.
  function rsi(closes, period) {
    const out = new Array(closes.length).fill(null);
    let gains = 0, losses = 0, avgG, avgL;
    for (let i = 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      if (i <= period) {
        if (diff >= 0) gains += diff; else losses -= diff;
        if (i === period) {
          avgG = gains / period; avgL = losses / period;
          out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
        }
        continue;
      }
      const g = diff > 0 ? diff : 0, l = diff < 0 ? -diff : 0;
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
    return out;
  }

  // Chaikin Money Flow. CLV không xác định khi high === low (nến doji) —
  // quy ước chuẩn là coi bằng 0 thay vì chia cho 0.
  function cmf(bars, period) {
    const out = new Array(bars.length).fill(null);
    for (let i = period - 1; i < bars.length; i++) {
      let mfv = 0, vol = 0;
      for (let k = i - period + 1; k <= i; k++) {
        const b = bars[k];
        const range = b.high - b.low;
        const clv = range === 0 ? 0 : ((b.close - b.low) - (b.high - b.close)) / range;
        mfv += clv * b.volume;
        vol += b.volume;
      }
      out[i] = vol === 0 ? 0 : mfv / vol;
    }
    return out;
  }

  function roc(closes, period) {
    return closes.map((c, i) => (i < period || !closes[i - period] ? null : (c / closes[i - period] - 1) * 100));
  }

  /* ---------------- gộp nến ngày -> tuần ---------------- */

  function isoWeekKey(dateStr) {
    const d = new Date(dateStr + "T00:00:00Z");
    const day = (d.getUTCDay() + 6) % 7;        // thứ 2 = 0
    d.setUTCDate(d.getUTCDate() - day + 3);      // thứ 5 của tuần đó
    const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
    const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
    return d.getUTCFullYear() + "-W" + String(week).padStart(2, "0");
  }

  function toWeekly(bars) {
    const out = [];
    let cur = null, key = null;
    for (const b of bars) {
      const k = isoWeekKey(b.date);
      if (k !== key) {
        if (cur) out.push(cur);
        key = k;
        cur = { date: b.date, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume };
      } else {
        cur.high = Math.max(cur.high, b.high);
        cur.low = Math.min(cur.low, b.low);
        cur.close = b.close;
        cur.volume += b.volume;
        cur.date = b.date;                       // nhãn tuần = phiên cuối cùng của tuần
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  /* ---------------- tín hiệu tổng hợp ---------------- */

  // SAI LỆCH #2: tài liệu nói RSI "vượt lên 30" / "cắt xuống 70". Hiểu đúng
  // nghĩa đen thì tín hiệu chỉ sống 1 phiên và gần như mọi mã luôn Trung tính,
  // nên cho nó còn hiệu lực trong `window` phiên kể từ lúc cắt.
  function crossedUp(series, level, window) {
    for (let i = series.length - 1; i >= Math.max(1, series.length - window); i--) {
      if (series[i] != null && series[i - 1] != null && series[i - 1] <= level && series[i] > level) return true;
    }
    return false;
  }
  function crossedDown(series, level, window) {
    for (let i = series.length - 1; i >= Math.max(1, series.length - window); i--) {
      if (series[i] != null && series[i - 1] != null && series[i - 1] >= level && series[i] < level) return true;
    }
    return false;
  }

  /**
   * @param bars   OHLCV tăng dần
   * @param window số phiên tín hiệu RSI còn hiệu lực (mặc định 3)
   * @returns null nếu không đủ nến, ngược lại là các chỉ báo + 3 mức tín hiệu
   */
  function compute(bars, window = 3) {
    if (!Array.isArray(bars) || bars.length < MIN_BARS) return null;
    const closes = bars.map((b) => b.close);
    const ma5 = sma(closes, 5);
    const r = rsi(closes, 14);
    const c = cmf(bars, 20);
    const o = roc(closes, 9);
    const i = bars.length - 1;
    const price = closes[i];

    // Nhóm A — trung bình động (tài liệu chỉ dùng MA(5)).
    const maSig = ma5[i] == null ? NEU : price > ma5[i] ? BULL : price < ma5[i] ? BEAR : NEU;

    // Nhóm B — 3 chỉ báo dao động, lấy đa số.
    let rsiSig = NEU;
    if (crossedUp(r, 30, window)) rsiSig = BULL;
    else if (crossedDown(r, 70, window)) rsiSig = BEAR;

    const cmfSig = c[i] == null ? NEU : c[i] > 0 ? BULL : c[i] < 0 ? BEAR : NEU;
    // SAI LỆCH #1: tài liệu ghi ngưỡng 30/70 cho ROC — chép nhầm từ dòng RSI.
    // ROC không bị chặn 0–100, nó dao động quanh 0 nên ngưỡng đúng là 0.
    const rocSig = o[i] == null ? NEU : o[i] > 0 ? BULL : o[i] < 0 ? BEAR : NEU;

    const votes = [rsiSig, cmfSig, rocSig];
    const nb = votes.filter((v) => v === BULL).length;
    const nr = votes.filter((v) => v === BEAR).length;
    const indSig = nb > nr ? BULL : nb < nr ? BEAR : NEU;

    return {
      price, ma5: ma5[i], rsi: r[i], cmf: c[i], roc: o[i],
      maSig, rsiSig, cmfSig, rocSig, indSig,
      summary: MATRIX[indSig][maSig],
    };
  }

  /* ---------------- giá – khối lượng ---------------- */

  // SAI LỆCH #3: FiinTrade quy đổi khối lượng trong phiên ra cả phiên để bắt
  // đột biến ngay lúc đang giao dịch. Backend chỉ có snapshot cuối ngày nên
  // mọi so sánh ở đây dùng phiên gần nhất ĐÃ đóng cửa.
  function streaks(bars) {
    const n = bars.length;
    let upDays = 0, downDays = 0, volUp = 0;
    for (let i = n - 1; i > 0; i--) { if (bars[i].close > bars[i - 1].close) upDays++; else break; }
    for (let i = n - 1; i > 0; i--) { if (bars[i].close < bars[i - 1].close) downDays++; else break; }
    for (let i = n - 1; i > 0; i--) { if (bars[i].volume > bars[i - 1].volume) volUp++; else break; }
    const startIdx = n - 1 - volUp;               // nến ngay trước khi chuỗi KL bắt đầu
    const priceVsStart = volUp > 0 && startIdx >= 0 ? bars[n - 1].close - bars[startIdx].close : 0;
    return { upDays, downDays, volUp, priceVsStart };
  }

  /* ---------------- chiến lược TA ---------------- */

  function volRatio(bars) {
    const n = bars.length;
    if (n < 12) return null;
    let s = 0;
    for (let i = n - 11; i <= n - 1; i++) s += bars[i].volume;  // 10 phiên trước phiên cuối
    const avg = s / 10;
    return avg === 0 ? null : bars[n - 1].volume / avg;
  }

  function pctChange(bars) {
    const n = bars.length;
    return n < 2 ? 0 : (bars[n - 1].close / bars[n - 2].close - 1) * 100;
  }

  // SAI LỆCH #5: đỉnh/đáy so theo GIÁ ĐÓNG CỬA (user chốt), không theo giá cao
  // nhất/thấp nhất trong phiên. Đo trên VN30 khung 1 tháng: theo đóng cửa ra 10
  // mã thủng đáy, theo giá thấp nhất phiên chỉ ra 1 mã.
  function extremes(bars, months) {
    const need = Math.round(months * 21);          // ~21 phiên/tháng
    const slice = bars.slice(Math.max(0, bars.length - 1 - need), bars.length - 1); // bỏ phiên cuối
    if (!slice.length) return null;
    return {
      high: Math.max(...slice.map((b) => b.close)),
      low: Math.min(...slice.map((b) => b.close)),
      n: slice.length,
    };
  }

  function periodReturn(bars, period) {
    const back = period === "D" ? 1 : period === "W" ? 5 : 21;
    const n = bars.length;
    return n <= back ? null : (bars[n - 1].close / bars[n - 1 - back].close - 1) * 100;
  }

  function avgVolume(bars, n) {
    const s = bars.slice(-n);
    return s.length ? s.reduce((a, b) => a + b.volume, 0) / s.length : 0;
  }

  return {
    BULL, NEU, BEAR, RANK, MIN_BARS,
    sma, rsi, cmf, roc,
    toWeekly, compute, streaks,
    volRatio, pctChange, extremes, periodReturn, avgVolume,
  };
})();
