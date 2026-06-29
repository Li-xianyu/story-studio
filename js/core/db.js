/* ============================================================
   浮光剧场 · IndexedDB Local Storage Wrapper
   ============================================================ */

var DB_NAME = "FloatingStoryStudio";
var DB_VERSION = 1;
var STORE_NAME = "stories";

var dbInstance = null;

export function initDb() {
  if (dbInstance) return Promise.resolve(dbInstance);
  return new Promise(function (resolve, reject) {
    var request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = function (event) {
      var db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = function (event) {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };
    request.onerror = function (event) {
      reject(new Error("IndexedDB 打开失败: " + event.target.error));
    };
  });
}

export function getAllStories() {
  return initDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE_NAME, "readonly");
      var store = transaction.objectStore(STORE_NAME);
      var request = store.getAll();
      request.onsuccess = function () {
        resolve(request.result || []);
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  });
}

export function saveStory(story) {
  return initDb().then(function (db) {
    return new Promise(function (resolve, reject) {
      var transaction = db.transaction(STORE_NAME, "readwrite");
      var store = transaction.objectStore(STORE_NAME);
      // Clean clone to prevent issues with live proxy object serialization if any
      var copy = JSON.parse(JSON.stringify(story));
      var request = store.put(copy);
      request.onsuccess = function () {
        resolve();
      };
      request.onerror = function () {
        reject(request.error);
      };
    });
  });
}

export async function deleteStory(id) {
  const db = await initDb();
  return await new Promise(function (resolve, reject) {
    var transaction = db.transaction(STORE_NAME, "readwrite");
    var store = transaction.objectStore(STORE_NAME);
    var request = store.delete(id);
    request.onsuccess = function () {
      resolve();
    };
    request.onerror = function () {
      reject(request.error);
    };
  });
}
