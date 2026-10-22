import { buildJpegPdf, dataUrlToBytes } from "./jpeg-pdf.js";

const waitForPaint = () =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      resolve();
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

const readDataUrlSize = (dataUrl) =>
  new Promise((resolve, reject) => {
    if (typeof Image === "undefined") {
      reject(new Error("No se pudo medir la captura"));
      return;
    }
    const image = new Image();
    image.onload = () =>
      resolve({
        width: image.naturalWidth || image.width,
        height: image.naturalHeight || image.height,
      });
    image.onerror = () => reject(new Error("No se pudo leer la captura"));
    image.src = dataUrl;
  });

export const downloadBytes = (bytes, filename, mimeType = "application/pdf") => {
  const blob = new Blob([bytes], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(objectUrl);
};

export const captureNodePdf = async (node, { backgroundColor } = {}) => {
  if (!node) throw new Error("No hay contenido para capturar");
  await waitForPaint();
  const { toJpeg } = await import("html-to-image");
  const styles = typeof window !== "undefined" ? getComputedStyle(node) : null;
  const dataUrl = await toJpeg(node, {
    cacheBust: true,
    quality: 0.92,
    pixelRatio: Math.min(
      2,
      typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2,
    ),
    backgroundColor:
      backgroundColor ||
      styles?.backgroundColor ||
      styles?.getPropertyValue("--surface") ||
      "#ffffff",
    width: Math.max(node.scrollWidth, node.clientWidth),
    height: Math.max(node.scrollHeight, node.clientHeight),
  });
  const { bytes } = dataUrlToBytes(dataUrl);
  const size = await readDataUrlSize(dataUrl);
  const pageWidth = (size.width * 72) / 96;
  const pageHeight = (size.height * 72) / 96;
  return buildJpegPdf(bytes, size.width, size.height, pageWidth, pageHeight);
};
