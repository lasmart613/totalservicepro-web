/**
 * Signature "ink" detection. A signature pad that was never drawn on still
 * exports a valid PNG (all white, or all transparent), which renders as an
 * empty white box. These helpers tell a real signature from a blank one.
 */

/** True when RGBA pixel data has at least `minInk` visibly dark, opaque pixels. */
export function pixelsHaveInk(data: ArrayLike<number>, minInk = 20): boolean {
  let ink = 0;
  for (let i = 0; i + 3 < data.length; i += 4) {
    const a = data[i + 3];
    if (a < 64) continue;
    const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    if (lum < 200) {
      ink++;
      if (ink >= minInk) return true;
    }
  }
  return false;
}

/** True when the canvas currently holds a drawn signature. */
export function canvasHasInk(canvas: HTMLCanvasElement | null | undefined): boolean {
  if (!canvas || !canvas.width || !canvas.height) return false;
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return false;
    return pixelsHaveInk(ctx.getImageData(0, 0, canvas.width, canvas.height).data);
  } catch {
    return true; // tainted/unknown: don't throw away what the user drew
  }
}

/**
 * Loads an image src (data URL or http) and resolves true when it has ink,
 * false when blank or unloadable. Resolves true on CORS/taint errors so a
 * remote signature that can't be inspected is still shown.
 */
export function imageHasInk(src: string, timeoutMs = 4000): Promise<boolean> {
  if (typeof window === 'undefined' || !src) return Promise.resolve(false);
  return new Promise((resolve) => {
    const img = new Image();
    let done = false;
    const finish = (v: boolean) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const timer = window.setTimeout(() => finish(true), timeoutMs);
    img.onload = () => {
      window.clearTimeout(timer);
      const w = img.naturalWidth || img.width;
      const h = img.naturalHeight || img.height;
      if (!w || !h) return finish(false);
      try {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        const ctx = c.getContext('2d');
        if (!ctx) return finish(true);
        ctx.drawImage(img, 0, 0);
        finish(pixelsHaveInk(ctx.getImageData(0, 0, w, h).data));
      } catch {
        finish(true);
      }
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      finish(false);
    };
    if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';
    img.src = src;
  });
}
