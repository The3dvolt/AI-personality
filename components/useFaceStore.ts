"use client";
// Simple IndexedDB wrapper for storing face hashes and timestamps
export async function openDB() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open("vision-db", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("faces")) {
        db.createObjectStore("faces", { keyPath: "hash" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveFace(hash: string) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("faces", "readwrite");
    const store = tx.objectStore("faces");
    store.put({ hash, lastSeen: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function hasSeen(hash: string) {
  const db = await openDB();
  return new Promise<boolean>((resolve, reject) => {
    const tx = db.transaction("faces", "readonly");
    const store = tx.objectStore("faces");
    const req = store.get(hash);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveFaceWithName(hash: string, name: string) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction("faces", "readwrite");
    const store = tx.objectStore("faces");
    store.put({ hash, name, lastSeen: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getFace(hash: string) {
  const db = await openDB();
  return new Promise<any>((resolve, reject) => {
    const tx = db.transaction("faces", "readonly");
    const store = tx.objectStore("faces");
    const req = store.get(hash);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function listFaces() {
  const db = await openDB();
  return new Promise<any[]>((resolve, reject) => {
    const tx = db.transaction("faces", "readonly");
    const store = tx.objectStore("faces");
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

// Simple memory log store
export async function saveMemory(entry: { title: string; detail?: string }) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    // create memories store if needed
    if (!db.objectStoreNames.contains("memories")) {
      // need to reopen with higher version — simple fallback: use localStorage
      try {
        const arr = JSON.parse(localStorage.getItem("memories:v1") || "[]");
        arr.unshift({ ...entry, ts: Date.now() });
        localStorage.setItem("memories:v1", JSON.stringify(arr.slice(0, 200)));
        resolve();
      } catch (e) {
        reject(e);
      }
      return;
    }
    const tx = db.transaction("memories", "readwrite");
    const store = tx.objectStore("memories");
    store.add({ ...entry, ts: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function listMemories() {
  try {
    const arr = JSON.parse(localStorage.getItem("memories:v1") || "[]");
    return arr;
  } catch (e) {
    return [];
  }
}
