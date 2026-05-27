// scripts/imageCompress.js
// Client-side photo compression before upload.
//
// Why: raw iPhone photos are typically 3-4MB at full resolution
// (4032x3024). For document scans we only need 1600px on the
// longest side. Compressing brings each photo down to ~250-400KB
// — a 6-10x payload reduction.

const MAX_DIMENSION = 1600;
const QUALITY = 0.85;

export async function compressDataUrl(dataUrl) {
  if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
    return dataUrl;
  }
  try {
    const img = await loadImage(dataUrl);
    const { width, height } = scaleDimensions(img.width, img.height, MAX_DIMENSION);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, width, height);

    const compressed = canvas.toDataURL("image/jpeg", QUALITY);

    canvas.width = 0;
    canvas.height = 0;

    return compressed.length < dataUrl.length ? compressed : dataUrl;
  } catch (err) {
    console.warn("[compress] failed, using original:", err);
    return dataUrl;
  }
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Image decode failed"));
    img.src = dataUrl;
  });
}

function scaleDimensions(srcW, srcH, maxDim) {
  if (srcW <= maxDim && srcH <= maxDim) {
    return { width: srcW, height: srcH };
  }
  const ratio = srcW > srcH ? maxDim / srcW : maxDim / srcH;
  return {
    width: Math.round(srcW * ratio),
    height: Math.round(srcH * ratio),
  };
}

export function dataUrlSizeKB(dataUrl) {
  if (!dataUrl) return 0;
  const base64Part = dataUrl.split(",")[1] || dataUrl;
  return Math.round((base64Part.length * 3 / 4) / 1024);
}
