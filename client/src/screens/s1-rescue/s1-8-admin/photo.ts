// D20 — turning a phone photo into something small enough to store in Postgres.
//
// The bytes live in a table and travel as a data URL on an ordinary JSON body
// (`shared/src/masters.ts`, `SetDonorPhotoRequest`): multipart would mean a parsing
// dependency (D5) and a mounted volume, and a volume is one more thing `pg_dump`
// does not back up.
//
// The server enforces the ceiling as a database CHECK, ~400 KB and a jpeg/png mime.
// THIS IS WHAT KEEPS A PHONE PHOTO FROM EVER REACHING IT: a modern phone camera
// produces 3–8 MB, and an admin who is refused after a 30-second upload has learnt
// nothing they can act on. Resizing first means the refusal is unreachable in
// normal use rather than merely handled.
//
// No dependency (D5): `<canvas>` and `FileReader` are in the browser. The one cost
// is that this cannot be unit-tested here — there is no DOM in the client suite —
// so the part that IS a rule (which of set/clear/nothing a save sends) lives in
// `logic.ts` as `photoChange` and is tested there.

/** Long edge, in CSS pixels. Big enough to recognise a loading dock on a desktop,
 *  small enough that a JPEG of it is tens of KB against a 400 KB ceiling. */
export const PHOTO_MAX_EDGE = 800;

/** JPEG quality. 0.7 is the knee: visibly identical for a photograph, roughly a
 *  third the bytes of 0.9. */
export const PHOTO_QUALITY = 0.7;

/** JPEG whatever came in, so a PNG screenshot of a map does not arrive as a
 *  megabyte of lossless pixels. Both are within the server's allowed mimes. */
const PHOTO_MIME = 'image/jpeg';

/** Fits the long edge to `PHOTO_MAX_EDGE`, never enlarging: a small photo stays
 *  its own size rather than being upscaled into a blurry 800px one. */
export function scaledSize(
  width: number,
  height: number,
  maxEdge: number = PHOTO_MAX_EDGE,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge || longest === 0) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('unreadable'));
    };
    reader.onerror = () => reject(new Error('unreadable'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('undecodable'));
    image.src = dataUrl;
  });
}

/**
 * A chosen file as a small JPEG data URL, ready to PUT.
 *
 * Rejects rather than returning a huge string: the caller shows §6's "what
 * happened plus what to do" and leaves the existing photo alone.
 */
export async function resizedPhotoDataUrl(file: File): Promise<string> {
  const original = await readAsDataUrl(file);
  const image = await loadImage(original);
  const size = scaledSize(image.naturalWidth, image.naturalHeight);

  const canvas = document.createElement('canvas');
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no-canvas');
  context.drawImage(image, 0, 0, size.width, size.height);

  return canvas.toDataURL(PHOTO_MIME, PHOTO_QUALITY);
}
