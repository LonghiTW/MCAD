/**
 * IndexedDB-based storage for reference image layer data.
 *
 * Large Base64 data URLs would easily exceed localStorage limits (~5–10 MB).
 * IndexedDB provides a much larger quota (hundreds of MB) and is the right
 * place for binary image payloads.
 *
 * The layer model in the store keeps `dataUrl` in memory at runtime, but
 * autosave / project-serialization strip it. Image data is persisted and
 * retrieved exclusively through this module.
 */

const DB_NAME = "mcad-image-store";
const DB_VERSION = 1;
const STORE_NAME = "images";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "layerId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Stored record shape. */
export interface ImageRecord {
  layerId: string;
  dataUrl: string;
}

/**
 * Store an image's data URL in IndexedDB (upsert).
 */
export async function storeImageData(layerId: string, dataUrl: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.put({ layerId, dataUrl } satisfies ImageRecord);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieve a single image's data URL from IndexedDB.
 * Returns undefined if not found.
 */
export async function retrieveImageData(layerId: string): Promise<string | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.get(layerId);
    req.onsuccess = () => {
      const record = req.result as ImageRecord | undefined;
      resolve(record?.dataUrl);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Retrieve all image records from IndexedDB.
 * Returns a Map keyed by layerId.
 */
export async function retrieveAllImageData(): Promise<Map<string, string>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const store = tx.objectStore(STORE_NAME);
    const req = store.getAll();
    req.onsuccess = () => {
      const records = req.result as ImageRecord[];
      const map = new Map<string, string>();
      for (const rec of records) {
        map.set(rec.layerId, rec.dataUrl);
      }
      resolve(map);
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete a single image record from IndexedDB.
 */
export async function deleteImageData(layerId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.delete(layerId);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Delete all image records whose layerId is NOT in the given set.
 * Used during autosave to clean up orphaned image data.
 */
export async function pruneImageData(activeLayerIds: Set<string>): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    const req = store.openCursor();
    req.onsuccess = () => {
      const cursor = req.result as IDBCursorWithValue | null;
      if (!cursor) {
        resolve();
        return;
      }
      const key = cursor.primaryKey as string;
      if (!activeLayerIds.has(key)) {
        cursor.delete();
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
