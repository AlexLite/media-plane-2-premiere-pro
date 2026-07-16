export interface RationalFps { numerator: number; denominator: number }
export function validateFps(fps: RationalFps): void {
  if (!Number.isInteger(fps.numerator) || !Number.isInteger(fps.denominator) || fps.numerator <= 0 || fps.denominator <= 0) throw new Error("Invalid rational frame rate");
}
export function frameToSeconds(frame: number, fps: RationalFps): number { validateFps(fps); if (!Number.isInteger(frame) || frame < 0) throw new Error("Invalid frame number"); return frame * fps.denominator / fps.numerator; }
export function secondsToFrame(seconds: number, fps: RationalFps): number { validateFps(fps); if (!Number.isFinite(seconds) || seconds < 0) throw new Error("Invalid time"); return Math.round(seconds * fps.numerator / fps.denominator); }
