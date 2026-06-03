const DISPLAY_WIDTH = 576;
const DISPLAY_HEIGHT = 135;
const ROW_SIZE_BYTES = Math.ceil(DISPLAY_WIDTH / 32) * 4;
const PIXEL_DATA_OFFSET = 62;

const TOP_BAR = { x: 6, y: 4, w: 564, h: 23 };
const CUE_PANEL = { x: 6, y: 32, w: 564, h: 72 };
const TRANSCRIPT_BAR = { x: 6, y: 109, w: 564, h: 26 };

const FONT: Record<string, string[]> = {
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00010", "00100", "00000", "00100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "01100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "01100", "01000"],
  "'": ["00100", "00100", "00000", "00000", "00000", "00000", "00000"],
  "\"": ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "/": ["00001", "00010", "00100", "00100", "01000", "10000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "+": ["00000", "00100", "00100", "11111", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "A": ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  "B": ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  "C": ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  "D": ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  "E": ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  "F": ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  "G": ["01110", "10001", "10000", "10111", "10001", "10001", "01110"],
  "H": ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  "I": ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  "J": ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  "K": ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  "L": ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  "M": ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  "N": ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  "O": ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  "P": ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  "Q": ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  "R": ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  "S": ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  "T": ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  "U": ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  "V": ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  "W": ["10001", "10001", "10001", "10101", "10101", "10101", "01010"],
  "X": ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  "Y": ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  "Z": ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
};

export type ManualBitmapDisplayInput = {
  statusHeader: string;
  statusBody: string;
  answerHeader: string;
  answerBody: string;
};

class MonoBitmap {
  private readonly buffer: Buffer;

  constructor() {
    const fileSize = PIXEL_DATA_OFFSET + ROW_SIZE_BYTES * DISPLAY_HEIGHT;
    this.buffer = Buffer.alloc(fileSize, 0x00);
    this.writeHeader(fileSize);
  }

  toBase64(): string {
    return this.buffer.toString("base64");
  }

  setPixel(x: number, y: number, lit: boolean): void {
    if (x < 0 || y < 0 || x >= DISPLAY_WIDTH || y >= DISPLAY_HEIGHT) return;
    const destY = DISPLAY_HEIGHT - 1 - y;
    const byteOffset = PIXEL_DATA_OFFSET + destY * ROW_SIZE_BYTES + Math.floor(x / 8);
    const bit = 7 - (x % 8);
    if (lit) {
      this.buffer[byteOffset] |= 1 << bit;
    } else {
      this.buffer[byteOffset] &= ~(1 << bit);
    }
  }

  line(x1: number, y1: number, x2: number, y2: number, thickness = 1): void {
    if (x1 === x2) {
      for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y++) {
        for (let offset = 0; offset < thickness; offset++) this.setPixel(x1 + offset, y, true);
      }
      return;
    }
    if (y1 === y2) {
      for (let x = Math.min(x1, x2); x <= Math.max(x1, x2); x++) {
        for (let offset = 0; offset < thickness; offset++) this.setPixel(x, y1 + offset, true);
      }
      return;
    }

    const dx = Math.abs(x2 - x1);
    const sx = x1 < x2 ? 1 : -1;
    const dy = -Math.abs(y2 - y1);
    const sy = y1 < y2 ? 1 : -1;
    let err = dx + dy;
    let x = x1;
    let y = y1;
    while (true) {
      for (let ox = 0; ox < thickness; ox++) {
        for (let oy = 0; oy < thickness; oy++) this.setPixel(x + ox, y + oy, true);
      }
      if (x === x2 && y === y2) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.line(x, y, x + w - 1, y, 2);
    this.line(x, y + h - 2, x + w - 1, y + h - 2, 2);
    this.line(x, y, x, y + h - 1, 2);
    this.line(x + w - 2, y, x + w - 2, y + h - 1, 2);
  }

  text(text: string, x: number, y: number, maxWidth: number, maxLines: number, options: { bold?: boolean; scale?: number } = {}): void {
    const scale = options.scale ?? 2;
    const lines = wrapBitmapText(text, maxWidth, scale);
    const visible = lines.slice(0, maxLines);
    visible.forEach((line, lineIndex) => {
      drawTextLine(this, line, x, y + lineIndex * (8 * scale), { ...options, scale });
    });
  }

  private writeHeader(fileSize: number): void {
    let offset = 0;
    this.buffer.write("BM", offset); offset += 2;
    this.buffer.writeUInt32LE(fileSize, offset); offset += 4;
    this.buffer.writeUInt16LE(0, offset); offset += 2;
    this.buffer.writeUInt16LE(0, offset); offset += 2;
    this.buffer.writeUInt32LE(PIXEL_DATA_OFFSET, offset); offset += 4;

    this.buffer.writeUInt32LE(40, offset); offset += 4;
    this.buffer.writeInt32LE(DISPLAY_WIDTH, offset); offset += 4;
    this.buffer.writeInt32LE(DISPLAY_HEIGHT, offset); offset += 4;
    this.buffer.writeUInt16LE(1, offset); offset += 2;
    this.buffer.writeUInt16LE(1, offset); offset += 2;
    this.buffer.writeUInt32LE(0, offset); offset += 4;
    this.buffer.writeUInt32LE(ROW_SIZE_BYTES * DISPLAY_HEIGHT, offset); offset += 4;
    this.buffer.writeInt32LE(2835, offset); offset += 4;
    this.buffer.writeInt32LE(2835, offset); offset += 4;
    this.buffer.writeUInt32LE(2, offset); offset += 4;
    this.buffer.writeUInt32LE(2, offset); offset += 4;

    this.buffer.writeUInt32LE(0x00000000, offset); offset += 4;
    this.buffer.writeUInt8(255, offset++);
    this.buffer.writeUInt8(255, offset++);
    this.buffer.writeUInt8(255, offset++);
    this.buffer.writeUInt8(0, offset++);
  }
}

export function renderManualBitmapDisplay(input: ManualBitmapDisplayInput): string {
  const bitmap = new MonoBitmap();
  drawTopBar(bitmap, input.statusHeader, input.answerHeader);
  drawCuePanel(bitmap, input.answerHeader, input.answerBody || "Ready.");
  drawTranscriptBar(bitmap, input.statusBody);
  return bitmap.toBase64();
}

function drawTopBar(bitmap: MonoBitmap, statusHeader: string, answerHeader: string): void {
  bitmap.rect(TOP_BAR.x, TOP_BAR.y, TOP_BAR.w, TOP_BAR.h);
  bitmap.text("SAYNEXT", TOP_BAR.x + 8, TOP_BAR.y + 6, 92, 1, { bold: true, scale: 2 });
  drawStatusPill(bitmap, TOP_BAR.x + 112, TOP_BAR.y + 5, compactStatusLabel(statusHeader));
  bitmap.text(cleanBitmapText(answerHeader).toUpperCase(), TOP_BAR.x + TOP_BAR.w - 112, TOP_BAR.y + 7, 104, 1, { scale: 1 });
}

function drawCuePanel(bitmap: MonoBitmap, header: string, body: string): void {
  bitmap.rect(CUE_PANEL.x, CUE_PANEL.y, CUE_PANEL.w, CUE_PANEL.h);
  bitmap.line(CUE_PANEL.x + 35, CUE_PANEL.y + 2, CUE_PANEL.x + 35, CUE_PANEL.y + CUE_PANEL.h - 3, 2);
  drawCueIcon(bitmap, CUE_PANEL.x + 11, CUE_PANEL.y + 10);
  bitmap.text(cleanBitmapText(header).toUpperCase(), CUE_PANEL.x + 45, CUE_PANEL.y + 7, 132, 1, { bold: true, scale: 1 });
  bitmap.line(CUE_PANEL.x + 44, CUE_PANEL.y + 20, CUE_PANEL.x + CUE_PANEL.w - 8, CUE_PANEL.y + 20, 2);
  bitmap.text(cleanBitmapText(body), CUE_PANEL.x + 45, CUE_PANEL.y + 28, CUE_PANEL.w - 54, 3, { scale: 2 });
}

function drawTranscriptBar(bitmap: MonoBitmap, transcript: string): void {
  bitmap.rect(TRANSCRIPT_BAR.x, TRANSCRIPT_BAR.y, TRANSCRIPT_BAR.w, TRANSCRIPT_BAR.h);
  bitmap.text("LIVE", TRANSCRIPT_BAR.x + 8, TRANSCRIPT_BAR.y + 7, 48, 1, { bold: true, scale: 2 });
  bitmap.line(TRANSCRIPT_BAR.x + 57, TRANSCRIPT_BAR.y + 5, TRANSCRIPT_BAR.x + 57, TRANSCRIPT_BAR.y + TRANSCRIPT_BAR.h - 6, 2);
  bitmap.text(cleanBitmapText(transcript) || "Listening for speech.", TRANSCRIPT_BAR.x + 66, TRANSCRIPT_BAR.y + 7, TRANSCRIPT_BAR.w - 74, 1, { scale: 2 });
}

function drawStatusPill(bitmap: MonoBitmap, x: number, y: number, text: string): void {
  bitmap.rect(x, y, 88, 13);
  for (let dx = 0; dx < 4; dx++) {
    for (let dy = 0; dy < 4; dy++) bitmap.setPixel(x + 5 + dx, y + 5 + dy, true);
  }
  bitmap.text(text, x + 14, y + 3, 72, 1, { scale: 1 });
}

function drawCueIcon(bitmap: MonoBitmap, x: number, y: number): void {
  bitmap.rect(x, y, 14, 14);
  bitmap.line(x + 3, y + 5, x + 10, y + 5);
  bitmap.line(x + 3, y + 8, x + 8, y + 8);
  bitmap.setPixel(x + 11, y + 13, true);
  bitmap.setPixel(x + 12, y + 14, true);
  bitmap.setPixel(x + 13, y + 15, true);
}

function compactStatusLabel(statusHeader: string): string {
  const text = cleanBitmapText(statusHeader).toUpperCase();
  if (text.includes("HEARING")) return "HEARING";
  if (text.includes("HEARD")) return "HEARD";
  if (text.includes("GEN")) return "GEN";
  if (text.includes("BUSY")) return "BUSY";
  if (text.includes("NO ASR")) return "NO ASR";
  if (text.includes("READY")) return "READY";
  if (text.includes("LISTEN")) return "LISTEN";
  return "LIVE";
}

function drawTextLine(bitmap: MonoBitmap, text: string, x: number, y: number, options: { bold?: boolean; scale?: number }): void {
  const scale = options.scale ?? 2;
  let cursor = x;
  for (const char of text) {
    const glyph = FONT[char.toUpperCase()] || FONT[" "];
    for (let row = 0; row < glyph.length; row++) {
      for (let col = 0; col < glyph[row].length; col++) {
        if (glyph[row][col] === "1") {
          for (let ox = 0; ox < scale; ox++) {
            for (let oy = 0; oy < scale; oy++) {
              bitmap.setPixel(cursor + col * scale + ox, y + row * scale + oy, true);
              if (options.bold) bitmap.setPixel(cursor + col * scale + ox + 1, y + row * scale + oy, true);
            }
          }
        }
      }
    }
    cursor += 6 * scale + (options.bold ? 1 : 0);
  }
}

function wrapBitmapText(text: string, maxWidth: number, scale = 2): string[] {
  const maxChars = Math.max(1, Math.floor(maxWidth / (6 * scale)));
  const normalized = cleanBitmapText(text).replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const words = normalized.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxChars) {
        lines.push(word.slice(index, index + maxChars));
      }
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function cleanBitmapText(text: string): string {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/[{}[\]\\|<>_*`~^]/g, " ")
    .replace(/\s+\n/g, "\n")
    .replace(/\n+/g, " ")
    .trim();
}
