import assert from "node:assert/strict";
import test from "node:test";
import { buildJpegPdf, buildJpegPdfPages, dataUrlToBytes } from "./jpeg-pdf.js";

const TINY_JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAGf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPwCf/9k=";

test("dataUrlToBytes lee un JPEG en base64", () => {
  const { mime, bytes } = dataUrlToBytes(`data:image/jpeg;base64,${TINY_JPEG_BASE64}`);
  assert.equal(mime, "image/jpeg");
  assert.equal(bytes[0], 0xff);
  assert.equal(bytes[1], 0xd8);
  assert.ok(bytes.length > 20);
});

test("dataUrlToBytes rechaza una captura inválida", () => {
  assert.throws(() => dataUrlToBytes("not-a-data-url"), /Captura inválida/);
});

test("buildJpegPdf arma un PDF con el JPEG embebido", () => {
  const { bytes } = dataUrlToBytes(`data:image/jpeg;base64,${TINY_JPEG_BASE64}`);
  const pdf = buildJpegPdf(bytes, 1200, 800, 900, 600);
  const text = Buffer.from(pdf).toString("latin1");
  assert.equal(text.slice(0, 8), "%PDF-1.4");
  assert.match(text, /\/Filter \/DCTDecode/);
  assert.match(text, /\/Width 1200/);
  assert.match(text, /\/Height 800/);
  assert.match(text, /MediaBox \[0 0 900.00 600.00\]/);
  assert.match(text, /%%EOF/);
  assert.ok(pdf.length > bytes.length);
});

test("buildJpegPdfPages arma un PDF de varias paginas", () => {
  const { bytes } = dataUrlToBytes(`data:image/jpeg;base64,${TINY_JPEG_BASE64}`);
  const pdf = buildJpegPdfPages([
    { bytes, width: 800, height: 400, pageWidth: 600, pageHeight: 300 },
    { bytes, width: 800, height: 600, pageWidth: 600, pageHeight: 450 },
  ]);
  const text = Buffer.from(pdf).toString("latin1");
  assert.match(text, /\/Count 2/);
  assert.match(text, /MediaBox \[0 0 600.00 300.00\]/);
  assert.match(text, /MediaBox \[0 0 600.00 450.00\]/);
  assert.match(text, /%%EOF/);
});
