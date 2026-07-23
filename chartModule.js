/**
 * Biểu đồ nến (candlestick) dùng thư viện TradingView Lightweight Charts —
 * hỗ trợ zoom/pan mượt sẵn có (kéo để xem lịch sử, cuộn chuột/chụm để zoom).
 * Thêm: MA10/MA20, khối lượng, RSI(14) (biểu đồ phụ đồng bộ trục thời gian),
 * và công cụ vẽ đường xu hướng thủ công (2 điểm click) trên lớp canvas phủ.
 *
 * Yêu cầu: script lightweight-charts đã được nạp trong index.html
 * (biến toàn cục window.LightweightCharts).
 */

const ChartModule = (function () {
  let priceChart, rsiChart, candleSeries, ma10Series, ma20Series, volumeSeries, rsiSeries;
  let bbUpperSeries, bbBasisSeries, bbLowerSeries;
  let priceContainer, rsiContainer, overlayCanvas, overlayCtx;
  let trendline = null;
  let pendingPoint = null;
  let drawMode = false;
  let resizeObserver;

  const UP = "#17d980";
  const DOWN = "#ff4d5e";

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
        fontFamily: "'Inter', sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "transparent" },
        horzLines: { color: css.getPropertyValue("--border").trim() || "#223154" },
      },
      rightPriceScale: { borderColor: css.getPropertyValue("--border").trim() || "#223154" },
      timeScale: { borderColor: css.getPropertyValue("--border").trim() || "#223154" },
      crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    };
  }

  function init(priceContainerId, rsiContainerId, overlayCanvasId) {
    priceContainer = document.getElementById(priceContainerId);
    rsiContainer = document.getElementById(rsiContainerId);
    overlayCanvas = document.getElementById(overlayCanvasId);
    overlayCtx = overlayCanvas.getContext("2d");

    priceChart = LightweightCharts.createChart(priceContainer, {
      ...chartTheme(),
      width: priceContainer.clientWidth,
      height: 260,
    });
    candleSeries = priceChart.addCandlestickSeries({
      upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN,
    });
    ma10Series = priceChart.addLineSeries({ color: "#2a78d6", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    ma20Series = priceChart.addLineSeries({ color: "#4a3aa7", lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    bbUpperSeries = priceChart.addLineSeries({ color: "#1baf7a", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
    bbBasisSeries = priceChart.addLineSeries({ color: "#1baf7a", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, priceLineVisible: false, lastValueVisible: false });
    bbLowerSeries = priceChart.addLineSeries({ color: "#1baf7a", lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false });
    [bbUpperSeries, bbBasisSeries, bbLowerSeries].forEach((s) => s.applyOptions({ visible: false }));
    volumeSeries = priceChart.addHistogramSeries({
      priceFormat: { type: "volume" }, priceScaleId: "volume", lastValueVisible: false, priceLineVisible: false,
    });
    priceChart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    rsiChart = LightweightCharts.createChart(rsiContainer, {
      ...chartTheme(),
      width: rsiContainer.clientWidth,
      height: 90,
    });
    rsiSeries = rsiChart.addLineSeries({ color: "#eda100", lineWidth: 1.5, lastValueVisible: false });
    rsiChart.priceScale("right").applyOptions({ autoScale: false });
    rsiSeries.applyOptions({});
    rsiChart.priceScale("right").applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });

    let syncing = false;
    priceChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || syncing) return;
      syncing = true;
      rsiChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
      redrawTrendline();
    });
    rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || syncing) return;
      syncing = true;
      priceChart.timeScale().setVisibleLogicalRange(range);
      syncing = false;
    });

    overlayCanvas.addEventListener("click", handleClick);
    resizeObserver = new ResizeObserver(() => resize());
    resizeObserver.observe(priceContainer);
    resize();
  }

  function resize() {
    const w = priceContainer.clientWidth;
    priceChart.applyOptions({ width: w });
    rsiChart.applyOptions({ width: rsiContainer.clientWidth });
    overlayCanvas.width = w;
    overlayCanvas.height = priceContainer.clientHeight;
    redrawTrendline();
  }

  function toTime(dateStr) {
    return dateStr; // "YYYY-MM-DD" — định dạng time trực tiếp được lightweight-charts hỗ trợ
  }

  function setData(ohlcv) {
    const candleData = ohlcv.map((d) => ({ time: toTime(d.date), open: d.open, high: d.high, low: d.low, close: d.close }));
    candleSeries.setData(candleData);

    const closes = ohlcv.map((d) => d.close);
    const ma10 = sma(closes, 10), ma20 = sma(closes, 20);
    ma10Series.setData(ohlcv.map((d, i) => (ma10[i] != null ? { time: toTime(d.date), value: ma10[i] } : null)).filter(Boolean));
    ma20Series.setData(ohlcv.map((d, i) => (ma20[i] != null ? { time: toTime(d.date), value: ma20[i] } : null)).filter(Boolean));

    const bb = bollingerBands(closes, 20, 2);
    bbUpperSeries.setData(ohlcv.map((d, i) => (bb.upper[i] != null ? { time: toTime(d.date), value: bb.upper[i] } : null)).filter(Boolean));
    bbBasisSeries.setData(ohlcv.map((d, i) => (bb.basis[i] != null ? { time: toTime(d.date), value: bb.basis[i] } : null)).filter(Boolean));
    bbLowerSeries.setData(ohlcv.map((d, i) => (bb.lower[i] != null ? { time: toTime(d.date), value: bb.lower[i] } : null)).filter(Boolean));

    volumeSeries.setData(ohlcv.map((d) => ({ time: toTime(d.date), value: d.volume, color: d.close >= d.open ? UP + "aa" : DOWN + "aa" })));

    const rsiArr = rsiCalc(closes, 14);
    rsiSeries.setData(ohlcv.map((d, i) => (rsiArr[i] != null ? { time: toTime(d.date), value: rsiArr[i] } : null)).filter(Boolean));

    trendline = null; pendingPoint = null;
    priceChart.timeScale().fitContent();
    rsiChart.timeScale().fitContent();
    resize();
  }

  function setDrawMode(on) {
    drawMode = on;
    pendingPoint = null;
    overlayCanvas.style.cursor = on ? "crosshair" : "default";
    redrawTrendline();
  }

  function clearTrendline() {
    trendline = null;
    pendingPoint = null;
    redrawTrendline();
  }

  function handleClick(evt) {
    if (!drawMode) return;
    const rect = overlayCanvas.getBoundingClientRect();
    const x = evt.clientX - rect.left, y = evt.clientY - rect.top;
    const time = priceChart.timeScale().coordinateToTime(x);
    const price = candleSeries.coordinateToPrice(y);
    if (time == null || price == null) return;
    const pt = { time, price };
    if (!pendingPoint) {
      pendingPoint = pt;
    } else {
      trendline = { p1: pendingPoint, p2: pt };
      pendingPoint = null;
      drawMode = false;
      overlayCanvas.style.cursor = "default";
      document.dispatchEvent(new CustomEvent("trendline-drawn"));
    }
    redrawTrendline();
  }

  function redrawTrendline() {
    if (!overlayCtx) return;
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    if (pendingPoint) {
      const x = priceChart.timeScale().timeToCoordinate(pendingPoint.time);
      const y = candleSeries.priceToCoordinate(pendingPoint.price);
      if (x != null && y != null) {
        overlayCtx.fillStyle = "#eb6834";
        overlayCtx.beginPath();
        overlayCtx.arc(x, y, 3, 0, Math.PI * 2);
        overlayCtx.fill();
      }
    }
    if (trendline) {
      const x1 = priceChart.timeScale().timeToCoordinate(trendline.p1.time);
      const y1 = candleSeries.priceToCoordinate(trendline.p1.price);
      const x2 = priceChart.timeScale().timeToCoordinate(trendline.p2.time);
      const y2 = candleSeries.priceToCoordinate(trendline.p2.price);
      if ([x1, y1, x2, y2].every((v) => v != null)) {
        overlayCtx.strokeStyle = "#eb6834";
        overlayCtx.lineWidth = 2;
        overlayCtx.lineCap = "round";
        overlayCtx.beginPath();
        overlayCtx.moveTo(x1, y1);
        overlayCtx.lineTo(x2, y2);
        overlayCtx.stroke();
        [[x1, y1], [x2, y2]].forEach(([x, y]) => {
          overlayCtx.fillStyle = "#eb6834";
          overlayCtx.beginPath();
          overlayCtx.arc(x, y, 3, 0, Math.PI * 2);
          overlayCtx.fill();
        });
      }
    }
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
    if (name === "rsi") rsiContainer.style.display = visible ? "block" : "none";
  }

  // Re-apply theme-dependent colours (grid/text/borders read from CSS vars).
  // Called by app.js when the Sáng/Tối toggle flips. Candle up/down stay fixed.
  function applyTheme() {
    if (!priceChart) return;
    const t = chartTheme();
    priceChart.applyOptions(t);
    rsiChart.applyOptions(t);
  }

  return { init, setData, setDrawMode, clearTrendline, toggleSeries, redrawTrendline, applyTheme };
})();
