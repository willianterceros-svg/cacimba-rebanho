const RebanhoImport = (() => {
  function normalizeHeader(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .trim()
      .replace(/\s+/g, " ")
      .toLowerCase();
  }

  function normalizeText(value) {
    if (value === null || value === undefined) return "";
    return String(value).trim();
  }

  function normalizeSex(value) {
    const text = normalizeHeader(value);
    if (!text) return null;
    if (text === "f" || text.startsWith("femea")) return "F";
    if (text === "m" || text.startsWith("macho")) return "M";
    return null;
  }

  function pad(number) {
    return String(number).padStart(2, "0");
  }

  function isoDate(year, month, day) {
    return `${year}-${pad(month)}-${pad(day)}`;
  }

  function validCalendarDate(year, month, day) {
    if (year < 1900 || year > 2999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
    return isoDate(year, month, day);
  }

  function parseSheetDate(value) {
    if (value === null || value === undefined || value === "") return null;

    if (value instanceof Date) {
      if (Number.isNaN(value.getTime())) return null;
      return validCalendarDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
    }

    if (typeof value === "number" && Number.isFinite(value)) {
      const shifted = new Date(Math.round((value - 25569) * 86400000));
      return validCalendarDate(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate());
    }

    const text = String(value).trim();
    if (!text) return null;

    let parts = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (parts) return validCalendarDate(Number(parts[1]), Number(parts[2]), Number(parts[3]));

    parts = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (parts) return validCalendarDate(Number(parts[3]), Number(parts[2]), Number(parts[1]));

    return null;
  }

  function parseCsvText(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    const pushField = () => { row.push(field); field = ""; };
    const pushRow = () => { pushField(); rows.push(row); row = []; };
    const normalized = String(text).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    let separator = ",";
    let commas = 0;
    let semicolons = 0;
    let sniffingQuotes = false;
    for (let i = 0; i < normalized.length && normalized[i] !== "\n"; i++) {
      const char = normalized[i];
      if (char === "\"") {
        if (sniffingQuotes && normalized[i + 1] === "\"") i++;
        else sniffingQuotes = !sniffingQuotes;
      } else if (!sniffingQuotes && char === ",") commas++;
      else if (!sniffingQuotes && char === ";") semicolons++;
    }
    if (semicolons > commas) separator = ";";

    for (let i = 0; i < normalized.length; i++) {
      const char = normalized[i];
      if (inQuotes) {
        if (char === "\"") {
          if (normalized[i + 1] === "\"") { field += "\""; i++; }
          else inQuotes = false;
        } else {
          field += char;
        }
      } else if (char === "\"") {
        inQuotes = true;
      } else if (char === separator) {
        pushField();
      } else if (char === "\n") {
        pushRow();
      } else {
        field += char;
      }
    }
    if (field !== "" || row.length) pushRow();

    return rows.filter(r => !(r.length === 1 && r[0] === ""));
  }

  function tagKey(value) {
    return normalizeText(value).toLowerCase();
  }

  const STOCK_ALIASES = {
    id: ["identificacao", "identificacao do animal", "brinco", "numero do brinco", "numero"],
    sex: ["sexo"],
    birth: ["data de nascimento", "nascimento", "data nascimento"],
    father: ["pai"],
    mother: ["mae"],
    pgf: ["avo paterno"],
    pgm: ["avo paterna"],
    mgf: ["avo materno"],
    mgm: ["avo materna"],
    breed: ["raca"]
  };

  function mapColumns(headerRow, aliases) {
    const normalized = (headerRow || []).map(normalizeHeader);
    const columns = {};
    for (const key of Object.keys(aliases)) {
      columns[key] = -1;
      for (const alias of aliases[key]) {
        const at = normalized.indexOf(alias);
        if (at !== -1) {
          columns[key] = at;
          break;
        }
      }
    }
    return columns;
  }

  function mapStockColumns(headerRow) {
    const columns = mapColumns(headerRow, STOCK_ALIASES);
    const missing = columns.id === -1 ? ["id"] : [];
    return { columns, missing };
  }

  function cellAt(row, index) {
    return index >= 0 && index < row.length ? row[index] : "";
  }

  function isBlankRow(row) {
    return row.every(value => normalizeText(value) === "");
  }

  function buildStockPreview(rows, options) {
    const settings = options || {};
    const existing = new Set((settings.existingTags || []).map(tagKey));
    const defaultSex = settings.defaultSex || null;
    const defaultBreed = settings.defaultBreed || "";
    const onDuplicate = settings.onDuplicate === "fill" ? "fill" : "skip";

    const { columns, missing } = mapStockColumns(rows[0] || []);
    if (missing.includes("id")) {
      return {
        error: "A planilha precisa ter a coluna: Identificação.",
        ready: [],
        skipped: [],
        summary: { total: 0, create: 0, update: 0, skipped: 0 }
      };
    }

    const ready = [];
    const skipped = [];
    const seen = new Set();
    let total = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (isBlankRow(row)) continue;

      const line = r + 1;
      total++;

      const id = normalizeText(cellAt(row, columns.id));
      if (!id) {
        skipped.push({ line, id: "", reason: "Identificação em branco." });
        continue;
      }

      const key = tagKey(id);
      if (seen.has(key)) {
        skipped.push({ line, id, reason: "Identificação repetida dentro do arquivo." });
        continue;
      }
      seen.add(key);

      const rawSex = cellAt(row, columns.sex);
      const sexText = normalizeText(rawSex);
      const normalizedSex = normalizeSex(rawSex);
      if (sexText && !normalizedSex) {
        skipped.push({ line, id, reason: "Sexo inválido. Use Fêmea, Macho, F ou M." });
        continue;
      }

      let birth = null;
      const rawBirth = cellAt(row, columns.birth);
      if (normalizeText(rawBirth) !== "") {
        birth = parseSheetDate(rawBirth);
        if (birth === null) {
          skipped.push({ line, id, reason: "Data de nascimento inválida." });
          continue;
        }
      }

      let action = "create";
      if (existing.has(key)) {
        if (onDuplicate !== "fill") {
          skipped.push({ line, id, reason: "Identificação já cadastrada no sistema." });
          continue;
        }
        action = "update";
      }

      ready.push({
        line,
        id,
        sex: normalizedSex || defaultSex,
        birth,
        father: normalizeText(cellAt(row, columns.father)),
        mother: normalizeText(cellAt(row, columns.mother)),
        pgf: normalizeText(cellAt(row, columns.pgf)),
        pgm: normalizeText(cellAt(row, columns.pgm)),
        mgf: normalizeText(cellAt(row, columns.mgf)),
        mgm: normalizeText(cellAt(row, columns.mgm)),
        breed: normalizeText(cellAt(row, columns.breed)) || defaultBreed,
        action
      });
    }

    return {
      error: null,
      ready,
      skipped,
      summary: {
        total,
        create: ready.filter(r => r.action === "create").length,
        update: ready.filter(r => r.action === "update").length,
        skipped: skipped.length
      }
    };
  }

  function buildStockRecords(ready, context) {
    const created = [];
    const updates = [];

    for (const row of ready) {
      if (row.action === "update") {
        updates.push({
          uid: context.tagToUid[tagKey(row.id)],
          patch: {
            sex: row.sex,
            father: row.father,
            mother: row.mother,
            pgf: row.pgf,
            pgm: row.pgm,
            mgf: row.mgf,
            mgm: row.mgm,
            breed: row.breed,
            birth: row.birth
          }
        });
        continue;
      }

      created.push({
        uid: `imp_${context.uidSeed}_${row.line}`,
        id: row.id,
        sex: row.sex,
        birth: row.birth,
        father: row.father,
        mother: row.mother,
        pgf: row.pgf,
        pgm: row.pgm,
        mgf: row.mgf,
        mgm: row.mgm,
        breed: row.breed,
        status: "ATIVO",
        origin: "Importação de planilha",
        importSource: context.sourceName,
        notes: "",
        createdBy: context.actor.name,
        createdByLogin: context.actor.login,
        createdByUid: context.actor.uid,
        createdAt: context.createdAt
      });
    }

    return { created, updates };
  }

  const SALE_ALIASES = {
    animal: ["identificacao do animal", "identificacao", "brinco", "numero do brinco"],
    date: ["data da venda", "data venda", "data"],
    buyer: ["comprador"]
  };

  function mapSaleColumns(headerRow) {
    const columns = mapColumns(headerRow, SALE_ALIASES);
    const missing = columns.animal === -1 ? ["animal"] : [];
    return { columns, missing };
  }

  function buildSalePreview(rows, options) {
    const settings = options || {};
    const herdIndex = settings.herdIndex || {};
    const defaultDate = settings.defaultDate || "";
    const defaultBuyer = settings.defaultBuyer || "";

    const { columns, missing } = mapSaleColumns(rows[0] || []);
    if (missing.includes("animal")) {
      return {
        error: "A planilha precisa ter a coluna: Identificação do animal.",
        ready: [],
        skipped: [],
        summary: { total: 0, ready: 0, skipped: 0 }
      };
    }

    const ready = [];
    const skipped = [];
    const seen = new Set();
    let total = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      if (isBlankRow(row)) continue;

      const line = r + 1;
      total++;

      const id = normalizeText(cellAt(row, columns.animal));
      if (!id) {
        skipped.push({ line, id: "", reason: "Identificação em branco." });
        continue;
      }

      const key = tagKey(id);
      const entry = herdIndex[key];
      if (!entry) {
        skipped.push({ line, id, reason: "Animal não encontrado no rebanho." });
        continue;
      }
      if (entry.status === "VENDIDO") {
        skipped.push({ line, id, reason: "Animal já consta como vendido." });
        continue;
      }
      if (entry.status === "MORTO") {
        skipped.push({ line, id, reason: "Animal já consta como morto." });
        continue;
      }

      const rawDate = cellAt(row, columns.date);
      const dateText = normalizeText(rawDate);
      let date;
      if (dateText === "") {
        date = defaultDate;
        if (!date) {
          skipped.push({ line, id, reason: "Data da venda não informada." });
          continue;
        }
      } else {
        date = parseSheetDate(rawDate);
        if (date === null) {
          skipped.push({ line, id, reason: "Data da venda inválida." });
          continue;
        }
      }

      if (seen.has(key)) {
        skipped.push({ line, id, reason: "Identificação repetida dentro do arquivo." });
        continue;
      }
      seen.add(key);

      const buyer = normalizeText(cellAt(row, columns.buyer)) || defaultBuyer;
      if (!buyer) {
        skipped.push({ line, id, reason: "Comprador não informado." });
        continue;
      }

      ready.push({ line, id, uid: entry.uid, date, buyer });
    }

    return {
      error: null,
      ready,
      skipped,
      summary: { total, ready: ready.length, skipped: skipped.length }
    };
  }

  function buildSaleRecords(ready, context) {
    const updates = [];
    const events = [];

    for (const row of ready) {
      updates.push({ uid: row.uid, status: "VENDIDO" });
      events.push({
        type: "sale",
        animalUid: row.uid,
        id: row.id,
        date: row.date,
        buyer: row.buyer,
        user: context.actor.name,
        userLogin: context.actor.login,
        userUid: context.actor.uid,
        source: context.source
      });
    }

    return { updates, events };
  }

  return {
    normalizeHeader,
    normalizeText,
    normalizeSex,
    parseSheetDate,
    mapStockColumns,
    buildStockPreview,
    buildStockRecords,
    mapSaleColumns,
    buildSalePreview,
    buildSaleRecords,
    parseCsvText
  };
})();

let stockRows = null;
let stockFileName = "";
let stockPreview = null;
let stockReadyPage = 0;
let stockIssuesPage = 0;

const PREVIEW_PAGE_SIZE = 10;

function renderPagedList(container, items, page, onPageChange, buildItem, headerNode) {
  container.replaceChildren();
  if (headerNode) container.append(headerNode);
  const totalPages = Math.max(1, Math.ceil(items.length / PREVIEW_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * PREVIEW_PAGE_SIZE;
  items.slice(start, start + PREVIEW_PAGE_SIZE).forEach(item => container.append(buildItem(item)));
  if (totalPages > 1) {
    const pager = document.createElement("div");
    pager.className = "row";
    const prev = document.createElement("button");
    prev.type = "button"; prev.className = "btn secondary"; prev.style.width = "auto"; prev.textContent = "◀ Anterior";
    prev.disabled = safePage === 0;
    prev.onclick = () => onPageChange(safePage - 1);
    const label = document.createElement("span");
    label.className = "muted";
    label.textContent = `Página ${safePage + 1} de ${totalPages} (${items.length} no total)`;
    const next = document.createElement("button");
    next.type = "button"; next.className = "btn secondary"; next.style.width = "auto"; next.textContent = "Próxima ▶";
    next.disabled = safePage >= totalPages - 1;
    next.onclick = () => onPageChange(safePage + 1);
    pager.append(prev, label, next);
    container.append(pager);
  }
  return safePage;
}

function buildIssueItem(item) {
  const row = document.createElement("div");
  row.className = "row";
  row.textContent = `Linha ${item.line} (${item.id || "sem identificação"}): ${item.reason}`;
  return row;
}

function buildIssuesNotice() {
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.textContent = "Estas linhas não serão importadas — o sistema não corrige nada aqui. Ajuste a planilha original e envie o arquivo de novo.";
  return notice;
}

function buildStockReadyItem(row) {
  const wrap = document.createElement("div");
  wrap.className = "row";
  const main = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = `Linha ${row.line} — ${row.id}`;
  const detail = document.createElement("div");
  detail.className = "muted";
  const sexLabel = row.sex === "M" ? "Macho" : row.sex === "F" ? "Fêmea" : "sexo não definido";
  detail.textContent = `${sexLabel} · Nasc. ${row.birth || "não informada"} · Pai: ${row.father || "—"} · Mãe: ${row.mother || "—"} · Raça: ${row.breed || "—"}`;
  main.append(title, detail);
  const action = document.createElement("span");
  action.className = row.action === "update" ? "badge warn" : "badge active";
  action.textContent = row.action === "update" ? "Completar" : "Novo";
  wrap.append(main, action);
  return wrap;
}

async function readSheetRows(file) {
  if (/\.csv$/i.test(file.name)) {
    return RebanhoImport.parseCsvText(await file.text());
  }
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, cellDates: true, defval: "" });
}

async function handleStockFile() {
  const file = stockFile.files && stockFile.files[0];
  stockFile.value = "";
  if (!file) return;
  stockFileName = file.name;
  stockFileNameLabel();
  try {
    stockRows = await readSheetRows(file);
    applyStockRules();
  } catch {
    stockRows = null;
    stockPreview = null;
    renderStockError("Não foi possível ler o arquivo. Confira o formato (.xlsx, .xls ou .csv).");
  }
}

function stockFileNameLabel() {
  document.getElementById("stockFileName").textContent = stockFileName || "Nenhum arquivo selecionado";
}

function applyStockRules() {
  if (!stockRows) return;
  const options = {
    existingTags: herd.map(a => a.id).filter(Boolean),
    defaultSex: importSex.value,
    defaultBreed: importBreed.value.trim(),
    onDuplicate: importDuplicate.value
  };
  stockPreview = RebanhoImport.buildStockPreview(stockRows, options);
  stockReadyPage = 0;
  stockIssuesPage = 0;
  if (stockPreview.error) {
    renderStockError(stockPreview.error);
  } else {
    renderStockPreview();
  }
}

function renderStockError(message) {
  importSummary.classList.add("hidden");
  importReady.classList.add("hidden");
  importActions.classList.add("hidden");
  importIssues.classList.remove("hidden");
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.textContent = message;
  importIssues.replaceChildren(notice);
}

function renderStockPreview() {
  const { summary, skipped, ready } = stockPreview;

  importSummary.classList.remove("hidden");
  importSummary.replaceChildren();
  [["total", "Total na planilha"], ["create", "Novos animais"], ["update", "Completar dados"], ["skipped", "Pendências (não entram)"]].forEach(([key, label]) => {
    const stat = document.createElement("div");
    stat.className = "stat";
    const value = document.createElement("b");
    value.textContent = summary[key];
    stat.append(value, document.createTextNode(label));
    importSummary.append(stat);
  });

  importReady.classList.toggle("hidden", ready.length === 0);
  if (ready.length) {
    stockReadyPage = renderPagedList(importReady, ready, stockReadyPage, page => { stockReadyPage = page; renderStockPreview(); }, buildStockReadyItem);
  }

  importIssues.classList.toggle("hidden", skipped.length === 0);
  if (skipped.length) {
    stockIssuesPage = renderPagedList(importIssues, skipped, stockIssuesPage, page => { stockIssuesPage = page; renderStockPreview(); }, buildIssueItem, buildIssuesNotice());
  }

  importActions.classList.toggle("hidden", ready.length === 0);
}

async function confirmStockImport() {
  if (!stockPreview || stockPreview.error || !stockPreview.ready.length) return;
  const confirmed = await appConfirm(`Confirmar importação: ${stockPreview.summary.create} animal(is) novo(s) e ${stockPreview.summary.update} atualização(ões)?`);
  if (!confirmed) return;

  const tagToUid = {};
  herd.forEach(a => { if (a.id) tagToUid[a.id.trim().toLowerCase()] = a.uid; });

  const context = {
    actor: auditActor(),
    createdAt: new Date().toISOString(),
    sourceName: stockFileName,
    uidSeed: Date.now(),
    tagToUid
  };

  const { created, updates } = RebanhoImport.buildStockRecords(stockPreview.ready, context);

  created.forEach(animal => {
    herd.push(animal);
    learnGenealogyFromAnimal(animal, true);
  });

  updates.forEach(({ uid, patch }) => {
    const animal = herd.find(a => a.uid === uid);
    if (!animal) return;
    Object.keys(patch).forEach(key => { if (!animal[key]) animal[key] = patch[key]; });
    learnGenealogyFromAnimal(animal, true);
  });
  refreshPedigreeAutocomplete();

  log(`Importação de planilha "${stockFileName}": ${created.length} animal(is) cadastrado(s), ${updates.length} atualizado(s).`);
  save();
  resetStockImport();
  renderStock();
  showScreen("stock");
  appAlert("Importação concluída.");
}

function resetStockImport() {
  stockRows = null;
  stockPreview = null;
  stockFileName = "";
  stockReadyPage = 0;
  stockIssuesPage = 0;
  stockFile.value = "";
  stockFileNameLabel();
  importSummary.classList.add("hidden");
  importSummary.replaceChildren();
  importReady.classList.add("hidden");
  importReady.replaceChildren();
  importIssues.classList.add("hidden");
  importIssues.replaceChildren();
  importActions.classList.add("hidden");
}

function widenColumns(sheet, headers) {
  sheet["!cols"] = headers.map(header => ({ wch: Math.max(header.length + 4, 12) }));
}

function downloadStockTemplate() {
  const headers = ["Identificação", "Sexo", "Data de nascimento", "Pai", "Mãe", "Avô paterno", "Avó paterna", "Avô materno", "Avó materna", "Raça"];
  const sheet = XLSX.utils.json_to_sheet([{
    "Identificação": "7832", "Sexo": "Fêmea", "Data de nascimento": "15/03/2023",
    "Pai": "REI 22", "Mãe": "", "Avô paterno": "", "Avó paterna": "", "Avô materno": "", "Avó materna": "",
    "Raça": "Nelore"
  }], { header: headers });
  widenColumns(sheet, headers);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Modelo");
  XLSX.writeFile(workbook, "modelo_importacao_estoque.xlsx");
}

let saleRows = null;
let saleFileName = "";
let salePreview = null;
let saleReadyPage = 0;
let saleIssuesPage = 0;

function buildSaleReadyItem(row) {
  const wrap = document.createElement("div");
  wrap.className = "row";
  const main = document.createElement("div");
  const title = document.createElement("b");
  title.textContent = `Linha ${row.line} — ${row.id}`;
  const detail = document.createElement("div");
  detail.className = "muted";
  detail.textContent = `${row.date} · ${row.buyer}`;
  main.append(title, detail);
  wrap.append(main);
  return wrap;
}

async function handleSaleFile() {
  const file = saleFile.files && saleFile.files[0];
  saleFile.value = "";
  if (!file) return;
  saleFileName = file.name;
  saleFileNameLabel();
  try {
    saleRows = await readSheetRows(file);
    applySaleRules();
  } catch {
    saleRows = null;
    salePreview = null;
    renderSaleError("Não foi possível ler o arquivo. Confira o formato (.xlsx, .xls ou .csv).");
  }
}

function saleFileNameLabel() {
  document.getElementById("saleFileName").textContent = saleFileName || "Nenhum arquivo selecionado";
}

function applySaleRules() {
  if (!saleRows) return;
  const herdIndex = {};
  herd.forEach(a => { if (a.id) herdIndex[a.id.trim().toLowerCase()] = { uid: a.uid, status: a.status }; });
  const options = {
    herdIndex,
    defaultDate: saleDate.value || "",
    defaultBuyer: saleBuyer.value.trim()
  };
  salePreview = RebanhoImport.buildSalePreview(saleRows, options);
  saleReadyPage = 0;
  saleIssuesPage = 0;
  if (salePreview.error) {
    renderSaleError(salePreview.error);
  } else {
    renderSalePreview();
  }
}

function renderSaleError(message) {
  saleSummary.classList.add("hidden");
  saleReady.classList.add("hidden");
  saleIssues.classList.remove("hidden");
  const notice = document.createElement("div");
  notice.className = "notice";
  notice.textContent = message;
  saleIssues.replaceChildren(notice);
}

function renderSalePreview() {
  const { summary, skipped, ready } = salePreview;

  saleSummary.classList.remove("hidden");
  saleSummary.replaceChildren();
  [["total", "Total na planilha"], ["ready", "Prontos para baixa"], ["skipped", "Pendências (não entram)"]].forEach(([key, label]) => {
    const stat = document.createElement("div");
    stat.className = "stat";
    const value = document.createElement("b");
    value.textContent = summary[key];
    stat.append(value, document.createTextNode(label));
    saleSummary.append(stat);
  });

  saleReady.classList.toggle("hidden", ready.length === 0);
  if (ready.length) {
    saleReadyPage = renderPagedList(saleReady, ready, saleReadyPage, page => { saleReadyPage = page; renderSalePreview(); }, buildSaleReadyItem);
  }

  saleIssues.classList.toggle("hidden", skipped.length === 0);
  if (skipped.length) {
    saleIssuesPage = renderPagedList(saleIssues, skipped, saleIssuesPage, page => { saleIssuesPage = page; renderSalePreview(); }, buildIssueItem, buildIssuesNotice());
  }
}

async function confirmSaleImport() {
  if (!salePreview || salePreview.error || !salePreview.ready.length) return appAlert("Não há vendas prontas para confirmar.");
  const confirmed = await appConfirm(`Confirmar baixa de ${salePreview.ready.length} animal(is) do estoque?`);
  if (!confirmed) return;

  const context = { actor: auditActor(), source: saleFileName };
  const { updates, events } = RebanhoImport.buildSaleRecords(salePreview.ready, context);

  updates.forEach(({ uid, status }) => {
    const animal = herd.find(a => a.uid === uid);
    if (animal) animal.status = status;
  });
  events.forEach(event => addMovementEvent(event));

  log(`Importação de venda "${saleFileName}": ${updates.length} animal(is) baixados do estoque.`);
  save();
  resetSaleImport();
  renderStock();
  appAlert("Venda importada e estoque atualizado.");
}

function resetSaleImport() {
  saleRows = null;
  salePreview = null;
  saleFileName = "";
  saleReadyPage = 0;
  saleIssuesPage = 0;
  saleFile.value = "";
  saleFileNameLabel();
  saleSummary.classList.add("hidden");
  saleSummary.replaceChildren();
  saleReady.classList.add("hidden");
  saleReady.replaceChildren();
  saleIssues.classList.add("hidden");
  saleIssues.replaceChildren();
}

function downloadSaleTemplate() {
  const headers = ["Data da venda", "Comprador", "Identificação do animal"];
  const sheet = XLSX.utils.json_to_sheet([{
    "Data da venda": "10/09/2026", "Comprador": "Frigorífico Sul", "Identificação do animal": "7832"
  }], { header: headers });
  widenColumns(sheet, headers);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Modelo");
  XLSX.writeFile(workbook, "modelo_importacao_venda.xlsx");
}
