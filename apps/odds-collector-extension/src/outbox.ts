const DATABASE = "nexusbet-collector-outbox";
const STORE = "publications";

function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, {
        keyPath: "sequence",
        autoIncrement: true,
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function enqueue(payload: Record<string, unknown>) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  if (bytes > 8 * 1024 * 1024)
    throw Error("Publication exceeds ingestion limit");
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      const store = transaction.objectStore(STORE);
      const count = store.count();
      count.onsuccess = () => {
        if (count.result >= 1000) transaction.abort();
        else store.add({ payload });
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(Error("Extension outbox full"));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function oldest(): Promise<{
  sequence: number;
  payload: Record<string, unknown>;
} | null> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const cursor = transaction.objectStore(STORE).openCursor();
      cursor.onsuccess = () => resolve(cursor.result?.value ?? null);
      cursor.onerror = () => reject(cursor.error);
    });
  } finally {
    db.close();
  }
}

export async function remove(sequence: number) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).delete(sequence);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export async function count() {
  const db = await database();
  try {
    return await new Promise<number>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readonly");
      const request = transaction.objectStore(STORE).count();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}
