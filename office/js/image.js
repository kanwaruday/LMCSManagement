// Client-side proof preparation: images shrink to a 1600 px longest edge at JPEG 0.7; PDFs pass through (max 3 MB, as the backend).
export const MAX_EDGE = 1600, JPEG_QUALITY = 0.7, PDF_MAX_BYTES = 3 * 1024 * 1024;

// Fit (w, h) inside a maxEdge square, keeping the ratio; never upscale, never below 1 px.
export function resizeDims(w, h, maxEdge = MAX_EDGE) {
  const k = Math.min(1, maxEdge / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
export const pdfTooBig = (bytes) => bytes > PDF_MAX_BYTES;

export const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read the file'));
  r.readAsDataURL(blob);
});

// file: a File from <input type=file>. Resolves {base64, mime}; rejects with a message fit to show the clerk.
export async function resizeImage(file) {
  if (file.type === 'application/pdf') {
    if (pdfTooBig(file.size)) throw new Error('This PDF is larger than 3 MB. Take a photo of the slip instead, or use a smaller PDF.');
    return { base64: await toBase64(file), mime: 'application/pdf' };
  }
  if (!/^image\//.test(file.type)) throw new Error('Choose a photo (or a PDF) of the deposit slip.');
  let bmp;
  try { bmp = await createImageBitmap(file); } catch (_) { throw new Error('This photo cannot be read. Try taking it again.'); }
  const { w, h } = resizeDims(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
  if (bmp.close) bmp.close();
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('This photo cannot be prepared. Try taking it again.');
  return { base64: await toBase64(blob), mime: 'image/jpeg' };
}
