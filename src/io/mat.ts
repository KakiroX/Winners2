// MATLAB Level 5 MAT-file reader/writer (the documented .mat format used by MATLAB v5–v7).
import { unzlibSync, zlibSync } from 'fflate';
import { CellArray, MError, StringArray, StructArray, Tensor, emptyTensor, type NumClass, type Value } from '../lang/value';

const mi = { INT8: 1, UINT8: 2, INT16: 3, UINT16: 4, INT32: 5, UINT32: 6, SINGLE: 7, DOUBLE: 9, INT64: 12, UINT64: 13, MATRIX: 14, COMPRESSED: 15, UTF8: 16, UTF16: 17, UTF32: 18 };
const mx = { CELL: 1, STRUCT: 2, OBJECT: 3, CHAR: 4, SPARSE: 5, DOUBLE: 6, SINGLE: 7, INT8: 8, UINT8: 9, INT16: 10, UINT16: 11, INT32: 12, UINT32: 13, INT64: 14, UINT64: 15 };
const MX_CLASS: Record<number, NumClass> = { 6: 'double', 7: 'single', 8: 'int8', 9: 'uint8', 10: 'int16', 11: 'uint16', 12: 'int32', 13: 'uint32', 14: 'int64', 15: 'uint64' };

class Reader {
  pos = 0;
  constructor(public dv: DataView, public le: boolean) {}
  u32() {
    const v = this.dv.getUint32(this.pos, this.le);
    this.pos += 4;
    return v;
  }
}

function readNumeric(dv: DataView, off: number, nbytes: number, type: number, le: boolean): number[] {
  const out: number[] = [];
  const sizes: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 2, 5: 4, 6: 4, 7: 4, 9: 8, 12: 8, 13: 8, 16: 1, 17: 2, 18: 4 };
  const sz = sizes[type];
  if (!sz) throw new MError(`Unsupported MAT data type ${type}`);
  const n = Math.floor(nbytes / sz);
  for (let i = 0; i < n; i++) {
    const p = off + i * sz;
    switch (type) {
      case 1: out.push(dv.getInt8(p)); break;
      case 2:
      case 16: out.push(dv.getUint8(p)); break;
      case 3: out.push(dv.getInt16(p, le)); break;
      case 4:
      case 17: out.push(dv.getUint16(p, le)); break;
      case 5: out.push(dv.getInt32(p, le)); break;
      case 6:
      case 18: out.push(dv.getUint32(p, le)); break;
      case 7: out.push(dv.getFloat32(p, le)); break;
      case 9: out.push(dv.getFloat64(p, le)); break;
      case 12: out.push(Number(dv.getBigInt64(p, le))); break;
      case 13: out.push(Number(dv.getBigUint64(p, le))); break;
    }
  }
  return out;
}

interface Element {
  type: number;
  off: number;
  nbytes: number;
  next: number;
}

function readTag(dv: DataView, pos: number, le: boolean): Element {
  const first = dv.getUint32(pos, le);
  if (first >>> 16 !== 0) {
    // small data element
    return { type: first & 0xffff, nbytes: first >>> 16, off: pos + 4, next: pos + 8 };
  }
  const nbytes = dv.getUint32(pos + 4, le);
  const padded = first === mi.COMPRESSED ? nbytes : Math.ceil(nbytes / 8) * 8;
  return { type: first, nbytes, off: pos + 8, next: pos + 8 + padded };
}

function readMatrix(dv: DataView, off: number, nbytes: number, le: boolean): { name: string; value: Value } {
  let p = off;
  const flagsEl = readTag(dv, p, le);
  const flags = dv.getUint32(flagsEl.off, le);
  const cls = flags & 0xff;
  const complex = (flags & 0x800) !== 0;
  const logical = (flags & 0x200) !== 0;
  p = flagsEl.next;
  if (nbytes === 0) return { name: '', value: emptyTensor() };
  const dimsEl = readTag(dv, p, le);
  const dims = readNumeric(dv, dimsEl.off, dimsEl.nbytes, dimsEl.type, le);
  p = dimsEl.next;
  const nameEl = readTag(dv, p, le);
  const name = String.fromCharCode(...readNumeric(dv, nameEl.off, nameEl.nbytes, nameEl.type, le));
  p = nameEl.next;
  const rows = dims[0] ?? 0;
  const cols = dims.slice(1).reduce((a, b) => a * b, 1);
  const numel = rows * cols;
  if (cls === mx.CELL) {
    const data: Value[] = [];
    for (let i = 0; i < numel; i++) {
      const el = readTag(dv, p, le);
      data.push(readMatrix(dv, el.off, el.nbytes, le).value);
      p = el.next;
    }
    return { name, value: new CellArray(rows, cols, data) };
  }
  if (cls === mx.STRUCT || cls === mx.OBJECT) {
    if (cls === mx.OBJECT) {
      const cn = readTag(dv, p, le);
      p = cn.next;
    }
    const lenEl = readTag(dv, p, le);
    const flen = readNumeric(dv, lenEl.off, lenEl.nbytes, lenEl.type, le)[0];
    p = lenEl.next;
    const fnEl = readTag(dv, p, le);
    const raw = readNumeric(dv, fnEl.off, fnEl.nbytes, fnEl.type, le);
    p = fnEl.next;
    const fields: string[] = [];
    for (let k = 0; k * flen < raw.length; k++) {
      const chars = raw.slice(k * flen, (k + 1) * flen);
      const z = chars.indexOf(0);
      fields.push(String.fromCharCode(...(z >= 0 ? chars.slice(0, z) : chars)));
    }
    const data: Map<string, Value>[] = [];
    for (let i = 0; i < numel; i++) {
      const m = new Map<string, Value>();
      for (const f of fields) {
        const el = readTag(dv, p, le);
        m.set(f, readMatrix(dv, el.off, el.nbytes, le).value);
        p = el.next;
      }
      data.push(m);
    }
    return { name, value: new StructArray(rows, cols, fields, data) };
  }
  if (cls === mx.SPARSE) {
    const irEl = readTag(dv, p, le);
    const ir = readNumeric(dv, irEl.off, irEl.nbytes, irEl.type, le);
    p = irEl.next;
    const jcEl = readTag(dv, p, le);
    const jc = readNumeric(dv, jcEl.off, jcEl.nbytes, jcEl.type, le);
    p = jcEl.next;
    const prEl = readTag(dv, p, le);
    const pr = readNumeric(dv, prEl.off, prEl.nbytes, prEl.type, le);
    const t = new Tensor(rows, dims[1], new Float64Array(rows * dims[1]));
    for (let j = 0; j < dims[1]; j++) for (let k = jc[j]; k < jc[j + 1]; k++) t.re[j * rows + ir[k]] = logical ? 1 : pr[k];
    return { name, value: logical ? t.withClass('logical') : t };
  }
  const reEl = readTag(dv, p, le);
  const re = readNumeric(dv, reEl.off, reEl.nbytes, reEl.type, le);
  p = reEl.next;
  let im: number[] | null = null;
  if (complex) {
    const imEl = readTag(dv, p, le);
    im = readNumeric(dv, imEl.off, imEl.nbytes, imEl.type, le);
  }
  const numCls: NumClass = cls === mx.CHAR ? 'char' : logical ? 'logical' : MX_CLASS[cls] ?? 'double';
  const t = new Tensor(rows, cols, Float64Array.from(re.length === numel ? re : re.concat(new Array(Math.max(0, numel - re.length)).fill(0))), im ? Float64Array.from(im) : null, numCls);
  return { name, value: t };
}

export function readMat(bytes: Uint8Array): Map<string, Value> {
  if (bytes.length < 128) throw new MError('Not a MAT-file (too short).');
  const header = String.fromCharCode(...bytes.slice(0, 116));
  if (header.startsWith('MATLAB 7.3') || bytes[0] === 0x89) throw new MError('MAT-file version 7.3 (HDF5) is not supported. Save with save(..., \'-v7\') in MATLAB.');
  const endian = String.fromCharCode(bytes[126], bytes[127]);
  const le = endian === 'IM';
  const out = new Map<string, Value>();
  let dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 128;
  while (pos + 8 <= bytes.length) {
    const el = readTag(dv, pos, le);
    if (el.type === mi.COMPRESSED) {
      const inflated = unzlibSync(bytes.subarray(el.off, el.off + el.nbytes));
      const idv = new DataView(inflated.buffer, inflated.byteOffset, inflated.byteLength);
      const inner = readTag(idv, 0, le);
      if (inner.type === mi.MATRIX) {
        const m = readMatrix(idv, inner.off, inner.nbytes, le);
        out.set(m.name, m.value);
      }
    } else if (el.type === mi.MATRIX) {
      const m = readMatrix(dv, el.off, el.nbytes, le);
      out.set(m.name, m.value);
    }
    pos = el.next;
    dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  }
  return out;
}

// ---------------- Writer ----------------
class Writer {
  chunks: number[] = [];
  bytes(arr: ArrayLike<number>) {
    for (let i = 0; i < arr.length; i++) this.chunks.push(arr[i]);
  }
  u32(v: number) {
    this.bytes([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);
  }
  pad() {
    while (this.chunks.length % 8) this.chunks.push(0);
  }
}

function element(type: number, data: Uint8Array): Uint8Array {
  const w = new Writer();
  w.u32(type);
  w.u32(data.length);
  w.bytes(data);
  w.pad();
  return Uint8Array.from(w.chunks);
}

function f64(values: ArrayLike<number>): Uint8Array {
  const b = new Uint8Array(values.length * 8);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < values.length; i++) dv.setFloat64(i * 8, values[i], true);
  return b;
}

function i32(values: number[]): Uint8Array {
  const b = new Uint8Array(values.length * 4);
  const dv = new DataView(b.buffer);
  values.forEach((v, i) => dv.setInt32(i * 4, v, true));
  return b;
}

function u16(values: ArrayLike<number>): Uint8Array {
  const b = new Uint8Array(values.length * 2);
  const dv = new DataView(b.buffer);
  for (let i = 0; i < values.length; i++) dv.setUint16(i * 2, values[i], true);
  return b;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const n = parts.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function matrixElement(name: string, v: Value): Uint8Array {
  const parts: Uint8Array[] = [];
  let cls: number, flags = 0;
  const nameBytes = new TextEncoder().encode(name);
  const dims = [v.rows, v.cols];
  const body: Uint8Array[] = [];
  switch (v.kind) {
    case 'tensor': {
      if (v.cls === 'char') {
        cls = mx.CHAR;
        body.push(element(mi.UTF16, u16(v.re)));
      } else {
        cls = v.cls === 'logical' ? mx.UINT8 : mx.DOUBLE;
        if (v.cls === 'logical') {
          flags |= 0x200;
          body.push(element(mi.UINT8, Uint8Array.from(v.re)));
        } else {
          body.push(element(mi.DOUBLE, f64(v.re)));
          if (v.im) {
            flags |= 0x800;
            body.push(element(mi.DOUBLE, f64(v.im)));
          }
        }
      }
      break;
    }
    case 'string': {
      // store string arrays as cell arrays of char
      return matrixElement(name, new CellArray(v.rows, v.cols, v.data.map((s) => {
        const t = new Tensor(1, s.length, Float64Array.from(s, (ch) => ch.charCodeAt(0)), null, 'char');
        return t;
      })));
    }
    case 'cell':
      cls = mx.CELL;
      for (const c of v.data) body.push(matrixElement('', c));
      break;
    case 'struct': {
      cls = mx.STRUCT;
      const flen = Math.max(32, ...v.fields.map((f) => f.length + 1));
      body.push(element(mi.INT32, i32([flen])));
      const names = new Uint8Array(flen * v.fields.length);
      v.fields.forEach((f, k) => names.set(new TextEncoder().encode(f), k * flen));
      body.push(element(mi.INT8, names));
      for (const m of v.data) for (const f of v.fields) body.push(matrixElement('', m.get(f) ?? emptyTensor()));
      break;
    }
    case 'fhandle':
      throw new MError('Function handles cannot be saved to MAT-files.');
  }
  const flagBytes = new Uint8Array(8);
  new DataView(flagBytes.buffer).setUint32(0, flags | cls!, true);
  parts.push(element(mi.UINT32, flagBytes));
  parts.push(element(mi.INT32, i32(dims)));
  parts.push(element(mi.INT8, nameBytes));
  parts.push(...body);
  return element(mi.MATRIX, concatBytes(parts));
}

export function writeMat(vars: [string, Value][], compress = true): Uint8Array {
  const header = new Uint8Array(128).fill(32);
  const text = `MATLAB 5.0 MAT-file, Platform: QUANTA, Created on: ${new Date().toUTCString()}`;
  header.set(new TextEncoder().encode(text.slice(0, 116)));
  for (let i = 116; i < 124; i++) header[i] = 0;
  header[124] = 0x00;
  header[125] = 0x01;
  header[126] = 'I'.charCodeAt(0);
  header[127] = 'M'.charCodeAt(0);
  const parts: Uint8Array[] = [header];
  for (const [n, v] of vars) {
    const el = matrixElement(n, v);
    if (compress) {
      const z = zlibSync(el);
      const w = new Writer();
      w.u32(mi.COMPRESSED);
      w.u32(z.length);
      parts.push(Uint8Array.from(w.chunks), z);
    } else parts.push(el);
  }
  return concatBytes(parts);
}

export { StringArray };
