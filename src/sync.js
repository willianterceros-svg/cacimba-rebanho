const RebanhoSync = (() => {
  let running = false;
  let runAgain = false;
  let resolving = false;
  let pendingReview = [];
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

  function valueAtPath(source, path) {
    if (path === "registro") return source;
    return path.split(".").reduce((value, key) => value == null ? undefined : value[key], source);
  }
  function setValueAtPath(target, path, value) {
    if (path === "registro") return structuredClone(value);
    const keys = path.split("."), result = structuredClone(target || {});
    let current = result;
    for (let index = 0; index < keys.length - 1; index++) {
      const key = keys[index];
      if (!isPlainObject(current[key])) current[key] = {};
      current = current[key];
    }
    const last = keys[keys.length - 1];
    if (value === undefined) delete current[last];
    else current[last] = structuredClone(value);
    return result;
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
      return { safe: false, fields: ["registro"], reason: serverActive ? "O registro também foi criado na nuvem." : "O registro foi excluído na nuvem.", localData, baseData, server };
    }

    if (change.operation === "delete") {
      if (!server || !serverActive) return { safe: true, keep: null, record: server, mode: "server" };
      if (server.version === baseVersion || (baseData && RebanhoData.sameData(baseData, server.data))) {
        const keep = { ...change, baseVersion: server.version, baseData: structuredClone(server.data) };
        return { safe: true, keep, record: { uid: change.uid, data: structuredClone(server.data), version: server.version + 1, updated_at: new Date().toISOString(), deleted_at: new Date().toISOString() }, mode: "local" };
      }
      return { safe: false, fields: ["registro"], reason: "Este aparelho excluiu o registro, mas ele foi alterado na nuvem.", localData, baseData, server };
    }

    if (!serverActive) return { safe: false, fields: ["registro"], reason: "O registro está ausente ou foi excluído na nuvem.", localData, baseData, server };
    if (RebanhoData.sameData(localData, server.data)) return { safe: true, keep: null, record: server, mode: "server" };
    if (server.version === baseVersion) {
      const keep = { ...change, baseData: baseData ? structuredClone(baseData) : structuredClone(server.data) };
      return { safe: true, keep, record: { uid: change.uid, data: localData, version: server.version + 1, updated_at: new Date().toISOString(), deleted_at: null }, mode: "local" };
    }
    if (!baseData) return { safe: false, fields: ["registro"], reason: "A versão original não foi encontrada para comparar os campos.", localData, baseData, server };

    const merged = mergeThreeWay(baseData, localData, server.data);
    if (merged.conflicts.length) return { safe: false, fields: merged.conflicts, reason: "Os mesmos campos foram alterados de formas diferentes.", mergedData: merged.value, localData, baseData, server };
    if (RebanhoData.sameData(merged.value, server.data)) return { safe: true, keep: null, record: server, mode: "server" };
    const keep = { ...change, operation: "update", baseVersion: server.version, baseData: structuredClone(server.data), data: merged.value };
    return { safe: true, keep, record: { uid: change.uid, data: structuredClone(merged.value), version: server.version + 1, updated_at: new Date().toISOString(), deleted_at: null }, mode: "merged" };
  }

  function resolveManualChange(change, classification, decisions) {
    const server = classification.server;
    const localData = classification.localData || structuredClone(change.data || {});
    const choices = new Map(decisions.map(decision => [decision.field, decision]));
    for (const field of classification.fields) {
      if (!choices.has(field)) return { missing: true };
    }

    if (classification.fields.includes("registro")) {
      const choice = choices.get("registro").choice;
      if (choice === "cloud") {
        return server
          ? { keep: null, recordItem: { entity: change.entity, record: server } }
          : { keep: null, recordItem: { entity: change.entity, uid: change.uid, remove: true } };
      }
      if (choice !== "local") return { missing: true };
      if (change.operation === "delete") {
        if (!server || server.deleted_at) return { keep: null, recordItem: server ? { entity: change.entity, record: server } : null };
        const keep = { ...change, baseVersion: server.version, baseData: structuredClone(server.data), data: structuredClone(server.data) };
        const record = { uid: change.uid, data: structuredClone(server.data), version: server.version + 1, updated_at: new Date().toISOString(), deleted_at: new Date().toISOString() };
        return { keep, recordItem: { entity: change.entity, record } };
      }
      const operation = server ? "update" : "insert";
      const baseVersion = Number(server?.version || 0);
      const keep = { ...change, operation, baseVersion, baseData: server ? structuredClone(server.data) : null, data: structuredClone(localData) };
      const record = { uid: change.uid, data: structuredClone(localData), version: baseVersion + 1, updated_at: new Date().toISOString(), deleted_at: null };
      return { keep, recordItem: { entity: change.entity, record } };
    }

    let data = structuredClone(classification.mergedData || server?.data || {});
    for (const field of classification.fields) {
      const decision = choices.get(field);
      const value = decision.choice === "local"
        ? valueAtPath(localData, field)
        : decision.choice === "cloud"
          ? valueAtPath(server?.data, field)
          : decision.value;
      data = setValueAtPath(data, field, value);
    }
    if (RebanhoData.sameData(data, server.data)) return { keep: null, recordItem: { entity: change.entity, record: server } };
    const keep = { ...change, operation: "update", baseVersion: server.version, baseData: structuredClone(server.data), data };
    const record = { uid: change.uid, data: structuredClone(data), version: server.version + 1, updated_at: new Date().toISOString(), deleted_at: null };
    return { keep, recordItem: { entity: change.entity, record } };
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
          return { conflict, failed: !conflict, error: result?.error || "Falha ao enviar" };
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
      if (pushed.failed) {
        const error = new Error(pushed.error || "Não foi possível enviar as alterações");
        renderSyncInfo(error.message);
        if (!silent) alert("As alterações continuam salvas neste aparelho, mas não puderam ser enviadas.");
        return { ok: false, error };
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
      if (runAgain) { runAgain = false; queueMicrotask(() => runAutomatic({ silent: true })); }
    }
  }

  async function runAutomatic({ silent = true } = {}) {
    const result = await run({ silent: true });
    if (!result.conflict) return result;
    try {
      return await resolveConflicts();
    } catch (error) {
      console.error("Falha ao resolver conflito automaticamente", error);
      renderSyncInfo(error.message);
      if (!silent) alert("Os dados locais continuam preservados, mas o conflito precisa ser analisado novamente.");
      return { ok: false, conflict: true, error };
    }
  }

  async function resolveConflicts() {
    if (!currentUser || !sessionToken || !navigator.onLine || !RebanhoApi.configured()) return { ok: false, offline: true };
    if (running || resolving) return { ok: false, busy: true };

    let resolvedBatches = 0, merged = 0, discarded = 0;
    const manual = [];
    resolving = true;
    try {
      const batches = (await RebanhoData.pendingOutbox()).filter(batch => batch.conflict);
      if (!batches.length) {
        pendingReview = [];
        return { ok: true, resolvedBatches: 0, merged: 0, discarded: 0 };
      }

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
          const context = contexts.get(`${change.entity}:${change.uid}`);
          const classification = classifyChange(change, context);
          if (!classification.safe) {
            batchManual.push({
              batchId: batch.id,
              entity: change.entity,
              uid: change.uid,
              operation: change.operation,
              fields: classification.fields || ["registro"],
              reason: classification.reason || "Os dados precisam de revisão.",
              baseData: structuredClone(classification.baseData || change.baseData || context?.base?.data),
              localData: structuredClone(classification.localData || change.data || {}),
              serverData: structuredClone(classification.server?.data || context?.server?.data),
              serverVersion: classification.server?.version ?? context?.server?.version ?? null,
              serverDeletedAt: classification.server?.deleted_at || context?.server?.deleted_at || null
            });
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
      pendingReview = structuredClone(manual);
      return { ...synced, ok: false, manual: true, manualConflicts: manual, resolvedBatches, merged, discarded };
    }
    pendingReview = [];
    return { ...synced, resolvedBatches, merged, discarded };
  }

  async function applyManualResolutions(decisions) {
    if (!currentUser || !sessionToken || !navigator.onLine || !RebanhoApi.configured()) return { ok: false, offline: true };
    if (running || resolving) return { ok: false, busy: true };
    const decisionList = Array.isArray(decisions) ? decisions : [];
    const decisionKey = item => `${item.batchId}:${item.entity}:${item.uid}`;
    const groupedDecisions = new Map();
    for (const decision of decisionList) {
      const key = decisionKey(decision);
      if (!groupedDecisions.has(key)) groupedDecisions.set(key, []);
      groupedDecisions.get(key).push(decision);
    }

    const plans = [];
    resolving = true;
    try {
      const batches = (await RebanhoData.pendingOutbox()).filter(batch => batch.conflict);
      if (!batches.length) return { ok: true, resolvedBatches: 0 };

      for (const batch of batches) {
        const result = await RebanhoApi.rpc("rebanho_conflict_context", {
          p_token: sessionToken,
          p_items: batch.changes.map(change => ({
            entity: change.entity, uid: change.uid, baseVersion: Number(change.baseVersion || 0),
            baseData: isPlainObject(change.baseData) ? change.baseData : null
          }))
        });
        if (!result?.ok) throw new Error(result?.error || "Não foi possível conferir as escolhas");
        const contexts = new Map((result.contexts || []).map(context => [`${context.entity}:${context.uid}`, context]));
        const nextChanges = [], records = [];

        for (const change of batch.changes) {
          const context = contexts.get(`${change.entity}:${change.uid}`);
          const classification = classifyChange(change, context);
          if (classification.safe) {
            if (classification.keep) nextChanges.push(classification.keep);
            if (classification.record) records.push({ entity: change.entity, record: classification.record });
            continue;
          }

          const selected = groupedDecisions.get(`${batch.id}:${change.entity}:${change.uid}`) || [];
          const expected = selected[0];
          const currentVersion = classification.server?.version ?? null;
          const currentDeletedAt = classification.server?.deleted_at || null;
          if (!expected || expected.serverVersion !== currentVersion || expected.serverDeletedAt !== currentDeletedAt) {
            return { ok: false, stale: true };
          }
          const resolution = resolveManualChange(change, classification, selected);
          if (resolution.missing) return { ok: false, incomplete: true };
          if (resolution.keep) nextChanges.push(resolution.keep);
          if (resolution.recordItem) records.push(resolution.recordItem);
        }
        plans.push({ batch, nextChanges, records });
      }

      for (const plan of plans) {
        await RebanhoData.resolveOutboxBatch(plan.batch, plan.nextChanges, plan.records);
      }
      pendingReview = [];
      applySnapshot(await RebanhoData.loadAfterLogin());
      migrateReproducers(); rebuildPedigreeLibrary();
      refreshAllViews();
    } finally {
      resolving = false;
    }

    const synced = await runAutomatic({ silent: true });
    return { ...synced, resolvedBatches: plans.length };
  }

  function getPendingReview() { return structuredClone(pendingReview); }

  return { run, runAutomatic, pullChanges, pushPending, resolveConflicts, applyManualResolutions, getPendingReview, mergeThreeWay, classifyChange, resolveManualChange };
})();

async function syncFromCloud() { return RebanhoSync.runAutomatic({ silent: true }); }
async function pushToCloud() { return RebanhoSync.runAutomatic({ silent: true }); }
async function syncNow(showMessage = false) {
  const result = await RebanhoSync.runAutomatic({ silent: !showMessage });
  if (showMessage && result.ok) alert("Sincronização concluída.");
  if (showMessage && result.manual) alert("Existe uma divergência real que precisa de revisão. Os dados locais continuam preservados.");
  return result.ok;
}

let visibleConflictReview = [];
const conflictFieldLabels = {
  id: "Identificação", name: "Nome", status: "Situação", father: "Pai", mother: "Mãe",
  pgf: "Avô paterno", pgm: "Avó paterna", mgf: "Avô materno", mgm: "Avó materna",
  breed: "Raça", birth: "Nascimento", notes: "Observações", register: "Registro", code: "Código",
  source: "Origem", fatherReproUid: "Vínculo do pai", damKey: "Vínculo da mãe", registro: "Registro completo",
  importSource: "Planilha de origem"
};
const conflictEntityLabels = {
  animals: "Animal", movements: "Movimentação", reproducers: "Reprodutor",
  history: "Histórico", historical_dams: "Matriz histórica", pedigree: "Genealogia"
};

function conflictValueAtPath(source, path) {
  if (path === "registro") return source;
  return path.split(".").reduce((value, key) => value == null ? undefined : value[key], source);
}
function conflictValueText(value) {
  if (value === undefined || value === null || value === "") return "Não informado";
  if (typeof value === "boolean") return value ? "Sim" : "Não";
  if (typeof value === "object") {
    const preferred = ["id", "name", "status", "father", "mother", "notes"]
      .filter(key => value[key] !== undefined && value[key] !== null && value[key] !== "")
      .map(key => `${conflictFieldLabels[key] || key}: ${value[key]}`);
    const text = preferred.length ? preferred.join("\n") : JSON.stringify(value, null, 2);
    return text.length > 700 ? text.slice(0, 700) + "…" : text;
  }
  return String(value);
}
function conflictRecordTitle(item) {
  const data = item.localData || item.serverData || {};
  const reference = data.id || data.name || data.code || item.uid;
  return `${conflictEntityLabels[item.entity] || "Registro"}: ${reference}`;
}
function appendConflictOption(container, name, choice, title, value) {
  const label = document.createElement("label"); label.className = "conflict-option";
  const radio = document.createElement("input"); radio.type = "radio"; radio.name = name; radio.value = choice;
  const content = document.createElement("span"), heading = document.createElement("b"), text = document.createElement("span");
  heading.textContent = title; text.className = "conflict-value"; text.textContent = conflictValueText(value);
  content.append(heading, text); label.append(radio, content); container.append(label);
  return { label, radio, content };
}
function parseConflictCustomValue(raw, item, field) {
  const samples = [conflictValueAtPath(item.localData, field), conflictValueAtPath(item.serverData, field), conflictValueAtPath(item.baseData, field)];
  const sample = samples.find(value => value !== undefined && value !== null);
  if (typeof sample === "number") {
    const number = Number(raw.replace(",", "."));
    if (!Number.isFinite(number)) throw new Error(`Informe um número válido para ${conflictFieldLabels[field] || field}.`);
    return number;
  }
  if (typeof sample === "boolean") {
    const normalized = raw.trim().toLowerCase();
    if (["sim", "true", "1"].includes(normalized)) return true;
    if (["não", "nao", "false", "0"].includes(normalized)) return false;
    throw new Error(`Informe Sim ou Não para ${conflictFieldLabels[field] || field}.`);
  }
  return raw;
}
function closeConflictReview() {
  const overlay = document.getElementById("conflictReviewOverlay");
  if (overlay) overlay.classList.add("hidden");
  document.body.style.overflow = "";
  visibleConflictReview = [];
}
function openConflictReview(items) {
  const overlay = document.getElementById("conflictReviewOverlay"), list = document.getElementById("conflictReviewList");
  if (!overlay || !list || !items?.length) return;
  visibleConflictReview = structuredClone(items);
  list.replaceChildren();
  visibleConflictReview.forEach((item, itemIndex) => {
    const record = document.createElement("section"); record.className = "conflict-record";
    const title = document.createElement("div"); title.className = "conflict-record-title"; title.textContent = conflictRecordTitle(item);
    const reason = document.createElement("div"); reason.className = "muted"; reason.textContent = item.reason;
    record.append(title, reason);
    item.fields.forEach((field, fieldIndex) => {
      const block = document.createElement("div"); block.className = "conflict-field"; block.dataset.itemIndex = itemIndex; block.dataset.field = field;
      const fieldTitle = document.createElement("div"); fieldTitle.className = "conflict-field-title"; fieldTitle.textContent = conflictFieldLabels[field] || field;
      const base = document.createElement("div"); base.className = "muted";
      base.textContent = `Antes: ${conflictValueText(conflictValueAtPath(item.baseData, field))}`;
      const values = document.createElement("div"); values.className = "conflict-values";
      const name = `conflict_${itemIndex}_${fieldIndex}`;
      const localValue = field === "registro" && item.operation === "delete" ? "Manter este registro excluído" : conflictValueAtPath(item.localData, field);
      const cloudValue = field === "registro" && item.serverDeletedAt ? "Manter este registro excluído" : conflictValueAtPath(item.serverData, field);
      appendConflictOption(values, name, "local", "Neste aparelho", localValue);
      appendConflictOption(values, name, "cloud", "Na nuvem", cloudValue);
      const localComplex = localValue !== null && typeof localValue === "object";
      const cloudComplex = cloudValue !== null && typeof cloudValue === "object";
      if (field !== "registro" && !localComplex && !cloudComplex) {
        const custom = appendConflictOption(values, name, "custom", "Outro valor", "Digite abaixo");
        custom.label.classList.add("conflict-custom");
        const input = document.createElement("input"); input.type = "text"; input.className = "conflict-custom-input";
        input.placeholder = "Informe o valor correto"; input.addEventListener("input", () => { custom.radio.checked = true; });
        custom.label.append(input);
      }
      block.append(fieldTitle, base, values); record.append(block);
    });
    list.append(record);
  });
  overlay.classList.remove("hidden"); document.body.style.overflow = "hidden"; renderIcons(overlay);
}
async function submitConflictReview() {
  const button = document.getElementById("applyConflictReviewBtn");
  const decisions = [];
  try {
    for (const block of document.querySelectorAll("#conflictReviewList .conflict-field")) {
      const item = visibleConflictReview[Number(block.dataset.itemIndex)], field = block.dataset.field;
      const selected = block.querySelector('input[type="radio"]:checked');
      if (!selected) { block.scrollIntoView({ behavior: "smooth", block: "center" }); throw new Error("Escolha uma opção para todos os campos antes de continuar."); }
      const decision = {
        batchId: item.batchId, entity: item.entity, uid: item.uid, field, choice: selected.value,
        serverVersion: item.serverVersion, serverDeletedAt: item.serverDeletedAt
      };
      if (selected.value === "custom") decision.value = parseConflictCustomValue(block.querySelector(".conflict-custom-input").value, item, field);
      decisions.push(decision);
    }
    if (button) { button.disabled = true; button.textContent = "Conferindo e sincronizando..."; }
    const result = await RebanhoSync.applyManualResolutions(decisions);
    if (result.stale || result.manual) {
      const refreshed = result.manual ? result : await RebanhoSync.resolveConflicts();
      if (refreshed.manual) {
        openConflictReview(refreshed.manualConflicts);
        alert("Os dados da nuvem mudaram durante a revisão. Confira novamente os campos atualizados; nenhuma escolha antiga foi aplicada.");
      } else {
        closeConflictReview();
        const info = document.getElementById("conflictResolutionInfo");
        if (info) { info.classList.remove("hidden"); info.textContent = "Os dados da nuvem mudaram durante a revisão, mas o conflito já foi resolvido automaticamente. Nenhuma informação foi perdida."; }
        alert("Os dados da nuvem mudaram durante a revisão, mas o conflito já foi resolvido automaticamente. Nenhuma informação foi perdida.");
        await renderSyncInfo();
      }
      return;
    }
    if (result.incomplete) throw new Error("Ainda existem campos sem uma escolha.");
    if (!result.ok) throw new Error("Não foi possível concluir a sincronização.");
    closeConflictReview();
    const info = document.getElementById("conflictResolutionInfo");
    if (info) { info.classList.remove("hidden"); info.textContent = "Revisão concluída com segurança. As escolhas foram sincronizadas e nenhuma informação foi perdida."; }
    alert("Revisão concluída e sincronizada.");
    await renderSyncInfo();
  } catch (error) {
    alert(error.message || "Não foi possível concluir a revisão.");
  } finally {
    if (button) { button.disabled = false; button.textContent = "Confirmar escolhas"; }
  }
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
      const fields = items.reduce((total, item) => total + item.fields.length, 0);
      if (info) info.textContent = `${fields} campo(s) precisam da sua escolha. Os dados continuam preservados até a confirmação.`;
      openConflictReview(items);
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
