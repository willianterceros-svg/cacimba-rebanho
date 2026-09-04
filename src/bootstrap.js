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
  netStatus.title = online ? "Conectado — dados sincronizados" : "Sem conexão — alterações salvas no aparelho";
}
async function bootstrap() {
  refreshAutomaticDates();
  ["birthDate", "saleDate", "deathDate", "reportDateTo"].forEach(id => document.getElementById(id)?.addEventListener("change", event => { event.currentTarget.dataset.userChanged = "1"; }));
  stockFile.onchange = event => { stockFileName.textContent = event.target.files[0]?.name || "Nenhum arquivo selecionado"; };
  saleFile.onchange = event => { saleFileName.textContent = event.target.files[0]?.name || "Nenhum arquivo selecionado"; };
  birthMother.addEventListener("input", () => { const mother = herd.find(animal => animal.id === birthMother.value.trim() && animal.sex === "F"); motherRule.textContent = mother ? "Matriz localizada no estoque. A regra de intervalo mínimo entre partos será verificada ao salvar." : ""; });
  loginPassword.addEventListener("keydown", event => { if (event.key === "Enter") doLogin(); });
  renderIcons();
  await RebanhoData.open();
  appShell.classList.add("hidden"); backBtn.hidden = true; updateNetStatus();
  if (currentUser) await resumeSession(); else loginShell.classList.remove("hidden");
}
window.addEventListener("online", async () => { updateNetStatus(); if (currentUser && sessionToken) await RebanhoSync.run({ silent: true }); });
window.addEventListener("offline", () => { updateNetStatus(); renderSyncInfo(); });
window.addEventListener("pageshow", refreshAutomaticDates);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && currentUser) RebanhoData.captureNow()?.catch(error => console.error("Falha ao concluir salvamento local", error));
});
if ("serviceWorker" in navigator && location.protocol !== "file:") {
  window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js", { updateViaCache: "none" }).catch(error => console.warn("Service worker não registrado", error)));
}
bootstrap().catch(error => { console.error(error); loginError.style.display = "block"; loginError.textContent = "Não foi possível iniciar a aplicação."; });
