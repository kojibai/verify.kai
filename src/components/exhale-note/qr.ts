// src/components/exhale-note/qr.ts
// minimal QR -> SVG with autosizing (uses the REAL url you pass in)
// Public API: makeQrSvgTagSafe(url, pixelSize=110, margin=2)

export const QRErrorCorrectLevel = { L: 1, M: 0, Q: 3, H: 2 } as const;
export type ECLevel = (typeof QRErrorCorrectLevel)[keyof typeof QRErrorCorrectLevel];

class QRBitBuffer {
  buffer: number[] = [];
  length = 0;
  get(i: number): boolean {
    return (((this.buffer[Math.floor(i / 8)] >>> (7 - (i % 8))) & 1) === 1);
  }
  put(num: number, length: number): void {
    for (let i = 0; i < length; i++) this.putBit(((num >>> (length - i - 1)) & 1) === 1);
  }
  putBit(bit: boolean): void {
    if (this.length === this.buffer.length * 8) this.buffer.push(0);
    if (bit) this.buffer[this.length >>> 3] |= 0x80 >>> (this.length % 8);
    this.length++;
  }
  getLengthInBits(): number {
    return this.length;
  }
}

// GF(256)
const QRMath = (() => {
  const EXP = new Array<number>(256);
  const LOG = new Array<number>(256);
  for (let i = 0; i < 8; i++) EXP[i] = 1 << i;
  for (let i = 8; i < 256; i++) EXP[i] = EXP[i - 4] ^ EXP[i - 5] ^ EXP[i - 6] ^ EXP[i - 8];
  for (let i = 0; i < 256; i++) LOG[EXP[i]] = i;
  const gexp = (n: number): number => {
    let x = n;
    while (x < 0) x += 255;
    while (x >= 256) x -= 255;
    return EXP[x];
  };
  const glog = (n: number): number => {
    if (n < 1) throw new Error("glog");
    return LOG[n];
  };
  return { gexp, glog };
})();

class QRPolynomial {
  num: number[];
  constructor(num: number[], shift: number) {
    let offset = 0;
    while (offset < num.length && num[offset] === 0) offset++;
    this.num = new Array(num.length - offset + shift);
    for (let i = 0; i < num.length - offset; i++) this.num[i] = num[i + offset];
  }
  get(i: number): number { return this.num[i]; }
  getLength(): number { return this.num.length; }
  multiply(e: QRPolynomial): QRPolynomial {
    const num = new Array(this.getLength() + e.getLength() - 1).fill(0);
    for (let i = 0; i < this.getLength(); i++)
      for (let j = 0; j < e.getLength(); j++)
        num[i + j] ^= QRMath.gexp(QRMath.glog(this.get(i)) + QRMath.glog(e.get(j)));
    return new QRPolynomial(num, 0);
  }
  mod(e: QRPolynomial): QRPolynomial {
    if (this.getLength() - e.getLength() < 0) return this;
    const ratio = QRMath.glog(this.get(0)) - QRMath.glog(e.get(0));
    const num = this.num.slice();
    for (let i = 0; i < e.getLength(); i++)
      num[i] ^= QRMath.gexp(QRMath.glog(e.get(i)) + ratio);
    return new QRPolynomial(num, 0).mod(e);
  }
}

const QRUtil = (() => {
  // Version 1..12 (enough for most short URLs). Extend if you need bigger codes.
  const PATTERN_POSITION_TABLE: number[][] = [
    [], [6,18], [6,22], [6,26], [6,30], [6,34], [6,22,38], [6,24,42], [6,26,46], [6,28,50], [6,30,54], [6,32,58], [6,34,62],
  ];
  const G15 = 1335, G18 = 7973, G15_MASK = 21522;
  const getBCHDigit = (d: number): number => { let n = 0, x = d; while (x !== 0) { n++; x >>>= 1; } return n; };
  function getBCHTypeInfo(data: number): number {
    let d = data << 10;
    while (getBCHDigit(d) - getBCHDigit(G15) >= 0) d ^= G15 << (getBCHDigit(d) - getBCHDigit(G15));
    return ((data << 10) | d) ^ G15_MASK;
  }
  function getBCHTypeNumber(data: number): number {
    let d = data << 12;
    while (getBCHDigit(d) - getBCHDigit(G18) >= 0) d ^= G18 << (getBCHDigit(d) - getBCHDigit(G18));
    return (data << 12) | d;
  }
  function getPatternPosition(t: number): number[] { return PATTERN_POSITION_TABLE[t - 1]; }
  function getErrorCorrectPolynomial(ecLength: number): QRPolynomial {
    let a = new QRPolynomial([1], 0);
    for (let i = 0; i < ecLength; i++) a = a.multiply(new QRPolynomial([1, QRMath.gexp(i)], 0));
    return a;
  }
  function getMask(p: number, i: number, j: number): boolean {
    switch (p) {
      case 0: return (i + j) % 2 === 0;
      case 1: return i % 2 === 0;
      case 2: return j % 3 === 0;
      case 3: return (i + j) % 3 === 0;
      case 4: return (Math.floor(i/2) + Math.floor(j/3)) % 2 === 0;
      case 5: return (((i*j)%2)+((i*j)%3)) % 2 === 0;
      case 6: return ((((i*j)%2)+((i*j)%3)) % 2) === 0;
      case 7: return ((((i*j)%3)+((i+j)%2)) % 2) === 0;
      default: throw new Error("bad mask");
    }
  }
  function getLostPoint(qr: QRCodeModel): number {
    const mc = qr.getModuleCount();
    let lost = 0;
    // rows
    for (let r = 0; r < mc; r++) {
      let same = 0;
      let dark = qr.isDark(r, 0);
      for (let c = 0; c < mc; c++) {
        if (qr.isDark(r, c) === dark) same++;
        else {
          if (same >= 5) lost += 3 + (same - 5);
          dark = qr.isDark(r, c);
          same = 1;
        }
      }
      if (same >= 5) lost += 3 + (same - 5);
    }
    // cols
    for (let c = 0; c < mc; c++) {
      let same = 0;
      let dark = qr.isDark(0, c);
      for (let r = 0; r < mc; r++) {
        if (qr.isDark(r, c) === dark) same++;
        else {
          if (same >= 5) lost += 3 + (same - 5);
          dark = qr.isDark(r, c);
          same = 1;
        }
      }
      if (same >= 5) lost += 3 + (same - 5);
    }
    // 2x2 blocks
    for (let r = 0; r < mc - 1; r++)
      for (let c = 0; c < mc - 1; c++) {
        const count = (qr.isDark(r,c)?1:0) + (qr.isDark(r+1,c)?1:0) + (qr.isDark(r,c+1)?1:0) + (qr.isDark(r+1,c+1)?1:0);
        if (count === 0 || count === 4) lost += 3;
      }
    // finder-like patterns (rows)
    for (let r = 0; r < mc; r++)
      for (let c = 0; c < mc - 6; c++)
        if (qr.isDark(r,c) && !qr.isDark(r,c+1) && qr.isDark(r,c+2) && qr.isDark(r,c+3) && qr.isDark(r,c+4) && !qr.isDark(r,c+5) && qr.isDark(r,c+6)) {
          const left =
            c >= 4 && !qr.isDark(r,c-1) && !qr.isDark(r,c-2) && !qr.isDark(r,c-3) && !qr.isDark(r,c-4);
          const right =
            c + 7 <= mc - 5 && !qr.isDark(r,c+7) && !qr.isDark(r,c+8) && !qr.isDark(r,c+9) && !qr.isDark(r,c+10);
          if (left || right) lost += 40;
        }
    // finder-like patterns (cols)
    for (let c = 0; c < mc; c++)
      for (let r = 0; r < mc - 6; r++)
        if (qr.isDark(r,c) && !qr.isDark(r+1,c) && qr.isDark(r+2,c) && qr.isDark(r+3,c) && qr.isDark(r+4,c) && !qr.isDark(r+5,c) && qr.isDark(r+6,c)) {
          const up = r >= 4 && !qr.isDark(r-1,c) && !qr.isDark(r-2,c) && !qr.isDark(r-3,c) && !qr.isDark(r-4,c);
          const down = r + 7 <= mc - 5 && !qr.isDark(r+7,c) && !qr.isDark(r+8,c) && !qr.isDark(r+9,c) && !qr.isDark(r+10,c);
          if (up || down) lost += 40; // <-- FIXED: use ||, not `or`
        }
    // balance
    let darkCount = 0;
    for (let r = 0; r < mc; r++)
      for (let c = 0; c < mc; c++) if (qr.isDark(r, c)) darkCount++;
    const ratio = Math.abs((darkCount * 100) / (mc * mc) - 50) / 5;
    lost += ratio * 10;
    return lost;
  }
  return {
    getPatternPosition,
    getBCHTypeInfo,
    getBCHTypeNumber,
    getErrorCorrectPolynomial,
    getMask,
    getLostPoint,
  };
})();

class QR8bitByte {
  mode = 4; // byte mode
  parsed: Uint8Array;
  constructor(public data: string) {
    this.parsed = new TextEncoder().encode(data);
  }
  getLength(): number { return this.parsed.length; }
  write(buf: QRBitBuffer): void {
    for (let i = 0; i < this.parsed.length; i++) buf.put(this.parsed[i], 8);
  }
}

// RS blocks for versions 1..12 at EC L/M/Q/H (subset)
const RS_BLOCK_TABLE: Array<null | Array<Array<[totalCount: number, dataCount: number]>>> = [
  null,
  [[[19,16]], [[16,14]], [[13,11]], [[9,9]]],
  [[[34,28]], [[28,22]], [[22,16]], [[16,12]]],
  [[[55,44]], [[44,34]], [[34,26]], [[26,18]]],
  [[[80,64]], [[64,52]], [[48,38]], [[36,26]]],
  [[[108,86]], [[86,70]], [[62,46]], [[46,34]]],
  [[[136,108]], [[108,86]], [[76,60]], [[60,42]]],
  [[[156,124]], [[124,98]], [[88,66]], [[66,50]]],
  [[[194,154]], [[154,122]], [[110,86]], [[86,62]]],
  [[[232,182]], [[182,143]], [[132,100]], [[100,74]]],
  [[[274,216]], [[216,174]], [[154,122]], [[122,86]]],
  [[[324,254]], [[254,202]], [[180,140]], [[140,100]]],
];

const levelIndex = (lvl: ECLevel): number =>
  lvl === QRErrorCorrectLevel.L ? 0 : lvl === QRErrorCorrectLevel.M ? 1 : lvl === QRErrorCorrectLevel.Q ? 2 : 3;

const QRRSBlock = {
  getRSBlocks(typeNumber: number, errorCorrectLevel: ECLevel): Array<{ totalCount: number; dataCount: number }> {
    const idx = levelIndex(errorCorrectLevel);
    const row = RS_BLOCK_TABLE[typeNumber];
    if (!row) throw new Error("Bad typeNumber");
    return row[idx].map((t) => ({ totalCount: t[0], dataCount: t[1] }));
  },
};

export class QRCodeModel {
  modules: (boolean | null)[][] = [];
  moduleCount = 0;
  dataList: QR8bitByte[] = [];
  dataCache: number[] | null = null;
  constructor(public typeNumber: number, public errorCorrectLevel: ECLevel) {}
  addData(data: string): void {
    this.dataList.push(new QR8bitByte(data));
    this.dataCache = null;
  }

  // Require both row & col for safety
  isDark(r: number, c?: number): boolean {
    if (c === undefined) throw new Error("QRCodeModel.isDark requires row and column arguments");
    return this.modules[r][c] === true;
  }
  getModuleCount(): number { return this.moduleCount; }

  make(): void {
    if (this.typeNumber < 1) {
      // auto-pick smallest version that fits (up to v12)
      for (let t = 1; t <= 12; t++) {
        const test = new QRCodeModel(t, this.errorCorrectLevel);
        for (const d of this.dataList) test.addData(d.data);
        try {
          test.makeImpl(true, 0);
          this.typeNumber = t;
          break;
        } catch { /* overflow -> next */ }
      }
      if (this.typeNumber < 1) throw new Error("data overflow");
    }
    this.makeImpl(false, 0);
  }

  private makeImpl(test: boolean, maskPattern: number): void {
    this.moduleCount = this.typeNumber * 4 + 17;
    this.modules = Array.from({ length: this.moduleCount }, () => Array<boolean | null>(this.moduleCount).fill(null));

    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupTimingPattern();
    this.setupPositionAdjustPattern();
    this.setupTypeInfo(test, maskPattern);
    if (this.typeNumber >= 7) this.setupTypeNumber(test);

    const data = this.createData(this.typeNumber, this.errorCorrectLevel, this.dataList);
    this.mapData(data, maskPattern);

    // choose best mask
    let bestMask = 0;
    let bestLost = Number.POSITIVE_INFINITY;
    for (let p = 0; p < 8; p++) {
      const q = new QRCodeModel(this.typeNumber, this.errorCorrectLevel);
      q.modules = this.modules.map((r) => r.slice());
      q.dataCache = this.dataCache;
      q.mapData(this.dataCache!, p);
      const lost = QRUtil.getLostPoint(q);
      if (lost < bestLost) { bestLost = lost; bestMask = p; }
    }
    // re-render with best mask
    this.modules = Array.from({ length: this.moduleCount }, () => Array<boolean | null>(this.moduleCount).fill(null));
    this.setupPositionProbePattern(0, 0);
    this.setupPositionProbePattern(this.moduleCount - 7, 0);
    this.setupPositionProbePattern(0, this.moduleCount - 7);
    this.setupTimingPattern();
    this.setupPositionAdjustPattern();
    this.setupTypeInfo(false, bestMask);
    if (this.typeNumber >= 7) this.setupTypeNumber(false);
    this.mapData(this.dataCache!, bestMask);
  }

  private setupPositionProbePattern(row: number, col: number): void {
    for (let r = -1; r <= 7; r++)
      for (let c = -1; c <= 7; c++) {
        const rr = row + r, cc = col + c;
        if (rr < 0 || rr >= this.moduleCount || cc < 0 || cc >= this.moduleCount) continue;
        const v = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
                  (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
                  (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        this.modules[rr][cc] = v;
      }
  }
  private setupTimingPattern(): void {
    for (let r = 8; r < this.moduleCount - 8; r++)
      if (this.modules[r][6] === null) this.modules[r][6] = r % 2 === 0;
    for (let c = 8; c < this.moduleCount - 8; c++)
      if (this.modules[6][c] === null) this.modules[6][c] = c % 2 === 0;
  }
 private setupPositionAdjustPattern(): void {
  const pos = QRUtil.getPatternPosition(this.typeNumber);
  for (let i = 0; i < pos.length; i++)
    for (let j = 0; j < pos.length; j++) {
      const row = pos[i], col = pos[j];
      if (this.modules[row][col] !== null) continue;

      for (let r = -2; r <= 2; r++)
        for (let c = -2; c <= 2; c++) {
          const rr = row + r, cc = col + c;
          if (rr < 0 || rr >= this.moduleCount || cc < 0 || cc >= this.moduleCount) continue;

          // ✅ Correct alignment pattern:
          // outer border (|r|==2 or |c|==2) dark, center (0,0) dark, middle ring light
          const dark = (Math.abs(r) === 2) || (Math.abs(c) === 2) || (r === 0 && c === 0);
          this.modules[rr][cc] = dark;
        }
    }
}

  private setupTypeNumber(test: boolean): void {
    const bits = QRUtil.getBCHTypeNumber(this.typeNumber);
    for (let i = 0; i < 18; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      this.modules[Math.floor(i/3)][(i%3) + this.moduleCount - 8 - 3] = mod;
      this.modules[(i%3) + this.moduleCount - 8 - 3][Math.floor(i/3)] = mod;
    }
  }
  private setupTypeInfo(test: boolean, maskPattern: number): void {
    // Respect the instance's EC level
    const data = (this.errorCorrectLevel << 3) | maskPattern;
    const bits = QRUtil.getBCHTypeInfo(data);
    for (let i = 0; i < 15; i++) {
      const mod = !test && ((bits >> i) & 1) === 1;
      // vertical
      if (i < 6) this.modules[i][8] = mod;
      else if (i < 8) this.modules[i + 1][8] = mod;
      else this.modules[this.moduleCount - 15 + i][8] = mod;
      // horizontal
      const j = 14 - i;
      if (j < 8) this.modules[8][j] = mod;
      else this.modules[8][j + 1] = mod;
    }
    this.modules[this.moduleCount - 8][8] = true;
  }

  private createData(typeNumber: number, errorCorrectLevel: ECLevel, dataList: QR8bitByte[]): number[] {
    const rsBlocks = QRRSBlock.getRSBlocks(typeNumber, errorCorrectLevel);
    const buffer = new QRBitBuffer();
    for (const d of dataList) {
      buffer.put(4, 4); // mode: byte
      const lenBits = typeNumber < 10 ? 8 : 16;
      buffer.put(d.getLength(), lenBits);
      d.write(buffer);
    }
    let totalDataCount = 0;
    for (const b of rsBlocks) totalDataCount += b.dataCount;
    if (buffer.getLengthInBits() > totalDataCount * 8) throw new Error("data overflow");

    // terminator & padding
    if (buffer.getLengthInBits() + 4 <= totalDataCount * 8) buffer.put(0, 4);
    while (buffer.getLengthInBits() % 8 !== 0) buffer.putBit(false);

    const bytes: number[] = [];
    const dataBytes = buffer.getLengthInBits() / 8;
    for (let i = 0; i < dataBytes; i++) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | (buffer.get(i * 8 + j) ? 1 : 0);
      bytes.push(v);
    }

    const PAD0 = 0xec, PAD1 = 0x11;
    let padIndex = 0;
    while (bytes.length < totalDataCount) bytes.push(padIndex++ % 2 === 0 ? PAD0 : PAD1);

    function createBytes(
      blocks: Array<{ totalCount: number; dataCount: number }>,
      data: number[]
    ): number[] {
      let offset = 0;
      const dcdata: number[][] = [];
      const ecdata: number[][] = [];
      for (const rs of blocks) {
        const dcCount = rs.dataCount;
        const ecCount = rs.totalCount - dcCount;
        const dc = data.slice(offset, offset + dcCount);
        offset += dcCount;
        dcdata.push(dc);
        const rsPoly = QRUtil.getErrorCorrectPolynomial(ecCount);
        const rawPoly = new QRPolynomial(dc, rsPoly.getLength() - 1);
        const modPoly = rawPoly.mod(rsPoly);
        const ec = new Array(ecCount).fill(0);
        const mLen = modPoly.getLength();
        for (let i = 0; i < ecCount; i++)
          ec[i] = i + mLen - ecCount >= 0 ? modPoly.get(i + mLen - ecCount) : 0;
        ecdata.push(ec);
      }
      const totalLength = blocks.reduce((sum: number, r) => sum + r.totalCount, 0);
      const result: number[] = [];
      const maxDc = Math.max(...dcdata.map((d) => d.length));
      const maxEc = Math.max(...ecdata.map((e) => e.length));
      for (let i = 0; i < maxDc; i++)
        for (let r = 0; r < dcdata.length; r++)
          if (i < dcdata[r].length) result.push(dcdata[r][i]);
      for (let i = 0; i < maxEc; i++)
        for (let r = 0; r < ecdata.length; r++)
          if (i < ecdata[r].length) result.push(ecdata[r][i]);
      return result.slice(0, totalLength);
    }

    this.dataCache = createBytes(rsBlocks, bytes);
    return this.dataCache;
  }

  private mapData(data: number[], maskPattern: number): void {
    let inc = -1, row = this.moduleCount - 1, bitIndex = 7, byteIndex = 0;
    for (let col = this.moduleCount - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (let c = 0; c < 2; c++) {
          if (this.modules[row][col - c] === null) {
            let dark = false;
            if (byteIndex < data.length) dark = ((data[byteIndex] >>> bitIndex) & 1) === 1;
            const mask = QRUtil.getMask(maskPattern, row, col - c);
            this.modules[row][col - c] = mask ? !dark : dark;
            bitIndex--;
            if (bitIndex === -1) { byteIndex++; bitIndex = 7; }
          }
        }
        row += inc;
        if (row < 0 || row >= this.moduleCount) { row -= inc; inc = -inc; break; }
      }
    }
  }

  createSvgTag({ cellSize = 2, margin = 2 }: { cellSize?: number; margin?: number; }): string {
    const moduleCount = this.getModuleCount();
    const size = cellSize * (moduleCount + margin * 2);
    let d = "";
    for (let r = 0; r < moduleCount; r++)
      for (let c = 0; c < moduleCount; c++)
        if (this.isDark(r, c)) {
          const x = (c + margin) * cellSize;
          const y = (r + margin) * cellSize;
          d += `M${x} ${y}h${cellSize}v${cellSize}h-${cellSize}z`;
        }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges">
  <rect width="100%" height="100%" fill="#fff"/>
  <path d="${d}" fill="#000"/>
</svg>`;
  }
}

function tryMakeQrSvg(raw: string, pixelSize = 110, margin = 2, ec: ECLevel = QRErrorCorrectLevel.M): string {
  const qr = new QRCodeModel(0, ec);
  qr.addData(raw); // USE EXACT URL (no shortening)
  qr.make();       // auto-choose version (1..12)
  const cell = Math.max(1, Math.floor(pixelSize / (qr.getModuleCount() + margin * 2)));
  return qr.createSvgTag({ cellSize: cell, margin });
}

/**
 * Public API: generate an SVG QR using the real URL as-is.
 * Tries EC-M first; if too long for our version table, retries with EC-L.
 */
export function makeQrSvgTagSafe(url: string, pixelSize = 110, margin = 2): string {
  try {
    return tryMakeQrSvg(url, pixelSize, margin, QRErrorCorrectLevel.M);
  } catch (e) {
    const msg = (e as Error)?.message || "";
    if (msg.includes("overflow")) {
      try {
        return tryMakeQrSvg(url, pixelSize, margin, QRErrorCorrectLevel.L);
      } catch { /* fallthrough */ }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelSize}" height="${pixelSize}">
  <rect width="100%" height="100%" fill="#fff"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="#000" font-size="10">QR ERROR</text>
</svg>`;
  }
}
