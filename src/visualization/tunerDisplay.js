/**
 * Vẽ đồng hồ cents (thang ngang) và tên nốt lên canvas.
 */

/**
 * @typedef {{
 *   hz: number,
 *   note: string,
 *   cents: number,
 *   methodLabel?: string,
 * }} TunerHoldReading
 */

/**
 * @typedef {{
 *   active: boolean,
 *   hz?: number,
 *   note?: string,
 *   cents?: number,
 *   peakDb?: number,
 *   idleHint?: string,
 *   methodLabel?: string,
 *   hold?: TunerHoldReading | null,
 * }} TunerDisplayState
 */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {HTMLElement} container
 */
export function syncTunerCanvasSize(canvas, container) {
  const dpr = window.devicePixelRatio || 1;
  const w = Math.max(1, container.clientWidth);
  const h = Math.max(1, container.clientHeight);
  const bw = Math.floor(w * dpr);
  const bh = Math.floor(h * dpr);
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw;
    canvas.height = bh;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {TunerDisplayState} state
 */
export function drawTunerFrame(canvas, state) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const cssW = canvas.clientWidth || 1;
  const cssH = canvas.clientHeight || 1;
  const W = canvas.width;
  const H = canvas.height;
  const sx = W / cssW;
  const sy = H / cssH;

  ctx.save();
  ctx.scale(sx, sy);

  const bg = getComputedStyle(canvas).getPropertyValue("--bg-alt").trim() || "#12151c";
  const border = getComputedStyle(canvas).getPropertyValue("--border").trim() || "#2a3140";
  const text = getComputedStyle(canvas).getPropertyValue("--text").trim() || "#e8ecf4";
  const muted = getComputedStyle(canvas).getPropertyValue("--muted").trim() || "#8b95a8";

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, cssW, cssH);

  const pad = 18;
  /** Khối nốt / Hz đặt cao hơn một chút; các dòng cách nhau rộng hơn */
  const centerY = cssH * 0.31;
  const noteDy = -14;
  const hzDyMul = 0.56;
  const holdHintDyMul = 0.92;
  const gaugeAfterNoteMul = 1.08;
  const noteSize = Math.min(56, cssW * 0.14);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  if (!state.active) {
    const hold = state.hold;
    if (
      hold &&
      Number.isFinite(hold.hz) &&
      hold.note &&
      Number.isFinite(hold.cents)
    ) {
      const hz = hold.hz;
      const note = hold.note;
      const cents = hold.cents;

      ctx.fillStyle = muted;
      ctx.font = `600 ${Math.round(noteSize * 0.88)}px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
      ctx.fillText(note, cssW / 2, centerY + noteDy);

      ctx.font = `500 14px ui-monospace, Menlo, Consolas, monospace`;
      const hzLine = hold.methodLabel
        ? `${hz.toFixed(1)} Hz · ${hold.methodLabel}`
        : `${hz.toFixed(1)} Hz`;
      ctx.fillText(hzLine, cssW / 2, centerY + noteSize * hzDyMul);

      ctx.font = `400 12px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
      ctx.fillText(
        "Giữ giá trị cuối — chờ tín hiệu mới",
        cssW / 2,
        centerY + noteSize * holdHintDyMul,
      );

      const gaugeTop = centerY + noteSize * gaugeAfterNoteMul;
      const gaugeH = 44;
      const gw = cssW - pad * 2;
      const gx = pad;
      const gy = gaugeTop;

      ctx.strokeStyle = border;
      ctx.lineWidth = 1;
      ctx.strokeRect(gx, gy, gw, gaugeH);

      const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
      grad.addColorStop(0, "rgba(220, 90, 90, 0.22)");
      grad.addColorStop(0.45, "rgba(90, 180, 120, 0.12)");
      grad.addColorStop(0.5, "rgba(90, 200, 130, 0.28)");
      grad.addColorStop(0.55, "rgba(90, 180, 120, 0.12)");
      grad.addColorStop(1, "rgba(220, 90, 90, 0.22)");
      ctx.fillStyle = grad;
      ctx.fillRect(gx + 1, gy + 1, gw - 2, gaugeH - 2);

      const range = 50;
      const t = Math.max(-1, Math.min(1, cents / range));
      const nx = gx + gw * 0.5 + t * (gw * 0.5 - 8);

      ctx.beginPath();
      ctx.moveTo(nx, gy + 4);
      ctx.lineTo(nx - 9, gy + gaugeH - 4);
      ctx.lineTo(nx + 9, gy + gaugeH - 4);
      ctx.closePath();
      ctx.fillStyle = muted;
      ctx.fill();

      ctx.fillStyle = muted;
      ctx.font = `400 11px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText("−50¢", gx, gy + gaugeH + 6);
      ctx.textAlign = "center";
      ctx.fillText("0", gx + gw / 2, gy + gaugeH + 6);
      ctx.textAlign = "right";
      ctx.fillText("+50¢", gx + gw, gy + gaugeH + 6);

      ctx.textAlign = "center";
      ctx.font = `600 16px ui-monospace, Menlo, Consolas, monospace`;
      ctx.fillText(`${cents >= 0 ? "+" : ""}${cents.toFixed(1)} ¢`, cssW / 2, gy + gaugeH + 28);

      if (state.idleHint) {
        ctx.fillStyle = muted;
        ctx.font = `400 13px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
        ctx.fillText(state.idleHint, cssW / 2, gy + gaugeH + 48);
      }

      if (state.peakDb !== undefined && Number.isFinite(state.peakDb)) {
        ctx.fillStyle = muted;
        ctx.font = `400 12px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
        ctx.fillText(`Đỉnh dải 60–2000 Hz ≈ ${state.peakDb.toFixed(1)} dB`, cssW / 2, cssH - pad);
      }
      ctx.restore();
      return;
    }

    ctx.fillStyle = muted;
    ctx.font = `600 ${Math.round(noteSize * 0.55)}px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
    ctx.fillText("—", cssW / 2, centerY);
    ctx.font = `400 14px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
    ctx.fillText(
      state.idleHint ?? "Tín hiệu yếu hoặc im lặng (< −40 dB)",
      cssW / 2,
      centerY + noteSize * 0.55,
    );
    if (state.peakDb !== undefined && Number.isFinite(state.peakDb)) {
      ctx.font = `400 12px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
      ctx.fillText(`Đỉnh dải 60–2000 Hz ≈ ${state.peakDb.toFixed(1)} dB`, cssW / 2, cssH - pad);
    }
    ctx.restore();
    return;
  }

  const note = state.note ?? "?";
  const hz = state.hz ?? 0;
  const cents = state.cents ?? 0;

  ctx.fillStyle = text;
  ctx.font = `700 ${Math.round(noteSize)}px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
  ctx.fillText(note, cssW / 2, centerY + noteDy);

  ctx.fillStyle = muted;
  ctx.font = `500 15px ui-monospace, Menlo, Consolas, monospace`;
  const hzLine = state.methodLabel
    ? `${hz.toFixed(1)} Hz · ${state.methodLabel}`
    : `${hz.toFixed(1)} Hz`;
  ctx.fillText(hzLine, cssW / 2, centerY + noteSize * hzDyMul);

  const gaugeTop = centerY + noteSize * gaugeAfterNoteMul;
  const gaugeH = 44;
  const gw = cssW - pad * 2;
  const gx = pad;
  const gy = gaugeTop;

  ctx.strokeStyle = border;
  ctx.lineWidth = 1;
  ctx.strokeRect(gx, gy, gw, gaugeH);

  const grad = ctx.createLinearGradient(gx, 0, gx + gw, 0);
  grad.addColorStop(0, "rgba(220, 90, 90, 0.35)");
  grad.addColorStop(0.45, "rgba(90, 180, 120, 0.2)");
  grad.addColorStop(0.5, "rgba(90, 200, 130, 0.45)");
  grad.addColorStop(0.55, "rgba(90, 180, 120, 0.2)");
  grad.addColorStop(1, "rgba(220, 90, 90, 0.35)");
  ctx.fillStyle = grad;
  ctx.fillRect(gx + 1, gy + 1, gw - 2, gaugeH - 2);

  const range = 50;
  const t = Math.max(-1, Math.min(1, cents / range));
  const nx = gx + gw * 0.5 + t * (gw * 0.5 - 8);

  ctx.beginPath();
  ctx.moveTo(nx, gy + 4);
  ctx.lineTo(nx - 9, gy + gaugeH - 4);
  ctx.lineTo(nx + 9, gy + gaugeH - 4);
  ctx.closePath();
  ctx.fillStyle = text;
  ctx.fill();

  ctx.fillStyle = muted;
  ctx.font = `400 11px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("−50¢", gx, gy + gaugeH + 6);
  ctx.textAlign = "center";
  ctx.fillText("0", gx + gw / 2, gy + gaugeH + 6);
  ctx.textAlign = "right";
  ctx.fillText("+50¢", gx + gw, gy + gaugeH + 6);

  ctx.textAlign = "center";
  ctx.fillStyle = Math.abs(cents) < 5 ? "#6cd49a" : text;
  ctx.font = `600 18px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillText(`${cents >= 0 ? "+" : ""}${cents.toFixed(1)} ¢`, cssW / 2, gy + gaugeH + 28);

  if (state.peakDb !== undefined && Number.isFinite(state.peakDb)) {
    ctx.fillStyle = muted;
    ctx.font = `400 12px "Helvetica Neue", Helvetica, Arial, system-ui, sans-serif`;
    ctx.fillText(`Đỉnh dải ≈ ${state.peakDb.toFixed(1)} dB`, cssW / 2, cssH - pad);
  }

  ctx.restore();
}
