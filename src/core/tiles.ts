import type { LatLon, TileSource, Vec2 } from "./types";
import { latLonToMinecraft } from "./projection";
import { defaultTileSources } from "./tileSources";

export { defaultTileSources };

export type ReprojectedTileQuad = {
  source: TileSource;
  url: string;
  corners: [Vec2, Vec2, Vec2, Vec2];
};

function tileLatLonBounds(x: number, y: number, z: number): [LatLon, LatLon] {
  const n = 2 ** z;
  const lonLeft = (x / n) * 360 - 180;
  const lonRight = ((x + 1) / n) * 360 - 180;
  const latTop = (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))) * 180) / Math.PI;
  const latBottom = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 1)) / n))) * 180) / Math.PI;
  return [
    { lat: latTop, lon: lonLeft },
    { lat: latBottom, lon: lonRight }
  ];
}

function lonLatToTile(lon: number, lat: number, zoom: number) {
  const latRad = (Math.max(-85.05112878, Math.min(85.05112878, lat)) * Math.PI) / 180;
  const n = 2 ** zoom;
  return {
    x: Math.floor(((lon + 180) / 360) * n),
    y: Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n)
  };
}

function tileUrlFromTemplate(source: { urlTemplate: string; id?: string }, x: number, y: number, z: number) {
  const isYandex = Boolean(source.id?.includes("yandex") || /yandex/.test(source.urlTemplate));
  const yForUrl = isYandex ? 2 ** z - 1 - y : y;

  let url = source.urlTemplate
    .replace(/{x}/g, String(x))
    .replace(/{y}/g, String(yForUrl))
    .replace(/{z}/g, String(z));

  if (url.includes("{u}")) {
    url = url.replace(/{u}/g, toQuadKey(x, y, z));
  }

  url = url.replace(/{random:([^}]+)}/g, (_, options) => {
    const choices = options.split(",");
    const index = Math.abs(x + y) % choices.length;
    return choices[index];
  });

  return url;
}

function loadImageUrl(url: string, timeoutMs = 4000): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    let settled = false;
    const finish = (success: boolean) => {
      if (settled) return;
      settled = true;
      resolve(success);
    };

    image.crossOrigin = "anonymous";
    image.onload = () => finish(true);
    image.onerror = () => finish(false);
    image.src = url;
    setTimeout(() => finish(false), timeoutMs);
  });
}

export async function detectMaxZoomFromUrl(urlTemplate: string, id?: string, maxSearchZoom = 22): Promise<number> {
  let lastSuccess = 0;
  for (let z = 0; z <= maxSearchZoom; z += 1) {
    const { x, y } = lonLatToTile(0, 0, z);
    const url = tileUrlFromTemplate({ urlTemplate, id }, x, y, z);
    // When running in the browser during development, route probe requests
    // through the local dev server proxy to avoid CORS blocking. The dev
    // server exposes `/tile-proxy?url=...` which will fetch the remote tile
    // server-side and return it with permissive CORS headers.
    let urlToLoad = url;
    if (typeof window !== "undefined") {
      try {
        urlToLoad = `/tile-proxy?url=${encodeURIComponent(url)}`;
      } catch {
        urlToLoad = url;
      }
    }

    const ok = await loadImageUrl(urlToLoad);
    if (!ok) break;
    lastSuccess = z;
  }
  return lastSuccess;
}

/**
 * 將 XYZ 座標轉換為 Bing Maps 使用的 Quadkey 字串
 */
function toQuadKey(x: number, y: number, z: number): string {
  let quadKey = "";
  for (let i = z; i > 0; i--) {
    let digit = 0;
    const mask = 1 << (i - 1);
    if ((x & mask) !== 0) digit++;
    if ((y & mask) !== 0) digit += 2;
    quadKey += digit.toString();
  }
  return quadKey;
}

export function reprojectTile(source: TileSource, x: number, y: number, z: number): ReprojectedTileQuad {
  // 1. Determine the effective zoom level for fetching tiles (overscaling)
  // When maxZoom is 0 (not yet detected), use 22 as a reasonable default
  const effectiveMaxZoom = source.maxZoom > 0 ? source.maxZoom : 22;
  const effectiveZ = Math.min(z, effectiveMaxZoom);

  // 2. Adjust x and y coordinates to match the effectiveZ for tile fetching
  // If z > effectiveZ, it means we are overscaling, so we need to find the parent tile at effectiveZ
  const zoomDifference = z - effectiveZ;
  const effectiveX = Math.floor(x / (2 ** zoomDifference));
  const effectiveY = Math.floor(y / (2 ** zoomDifference));

  // 3. 使用「有效座標」(effective) 計算地理邊界
  // 當過度縮放時，我們必須回傳父層瓦片的完整邊界。
  // 這樣渲染引擎才會以正確的比例繪製該瓦片，視角放大時自然就會看到圖片被放大的效果。
  // 若使用原始 x, y, z，圖片會被縮小擠壓到角落，導致看起來像消失。
  const [nw, se] = tileLatLonBounds(effectiveX, effectiveY, effectiveZ);
  const ne = { lat: nw.lat, lon: se.lon };
  const sw = { lat: se.lat, lon: nw.lon };

  // 4. Construct the URL using effective coordinates and zoom, applying Yandex Y-flip if necessary
  let yForUrl = effectiveY;
  if (source.id === "yandex") {
    // Yandex uses TMS-like Y, so flip effectiveY for the URL template
    yForUrl = (2 ** effectiveZ - 1) - effectiveY;
  }

  let url = source.urlTemplate
    .replace(/{x}/g, String(effectiveX))
    .replace(/{y}/g, String(yForUrl))
    .replace(/{z}/g, String(effectiveZ));

  // 處理 Bing Maps 的 Quadkey 佔位符
  if (url.includes("{u}")) {
    url = url.replace(/{u}/g, toQuadKey(effectiveX, effectiveY, effectiveZ));
  }

  // 處理 {random:a,b,c} 或 {random:0,1,2,3} 分流佔位符
  // 使用座標相加取餘數，確保同一塊瓦片總是請求同一個子網域，提高快取命中率
  url = url.replace(/{random:([^}]+)}/g, (_, options) => {
    const choices = options.split(",");
    const index = Math.abs(effectiveX + effectiveY) % choices.length;
    return choices[index];
  });

  return {
    source,
    url,
    corners: [latLonToMinecraft(nw), latLonToMinecraft(ne), latLonToMinecraft(se), latLonToMinecraft(sw)]
  };
}
