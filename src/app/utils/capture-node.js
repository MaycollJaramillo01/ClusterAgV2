import { buildJpegPdfPages, dataUrlToBytes } from "./jpeg-pdf.js";

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

const CLIPPED_OVERFLOW = new Set(["hidden", "auto", "scroll", "clip"]);

const patchOverflow = (element, restored) => {
  if (!element || element.nodeType !== 1) return;
  const computed = typeof getComputedStyle === "function"
    ? getComputedStyle(element)
    : null;
  const overflow = computed?.overflow || "";
  const overflowX = computed?.overflowX || "";
  const overflowY = computed?.overflowY || "";
  if (
    !CLIPPED_OVERFLOW.has(overflow)
    && !CLIPPED_OVERFLOW.has(overflowX)
    && !CLIPPED_OVERFLOW.has(overflowY)
  ) {
    return;
  }
  restored.push({
    element,
    overflow: element.style.overflow,
    overflowX: element.style.overflowX,
    overflowY: element.style.overflowY,
    height: element.style.height,
    maxHeight: element.style.maxHeight,
    maxWidth: element.style.maxWidth,
  });
  element.style.overflow = "visible";
  element.style.overflowX = "visible";
  element.style.overflowY = "visible";
  element.style.height = "auto";
  element.style.maxHeight = "none";
  element.style.maxWidth = "none";
};

const expandClippedOverflow = (node) => {
  const restored = [];
  let current = node;
  while (current && current !== document.documentElement) {
    patchOverflow(current, restored);
    current = current.parentElement;
  }
  const walk = (element) => {
    [...element.children].forEach((child) => {
      patchOverflow(child, restored);
      walk(child);
    });
  };
  if (node) walk(node);
  return () => {
    restored.forEach((entry) => {
      entry.element.style.overflow = entry.overflow;
      entry.element.style.overflowX = entry.overflowX;
      entry.element.style.overflowY = entry.overflowY;
      entry.element.style.height = entry.height;
      entry.element.style.maxHeight = entry.maxHeight;
      entry.element.style.maxWidth = entry.maxWidth;
    });
  };
};

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

const captureNodeImage = async (node, { backgroundColor } = {}) => {
  if (!node) throw new Error("No hay contenido para capturar");
  await waitForPaint();
  const { toJpeg } = await import("html-to-image");
  const styles = typeof window !== "undefined" ? getComputedStyle(node) : null;
  const width = Math.max(node.scrollWidth, node.clientWidth, node.offsetWidth);
  const height = Math.max(node.scrollHeight, node.clientHeight, node.offsetHeight);
  const dataUrl = await toJpeg(node, {
    cacheBust: true,
    quality: 0.92,
    pixelRatio: 1.5,
    backgroundColor:
      backgroundColor ||
      styles?.backgroundColor ||
      styles?.getPropertyValue("--surface") ||
      "#ffffff",
    width,
    height,
  });
  const { bytes } = dataUrlToBytes(dataUrl);
  const size = await readDataUrlSize(dataUrl);
  return {
    bytes,
    width: size.width,
    height: size.height,
    pageWidth: (size.width * 72) / 96,
    pageHeight: (size.height * 72) / 96,
  };
};

export const captureNodesPdf = async (nodes, options = {}) => {
  const list = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean);
  if (!list.length) throw new Error("No hay contenido para capturar");
  const pages = [];
  for (const node of list) {
    const restore = expandClippedOverflow(node);
    try {
      await waitForPaint();
      pages.push(await captureNodeImage(node, options));
    } finally {
      restore();
    }
  }
  return buildJpegPdfPages(pages);
};

export const captureNodePdf = async (node, options) =>
  captureNodesPdf([node], options);
