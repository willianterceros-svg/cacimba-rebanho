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
  let localRevision = 0;
  const baselines = Object.fromEntries(Object.keys(entities).map(name => [name, new Map()]));
  const OUTBOX_BATCH_LIMIT = 2000;

  function chunkOutboxChanges(changes) {
    const batches = [];
    for (let index = 0; index < changes.length; index += OUTBOX_BATCH_LIMIT) {
      batches.push(changes.slice(index, index + OUTBOX_BATCH_LIMIT));
    }
    return batches;
  }

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
  function canonicalize(value) {
    if (Array.isArray(value)) return value.map(canonicalize);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value).sort().reduce((result, key) => {
      result[key] = canonicalize(value[key]);
      return result;
    }, {});
  }
  function sameData(left, right) {
    return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
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
  async function readLocalState() {
    const snapshot = { schemaVersion: 5 }, records = {};
    for (const [entity, definition] of Object.entries(entities)) {
      records[entity] = await getAll(definition.store);
      snapshot[definition.collection] = records[entity].filter(record => !record.deleted_at).map(record => structuredClone(record.data));
    }
    return { snapshot, records };
  }
  function commitBaselines(records) {
    for (const entity of Object.keys(entities)) {
      baselines[entity].clear();
      for (const record of records[entity]) baselines[entity].set(record.uid, structuredClone(record));
    }
  }
  async function loadAfterLogin() {
    const state = await readLocalState();
    commitBaselines(state.records);
    return state.snapshot;
  }
  async function loadStable(applyState) {
    while (true) {
      await captureNow();
      const revision = localRevision;
      const state = await readLocalState();
      if (revision !== localRevision) continue;
      commitBaselines(state.records);
      applyState(state.snapshot);
      return state.snapshot;
    }
  }
  function scheduleCapture(provider, shouldSync = false) {
    if (!currentUser) return;
    localRevision++;
    snapshotProvider = provider;
    syncAfterCapture ||= shouldSync;
    if (captureScheduled) return;
    captureScheduled = true;
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
    localRevision++;
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
        if (previous && sameData(previous.data, data) && !previous.deleted_at) continue;
        const version = Number(previous?.version || 0) + 1;
        const record = { uid, data, version, updated_at: new Date().toISOString(), deleted_at: null };
        recordsToSave.push({ store: definition.store, record });
        changes.push({
          entity, operation: previous ? "update" : "insert", uid,
          baseVersion: Number(previous?.version || 0),
          baseData: previous && !previous.deleted_at ? cleanData(previous.data) : null,
          data
        });
      }
      for (const [uid, previous] of baselines[entity]) {
        if (currentIds.has(uid) || previous.deleted_at || currentUser?.role === "FIELD") continue;
        const record = { ...previous, version: Number(previous.version || 0) + 1, updated_at: new Date().toISOString(), deleted_at: new Date().toISOString() };
        recordsToSave.push({ store: definition.store, record });
        changes.push({
          entity, operation: "delete", uid,
          baseVersion: Number(previous.version || 0),
          baseData: cleanData(previous.data),
          data: cleanData(previous.data)
        });
      }
    }
    if (!changes.length) { if (shouldSync && typeof RebanhoSync !== "undefined") RebanhoSync.runAutomatic({ silent: true }); return; }
    const createdAt = new Date().toISOString();
    const outboxes = chunkOutboxChanges(changes).map((batchChanges, index) => ({
      id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${index}_${Math.random()}`,
      changes: batchChanges, createdAt, attempts: 0, conflict: false
    }));
    const db = await open(), stores = [...new Set([...recordsToSave.map(item => item.store), "outbox"])], tx = db.transaction(stores, "readwrite");
    for (const item of recordsToSave) tx.objectStore(item.store).put(item.record);
    for (const outbox of outboxes) tx.objectStore("outbox").put(outbox);
    await transactionPromise(tx);
    for (const item of recordsToSave) {
      const entity = Object.keys(entities).find(name => entities[name].store === item.store);
      baselines[entity].set(item.record.uid, structuredClone(item.record));
    }
    if (shouldSync && typeof RebanhoSync !== "undefined") RebanhoSync.runAutomatic({ silent: true });
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
  async function archiveRejectedOutbox(batch, cloudRecords, reason) {
    const validRecords = cloudRecords.filter(item => entities[item.entity] && item.record);
    if (validRecords.length !== batch.changes.length) throw new Error("A cópia da nuvem está incompleta para recuperar o lote.");
    const stores = [...new Set(["outbox", "meta", ...validRecords.map(item => entities[item.entity].store)])];
    const db = await open(), tx = db.transaction(stores, "readwrite");
    tx.objectStore("meta").put({
      key: `archived_outbox:${batch.id}`,
      value: { batch: structuredClone(batch), reason, archivedAt: new Date().toISOString() }
    });
    for (const item of validRecords) tx.objectStore(entities[item.entity].store).put(item.record);
    tx.objectStore("outbox").delete(batch.id);
    await transactionPromise(tx);
  }
  async function discardOutboxBatch(batch, items, reason) {
    const valid = items.filter(item => entities[item.entity] && (item.record || (item.remove && item.uid)));
    if (valid.length !== batch.changes.length) throw new Error("A cópia da nuvem está incompleta para descartar o lote.");
    const stores = [...new Set(["outbox", "meta", ...valid.map(item => entities[item.entity].store)])];
    const db = await open(), tx = db.transaction(stores, "readwrite");
    tx.objectStore("meta").put({
      key: `archived_outbox:${batch.id}`,
      value: { batch: structuredClone(batch), reason, archivedAt: new Date().toISOString(), discardedByUser: true }
    });
    for (const item of valid) {
      const store = tx.objectStore(entities[item.entity].store);
      if (item.remove) store.delete(String(item.uid));
      else store.put(item.record);
    }
    tx.objectStore("outbox").delete(batch.id);
    await transactionPromise(tx);
  }
  async function archivedOutbox() {
    const entries = await getAll("meta");
    return entries.filter(item => item.key.startsWith("archived_outbox:")).map(item => item.value);
  }
  async function resolveOutboxBatch(batch, nextChanges, resolvedRecords) {
    const validRecords = (resolvedRecords || []).filter(item => entities[item.entity] && (item.record || (item.remove && item.uid)));
    const stores = [...new Set(["outbox", ...validRecords.map(item => entities[item.entity].store)])];
    const db = await open(), tx = db.transaction(stores, "readwrite");
    for (const item of validRecords) {
      const store = tx.objectStore(entities[item.entity].store);
      if (item.remove) store.delete(String(item.uid));
      else store.put(item.record);
    }
    if (nextChanges.length) {
      tx.objectStore("outbox").put({
        ...batch, changes: nextChanges, conflict: false, conflicts: [], lastError: "",
        resolvedAt: new Date().toISOString()
      });
    } else {
      tx.objectStore("outbox").delete(batch.id);
    }
    await transactionPromise(tx);
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
    return { pending: outbox.length, conflicts: outbox.filter(item => item.conflict).length, rejected: outbox.filter(item => item.rejected).length, cursor: await getMeta("sync_cursor", 0), lastSync: await getMeta("last_sync", "") };
  }

  return { entities, open, getAll, getMeta, setMeta, loadAfterLogin, scheduleCapture, captureNow, pendingOutbox, updateOutbox, removeOutbox, archiveRejectedOutbox, archivedOutbox, resolveOutboxBatch, applyRemoteChanges, replaceFromImportedSnapshot, status, sameData, chunkOutboxChanges, loadStable, discardOutboxBatch };
})();
