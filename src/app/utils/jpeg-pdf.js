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

export const buildJpegPdf = (
  jpegBytes,
  pixelWidth,
  pixelHeight,
  pageWidth,
  pageHeight,
) => {
  const image = jpegBytes instanceof Uint8Array
    ? jpegBytes
    : new Uint8Array(jpegBytes || []);
  if (!image.length) throw new Error("No hay contenido para el PDF");

  const imgW = Math.max(1, Math.round(Number(pixelWidth) || 1));
  const imgH = Math.max(1, Math.round(Number(pixelHeight) || 1));
  const boxW = Math.max(1, Number(pageWidth) || imgW);
  const boxH = Math.max(1, Number(pageHeight) || imgH);
  const contentStream = `q ${boxW.toFixed(2)} 0 0 ${boxH.toFixed(2)} 0 0 cm /Im0 Do Q\n`;

  const objectBodies = [
    encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${boxW.toFixed(2)} ${boxH.toFixed(2)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    concat([
      encode(`<< /Type /XObject /Subtype /Image /Width ${imgW} /Height ${imgH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`),
      image,
      encode("\nendstream"),
    ]),
    encode(`<< /Length ${contentStream.length} >>\nstream\n${contentStream}endstream`),
  ];

  const parts = [encode("%PDF-1.4\n")];
  const offsets = [0];
  objectBodies.forEach((body, index) => {
    const num = index + 1;
    offsets[num] = parts.reduce((sum, part) => sum + part.length, 0);
    parts.push(encode(`${num} 0 obj\n`), body, encode("\nendobj\n"));
  });

  const xrefOffset = parts.reduce((sum, part) => sum + part.length, 0);
  let xref = "xref\n0 6\n0000000000 65535 f \n";
  for (let index = 1; index <= 5; index += 1) {
    xref += `${padOffset(offsets[index])} 00000 n \n`;
  }
  parts.push(encode(xref));
  parts.push(encode(`trailer << /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
  return concat(parts);
};
