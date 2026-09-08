const RebanhoSync = (() => {
  let running = false;
  let runAgain = false;
  let resolving = false;
  const blankGenealogyFields = new Set(["father", "mother", "pgf", "pgm", "mgf", "mgm", "fatherReproUid", "damKey"]);
  const derivedMetadataFields = new Set(["updatedAt", "source"]);

  function isPlainObject(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }
  function comparableValue(value, path) {
    const field = path[path.length - 1] || "";
    return blankGenealogyFields.has(field) && (value === null || value === undefined || value === "") ? "" : value;
  }
  function sameValue(left, right, path = []) {
    return RebanhoData.sameData({ value: comparableValue(left, path) }, { value: comparableValue(right, path) });
  }
  function mergeThreeWay(base, local, server, path = []) {
    if (sameValue(local, server, path)) return { value: structuredClone(server), conflicts: [] };
    if (sameValue(local, base, path)) return { value: structuredClone(server), conflicts: [] };
    if (sameValue(server, base, path)) return { value: structuredClone(local), conflicts: [] };

    const field = path[path.length - 1] || "";
    if (derivedMetadataFields.has(field)) return { value: structuredClone(server), conflicts: [] };

    const mergeableBase = isPlainObject(base) ? base : undefined;
    if (isPlainObject(local) && isPlainObject(server) && (mergeableBase || base === undefined)) {
      const source = mergeableBase || {};
      const value = {};
      const conflicts = [];
      const keys = [...new Set([...Object.keys(source), ...Object.keys(local), ...Object.keys(server)])].sort();
      for (const key of keys) {
        const merged = mergeThreeWay(source[key], local[key], server[key], [...path, key]);
        conflicts.push(...merged.conflicts);
        if (merged.value !== undefined) value[key] = merged.value;
      }
      return { value, conflicts };
    }

    return { value: structuredClone(server), conflicts: [path.join(".") || "registro"] };
  }

  function normalizedRecord(record) {
    if (!record) return null;
    return {
      uid: String(record.uid || ""), data: structuredClone(record.data || {}), version: Number(record.version || 0),
      updated_at: record.updated_at || new Date().toISOString(), deleted_at: record.deleted_at || null
    };
  }

  function classifyChange(change, context) {
    const server = normalizedRecord(context?.server), serverActive = Boolean(server && !server.deleted_at);
    const localData = structuredClone(change.data || {}), baseVersion = Number(change.baseVersion || 0);
    const embeddedBase = isPlainObject(change.baseData) ? change.baseData : null;
    const baseData = embeddedBase || (isPlainObject(context?.base?.data) ? context.base.data : null);

    if (change.operation === "insert") {
      if (!server) return { safe: true, keep: { ...change, baseVersion: 0, baseData: null }, record: { uid: change.uid, data: localData, version: 1, updated_at: new Date().toISOString(), deleted_at: null }, mode: "local" };
      if (serverActive && RebanhoData.sameData(localData, server.data)) return { safe: true, keep: null, record: server, mode: "server" };
      return { safe: false, fields: [serverActive ? "registro já existente" : "registro excluído na nuvem"] };
    }

    if (change.operation === "delete") {
      if (!server || !serverActive) return { safe: true, keep: null, record: server, mode: "server" };
      if (server.version === baseVersion || (baseData && RebanhoData.sameData(baseData, server.data))) {
        const keep = { ...change, baseVersion: server.version, baseData: structuredClone(server.data) };
        return { safe: true, keep, record: { uid: change.uid, data: structuredClone(server.data), version: server.version + 1, updated_at: new Date().toISOString(), deleted_at: new Date().toISOString() }, mode: "local" };
      }
      return { safe: false, fields: ["exclusão versus alteração na nuvem"] };
    }

    if (!serverActive) return { safe: false, fields: ["registro ausente ou excluído na nuvem"] };
    if (RebanhoData.sameData(localData, server.data)) return { safe: true, keep: null, record: server, mode: "server" };
    if (server.version === baseVersion) {
      const keep = { ...change, baseData: baseData ? structuredClone(baseData) : structuredClone(server.data) };
      return { safe: true, keep, record: { uid: change.uid, data: localData, version: server.version + 1, updated_at: new Date().toISOString(), deleted_at: null }, mode: "local" };
    }
    if (!baseData) return { safe: false, fields: ["versão-base não encontrada"] };

    const merged = mergeThreeWay(baseData, localData, server.data);
    if (merged.conflicts.length) return { safe: false, fields: merged.conflicts };
    if (RebanhoData.sameData(merged.value, server.data)) return { safe: true, keep: null, record: server, mode: "server" };
    const keep = { ...change, operation: "update", baseVersion: server.version, baseData: structuredClone(server.data), data: merged.value };
    return { safe: true, keep, record: { uid: change.uid, data: structuredClone(merged.value), version: server.version + 1, updated_at: new Date().toISOString(), deleted_at: null }, mode: "merged" };
  }

  async function pushPending() {
    const pending = await RebanhoData.pendingOutbox();
    for (const batch of pending) {
      if (batch.conflict) return { conflict: true };
      try {
        const result = await RebanhoApi.rpc("rebanho_push_changes", { p_token: sessionToken, p_batch_id: batch.id, p_changes: batch.changes });
        if (!result?.ok) {
          const conflict = result?.error === "VERSION_CONFLICT" || Array.isArray(result?.conflicts);
          await RebanhoData.updateOutbox({ ...batch, conflict, conflicts: result?.conflicts || [], lastError: result?.error || "Falha ao enviar", lastAttemptAt: new Date().toISOString(), attempts: Number(batch.attempts || 0) + 1 });
          return { conflict };
        }
        await RebanhoData.removeOutbox(batch.id);
      } catch (error) {
        await RebanhoData.updateOutbox({ ...batch, lastError: error.message, lastAttemptAt: new Date().toISOString(), attempts: Number(batch.attempts || 0) + 1 });
        throw error;
      }
    }
    return { conflict: false };
  }

  async function pullChanges() {
    let cursor = Number(await RebanhoData.getMeta("sync_cursor", 0));
    do {
      const result = await RebanhoApi.rpc("rebanho_pull_changes", { p_token: sessionToken, p_after_seq: cursor, p_limit: REBANHO_CONFIG.syncPageSize });
      if (!result?.ok) throw new Error(result?.error || "Não foi possível baixar as alterações");
      await RebanhoData.applyRemoteChanges(result.changes || []);
      cursor = Number(result.nextCursor ?? cursor);
      await RebanhoData.setMeta("sync_cursor", cursor);
      if (!result.hasMore) break;
    } while (true);
    return cursor;
  }

  async function run({ silent = false } = {}) {
    if (!currentUser || !sessionToken || !navigator.onLine || !RebanhoApi.configured()) {
      renderSyncInfo();
      return { ok: false, offline: true };
    }
    if (running) { runAgain = true; return { ok: false, busy: true }; }
    if (resolving) return { ok: false, busy: true };
    running = true;
    try {
      await RebanhoData.captureNow();
      const pushed = await pushPending();
      if (pushed.conflict) {
        renderSyncInfo();
        if (!silent) alert("Existe um conflito de edição pendente. Os dados locais foram preservados e nada foi sobrescrito.");
        return { ok: false, conflict: true };
      }
      await pullChanges();
      applySnapshot(await RebanhoData.loadAfterLogin());
      migrateReproducers(); rebuildPedigreeLibrary();
      await RebanhoData.setMeta("last_sync", new Date().toISOString());
      refreshAllViews();
      renderSyncInfo();
      return { ok: true };
    } catch (error) {
      console.error(error);
      renderSyncInfo(error.message);
      if (!silent) alert("Não foi possível sincronizar agora. Os dados continuam salvos neste aparelho.");
      return { ok: false, error };
    } finally {
      running = false;
      if (runAgain) { runAgain = false; queueMicrotask(() => run({ silent: true })); }
    }
  }

  async function resolveConflicts() {
    if (!currentUser || !sessionToken || !navigator.onLine || !RebanhoApi.configured()) return { ok: false, offline: true };
    if (running || resolving) return { ok: false, busy: true };

    const batches = (await RebanhoData.pendingOutbox()).filter(batch => batch.conflict);
    if (!batches.length) return { ok: true, resolvedBatches: 0, merged: 0, discarded: 0 };

    let resolvedBatches = 0, merged = 0, discarded = 0;
    const manual = [];
    resolving = true;
    try {
      for (const batch of batches) {
        const result = await RebanhoApi.rpc("rebanho_conflict_context", {
          p_token: sessionToken,
          p_items: batch.changes.map(change => ({
            entity: change.entity, uid: change.uid, baseVersion: Number(change.baseVersion || 0),
            baseData: isPlainObject(change.baseData) ? change.baseData : null
          }))
        });
        if (!result?.ok) throw new Error(result?.error || "Não foi possível analisar o conflito");
        const contexts = new Map((result.contexts || []).map(context => [`${context.entity}:${context.uid}`, context]));
        const nextChanges = [];
        const records = [];
        const batchManual = [];
        let batchMerged = 0, batchDiscarded = 0;

        for (const change of batch.changes) {
          const classification = classifyChange(change, contexts.get(`${change.entity}:${change.uid}`));
          if (!classification.safe) {
            batchManual.push({ entity: change.entity, uid: change.uid, fields: classification.fields || ["registro"] });
            continue;
          }
          if (classification.keep) {
            nextChanges.push(classification.keep);
            if (classification.mode === "merged") batchMerged++;
          } else {
            batchDiscarded++;
          }
          if (classification.record) records.push({ entity: change.entity, record: classification.record });
        }

        if (batchManual.length) {
          manual.push(...batchManual);
          continue;
        }

        await RebanhoData.resolveOutboxBatch(batch, nextChanges, records);
        resolvedBatches++;
        merged += batchMerged;
        discarded += batchDiscarded;
      }

      applySnapshot(await RebanhoData.loadAfterLogin());
      migrateReproducers(); rebuildPedigreeLibrary();
      refreshAllViews();
    } finally {
      resolving = false;
    }

    const synced = await run({ silent: true });
    if (manual.length) {
      return { ...synced, ok: false, manual: true, manualConflicts: manual, resolvedBatches, merged, discarded };
    }
    return { ...synced, resolvedBatches, merged, discarded };
  }

  return { run, pullChanges, pushPending, resolveConflicts, mergeThreeWay, classifyChange };
})();

async function syncFromCloud() { return RebanhoSync.run({ silent: true }); }
async function pushToCloud() { return RebanhoSync.run({ silent: true }); }
async function syncNow(showMessage = false) {
  const result = await RebanhoSync.run({ silent: !showMessage });
  if (showMessage && result.ok) alert("Sincronização concluída.");
  return result.ok;
}
async function resolveSyncConflicts() {
  const button = document.getElementById("resolveConflictsBtn");
  const info = document.getElementById("conflictResolutionInfo");
  if (!navigator.onLine || !sessionToken) return alert("É preciso estar online e com a sessão ativa para analisar o conflito.");
  if (button) button.disabled = true;
  if (info) {
    info.classList.remove("hidden");
    info.textContent = "Analisando as versões local e da nuvem...";
  }
  try {
    const result = await RebanhoSync.resolveConflicts();
    if (result.manual) {
      const items = result.manualConflicts || [];
      const preview = items.slice(0, 6).map(item => item.entity + " " + item.uid + ": " + item.fields.join(", ")).join("; ");
      const remaining = items.length > 6 ? " e mais " + (items.length - 6) : "";
      if (info) info.textContent = "Conflito real preservado. Campos que exigem revisão: " + preview + remaining + ".";
      alert("Há campos alterados de maneiras diferentes neste aparelho e na nuvem. Nenhum dado foi sobrescrito.");
    } else if (result.ok) {
      if (info) {
        info.textContent = result.merged
          ? "Sincronização concluída com segurança. As informações deste aparelho foram combinadas com as da nuvem. Nenhum dado foi perdido."
          : "Sincronização concluída com segurança. Os dados deste aparelho e da nuvem foram verificados e estão atualizados. Nenhuma informação foi perdida.";
      }
      alert("Conflito resolvido com segurança e sincronização concluída.");
    } else if (info) {
      info.textContent = "A nuvem mudou durante a resolução. Os dados locais continuam preservados; tente analisar novamente.";
    }
    await renderSyncInfo();
  } catch (error) {
    console.error(error);
    if (info) info.textContent = "Não foi possível analisar o conflito: " + error.message;
    alert("Não foi possível analisar o conflito agora. Nenhum dado foi alterado.");
  } finally {
    if (button) button.disabled = false;
  }
}
async function renderSyncInfo(error = "") {
  const element = document.getElementById("cloudSyncInfo");
  if (!element) return;
  const status = await RebanhoData.status();
  const conflictButton = document.getElementById("resolveConflictsBtn");
  if (conflictButton) conflictButton.classList.toggle("hidden", status.conflicts === 0);
  const when = status.lastSync ? new Date(status.lastSync).toLocaleString("pt-BR") : "ainda não sincronizado";
  const connection = navigator.onLine ? "Online" : "Offline";
  element.replaceChildren();
  const title = document.createElement("b"); title.textContent = connection;
  const details = document.createElement("div"); details.textContent = `Última sincronização: ${when} • ${status.pending} lote(s) pendente(s) • ${status.conflicts} conflito(s)`;
  const note = document.createElement("span"); note.className = "muted"; note.textContent = error || "Somente registros alterados são enviados. Lançamentos offline permanecem neste aparelho até a conexão voltar.";
  element.append(title, document.createElement("br"), details, note);
}
