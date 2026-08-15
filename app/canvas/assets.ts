const DATABASE_NAME = "lingke-generation-canvas";
const STORE_NAME = "assets";
const CLOUD_THUMBNAIL_STORE_NAME = "cloud-thumbnails";
const DATABASE_VERSION = 2;

type StoredAsset = {
  id: string;
  blob: Blob;
};

type StoredCloudThumbnail = {
  id: string;
  userId: string;
  projectId: string;
  assetId: string;
  version: string;
  blob: Blob;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
      if (!request.result.objectStoreNames.contains(CLOUD_THUMBNAIL_STORE_NAME)) {
        request.result.createObjectStore(CLOUD_THUMBNAIL_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onblocked = () => reject(new Error("浏览器素材缓存升级被其他标签页阻塞。"));
    request.onerror = () => reject(request.error);
  });
}

export async function saveAsset(id: string, blob: Blob): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put({ id, blob } satisfies StoredAsset);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function readAsset(id: string): Promise<Blob | undefined> {
  const database = await openDatabase();
  const asset = await new Promise<StoredAsset | undefined>((resolve, reject) => {
    const request = database
      .transaction(STORE_NAME, "readonly")
      .objectStore(STORE_NAME)
      .get(id);
    request.onsuccess = () => resolve(request.result as StoredAsset | undefined);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return asset?.blob;
}

export async function deleteAsset(id: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export function cloudThumbnailId(userId: string, assetId: string) {
  return `${userId}:${assetId}`;
}

export async function saveCloudThumbnail(input: {
  userId: string;
  projectId: string;
  assetId: string;
  version: string;
  blob: Blob;
}): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(CLOUD_THUMBNAIL_STORE_NAME, "readwrite");
    transaction.objectStore(CLOUD_THUMBNAIL_STORE_NAME).put({
      id: cloudThumbnailId(input.userId, input.assetId),
      ...input,
    } satisfies StoredCloudThumbnail);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function readCloudThumbnail(input: {
  userId: string;
  assetId: string;
  version: string;
}): Promise<Blob | undefined> {
  const database = await openDatabase();
  const stored = await new Promise<StoredCloudThumbnail | undefined>((resolve, reject) => {
    const request = database
      .transaction(CLOUD_THUMBNAIL_STORE_NAME, "readonly")
      .objectStore(CLOUD_THUMBNAIL_STORE_NAME)
      .get(cloudThumbnailId(input.userId, input.assetId));
    request.onsuccess = () => resolve(request.result as StoredCloudThumbnail | undefined);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return stored?.version === input.version ? stored.blob : undefined;
}

export async function deleteCloudThumbnail(userId: string, assetId: string): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(CLOUD_THUMBNAIL_STORE_NAME, "readwrite");
    transaction.objectStore(CLOUD_THUMBNAIL_STORE_NAME).delete(
      cloudThumbnailId(userId, assetId),
    );
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

async function deleteCloudThumbnailsMatching(
  matches: (thumbnail: StoredCloudThumbnail) => boolean,
): Promise<void> {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(CLOUD_THUMBNAIL_STORE_NAME, "readwrite");
    const store = transaction.objectStore(CLOUD_THUMBNAIL_STORE_NAME);
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (matches(cursor.value as StoredCloudThumbnail)) cursor.delete();
      cursor.continue();
    };
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export function deleteCloudProjectThumbnails(userId: string, projectId: string) {
  return deleteCloudThumbnailsMatching(
    (thumbnail) => thumbnail.userId === userId && thumbnail.projectId === projectId,
  );
}

export function deleteCloudUserThumbnails(userId: string) {
  return deleteCloudThumbnailsMatching((thumbnail) => thumbnail.userId === userId);
}
