const RebanhoSync = (() => {
  let running = false;
  let runAgain = false;

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
      migrateReproducers(); rebuildPedigreeLibrary(); migrateLegacyGenealogyLinks();
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

  return { run, pullChanges, pushPending };
})();

async function syncFromCloud() { return RebanhoSync.run({ silent: true }); }
async function pushToCloud() { return RebanhoSync.run({ silent: true }); }
async function syncNow(showMessage = false) {
  const result = await RebanhoSync.run({ silent: !showMessage });
  if (showMessage && result.ok) alert("Sincronização concluída.");
  return result.ok;
}
async function renderSyncInfo(error = "") {
  const element = document.getElementById("cloudSyncInfo");
  if (!element) return;
  const status = await RebanhoData.status();
  const when = status.lastSync ? new Date(status.lastSync).toLocaleString("pt-BR") : "ainda não sincronizado";
  const connection = navigator.onLine ? "Online" : "Offline";
  element.replaceChildren();
  const title = document.createElement("b"); title.textContent = connection;
  const details = document.createElement("div"); details.textContent = `Última sincronização: ${when} • ${status.pending} lote(s) pendente(s) • ${status.conflicts} conflito(s)`;
  const note = document.createElement("span"); note.className = "muted"; note.textContent = error || "Somente registros alterados são enviados. Lançamentos offline permanecem neste aparelho até a conexão voltar.";
  element.append(title, document.createElement("br"), details, note);
}
