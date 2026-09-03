function normalizeReproName(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function migrateReproducers() {
  reproducers = reproducers.map((item, index) => ({
    uid: item.uid || `rep_${Date.now()}_${index}`, name: item.name || "", register: item.register || "", code: item.code || "",
    status: item.status || "manual", father: item.father || "", mother: item.mother || "", pgf: item.pgf || "",
    pgm: item.pgm || "", mgf: item.mgf || "", mgm: item.mgm || "", source: item.source || "Preenchimento manual"
  }));
}
function pedigreeKey(name) { return normalizeReproName(name); }
function upsertPedigreeEntry(name, data = {}, overwrite = false, source = "Cadastro interno") {
  const clean = String(name || "").trim(), key = pedigreeKey(clean); if (!key) return null;
  let entry = pedigreeLibrary.find(item => item.key === key);
  if (!entry) { entry = { key, name: clean, sex: data.sex || "", father: "", mother: "", source, updatedAt: new Date().toISOString() }; pedigreeLibrary.push(entry); }
  const set = (field, value) => { const cleanValue = String(value || "").trim(); if (cleanValue && (overwrite || !entry[field])) entry[field] = cleanValue; };
  if (overwrite || !entry.name) entry.name = clean;
  if (data.sex && (overwrite || !entry.sex)) entry.sex = data.sex;
  set("father", data.father); set("mother", data.mother);
  if (overwrite || !entry.source) entry.source = source;
  if (overwrite || data.father || data.mother) entry.updatedAt = new Date().toISOString();
  return entry;
}
function learnGenealogyFromAnimal(animal, overwrite = false) {
  if (!animal) return;
  if (animal.id && (animal.father || animal.mother)) upsertPedigreeEntry(animal.id, { sex: animal.sex, father: animal.father, mother: animal.mother }, overwrite, `Ficha do animal ${animal.id}`);
  if (animal.father && (animal.pgf || animal.pgm)) upsertPedigreeEntry(animal.father, { sex: "M", father: animal.pgf, mother: animal.pgm }, overwrite, `Genealogia informada em ${animal.id || "animal sem identificação"}`);
  if (animal.mother && (animal.mgf || animal.mgm)) upsertPedigreeEntry(animal.mother, { sex: "F", father: animal.mgf, mother: animal.mgm }, overwrite, `Genealogia informada em ${animal.id || "animal sem identificação"}`);
}
function learnGenealogyFromReproducer(reproducer, overwrite = false) {
  if (!reproducer?.name) return;
  upsertPedigreeEntry(reproducer.name, { sex: "M", father: reproducer.father, mother: reproducer.mother }, overwrite, `Cadastro de reprodutor ${reproducer.name}`);
  if (reproducer.father && (reproducer.pgf || reproducer.pgm)) upsertPedigreeEntry(reproducer.father, { sex: "M", father: reproducer.pgf, mother: reproducer.pgm }, overwrite, `Genealogia do reprodutor ${reproducer.name}`);
  if (reproducer.mother && (reproducer.mgf || reproducer.mgm)) upsertPedigreeEntry(reproducer.mother, { sex: "F", father: reproducer.mgf, mother: reproducer.mgm }, overwrite, `Genealogia do reprodutor ${reproducer.name}`);
}
function rebuildPedigreeLibrary() {
  if (!Array.isArray(pedigreeLibrary)) pedigreeLibrary = [];
  herd.forEach(animal => learnGenealogyFromAnimal(animal));
  reproducers.forEach(reproducer => learnGenealogyFromReproducer(reproducer));
  historicalDams.forEach(dam => { if ((dam.id || dam.name) && (dam.father || dam.mother)) upsertPedigreeEntry(dam.id || dam.name, { sex: "F", father: dam.father, mother: dam.mother }, false, "Matriz histórica"); });
}
function mergePedigreeLibraries(remote = [], local = []) {
  const map = new Map();
  [...remote, ...local].forEach(entry => {
    if (!entry) return; const key = entry.key || pedigreeKey(entry.name); if (!key) return; const current = map.get(key);
    if (!current) { map.set(key, { ...entry, key }); return; }
    const entryDate = Date.parse(entry.updatedAt || 0) || 0, currentDate = Date.parse(current.updatedAt || 0) || 0;
    const newer = entryDate >= currentDate ? entry : current, older = entryDate >= currentDate ? current : entry;
    map.set(key, { ...older, ...newer, key, father: newer.father || older.father || "", mother: newer.mother || older.mother || "" });
  });
  return [...map.values()];
}
function findPedigreeEntry(name, sex = "") {
  const key = pedigreeKey(name); if (!key) return null;
  return pedigreeLibrary.find(entry => entry.key === key && (!sex || !entry.sex || entry.sex === sex)) || null;
}
function ensurePedigreeDatalists() {
  [["pedigreeMaleList", "M"], ["pedigreeFemaleList", "F"], ["pedigreeAllList", ""]].forEach(([id, sex]) => {
    let list = document.getElementById(id); if (!list) { list = document.createElement("datalist"); list.id = id; document.body.appendChild(list); }
    list.replaceChildren(...pedigreeLibrary.filter(entry => !sex || !entry.sex || entry.sex === sex).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR")).map(entry => { const option = document.createElement("option"); option.value = entry.name || ""; option.textContent = [entry.father, entry.mother].filter(Boolean).join(" × "); return option; }));
  });
  [["editFather", "pedigreeMaleList"], ["newFather", "pedigreeMaleList"], ["reproFather", "pedigreeMaleList"], ["erFather", "pedigreeMaleList"], ["editMother", "pedigreeFemaleList"], ["newMother", "pedigreeFemaleList"], ["reproMother", "pedigreeFemaleList"], ["erMother", "pedigreeFemaleList"]].forEach(([id, list]) => document.getElementById(id)?.setAttribute("list", list));
}
function autocompleteParent(input, grandfather, grandmother, sex) {
  if (!input || !grandfather || !grandmother) return; const match = findPedigreeEntry(input.value, sex); if (!match) return;
  if (match.name) input.value = match.name; if (!grandfather.value.trim() && match.father) grandfather.value = match.father; if (!grandmother.value.trim() && match.mother) grandmother.value = match.mother;
}
function bindPedigreeAutocomplete() {
  ensurePedigreeDatalists();
  [["editFather", "editPGF", "editPGM", "M"], ["editMother", "editMGF", "editMGM", "F"], ["newFather", "newPGF", "newPGM", "M"], ["newMother", "newMGF", "newMGM", "F"], ["reproFather", "reproPGF", "reproPGM", "M"], ["reproMother", "reproMGF", "reproMGM", "F"], ["erFather", "erPGF", "erPGM", "M"], ["erMother", "erMGF", "erMGM", "F"]].forEach(([parentId, gfId, gmId, sex]) => {
    const input = document.getElementById(parentId), gf = document.getElementById(gfId), gm = document.getElementById(gmId);
    if (!input || input.dataset.pedigreeBound) return; input.dataset.pedigreeBound = "1";
    ["input", "change", "blur"].forEach(event => input.addEventListener(event, () => autocompleteParent(input, gf, gm, sex)));
  });
}
function refreshPedigreeAutocomplete() { rebuildPedigreeLibrary(); ensurePedigreeDatalists(); }
function allDamOptions() {
  return [
    ...herd.filter(animal => animal.sex === "F").map(animal => ({ key: `herd:${animal.uid}`, label: `${animal.id || "Sem identificação"} — ${animal.status || "Ativa"}`, type: "herd", animal })),
    ...historicalDams.map(animal => ({ key: `hist:${animal.uid}`, label: `${animal.id || animal.name || "Matriz histórica"} — histórica`, type: "hist", animal }))
  ];
}
function findDamByKey(key) { if (!key) return null; const [type, uid] = key.split(":"); return type === "herd" ? herd.find(animal => animal.uid === uid) : historicalDams.find(animal => animal.uid === uid); }
function findReproByUid(uid) { return reproducers.find(reproducer => reproducer.uid === uid); }
