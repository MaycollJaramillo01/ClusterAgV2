const encoder = new TextEncoder();

const encode = (value) => encoder.encode(String(value));

const concat = (chunks) => {
  const list = chunks.filter(Boolean);
  const total = list.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of list) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

const padOffset = (value) => String(value).padStart(10, "0");

export const dataUrlToBytes = (dataUrl) => {
  const match = String(dataUrl || "").match(/^data:([^;,]+);base64,(.+)$/);
  if (!match) throw new Error("Captura inválida");
  const bytes = typeof Buffer !== "undefined"
    ? new Uint8Array(Buffer.from(match[2], "base64"))
    : Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  return { mime: match[1], bytes };
};

const normalizePdfPage = (page, index) => {
  const bytes = page?.bytes instanceof Uint8Array
    ? page.bytes
    : new Uint8Array(page?.bytes || []);
  if (!bytes.length) {
    throw new Error(`No hay contenido para el PDF (página ${index + 1})`);
  }
  const width = Math.max(1, Math.round(Number(page.width) || 1));
  const height = Math.max(1, Math.round(Number(page.height) || 1));
  return {
    bytes,
    width,
    height,
    pageWidth: Math.max(1, Number(page.pageWidth) || (width * 72) / 96),
    pageHeight: Math.max(1, Number(page.pageHeight) || (height * 72) / 96),
  };
};

export const buildJpegPdfPages = (pagesInput = []) => {
  const pages = (Array.isArray(pagesInput) ? pagesInput : [pagesInput])
    .map(normalizePdfPage);
  if (!pages.length) throw new Error("No hay contenido para el PDF");

  const pageObjectNumbers = pages.map((_, index) => 3 + index * 3);
  const kids = pageObjectNumbers.map((num) => `${num} 0 R`).join(" ");
  const objectBodies = [
    encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encode(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`),
  ];

  pages.forEach((page, index) => {
    const pageNum = pageObjectNumbers[index];
    const imageNum = pageNum + 1;
    const contentNum = pageNum + 2;
    const contentStream = `q ${page.pageWidth.toFixed(2)} 0 0 ${page.pageHeight.toFixed(2)} 0 0 cm /Im0 Do Q\n`;
    objectBodies.push(encode(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.pageWidth.toFixed(2)} ${page.pageHeight.toFixed(2)}] /Resources << /XObject << /Im0 ${imageNum} 0 R >> >> /Contents ${contentNum} 0 R >>`,
    ));
    objectBodies.push(concat([
      encode(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`),
      page.bytes,
      encode("\nendstream"),
    ]));
    objectBodies.push(encode(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream`));
  });

  const parts = [encode("%PDF-1.4\n")];
  const offsets = [0];
  objectBodies.forEach((body, index) => {
    const num = index + 1;
    offsets[num] = parts.reduce((sum, part) => sum + part.length, 0);
    parts.push(encode(`${num} 0 obj\n`), body, encode("\nendobj\n"));
  });

  const xrefOffset = parts.reduce((sum, part) => sum + part.length, 0);
  const total = objectBodies.length;
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= total; index += 1) {
    xref += `${padOffset(offsets[index])} 00000 n \n`;
  }
  parts.push(encode(xref));
  parts.push(encode(`trailer << /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return concat(parts);
};

export const buildJpegPdf = (
  jpegBytes,
  pixelWidth,
  pixelHeight,
  pageWidth,
  pageHeight,
) => buildJpegPdfPages([{
  bytes: jpegBytes,
  width: pixelWidth,
  height: pixelHeight,
  pageWidth,
  pageHeight,
}]);
