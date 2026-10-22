const waitForPaint = () =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame !== "function") {
      resolve();
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });

export const downloadDataUrl = (dataUrl, filename) => {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

export const captureNodePng = async (node, { backgroundColor } = {}) => {
  if (!node) throw new Error("No hay contenido para capturar");
  await waitForPaint();
  const { toPng } = await import("html-to-image");
  const styles = typeof window !== "undefined" ? getComputedStyle(node) : null;
  return toPng(node, {
    cacheBust: true,
    pixelRatio: Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 2 : 2),
    backgroundColor:
      backgroundColor ||
      styles?.backgroundColor ||
      styles?.getPropertyValue("--surface") ||
      "#ffffff",
    width: Math.max(node.scrollWidth, node.clientWidth),
    height: Math.max(node.scrollHeight, node.clientHeight),
  });
};
