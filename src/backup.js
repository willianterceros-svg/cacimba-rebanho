function chooseBackupFile() {
  if (currentUser?.role !== "OWNER") return alert("Somente o Proprietário pode importar um backup.");
  backupJsonFile.value = "";
  backupJsonFile.click();
}
function backupPayloadFrom(value) {
  let root = value;
  if (Array.isArray(root)) root = root[0] || {};
  if (root.cloud?.payload) return root.cloud.payload;
  if (root.payload) return root.payload;
  if (root.local) return root.local;
  return root;
}
function validateBackup(value) {
  const payload = backupPayloadFrom(value);
  if (!payload || !Array.isArray(payload.herd)) throw new Error("O JSON não contém uma coleção herd válida.");
  return {
    payload,
    counts: {
      animals: payload.herd.length,
      movements: Array.isArray(payload.movementEvents) ? payload.movementEvents.length : 0,
      reproducers: Array.isArray(payload.reproducers) ? payload.reproducers.length : 0,
      history: Array.isArray(payload.history) ? payload.history.length : 0,
      pedigree: Array.isArray(payload.pedigreeLibrary) ? payload.pedigreeLibrary.length : 0
    }
  };
}
async function showSelectedBackup() {
  const file = backupJsonFile.files[0]; if (!file) return;
  backupImportInfo.classList.remove("hidden");
  try {
    const json = JSON.parse(await file.text()), validated = validateBackup(json), counts = validated.counts;
    backupImportInfo.textContent = `${counts.animals} animais, ${counts.movements} movimentações, ${counts.reproducers} reprodutores, ${counts.history} históricos e ${counts.pedigree} genealogias.`;
    if (!sessionToken || !navigator.onLine) return alert("A importação na nuvem exige uma sessão online.");
    const localStatus = await RebanhoData.status();
    if (localStatus.pending) return alert("Sincronize os lançamentos pendentes antes de importar o backup.");
    if (!confirm(`Importar ${counts.animals} animais para as tabelas separadas? Registros com o mesmo UID serão atualizados; o JSON original será arquivado no banco.`)) return;
    backupImportInfo.textContent += " Enviando e validando...";
    const result = await rpc("rebanho_import_backup", { p_token: sessionToken, p_backup: json, p_mode: "merge", p_source_name: file.name });
    if (!result?.ok) throw new Error(result?.error || "Importação recusada pelo banco");
    await RebanhoData.setMeta("sync_cursor", 0);
    await RebanhoSync.run({ silent: false });
    backupImportInfo.textContent = `Importação concluída e conferida: ${JSON.stringify(result.counts)}.`;
  } catch (error) {
    console.error(error); backupImportInfo.textContent = `Falha: ${error.message}`; alert("O backup não foi importado. Nenhuma importação parcial deve ser considerada válida.");
  }
}
function downloadBackup(value) {
  const text = JSON.stringify(value, null, 2), blob = new Blob([text], { type: "application/json" });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-"), filename = `cacimba_rebanho_backup_${stamp}.json`;
  const url = URL.createObjectURL(blob), anchor = document.createElement("a");
  anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 3000);
}
async function exportFullBackup() {
  if (!currentUser) return;
  try {
    await RebanhoData.captureNow();
    const pendingOutbox = await RebanhoData.pendingOutbox();
    if (sessionToken && navigator.onLine) {
      try {
        const result = await rpc("rebanho_export_backup", { p_token: sessionToken });
        if (!result?.ok) throw new Error(result?.error || "Falha ao exportar");
        if (!pendingOutbox.length) { downloadBackup(result.backup); return; }
        downloadBackup({
          app: "Agropecuária Cacimba — Gestão do Rebanho", backupVersion: 5,
          generatedAt: new Date().toISOString(), source: "local-with-pending-changes",
          payload: localSnapshot(), pendingOutbox, cloudBackup: result.backup
        });
        alert("O backup inclui os dados locais e os lançamentos ainda pendentes. A cópia da nuvem também foi anexada para conferência.");
        return;
      } catch (cloudError) {
        console.error("Falha ao incluir a cópia da nuvem", cloudError);
      }
    }
    downloadBackup({
      app: "Agropecuária Cacimba — Gestão do Rebanho", backupVersion: 5,
      generatedAt: new Date().toISOString(), source: navigator.onLine ? "local-cloud-unavailable" : "offline-local",
      payload: localSnapshot(), pendingOutbox
    });
    if (navigator.onLine) alert("A nuvem não respondeu; foi baixado um backup local para preservar os lançamentos deste aparelho.");
  } catch (error) { console.error(error); alert("Não foi possível gerar o backup."); }
}
