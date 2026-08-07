/**
 * Biểu đồ nến (candlestick) dùng thư viện TradingView Lightweight Charts —
 * hỗ trợ zoom/pan mượt sẵn có (kéo để xem lịch sử, cuộn chuột/chụm để zoom).
 * Thêm: MA10/MA20, khối lượng, RSI(14) (biểu đồ phụ đồng bộ trục thời gian),
 * và 2 công cụ vẽ tay trên lớp canvas phủ (mỗi công cụ 2 điểm click):
 * đường xu hướng (trendline) và thước đo (ruler — số nến + % biến động).
 *
 * Yêu cầu: script lightweight-charts đã được nạp trong index.html
 * (biến toàn cục window.LightweightCharts).
 */

const ChartModule = (function () {
  let priceChart, rsiChart, candleSeries, ma10Series, ma20Series, volumeSeries, rsiSeries;
  let bbUpperSeries, bbBasisSeries, bbLowerSeries;
  // Chỉ số (VNINDEX/VN30/...) không có OHLC — SSI DailyIndex chỉ trả một
  // IndexValue mỗi ngày — nên vẽ bằng đường thay cho nến. Xem CLAUDE.md mục 7.
  let lineSeries;
  let priceContainer, rsiContainer, overlayCanvas, overlayCtx;
  let trendline = null;
  let ruler = null;
  let pendingPoint = null;
  let hoverPoint = null;
  // Drawing mode: null (idle) | "trend" (trendline) | "measure" (ruler).
  // The two tools share the overlay canvas and are mutually exclusive.
  let mode = null;
  let bars = []; // current OHLCV, kept for bar counting + date labels in the ruler
  let dataKey = null; // "SYMBOL|range" of the loaded bars — see setData()
  let resizeObserver;

  // Chart colours live in base.css so both themes are defined in one place.
  // They must be LITERAL hex there — getPropertyValue returns the raw string, so
  // an alias written as var(--x) would come back unresolved. UP/DOWN are also
  // concatenated with an alpha suffix below, which only works on hex.
  function cssColor(name, fallback) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
  }
  let UP = cssColor("--chart-up", "#3ddc97");
  let DOWN = cssColor("--chart-down", "#f0625f");
  let TREND = cssColor("--chart-trend", "#f0a94e");

  // RSI line: chart-series yellow in the design system.
  function accentColor() {
    return cssColor("--chart-rsi", "#e5d26b");
  }

  function sma(values, period) {
    return values.map((_, i) => {
      if (i < period - 1) return null;
      let sum = 0;
      for (let k = i - period + 1; k <= i; k++) sum += values[k];
      return sum / period;
    });
  }

  function bollingerBands(values, period, mult) {
    const basis = sma(values, period);
    const upper = new Array(values.length).fill(null);
    const lower = new Array(values.length).fill(null);
    for (let i = period - 1; i < values.length; i++) {
      let sumSq = 0;
      for (let k = i - period + 1; k <= i; k++) sumSq += (values[k] - basis[i]) ** 2;
      const stdev = Math.sqrt(sumSq / period);
      upper[i] = basis[i] + mult * stdev;
      lower[i] = basis[i] - mult * stdev;
    }
    return { basis, upper, lower };
  }

  function rsiCalc(closes, period) {
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

  function chartTheme() {
    const css = getComputedStyle(document.documentElement);
    return {
      layout: {
        background: { color: "transparent" },
        textColor: css.getPropertyValue("--text-muted").trim() || "#8493b3",
        fontFamily: "'Roboto', 'Inter', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "transparent" },
        horzLines: { color: css.getPropertyValue("--border").trim() || "#223154" },
      },
      // Fixed price-scale width so the price pane and the RSI pane share the
      // exact same left/right plot origin — their time axes stay parallel.
      rightPriceScale: { borderColor: css.getPropertyValue("--border").trim() || "#223154", minimumWidth: 58 },
      timeScale: { borderColor: css.getPropertyValue("--border").trim() || "#223154" },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    };
  }

  function init(priceContainerId, rsiContainerId, overlayCanvasId) {
    priceContainer = document.getElementById(priceContainerId);
    rsiContainer = document.getElementById(rsiContainerId);
    overlayCanvas = document.getElementById(overlayCanvasId);
    overlayCtx = overlayCanvas.getContext("2d");

    // Never create the chart at width 0 (page opened in a background tab, or
    // the panel not laid out yet): the time scale initialised that way stays
    // broken — fitContent/zoom/pan silently do nothing afterwards. A fallback
    // width keeps it valid; resize() applies the real width once it exists.
    priceChart = LightweightCharts.createChart(priceContainer, {
      ...chartTheme(),
      width: priceContainer.clientWidth || 600,
      height: 260,
    });
    candleSeries = priceChart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
    });
    const ma10 = cssColor("--chart-ma10", "#f0a94e");
    const ma20 = cssColor("--chart-ma20", "#a78bfa");
    const boll = cssColor("--chart-boll", "#8a8a8a");
    ma10Series = priceChart.addLineSeries({ color: ma10, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    ma20Series = priceChart.addLineSeries({ color: ma20, lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    bbUpperSeries = priceChart.addLineSeries({ color: boll, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
    bbBasisSeries = priceChart.addLineSeries({ color: boll, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false });
    bbLowerSeries = priceChart.addLineSeries({ color: boll, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
    [bbUpperSeries, bbBasisSeries, bbLowerSeries].forEach((s) => s.applyOptions({ visible: false }));
    // Index line. Created once and toggled, not created per dataset: adding and
    // removing a series on every symbol switch resets the time scale.
    lineSeries = priceChart.addLineSeries({
      color: cssColor("--chart-line", "#f5f5f0"), lineWidth: 2,
      priceLineVisible: false, lastValueVisible: true, visible: false,
    });
    volumeSeries = priceChart.addHistogramSeries({
      priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false,
    });
    priceChart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    rsiChart = LightweightCharts.createChart(rsiContainer, {
      ...chartTheme(),
      width: rsiContainer.clientWidth || 600,
      height: 90,
    });
    // Hide the RSI pane's own time axis — it duplicates the price pane's dates.
    // The two panes stay aligned via the shared price-scale width + logical sync.
    rsiChart.applyOptions({ timeScale: { visible: false } });
    rsiSeries = rsiChart.addLineSeries({
      color: accentColor(), lineWidth: 2, lastValueVisible: false, priceLineVisible: false,
      // Pin the scale to the RSI 0–100 band; without this the line renders off-view.
      autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }),
    });
    rsiChart.priceScale("right").applyOptions({ scaleMargins: { top: 0.12, bottom: 0.12 } });
    // Overbought / oversold reference lines at 70 / 30 — thick enough to read
    // against the candles behind the glass pane.
    rsiSeries.createPriceLine({ price: 70, color: "rgba(90,102,125,0.85)", lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: "70" });
    rsiSeries.createPriceLine({ price: 30, color: "rgba(90,102,125,0.85)", lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: "30" });

    // Two-way time-axis sync. The callbacks fire ASYNCHRONOUSLY, so a simple
    // `syncing` flag is already reset by the time the other chart answers — the
    // two panes then kept overwriting each other's range and the time scale
    // froze (fitContent / setVisibleLogicalRange / zoom / pan all had no
    // effect). Writing only when the ranges actually differ breaks the loop.
    const sameRange = (a, b) => a && b && Math.abs(a.from - b.from) < 0.005 && Math.abs(a.to - b.to) < 0.005;
    priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      if (!sameRange(rsiChart.timeScale().getVisibleLogicalRange(), range)) {
        rsiChart.timeScale().setVisibleLogicalRange(range);
      }
      redrawOverlay();
    });
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      if (!sameRange(priceChart.timeScale().getVisibleLogicalRange(), range)) {
        priceChart.timeScale().setVisibleLogicalRange(range);
      }
    });

    overlayCanvas.addEventListener("click", handleClick);
    // Rubber-band preview while the ruler waits for its second point.
    overlayCanvas.addEventListener("mousemove", handleMove);
    overlayCanvas.addEventListener("mouseleave", () => {
      if (hoverPoint) { hoverPoint = null; redrawOverlay(); }
    });
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(priceContainer);
    resize();
  }

  function resize() {
    const w = priceContainer.clientWidth;
    if (!w) return; // container not laid out yet (hidden tab): keep the old fit
    priceChart.applyOptions({ width: w });
    rsiChart.applyOptions({ width: rsiContainer.clientWidth || w });
    // Bar spacing is computed for the width at fit time, so a width change
    // leaves the candles bunched against the right edge with dead space on the
    // left. Re-fit after every resize to keep the bars spread over the pane.
    priceChart.timeScale().fitContent();
    rsiChart.timeScale().fitContent();
    overlayCanvas.width = w;
    overlayCanvas.height = priceContainer.clientHeight;
    redrawOverlay();
  }

  function toTime(dateStr) {
    return dateStr; // "YYYY-MM-DD" — định dạng time trực tiếp được lightweight-charts hỗ trợ
  }

  /**
   * @param ohlcv bars to draw
   * @param key   identity of the dataset ("SYMBOL|range"). The 45s refresh loop
   *              re-sends the SAME symbol+range — dropping the drawings there
   *              would wipe a trendline/ruler under the user every 45 seconds.
   *              Anchors stay valid as long as the key is unchanged.
   */
  // CẢNH BÁO — Lightweight Charts KHÔNG VẼ series khi giá trị quá lớn.
  // Đo 07/08/2026 với giá coin theo VND: 1,68e6 vẽ bình thường, 1,68e9 thì trục,
  // thang giá và nhãn giá cuối đều đúng nhưng ĐƯỜNG KHÔNG XUẤT HIỆN, không có
  // lỗi console nào. Chia cùng chuỗi đó cho 1000 là hiện lại ngay.
  // Đổi `priceFormat.minMove` KHÔNG cứu được (đã thử minMove=1000) — giới hạn
  // nằm ở độ lớn giá trị, không phải số bước giá.
  // → Trang nào có giá lớn phải TỰ CHIA BẬC trước khi gọi setData và ghi đơn vị
  //   lên nhãn (xem `pages/coin.js`, hàm chartScaleFor).
  function setData(ohlcv, key) {
    const sameDataset = key != null && key === dataKey;
    dataKey = key != null ? key : null;
    bars = ohlcv;

    // No `open` on the first bar => index data (close only). Detected from the
    // payload rather than passed in, so every existing call site keeps working.
    const isLine = ohlcv.length > 0 && ohlcv[0].open == null;

    candleSeries.applyOptions({ visible: !isLine });
    lineSeries.applyOptions({ visible: isLine });
    if (isLine) {
      lineSeries.setData(ohlcv.map((d) => ({ time: toTime(d.date), value: d.close })));
      candleSeries.setData([]);
    } else {
      lineSeries.setData([]);
      candleSeries.setData(
        ohlcv.map((d) => ({ time: toTime(d.date), open: d.open, high: d.high, low: d.low, close: d.close }))
      );
    }

    const closes = ohlcv.map((d) => d.close);
    const ma10 = sma(closes, 10), ma20 = sma(closes, 20);
    ma10Series.setData(ohlcv.map((d, i) => (ma10[i] != null ? { time: toTime(d.date), value: ma10[i] } : null)).filter(Boolean));
    ma20Series.setData(ohlcv.map((d, i) => (ma20[i] != null ? { time: toTime(d.date), value: ma20[i] } : null)).filter(Boolean));

    const bb = bollingerBands(closes, 20, 2);
    bbUpperSeries.setData(ohlcv.map((d, i) => (bb.upper[i] != null ? { time: toTime(d.date), value: bb.upper[i] } : null)).filter(Boolean));
    bbBasisSeries.setData(ohlcv.map((d, i) => (bb.basis[i] != null ? { time: toTime(d.date), value: bb.basis[i] } : null)).filter(Boolean));
    bbLowerSeries.setData(ohlcv.map((d, i) => (bb.lower[i] != null ? { time: toTime(d.date), value: bb.lower[i] } : null)).filter(Boolean));

    // Bar colour normally compares close to its own open. Index bars have no
    // open, so fall back to the previous close — same up/down meaning, and the
    // volume itself (TotalVol of the whole exchange) is real data worth keeping.
    volumeSeries.setData(
      ohlcv.map((d, i) => {
        const ref = d.open != null ? d.open : i > 0 ? ohlcv[i - 1].close : d.close;
        return { time: toTime(d.date), value: d.volume, color: d.close >= ref ? UP + "aa" : DOWN + "aa" };
      })
    );

    const rsiArr = rsiCalc(closes, 14);
    // Keep one point per bar — whitespace {time} for the leading nulls instead of
    // dropping them — so the RSI pane has the SAME bar count as the price pane.
    // Otherwise the cross-chart logical-range sync is offset by 14 bars and the
    // RSI line stops short of the latest trading day on the right edge.
    rsiSeries.setData(ohlcv.map((d, i) => (rsiArr[i] != null ? { time: toTime(d.date), value: rsiArr[i] } : { time: toTime(d.date) })));

    // Anchors are index/time based — a new symbol or range invalidates them.
    if (!sameDataset) { trendline = null; ruler = null; }
    pendingPoint = null; hoverPoint = null;
    // Resize FIRST, then fit: fitContent() computes bar spacing for the width
    // the chart has at that moment. Fitting before a width change left the bars
    // bunched against the right edge with dead space on the left.
    resize();
    priceChart.timeScale().fitContent();
    rsiChart.timeScale().fitContent();
    redrawOverlay();
  }

  function setMode(next) {
    mode = next;
    pendingPoint = null;
    hoverPoint = null;
    overlayCanvas.style.cursor = next ? "crosshair" : "default";
    // Only capture the mouse while drawing; idle, the chart keeps zoom/pan.
    overlayCanvas.style.pointerEvents = next ? "auto" : "none";
    redrawOverlay();
  }

  // Kept as-is for the "Vẽ trendline" button; turning it off only clears the
  // trendline mode, never the ruler's (they are toggled independently by app.js).
  function setDrawMode(on) {
    if (on) setMode("trend");
    else if (mode === "trend") setMode(null);
  }

  function setMeasureMode(on) {
    if (on) setMode("measure");
    else if (mode === "measure") setMode(null);
  }

  function clearTrendline() {
    trendline = null;
    pendingPoint = null;
    redrawOverlay();
  }

  function clearMeasure() {
    ruler = null;
    pendingPoint = null;
    hoverPoint = null;
    redrawOverlay();
  }

  function clearAll() {
    trendline = null;
    ruler = null;
    pendingPoint = null;
    hoverPoint = null;
    redrawOverlay();
  }

  // Canvas point → chart anchor. `index` is the logical bar index (rounded and
  // clamped into the loaded data) so the ruler can count bars exactly; `time` is
  // kept for the trendline, which anchors on time.
  function pointFromEvent(evt) {
    const rect = overlayCanvas.getBoundingClientRect();
    const x = evt.clientX - rect.left, y = evt.clientY - rect.top;
    const price = candleSeries.coordinateToPrice(y);
    if (price == null) return null;
    const time = priceChart.timeScale().coordinateToTime(x);
    const logical = priceChart.timeScale().coordinateToLogical(x);
    if (logical == null || !bars.length) return time == null ? null : { time, price };
    const index = Math.max(0, Math.min(bars.length - 1, Math.round(logical)));
    return { time, price, index };
  }

  function handleClick(evt) {
    if (!mode) return;
    const pt = pointFromEvent(evt);
    if (!pt) return;
    if (mode === "trend" && pt.time == null) return;
    if (mode === "measure" && pt.index == null) return;

    if (!pendingPoint) {
      pendingPoint = pt;
    } else {
      if (mode === "trend") {
        trendline = { p1: pendingPoint, p2: pt };
        document.dispatchEvent(new CustomEvent("trendline-drawn"));
      } else {
        ruler = { p1: pendingPoint, p2: pt };
        document.dispatchEvent(new CustomEvent("measure-drawn"));
      }
      pendingPoint = null;
      hoverPoint = null;
      mode = null;
      overlayCanvas.style.cursor = "default";
      overlayCanvas.style.pointerEvents = "none";
    }
    redrawOverlay();
  }

  function handleMove(evt) {
    if (mode !== "measure" || !pendingPoint) return;
    hoverPoint = pointFromEvent(evt);
    redrawOverlay();
  }

  function redrawOverlay() {
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (pendingPoint) {
      const x = mode === "measure"
        ? priceChart.timeScale().logicalToCoordinate(pendingPoint.index)
        : priceChart.timeScale().timeToCoordinate(pendingPoint.time);
      const y = candleSeries.priceToCoordinate(pendingPoint.price);
      if (x != null && y != null) dot(x, y, mode === "measure" ? UP : TREND);
    }

    if (trendline) {
      const x1 = priceChart.timeScale().timeToCoordinate(trendline.p1.time);
      const y1 = candleSeries.priceToCoordinate(trendline.p1.price);
      const x2 = priceChart.timeScale().timeToCoordinate(trendline.p2.time);
      const y2 = candleSeries.priceToCoordinate(trendline.p2.price);
      if ([x1, y1, x2, y2].every((v) => v != null)) {
        overlayCtx.strokeStyle = TREND;
        overlayCtx.lineWidth = 2;
        overlayCtx.lineCap = "round";
        overlayCtx.beginPath();
        overlayCtx.moveTo(x1, y1);
        overlayCtx.lineTo(x2, y2);
        overlayCtx.stroke();
        dot(x1, y1, TREND); dot(x2, y2, TREND);
      }
    }

    // Live preview while placing the ruler's second point, then the fixed ruler.
    if (mode === "measure" && pendingPoint && hoverPoint) drawRuler(pendingPoint, hoverPoint, true);
    if (ruler) drawRuler(ruler.p1, ruler.p2, false);
  }

  function dot(x, y, color) {
    overlayCtx.fillStyle = color;
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, 3, 0, Math.PI * 2);
    overlayCtx.fill();
  }

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }

  function shortDate(iso) {
    const [, m, d] = String(iso).split("-");
    return d && m ? `${d}/${m}` : String(iso);
  }

  /**
   * Ruler: shaded box between the two anchors plus a label with the bar count
   * and the % move. Anchored on bar index + price, so it stays glued to the
   * candles while panning/zooming (same contract as the trendline).
   */
  function drawRuler(p1, p2, preview) {
    const ts = priceChart.timeScale();
    const x1 = ts.logicalToCoordinate(p1.index), x2 = ts.logicalToCoordinate(p2.index);
    const y1 = candleSeries.priceToCoordinate(p1.price), y2 = candleSeries.priceToCoordinate(p2.price);
    if ([x1, y1, x2, y2].some((v) => v == null)) return;

    const rising = p2.price >= p1.price;
    const color = rising ? UP : DOWN;
    const barCount = Math.abs(p2.index - p1.index);
    const pct = p1.price ? ((p2.price - p1.price) / p1.price) * 100 : 0;
    const delta = p2.price - p1.price;

    overlayCtx.save();
    overlayCtx.fillStyle = rgba(color, preview ? 0.08 : 0.13);
    overlayCtx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
    overlayCtx.strokeStyle = color;
    overlayCtx.lineWidth = 1.5;
    overlayCtx.setLineDash(preview ? [4, 4] : []);
    overlayCtx.beginPath();
    overlayCtx.moveTo(x1, y1);
    overlayCtx.lineTo(x2, y2);
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);
    dot(x1, y1, color); dot(x2, y2, color);

    const sign = delta >= 0 ? "+" : "";
    const l1 = `${sign}${pct.toFixed(2)}%  (${sign}${delta.toFixed(2)})`;
    const d1 = bars[p1.index] && bars[p1.index].date, d2 = bars[p2.index] && bars[p2.index].date;
    const l2 = d1 && d2 ? `${barCount} nến · ${shortDate(d1)} → ${shortDate(d2)}` : `${barCount} nến`;

    overlayCtx.font = "700 11px Roboto, sans-serif";
    const w = Math.max(overlayCtx.measureText(l1).width, overlayCtx.measureText(l2).width) + 16;
    const h = 34;
    // Keep the label inside the canvas even when a point sits near an edge.
    let bx = Math.min(Math.max((x1 + x2) / 2 - w / 2, 2), overlayCanvas.width - w - 2);
    let by = Math.min(y1, y2) - h - 8;
    if (by < 2) by = Math.max(y1, y2) + 8;
    by = Math.min(by, overlayCanvas.height - h - 2);

    overlayCtx.fillStyle = rgba(color, 0.92);
    if (overlayCtx.roundRect) {
      overlayCtx.beginPath();
      overlayCtx.roundRect(bx, by, w, h, 7);
      overlayCtx.fill();
    } else {
      overlayCtx.fillRect(bx, by, w, h); // older browsers: square label chip
    }
    overlayCtx.fillStyle = "#0a0a0a";
    overlayCtx.textBaseline = "top";
    overlayCtx.fillText(l1, bx + 8, by + 5);
    overlayCtx.font = "600 10.5px Roboto, sans-serif";
    overlayCtx.fillText(l2, bx + 8, by + 19);
    overlayCtx.restore();
  }

  function toggleSeries(name, visible) {
    if (name === "ma10") ma10Series.applyOptions({ visible });
    if (name === "ma20") ma20Series.applyOptions({ visible });
    if (name === "bb") {
      bbUpperSeries.applyOptions({ visible });
      bbBasisSeries.applyOptions({ visible });
      bbLowerSeries.applyOptions({ visible });
    }
    if (name === "volume") volumeSeries.applyOptions({ visible });
    if (name === "rsi") {
      rsiContainer.style.display = visible ? "block" : "none";
      // A resize while hidden leaves the RSI chart at width 0 (clientWidth of a
      // display:none element). Re-measure on show so the line paints full-width.
      if (visible) resize();
    }
  }

  // Re-apply every theme-dependent colour (grid/text/borders/series) after the
  // Sáng/Tối toggle. The two themes now use different up/down and MA colours, so
  // the series have to be re-coloured too — re-reading the CSS vars is enough.
  function applyTheme() {
    if (!priceChart) return;
    const t = chartTheme();
    priceChart.applyOptions(t);
    rsiChart.applyOptions(t);
    rsiChart.applyOptions({ timeScale: { visible: false } });
    UP = cssColor("--chart-up", "#3ddc97");
    DOWN = cssColor("--chart-down", "#f0625f");
    TREND = cssColor("--chart-trend", "#f0a94e");
    const boll = cssColor("--chart-boll", "#8a8a8a");
    if (candleSeries) {
      candleSeries.applyOptions({ upColor: UP, downColor: DOWN, wickUpColor: UP, wickDownColor: DOWN });
    }
    if (lineSeries) lineSeries.applyOptions({ color: cssColor("--chart-line", "#f5f5f0") });
    if (ma10Series) ma10Series.applyOptions({ color: cssColor("--chart-ma10", "#f0a94e") });
    if (ma20Series) ma20Series.applyOptions({ color: cssColor("--chart-ma20", "#a78bfa") });
    [bbUpperSeries, bbBasisSeries, bbLowerSeries].forEach((s) => s && s.applyOptions({ color: boll }));
    if (rsiSeries) rsiSeries.applyOptions({ color: accentColor() });
    redrawOverlay(); // trendline/ruler ink follows the theme too
  }

  // Which dataset is currently drawn ("SYMBOL|range"), so callers can tell a
  // transient refresh failure (same key — keep the chart) from a failed switch
  // to another symbol (different key — a stale chart under the new title would
  // read as that symbol's price history).
  function currentKey() { return dataKey; }

  return {
    init, setData, toggleSeries, applyTheme, currentKey,
    setDrawMode, setMeasureMode,
    clearTrendline, clearMeasure, clearAll,
    redrawOverlay,
  };
})();
