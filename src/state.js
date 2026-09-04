let users = [];
let currentUser = JSON.parse(sessionStorage.getItem("cacimba2_current_user") || "null");
let sessionToken = sessionStorage.getItem("cacimba2_session_token") || "";
let pendingFirstLoginUser = null;

// Os dados começam vazios e somente são carregados pelo startSession após login.
let herd = [];
let history = [];
let movementEvents = [];
let reproducers = [];
let historicalDams = [];
let pedigreeLibrary = [];

let navHistory = [];
let currentAnimalUid = null;
let currentAgeSex = "F";
let currentAgeRange = "0-12";
let currentAgeExact = null;
let saleSelected = [];
let currentReproUid = null;
let reproMenuUid = null;

function localSnapshot() {
  return { schemaVersion: 5, herd, history, reproducers, movementEvents, historicalDams, pedigreeLibrary };
}

function historyTimestamp(entry) {
  const iso = Date.parse(entry?.createdAt || "");
  if (Number.isFinite(iso)) return iso;
  const match = String(entry?.when || "").match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2}):(\d{2})$/);
  return match ? new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(match[4]), Number(match[5]), Number(match[6])).getTime() : 0;
}

function applySnapshot(snapshot) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  herd = Array.isArray(source.herd) ? source.herd : [];
  history = Array.isArray(source.history) ? [...source.history].sort((a, b) => historyTimestamp(b) - historyTimestamp(a)) : [];
  reproducers = Array.isArray(source.reproducers) ? source.reproducers : [];
  movementEvents = Array.isArray(source.movementEvents) ? source.movementEvents : [];
  historicalDams = Array.isArray(source.historicalDams) ? source.historicalDams : [];
  pedigreeLibrary = Array.isArray(source.pedigreeLibrary) ? source.pedigreeLibrary : [];
}

function clearLoadedData() {
  applySnapshot({});
  users = [];
  navHistory = [];
  currentAnimalUid = null;
  currentReproUid = null;
  saleSelected = [];
}

function persistLocal() { RebanhoData.scheduleCapture(() => localSnapshot()); }
function queueCloudSync() { RebanhoData.scheduleCapture(() => localSnapshot(), true); }
function save() { queueCloudSync(); }
function saveMovementEvents() { queueCloudSync(); }
function saveHistoricalDams() { queueCloudSync(); }

function auditActor() {
  return { name: currentUser?.name || "Sistema", login: currentUser?.login || "", uid: currentUser?.uid || "" };
}
function addMovementEvent(event) {
  const actor = auditActor();
  movementEvents.push({
    eventUid: `mov_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    createdAt: new Date().toISOString(), user: actor.name, userLogin: actor.login, userUid: actor.uid,
    editedBy: "", editedByLogin: "", editedByUid: "", editedAt: "", ...event
  });
  saveMovementEvents();
}
function movementEventForAnimal(type, animalUid) {
  return [...movementEvents].reverse().find(event => event.type === type && event.animalUid === animalUid) || null;
}
function auditLabel(name, login) { return !name ? "Não informado" : login ? `${name} (@${login})` : name; }
function auditDateTime(value) { if (!value) return "—"; try { return new Date(value).toLocaleString("pt-BR"); } catch { return "—"; } }
function log(message) {
  const actor = currentUser ? `${currentUser.name} (@${currentUser.login})` : "Sistema";
  const createdAt = new Date().toISOString();
  history.unshift({ uid: crypto.randomUUID ? `hist_${crypto.randomUUID()}` : `hist_${Date.now()}_${Math.random()}`, createdAt, when: new Date(createdAt).toLocaleString("pt-BR"), msg: `${message} — por ${actor}` });
  save();
  renderHistory();
}
