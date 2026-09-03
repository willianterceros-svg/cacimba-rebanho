const RebanhoData = (() => {
  const DB_NAME = "cacimba_rebanho_ajustada";
  const DB_VERSION = 1;
  const entities = {
    animals: { store: "animals", collection: "herd", key: "uid" },
    movements: { store: "movements", collection: "movementEvents", key: "eventUid" },
    reproducers: { store: "reproducers", collection: "reproducers", key: "uid" },
    history: { store: "history", collection: "history", key: "uid" },
    historical_dams: { store: "historical_dams", collection: "historicalDams", key: "uid" },
    pedigree: { store: "pedigree", collection: "pedigreeLibrary", key: "key" }
  };
  let connection = null;
  let captureScheduled = false;
  let captureQueue = Promise.resolve();
  let syncAfterCapture = false;
  let snapshotProvider = null;
  const baselines = Object.fromEntries(Object.keys(entities).map(name => [name, new Map()]));

  function requestPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  function transactionPromise(transaction) {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("Transação local cancelada"));
    });
  }
  async function open() {
    if (connection) return connection;
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = event => {
      const db = event.target.result;
      for (const definition of Object.values(entities)) {
        if (!db.objectStoreNames.contains(definition.store)) db.createObjectStore(definition.store, { keyPath: "uid" });
      }
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id" });
      if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta", { keyPath: "key" });
    };
    connection = await requestPromise(request);
    connection.onversionchange = () => { connection.close(); connection = null; };
    return connection;
  }
  async function getAll(storeName) {
    const db = await open();
    return requestPromise(db.transaction(storeName).objectStore(storeName).getAll());
  }
  async function getMeta(key, fallback = null) {
    const db = await open();
    const result = await requestPromise(db.transaction("meta").objectStore("meta").get(key));
    return result ? result.value : fallback;
  }
  async function setMeta(key, value) {
    const db = await open(), tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put({ key, value }); await transactionPromise(tx);
  }
  function cleanData(value) {
    const data = structuredClone(value || {});
    delete data._version; delete data._updatedAt; delete data._deletedAt;
    return data;
  }
  function ensureUid(entity, item) {
    const definition = entities[entity];
    if (item?.[definition.key]) return String(item[definition.key]);
    if (entity === "history") {
      item.uid = `hist_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`}`;
      return item.uid;
    }
    if (entity === "historical_dams") {
      item.uid = `dam_${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`}`;
      return item.uid;
    }
    throw new Error(`Registro sem identificador em ${entity}`);
  }
  async function loadAfterLogin() {
    const snapshot = { schemaVersion: 5 };
    for (const [entity, definition] of Object.entries(entities)) {
      const records = await getAll(definition.store);
      baselines[entity].clear();
      const active = [];
      for (const record of records) {
        baselines[entity].set(record.uid, structuredClone(record));
        if (!record.deleted_at) active.push(structuredClone(record.data));
      }
      snapshot[definition.collection] = active;
    }
    return snapshot;
  }
  function scheduleCapture(provider, shouldSync = false) {
    if (!currentUser) return;
    snapshotProvider = provider;
    syncAfterCapture ||= shouldSync;
    if (captureScheduled) return;
    captureScheduled = true;
    // Executa ao final da ação atual: agrupa animal, movimentação e histórico,
    // sem deixar uma janela de debounce na qual fechar a página perderia dados.
    queueMicrotask(async () => {
      captureScheduled = false;
      try { await captureNow(); } catch (error) { console.error("Falha ao salvar localmente", error); alert("Não foi possível salvar este lançamento no aparelho."); }
    });
  }
  function captureNow() {
    if (!currentUser || !snapshotProvider) return;
    const next = captureQueue.then(() => captureSnapshot());
    // Uma falha é devolvida ao chamador, mas não bloqueia os próximos salvamentos.
    captureQueue = next.catch(() => {});
    return next;
  }
  async function captureSnapshot() {
    const shouldSync = syncAfterCapture;
    syncAfterCapture = false;
    const snapshot = snapshotProvider();
    const changes = [];
    const recordsToSave = [];
    for (const [entity, definition] of Object.entries(entities)) {
      const items = Array.isArray(snapshot[definition.collection]) ? snapshot[definition.collection] : [];
      const currentIds = new Set();
      for (const item of items) {
        const uid = ensureUid(entity, item), data = cleanData(item), previous = baselines[entity].get(uid);
        currentIds.add(uid);
        if (previous && JSON.stringify(previous.data) === JSON.stringify(data) && !previous.deleted_at) continue;
        const version = Number(previous?.version || 0) + 1;
        const record = { uid, data, version, updated_at: new Date().toISOString(), deleted_at: null };
        recordsToSave.push({ store: definition.store, record });
        changes.push({ entity, operation: previous ? "update" : "insert", uid, baseVersion: Number(previous?.version || 0), data });
      }
      for (const [uid, previous] of baselines[entity]) {
        if (currentIds.has(uid) || previous.deleted_at) continue;
        const record = { ...previous, version: Number(previous.version || 0) + 1, updated_at: new Date().toISOString(), deleted_at: new Date().toISOString() };
        recordsToSave.push({ store: definition.store, record });
        changes.push({ entity, operation: "delete", uid, baseVersion: Number(previous.version || 0), data: previous.data });
      }
    }
    if (!changes.length) { if (shouldSync && typeof RebanhoSync !== "undefined") RebanhoSync.run({ silent: true }); return; }
    const outbox = { id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random()}`, changes, createdAt: new Date().toISOString(), attempts: 0, conflict: false };
    const db = await open(), stores = [...new Set([...recordsToSave.map(item => item.store), "outbox"])], tx = db.transaction(stores, "readwrite");
    for (const item of recordsToSave) tx.objectStore(item.store).put(item.record);
    tx.objectStore("outbox").put(outbox);
    await transactionPromise(tx);
    for (const item of recordsToSave) {
      const entity = Object.keys(entities).find(name => entities[name].store === item.store);
      baselines[entity].set(item.record.uid, structuredClone(item.record));
    }
    if (shouldSync && typeof RebanhoSync !== "undefined") RebanhoSync.run({ silent: true });
  }
  async function pendingOutbox() {
    return (await getAll("outbox")).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async function updateOutbox(item) {
    const db = await open(), tx = db.transaction("outbox", "readwrite"); tx.objectStore("outbox").put(item); await transactionPromise(tx);
  }
  async function removeOutbox(id) {
    const db = await open(), tx = db.transaction("outbox", "readwrite"); tx.objectStore("outbox").delete(id); await transactionPromise(tx);
  }
  async function applyRemoteChanges(changes) {
    if (!changes?.length) return;
    const db = await open();
    const stores = [...new Set(changes.map(change => entities[change.entity]?.store).filter(Boolean))];
    if (!stores.length) return;
    const tx = db.transaction(stores, "readwrite");
    for (const change of changes) {
      const definition = entities[change.entity]; if (!definition) continue;
      const source = change.record || {}, record = {
        uid: String(source.uid || change.uid), data: source.data || {}, version: Number(source.version || 1),
        updated_at: source.updated_at || new Date().toISOString(), deleted_at: source.deleted_at || null
      };
      tx.objectStore(definition.store).put(record);
      baselines[change.entity].set(record.uid, structuredClone(record));
    }
    await transactionPromise(tx);
  }
  async function replaceFromImportedSnapshot(snapshot) {
    const db = await open(), stores = Object.values(entities).map(def => def.store), tx = db.transaction(stores, "readwrite");
    for (const store of stores) tx.objectStore(store).clear();
    await transactionPromise(tx);
    for (const map of Object.values(baselines)) map.clear();
    applySnapshot(snapshot);
  }
  async function status() {
    const outbox = await pendingOutbox();
    return { pending: outbox.length, conflicts: outbox.filter(item => item.conflict).length, cursor: await getMeta("sync_cursor", 0), lastSync: await getMeta("last_sync", "") };
  }

  return { entities, open, getAll, getMeta, setMeta, loadAfterLogin, scheduleCapture, captureNow, pendingOutbox, updateOutbox, removeOutbox, applyRemoteChanges, replaceFromImportedSnapshot, status };
})();
