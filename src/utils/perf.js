export default class PerfMeter {
  constructor({ sampleWindow = 60, emaAlpha = 0.12 } = {}) {
    this.sampleWindow = sampleWindow;
    this.emaAlpha = emaAlpha;
    this.deltas = [];
    this.emaFps = null;
    this.lastFrameTime = null;
    this._frames = 0;
    this._lastNow = performance.now();
  }

  recordFrame(frameTimeMs) {
    if (typeof frameTimeMs !== 'number' || !isFinite(frameTimeMs) || frameTimeMs <= 0) {
      const now = performance.now();
      frameTimeMs = Math.max(0.1, now - this._lastNow);
      this._lastNow = now;
    }
    this.deltas.push(frameTimeMs);
    if (this.deltas.length > this.sampleWindow) this.deltas.shift();

    const avgDelta = this.deltas.reduce((a, b) => a + b, 0) / this.deltas.length;
    const instantFps = avgDelta > 0 ? 1000 / avgDelta : 0;

    if (this.emaFps === null) this.emaFps = instantFps;
    else this.emaFps = this.emaFps * (1 - this.emaAlpha) + instantFps * this.emaAlpha;

    this._frames++;
    return this.emaFps;
  }

  getFPS() {
    if (this.emaFps === null) return 0;
    return Number(this.emaFps.toFixed(1));
  }

  getInstantFPS() {
    if (!this.deltas.length) return 0;
    const avgDelta = this.deltas.reduce((a, b) => a + b, 0) / this.deltas.length;
    return Number((1000 / avgDelta).toFixed(1));
  }

  reset() {
    this.deltas.length = 0;
    this.emaFps = null;
    this._frames = 0;
  }
}
