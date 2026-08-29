/**
 * One-finger swipe detector for mobile movement. Two-finger gestures are
 * ignored here (the camera owns them), and tiny motions count as taps.
 */
export class TouchInput {
  private start: { id: number; x: number; y: number; t: number } | null = null;
  private activeTouches = 0;

  constructor(
    private canvas: HTMLCanvasElement,
    private onSwipe: (dx: number, dy: number, lengthPx: number) => void,
  ) {
    canvas.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onCancel);
  }

  private onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    this.activeTouches++;
    if (this.activeTouches === 1) {
      this.start = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    } else {
      this.start = null; // second finger → camera gesture, not a swipe
    }
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    this.activeTouches = Math.max(0, this.activeTouches - 1);
    const start = this.start;
    if (!start || start.id !== e.pointerId) return;
    this.start = null;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const len = Math.hypot(dx, dy);
    const dt = performance.now() - start.t;
    if (len >= 24 && dt < 800) this.onSwipe(dx, dy, len);
  };

  private onCancel = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    this.activeTouches = Math.max(0, this.activeTouches - 1);
    if (this.start?.id === e.pointerId) this.start = null;
  };

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onCancel);
  }
}
