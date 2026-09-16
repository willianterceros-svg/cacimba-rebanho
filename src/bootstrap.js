const today = () => cacimbaLocalDateISO(new Date());
function cacimbaLocalDateISO(value) {
  const date = value ? new Date(value) : new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}
function refreshAutomaticDates() {
  const value = today();
  ["birthDate", "saleDate", "deathDate", "reportDateTo"].forEach(id => {
    const input = document.getElementById(id);
    if (input && (!input.dataset.userChanged || !input.value)) input.value = value;
  });
}
function refreshAllViews() {
  renderStock(); renderReproducers(); renderHistory(); renderUsers();
  if (currentAnimalUid) renderAnimalDetail();
  if (document.querySelector(".screen.active")?.id === "ageList") renderAgeScreen();
  if (document.querySelector(".screen.active")?.id === "reports") renderReportPreview();
}
function renderIcons(root = document) {
  if (window.lucide?.createIcons) lucide.createIcons({ nameAttr: "data-lucide", root });
}
function updateNetStatus() {
  const online = navigator.onLine;
  const dot = document.createElement("i");
  netStatus.replaceChildren(dot, document.createTextNode(online ? "Online" : "Offline"));
  netStatus.className = `netstatus ${online ? "online" : "offline"}`;
  netStatus.title = online ? "Conectado à internet" : "Sem conexão — alterações salvas no aparelho";
}
function syncWhenActive() {
  const activeScreen = document.querySelector(".screen.active")?.id || "";
  if (!currentUser || !sessionToken || !navigator.onLine || document.visibilityState === "hidden") return;
  // Evita atualizar a base enquanto um cadastro existente está aberto para edição.
  if (["editAnimal", "editRepro"].includes(activeScreen)) return;
  return RebanhoSync.runAutomatic({ silent: true }).catch(error => console.error("Falha na sincronização automática", error));
}
function applyEnvBadge() {
  const isDev = REBANHO_CONFIG.env !== "prod";
  loginEnvBadge.classList.toggle("hidden", !isDev);
  envBadge.classList.toggle("hidden", !isDev);
}
async function bootstrap() {
  applyEnvBadge();
  refreshAutomaticDates();
  ["birthDate", "saleDate", "deathDate", "reportDateTo"].forEach(id => document.getElementById(id)?.addEventListener("change", event => { event.currentTarget.dataset.userChanged = "1"; }));
  birthMother.addEventListener("input", () => { const mother = herd.find(animal => animal.id === birthMother.value.trim() && animal.sex === "F"); motherRule.textContent = mother ? "Matriz localizada no estoque. A regra de intervalo mínimo entre partos será verificada ao salvar." : ""; });
  loginPassword.addEventListener("keydown", event => { if (event.key === "Enter") doLogin(); });
  renderIcons();
  await RebanhoData.open();
  appShell.classList.add("hidden"); backBtn.hidden = true; updateNetStatus();
  if (currentUser) await resumeSession(); else loginShell.classList.remove("hidden");
}
window.addEventListener("online", () => { updateNetStatus(); syncWhenActive(); });
window.addEventListener("offline", () => { updateNetStatus(); renderSyncInfo(); });
window.addEventListener("pageshow", () => { refreshAutomaticDates(); syncWhenActive(); });
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && currentUser) RebanhoData.captureNow()?.catch(error => console.error("Falha ao concluir salvamento local", error));
  if (document.visibilityState === "visible") syncWhenActive();
});
setInterval(syncWhenActive, REBANHO_CONFIG.syncIntervalMs);
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(error => console.warn("Service worker não registrado", error)));
}
bootstrap().catch(error => { console.error(error); loginError.style.display = "block"; loginError.textContent = "Não foi possível iniciar a aplicação."; });
