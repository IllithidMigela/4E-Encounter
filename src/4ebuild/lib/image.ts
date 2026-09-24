export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("读取失败"));
    reader.readAsDataURL(file);
  });
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 估算 base64 data URL 解码后的字节数（忽略 data: 前缀与分隔逗号）。 */
export function dataUrlSizeBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.ceil(base64.length * 0.75); // base64：每 4 字符表示 3 字节
}

/** 按给定最大边长与 JPEG 质量重编码图片。 */
export function reencodeImage(url: string, maxDim: number, quality: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("无法创建 canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = url;
  });
}

/**
 * 将图片压缩到预算字节数以内（供 localStorage 存储）。
 * 交替缩小边长与降低 JPEG 质量，直到体积 ≤ maxBytes，或退化到最低质量/最小边长。
 * 原图已 ≤ maxBytes 时原样返回，不做任何处理。
 */
export async function compressDataUrlToBudget(dataUrl: string, maxBytes: number, opts?: { maxDim?: number }): Promise<string> {
  if (dataUrlSizeBytes(dataUrl) <= maxBytes) return dataUrl; // 已满足预算，原样返回
  const maxDim = opts?.maxDim ?? 1600;
  let dim = maxDim;
  let quality = 0.9;
  let current = dataUrl;
  for (let i = 0; i < 12; i++) {
    current = await reencodeImage(current, dim, quality);
    if (dataUrlSizeBytes(current) <= maxBytes) return current;
    // 交替降维与降质：先缩边长，再降质量
    if (i % 2 === 0) dim = Math.max(320, Math.round(dim * 0.72));
    else quality = Math.max(0.4, quality - 0.15);
  }
  return current;
}

export function downscaleImage(url: string, maxSize = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("无法创建 canvas"));
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = url;
  });
}

export function cropImage(imageSrc: string, area: CropArea): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const sx = img.naturalWidth / img.width;
      const sy = img.naturalHeight / img.height;
      canvas.width = Math.max(1, Math.round(area.width));
      canvas.height = Math.max(1, Math.round(area.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("无法创建 canvas"));
        return;
      }
      ctx.drawImage(img, area.x * sx, area.y * sy, area.width * sx, area.height * sy, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => reject(new Error("图片加载失败"));
    img.src = imageSrc;
  });
}
