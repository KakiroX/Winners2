// Graph export helpers (browser/renderer side): SVG, PNG, JPEG, TIFF (PackBits), PDF (via Electron).
import { platform } from '../platform';

export type ExportFormat = 'svg' | 'png' | 'jpeg' | 'tiff' | 'pdf';

export const EXPORT_FORMATS: { value: ExportFormat; label: string; ext: string; mime: string }[] = [
  { value: 'pdf', label: 'PDF (vector)', ext: 'pdf', mime: 'application/pdf' },
  { value: 'svg', label: 'SVG (vector)', ext: 'svg', mime: 'image/svg+xml' },
  { value: 'tiff', label: 'TIFF (journal raster)', ext: 'tif', mime: 'image/tiff' },
  { value: 'png', label: 'PNG', ext: 'png', mime: 'image/png' },
  { value: 'jpeg', label: 'JPEG', ext: 'jpg', mime: 'image/jpeg' },
];

export async function rasterize(svg: string, width: number, height: number, dpi: number, background = '#ffffff'): Promise<HTMLCanvasElement> {
  const scale = dpi / 72;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const img = new Image();
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not rasterize the graph'));
      img.src = url;
    });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
  return canvas;
}

async function canvasBytes(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Uint8Array> {
  const blob: Blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Encoding failed'))), mime, quality));
  return new Uint8Array(await blob.arrayBuffer());
}

function packBits(row: Uint8Array): number[] {
  const out: number[] = [];
  let i = 0;
  const n = row.length;
  while (i < n) {
    // run of identical bytes
    let run = 1;
    while (i + run < n && run < 128 && row[i + run] === row[i]) run++;
    if (run > 1) {
      out.push(257 - run, row[i]);
      i += run;
      continue;
    }
    // literal run
    let j = i + 1;
    while (j < n && j - i < 128 && !(j + 1 < n && row[j] === row[j + 1])) j++;
    out.push(j - i - 1);
    for (let k = i; k < j; k++) out.push(row[k]);
    i = j;
  }
  return out;
}

/** Encode RGBA canvas pixels as an RGB TIFF with PackBits compression and DPI tags. */
export function encodeTiff(rgba: Uint8ClampedArray, width: number, height: number, dpi: number): Uint8Array {
  const strips: number[][] = [];
  const row = new Uint8Array(width * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const s = (y * width + x) * 4;
      const a = rgba[s + 3] / 255;
      row[x * 3] = Math.round(rgba[s] * a + 255 * (1 - a));
      row[x * 3 + 1] = Math.round(rgba[s + 1] * a + 255 * (1 - a));
      row[x * 3 + 2] = Math.round(rgba[s + 2] * a + 255 * (1 - a));
    }
    strips.push(packBits(row));
  }
  const tags = 13;
  const headerSize = 8;
  const ifdSize = 2 + tags * 12 + 4;
  const extraOffset = headerSize + ifdSize;
  const bpsOffset = extraOffset;
  const xresOffset = bpsOffset + 6 + 2; // keep word alignment
  const yresOffset = xresOffset + 8;
  const stripOffsetsOffset = yresOffset + 8;
  const stripCountsOffset = stripOffsetsOffset + height * 4;
  let dataOffset = stripCountsOffset + height * 4;
  const total = dataOffset + strips.reduce((s, r) => s + r.length, 0);
  const buf = new Uint8Array(total);
  const dv = new DataView(buf.buffer);
  buf[0] = 0x49;
  buf[1] = 0x49;
  dv.setUint16(2, 42, true);
  dv.setUint32(4, headerSize, true);
  let p = headerSize;
  dv.setUint16(p, tags, true);
  p += 2;
  const tag = (id: number, type: number, count: number, value: number) => {
    dv.setUint16(p, id, true);
    dv.setUint16(p + 2, type, true);
    dv.setUint32(p + 4, count, true);
    if (type === 3 && count === 1) dv.setUint16(p + 8, value, true);
    else dv.setUint32(p + 8, value, true);
    p += 12;
  };
  tag(256, 4, 1, width);
  tag(257, 4, 1, height);
  tag(258, 3, 3, bpsOffset);
  tag(259, 3, 1, 32773);
  tag(262, 3, 1, 2);
  tag(273, 4, height, stripOffsetsOffset);
  tag(277, 3, 1, 3);
  tag(278, 4, 1, 1);
  tag(279, 4, height, stripCountsOffset);
  tag(282, 5, 1, xresOffset);
  tag(283, 5, 1, yresOffset);
  tag(284, 3, 1, 1);
  tag(296, 3, 1, 2);
  dv.setUint32(p, 0, true);
  dv.setUint16(bpsOffset, 8, true);
  dv.setUint16(bpsOffset + 2, 8, true);
  dv.setUint16(bpsOffset + 4, 8, true);
  dv.setUint32(xresOffset, Math.round(dpi), true);
  dv.setUint32(xresOffset + 4, 1, true);
  dv.setUint32(yresOffset, Math.round(dpi), true);
  dv.setUint32(yresOffset + 4, 1, true);
  strips.forEach((s, i) => {
    dv.setUint32(stripOffsetsOffset + i * 4, dataOffset, true);
    dv.setUint32(stripCountsOffset + i * 4, s.length, true);
    buf.set(s, dataOffset);
    dataOffset += s.length;
  });
  return buf;
}

export async function exportBytes(svg: string, width: number, height: number, format: ExportFormat, dpi = 300): Promise<Uint8Array> {
  switch (format) {
    case 'svg':
      return new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`);
    case 'png':
      return canvasBytes(await rasterize(svg, width, height, dpi), 'image/png');
    case 'jpeg':
      return canvasBytes(await rasterize(svg, width, height, dpi), 'image/jpeg', 0.95);
    case 'tiff': {
      const c = await rasterize(svg, width, height, dpi);
      const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height);
      return encodeTiff(d.data, c.width, c.height, dpi);
    }
    case 'pdf': {
      const pdf = await platform.svgToPdf(svg, width, height);
      if (!pdf) throw new Error('PDF export is available in the desktop app. Use SVG for vector graphics in the browser.');
      return pdf;
    }
  }
}

export async function copyGraphToClipboard(svg: string, width: number, height: number) {
  const c = await rasterize(svg, width, height, 192);
  const blob: Blob = await new Promise((resolve) => c.toBlob((b) => resolve(b!), 'image/png'));
  if (platform.copyImage) {
    await platform.copyImage(new Uint8Array(await blob.arrayBuffer()));
    return;
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
}

export async function svgToPngBase64(svg: string, width: number, height: number, dpi = 110): Promise<string> {
  const c = await rasterize(svg, width, height, dpi);
  const url = c.toDataURL('image/png');
  return url.slice(url.indexOf(',') + 1);
}
