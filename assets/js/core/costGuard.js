// ============================================================
// COST GUARD — bắt lỗi NHẬP SAI ĐƠN VỊ ở ô "giá vốn" của các trang tài sản.
//
// Lý do có file này: mỗi trang có một đơn vị giá vốn khác nhau
//   Vàng     — triệu ₫/lượng   (nội bộ quy về nghìn ₫/chỉ, hệ số 100)
//   Coin     — ₫/1 coin
//   Ngoại tệ — ₫/1 đơn vị
// Người dùng thật đã gõ 80000000 ở trang Vàng (ý là 80 triệu/lượng); app lưu
// nguyên 80000000 nên lãi/lỗ ra con số vô nghĩa. Trước đó chỉ có kiểm `cost > 0`.
//
// HAI NGUYÊN TẮC, đừng đổi mà không đọc hết:
//
// 1. KHÔNG DÙNG NGƯỠNG CỨNG theo giá thị trường (kiểu "vàng phải trong khoảng
//    100–200 triệu"). Giá vàng/coin/tỷ giá trôi theo thời gian, ngưỡng cứng sẽ
//    lỗi thời và bắt đầu chặn nhầm số đúng. Ở đây so với GIÁ THỊ TRƯỜNG ĐANG
//    HIỂN THỊ trên chính trang đó, nên ngưỡng tự trôi theo giá.
//    Không có giá tham chiếu (nguồn lỗi, tiệm không niêm yết) thì KHÔNG cảnh
//    báo — cảnh báo dựa trên số không có thật cũng là số bịa (CLAUDE.md mục 3).
//
// 2. KHÔNG CHẶN CỨNG. Giá vốn là số của quá khứ: mua vàng năm 2010 giá 13 triệu
//    /lượng trong khi nay 139 là lệch 10 lần mà vẫn đúng. Nên đây là cảnh báo
//    hai nhịp — bấm lại đúng số đó là app nhận, y như nút Xoá hai nhịp.
// ============================================================

const CostGuard = (() => {
  // Biên lệch mới cảnh báo. Lệch hai chiều KHÔNG đối xứng có chủ đích:
  //   trên  ×20  — giá vốn cao hơn giá nay 20 lần thì gần như chắc chắn sai đơn vị
  //   dưới  ÷50  — chiều này là chiều của "mua từ lâu, giá còn rẻ", nới rộng hơn
  //                để đỡ hỏi han người mua sớm; ÷1000 (lỗi thiếu ba số 0) vẫn lọt.
  const MAX_OVER = 20;
  const MAX_UNDER = 50;

  // Chỉ gợi ý "có phải bạn định nhập X?" khi số lệch đúng một BẬC NGHÌN
  // (×1e3 / ×1e6 / ×1e9) và số sau khi quy về nằm sát giá thị trường. Lệch bậc
  // lẻ (vd nhập giá USD của coin) không phải lỗi đơn vị của ô này — đoán bừa
  // một con số cụ thể còn tệ hơn không đoán.
  const NEAR_LO = 0.3;
  const NEAR_HI = 3;

  const fmtDefault = (n) =>
    n.toLocaleString("vi-VN", { maximumFractionDigits: n < 100 ? 2 : 0 });

  function suggest(cost, market) {
    const k = Math.round(Math.log10(cost / market) / 3) * 3; // bậc nghìn gần nhất
    if (!k) return null;
    const cand = cost / Math.pow(10, k);
    const r = cand / market;
    return r >= NEAR_LO && r <= NEAR_HI ? cand : null;
  }

  // cost/market phải CÙNG ĐƠN VỊ — trang tự quy đổi trước khi gọi.
  // opts: { unitLabel, marketLabel, fmt }
  // Trả chuỗi cảnh báo, hoặc "" khi không có gì đáng ngờ.
  function check(cost, market, opts) {
    const o = opts || {};
    const fmt = o.fmt || fmtDefault;
    if (!Number.isFinite(cost) || cost <= 0) return "";
    if (!Number.isFinite(market) || market <= 0) return ""; // không có mốc -> im lặng
    if (cost <= market * MAX_OVER && cost >= market / MAX_UNDER) return "";

    const times = cost > market ? cost / market : market / cost;
    const dir = cost > market ? "cao gấp" : "thấp hơn";
    const unit = o.unitLabel ? ` (${o.unitLabel})` : "";
    const cand = suggest(cost, market);

    return (
      `Giá vốn ${fmt(cost)} ${dir} ${fmt(times)} lần ${o.marketLabel || "giá thị trường"} ` +
      `${fmt(market)}${unit}. ` +
      (cand === null ? `Kiểm tra lại đơn vị của ô này. ` : `Có phải bạn định nhập ${fmt(cand)}? `) +
      `Bấm lại để giữ nguyên số đã nhập.`
    );
  }

  // Xác nhận hai nhịp. `key` gồm cả số đã nhập, nên sửa số là cảnh báo lại từ đầu.
  function makeConfirmer() {
    let pending = null;
    return {
      // "" = cho qua (không đáng ngờ, hoặc user đã bấm lần thứ hai)
      guard(key, cost, market, opts) {
        const msg = check(cost, market, opts);
        if (!msg) {
          pending = null;
          return "";
        }
        if (pending === key) {
          pending = null;
          return "";
        }
        pending = key;
        return msg;
      },
      reset() {
        pending = null;
      },
    };
  }

  return { check, makeConfirmer };
})();
