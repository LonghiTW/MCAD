import type { TileSource } from "./types";

interface LeafSource {
  id: string;
  name: string;
  url: string;
  maxZoom: number;
  default?: boolean;
}

interface GroupNode {
  name: string;
  children: (LeafSource | GroupNode)[];
}

export type SourceNode = LeafSource | GroupNode;

/**
 * 這是地圖圖資的唯一來源清單。
 * - default: 若為 true，則 App 啟動時會預設載入此圖層。
 * - 支援樹狀架構，會自動轉換為帶有路徑的扁平選單供檢索。
 */
export const TILE_LIBRARY: SourceNode[] = [
  // ==================== Global ====================
  {
    id: "osm",
    name: "OpenStreetMap",
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    maxZoom: 19,
    default: true
  },
  {
    id: "bing_aerial",
    name: "Bing Maps",
    url: "https://t.ssl.ak.dynamic.tiles.virtualearth.net/comp/ch/{u}?it=A&shading=hill",
    maxZoom: 19,
    default: false
  },
  {
    id: "yandex_aerial",
    name: "Yandex Maps",
    url: "https://core-sat.maps.yandex.net/tiles?l=sat&x={x}&y={y}&z={z}",
    maxZoom: 19,
    default: false
  },
  {
    id: "google-satellite",
    name: "Google Satellite",
    url: "https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}",
    maxZoom: 21,
    default: false
  },
  {
    id: "esri-world-imagery",
    name: "Esri World Imagery",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    maxZoom: 19,
    default: false
  },

  // ==================== Taiwan ====================
  {
    name: "Taiwan",
    children: [
      {
        id: "taiwan-ortho",
        name: "臺灣正射影像",
        url: "https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{y}/{x}.png",
        maxZoom: 21,
        default: false
      },
      {
        id: "taiwan-emap",
        name: "臺灣通用電子地圖",
        url: "https://wmts.nlsc.gov.tw/wmts/EMAP15/default/GoogleMapsCompatible/{z}/{y}/{x}.png",
        maxZoom: 21,
        default: false
      },
      {
        name: "臺北市",
        children: [
          {
            id: "taipei-ortho",
            name: "臺北市航測影像",
            url: "https://www.historygis.udd.gov.taipei/arcgis/rest/services/Aerial/Ortho_2023/MapServer/WMTS/tile/1.0.0/Aerial_Ortho_2023/default/default028mm/{z}/{y}/{x}.png",
            maxZoom: 22,
            default: false
          },
          {
            id: "taipei-topo",
            name: "臺北市1/1000地形圖",
            url: "https://www.historygis.udd.gov.taipei/arcgis/rest/services/TOPO/DGN_2023/MapServer/WMTS/tile/1.0.0/TOPO_DGN_2023/default/GoogleMapsCompatible/{z}/{y}/{x}.png",
            maxZoom: 22,
            default: false
          }
        ]
      }
    ]
  },

  // ==================== Korea ====================
  {
    name: "Korea",
    children: [
      {
        id: "kakao_aerial",
        name: "Kakao Map (Satellite)",
        url: "http://map{random:0,1,2,3}.daumcdn.net/map_skyview/L{z}/{y}/{x}.jpg",
        maxZoom: 20,
        default: false
      },
      {
        id: "kakao_plain",
        name: "Kakao Map",
        url: "http://map{random:0,1,2,3}.daumcdn.net/map_2d/2012tlq/L{z}/{y}/{x}.png",
        maxZoom: 20,
        default: false
      },
      {
        id: "naver_aerial",
        name: "Naver Map (Satellite)",
        url: "https://map.pstatic.net/nrb/styles/satellite/{z}/{x}/{y}.png",
        maxZoom: 19,
        default: false
      },
      {
        id: "naver_plain",
        name: "Naver Map",
        url: "https://map.pstatic.net/nrb/styles/basic/{z}/{x}/{y}.png",
        maxZoom: 19,
        default: false
      },
      {
        id: "tmap_plain",
        name: "T Map",
        url: "https://topopentile2.tmap.co.kr/tms/1.0.0/hd_tile/{z}/{x}/{y}.png",
        maxZoom: 19,
        default: false
      }
    ]
  },

  // ==================== Japan ====================
  {
    name: "Japan",
    children: [
      {
        id: "lidar_jp_aerial",
        name: "Japan LiDAR (Satellite)",
        url: "http://maps.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg",
        maxZoom: 17,
        default: false
      },
      {
        id: "lidar_jp_plain",
        name: "Japan LiDAR",
        url: "http://maps.gsi.go.jp/xyz/std/{z}/{x}/{y}.png",
        maxZoom: 17,
        default: false
      }
    ]
  },

  // ==================== Singapore ====================
  {
    name: "Singapore",
    children: [
      {
        id: "onemap_default",
        name: "OneMap Default",
        url: "https://www.onemap.gov.sg/maps/tiles/Default_HD/{z}/{x}/{y}.png",
        maxZoom: 19,
        default: false
      },
      {
        id: "onemap_satellite",
        name: "OneMap Satellite",
        url: "https://www.onemap.gov.sg/maps/tiles/Satellite/{z}/{x}/{y}.png",
        maxZoom: 19,
        default: false
      }
    ]
  },

  // ==================== Hong Kong ====================
  {
    name: "HongKong",
    children: [
      {
        id: "geomap_hk",
        name: "香港地理資訊地圖",
        url: "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/basemap/wgs84/{z}/{x}/{y}.png",
        maxZoom: 20,
        default: false
      },
      {
        id: "ortho_HK",
        name: "香港正射影像",
        url: "https://mapapi.geodata.gov.hk/gs/api/v1.0.0/xyz/imagery/WGS84/{z}/{x}/{y}.png",
        maxZoom: 19,
        default: false
      }
    ]
  }
];

/** 遞迴獲取所有葉子節點並標註路徑 */
function flattenSources(nodes: SourceNode[], path: string[] = []): (LeafSource & { pathName: string })[] {
  return nodes.flatMap((node) => {
    const currentPath = [...path, node.name];
    if ("children" in node) {
      return flattenSources(node.children, currentPath);
    } else {
      return [{ ...node, pathName: currentPath.join(" / ") }];
    }
  });
}

const ALL_FLAT_SOURCES = flattenSources(TILE_LIBRARY);

/** 供 App.tsx 下拉選單使用 */
export const TILE_PRESETS = ALL_FLAT_SOURCES.map((s) => ({ 
  id: s.id, 
  name: s.pathName, 
  url: s.url,
  maxZoom: s.maxZoom 
}));

/** 供 tiles.ts / Store 初始狀態使用 */
export const defaultTileSources: TileSource[] = ALL_FLAT_SOURCES
  .filter((s) => s.default)
  .map((s) => ({
    id: s.id,
    name: s.name,
    kind: "xyz",
    urlTemplate: s.url,
    visible: true,
    opacity: 1.0,
    minZoom: 0,
    maxZoom: s.maxZoom,
    offsetX: 0,
    offsetZ: 0
  }));