export interface UploadValidation {
  valid: boolean;
  reason?: string;
  contentType?: "application/pdf" | "image/png" | "image/jpeg";
  width?: number;
  height?: number;
}

async function readBytes(file: Blob, size = 1024 * 1024): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, size).arrayBuffer());
}

export async function validatePdf(file: Blob): Promise<UploadValidation> {
  if (file.size > 20 * 1024 * 1024) return { valid: false, reason: "pdf_too_large" };
  const bytes = await readBytes(file, 20 * 1024 * 1024);
  const text = new TextDecoder("latin1").decode(bytes);
  if (!text.startsWith("%PDF-")) return { valid: false, reason: "pdf_magic" };
  // pdf-lib validates the document structure without PDF.js rendering globals
  // such as DOMMatrix, which are unavailable in Vercel's Node runtime.
  const { PDFDocument } = await import("pdf-lib");
  try {
    const document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      throwOnInvalidObject: true,
      updateMetadata: false,
    });
    return document.getPageCount() > 0
      ? { valid: true, contentType: "application/pdf" }
      : { valid: false, reason: "pdf_parse" };
  } catch {
    return { valid: false, reason: "pdf_parse" };
  }
}

function safeDimensions(width: number, height: number): boolean {
  return width > 0 && height > 0 && width <= 8_000 && height <= 8_000 && width * height <= 32_000_000;
}

export async function validateImage(file: Blob): Promise<UploadValidation> {
  if (file.size > 8 * 1024 * 1024) return { valid: false, reason: "image_too_large" };
  const bytes = await readBytes(file, 8 * 1024 * 1024);
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value)) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16);
    const height = view.getUint32(20);
    const hasIend = bytes.length >= 12 && [73, 69, 78, 68, 174, 66, 96, 130].every((value, index) => bytes[bytes.length - 8 + index] === value);
    return safeDimensions(width, height) && hasIend ? { valid: true, contentType: "image/png", width, height } : { valid: false, reason: "image_parse" };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let index = 2; index + 9 < bytes.length; ) {
      if (bytes[index] !== 0xff) { index++; continue; }
      const marker = bytes[index + 1];
      const length = (bytes[index + 2] << 8) | bytes[index + 3];
      if (marker >= 0xc0 && marker <= 0xc3 && length >= 7) {
        const height = (bytes[index + 5] << 8) | bytes[index + 6];
        const width = (bytes[index + 7] << 8) | bytes[index + 8];
        const hasEoi = bytes.length > 2 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
        return safeDimensions(width, height) && hasEoi ? { valid: true, contentType: "image/jpeg", width, height } : { valid: false, reason: "image_parse" };
      }
      index += Math.max(2, length + 2);
    }
  }
  return { valid: false, reason: "image_signature" };
}

export function contentDisposition(fileName: string, disposition: "inline" | "attachment" = "attachment"): string {
  const safe = fileName.replace(/[\r\n]/g, "_").replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 160) || "download";
  return `${disposition}; filename="${safe.replace(/"/g, "_")}"`;
}
