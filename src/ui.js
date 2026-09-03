function monthsOld(b){if(!b)return null;let d=new Date(b+"T12:00:00"),n=new Date(),m=(n.getFullYear()-d.getFullYear())*12+n.getMonth()-d.getMonth();if(n.getDate()<d.getDate())m--;return Math.max(0,m)}
function ageText(a){const m=monthsOld(a.birth);if(m===null)return"Idade não informada";if(m<12)return`${m} meses`;const y=Math.floor(m/12),r=m%12;return r?`${y} ano${y>1?"s":""} e ${r}m`:`${y} ano${y>1?"s":""}`}
function rangeOf(a){const m=monthsOld(a.birth);if(m===null)return"unknown";if(m<12)return"0-12";if(m<24)return"12-24";if(m<36)return"24-36";return"36+"}
const ranges=[["0-12","0–12 meses"],["12-24","12–24 meses"],["24-36","24–36 meses"],["36+","36+ meses"],["unknown","Idade não informada"]];
function activeHerd(){return herd.filter(a=>a.status==="ATIVO")}
function displayId(a){return a.id||"Sem identificação"}
function fmtDate(v){if(!v)return"—";const [y,m,d]=v.split("-");return`${d}/${m}/${y}`}
function renderStock(){
 const active=activeHerd(),f=active.filter(a=>a.sex==="F"),m=active.filter(a=>a.sex==="M"),u=active.filter(a=>!a.id).length;
 totalStock.textContent=active.length;femaleTotal.textContent=f.length;maleTotal.textContent=m.length;
 unidentifiedNotice.replaceChildren();
 const unidentifiedTitle=document.createElement("b");unidentifiedTitle.textContent=`Sem identificação: ${u} animal(is)`;
 const unidentifiedText=document.createElement("span");unidentifiedText.className="muted";unidentifiedText.textContent="Eles continuam contando normalmente no estoque e podem receber brinco depois.";
 unidentifiedNotice.append(unidentifiedTitle,document.createElement("br"),unidentifiedText);
 femaleAges.replaceChildren(...ranges.map(r=>ageRow("F",r,f)));maleAges.replaceChildren(...ranges.map(r=>ageRow("M",r,m)));
}
function ageRow(sex,r,list){const n=list.filter(a=>rangeOf(a)===r[0]).length,row=document.createElement("div"),label=document.createElement("span"),count=document.createElement("span");row.className="row click";row.addEventListener("click",()=>openAge(sex,r[0]));label.textContent=r[1];count.className="count";count.textContent=`${n} ›`;row.append(label,count);return row}
function openAge(sex,range){currentAgeSex=sex;currentAgeRange=range;currentAgeExact=null;showScreen("ageList");renderAgeScreen()}
function renderAgeScreen(){
 const list=activeHerd().filter(a=>a.sex===currentAgeSex&&rangeOf(a)===currentAgeRange);ageRangeTotal.textContent=`${list.length} animais`;
 const rs=ranges.find(r=>r[0]===currentAgeRange);setHeader(`${currentAgeSex==="F"?"Fêmeas":"Machos"} • ${rs?rs[1]:""}`,"Estoque por idade");
 let ms=[];if(currentAgeRange==="0-12")ms=[0,1,2,3,4,5,6,7,8,9,10,11];else if(currentAgeRange==="12-24")ms=[12,13,14,15,16,17,18,19,20,21,22,23];else if(currentAgeRange==="24-36")ms=[24,25,26,27,28,29,30,31,32,33,34,35];
 const pillValues=[null,...ms];
 agePills.replaceChildren(...pillValues.map(value=>{const button=document.createElement("button");button.type="button";button.className=`pill ${currentAgeExact===value?"active":""}`;button.textContent=value===null?"Todos":`${value}m`;button.addEventListener("click",()=>setAge(value));return button}));
 renderAgeAnimals()
}
function setAge(m){currentAgeExact=m;renderAgeScreen()}
function renderAgeAnimals(){
 let list=activeHerd().filter(a=>a.sex===currentAgeSex&&rangeOf(a)===currentAgeRange);
 if(currentAgeExact!==null)list=list.filter(a=>monthsOld(a.birth)===currentAgeExact);
 const q=ageSearch.value.trim().toLowerCase();if(q)list=list.filter(a=>displayId(a).toLowerCase().includes(q));
 ageFilterLabel.textContent=currentAgeExact!==null?`Idade selecionada: ${currentAgeExact} meses • ${list.length} animais`:`${list.length} animais`;
 ageAnimals.replaceChildren();
 if(!list.length){const empty=document.createElement("div");empty.className="center muted";empty.textContent="Nenhum animal neste filtro.";ageAnimals.append(empty);return}
 list.forEach(a=>{
  const row=document.createElement("div");row.className="animalRow";row.onclick=()=>openAnimal(a.uid);
  const icon=document.createElement("div");icon.className="sexicon";icon.style.background=a.sex==="F"?"var(--femaleSoft)":"var(--maleSoft)";icon.style.color=a.sex==="F"?"var(--female)":"var(--male)";
  const copy=document.createElement("div"),id=document.createElement("b"),birth=document.createElement("div");id.textContent=displayId(a);birth.className="muted";birth.textContent=`Nascimento: ${fmtDate(a.birth)}`;copy.append(id,birth);
  const badge=document.createElement("span");badge.className=`badge ${a.sex==="F"?"f":"m"}`;badge.textContent=`${monthsOld(a.birth)??"?"}m`;row.append(icon,copy,badge);ageAnimals.append(row)
 })
}
function openAnimal(uid){currentAnimalUid=uid;showScreen("animalDetail");renderAnimalDetail()}
function renderAnimalDetail(){
 const a=herd.find(x=>x.uid===currentAnimalUid);if(!a)return;
 const g=resolveAnimalGenealogy(a);
 setHeader("Ficha do Animal","Cadastro individual");
 detailSexIcon.textContent="";
 detailSexIcon.style.color=a.sex==="F"?"var(--female)":"var(--male)";
 detailId.textContent=displayId(a);
 detailSexAge.textContent=`${a.sex==="F"?"Fêmea":"Macho"} • ${ageText(a)}`;
 detailStatus.textContent=a.status;
 detailBirth.textContent=fmtDate(a.birth);
 detailAge.textContent=ageText(a);
 detailFather.textContent=a.father||"Não informado";
 detailMother.textContent=a.mother||"Não informada";
 detailPGF.textContent=g.pgf||"—";
 detailPGM.textContent=g.pgm||"—";
 detailMGF.textContent=g.mgf||"—";
 detailMGM.textContent=g.mgm||"—";
 detailBreed.textContent=a.breed||"—";
 detailOrigin.textContent=a.origin||"—";
 detailNotes.textContent=a.notes||"—";
 const birthEv=a.origin==="Nascimento"?movementEventForAnimal("birth",a.uid):null;
 const createdBy=a.createdBy||birthEv?.user||"";
 const createdByLogin=a.createdByLogin||birthEv?.userLogin||"";
 const createdAt=a.createdAt||birthEv?.createdAt||"";
 const editedBy=a.lastEditedBy||birthEv?.editedBy||"";
 const editedByLogin=a.lastEditedByLogin||birthEv?.editedByLogin||"";
 const editedAt=a.lastEditedAt||birthEv?.editedAt||"";
 detailCreatedBy.textContent=auditLabel(createdBy,createdByLogin);
 detailCreatedAt.textContent=auditDateTime(createdAt);
 detailEditedBy.textContent=editedBy?auditLabel(editedBy,editedByLogin):"Sem edição";
 detailEditedAt.textContent=auditDateTime(editedAt);
}
function openEditAnimal(){if(currentUser?.role==="FIELD")return alert("Funcionário de campo não pode editar o cadastro do animal.");const a=herd.find(x=>x.uid===currentAnimalUid);refreshPedigreeAutocomplete();editId.value=a.id||"";editSex.value=a.sex;editBirth.value=a.birth||"";editFather.value=a.father||"";editMother.value=a.mother||"";editPGF.value=a.pgf||"";editPGM.value=a.pgm||"";editMGF.value=a.mgf||"";editMGM.value=a.mgm||"";editBreed.value=a.breed||"";editNotes.value=a.notes||"";showScreen("editAnimal")}
function saveAnimalEdit(){if(currentUser?.role==="FIELD")return alert("Sem permissão.");const a=herd.find(x=>x.uid===currentAnimalUid),newId=editId.value.trim()||null;if(newId&&herd.some(x=>x.uid!==a.uid&&x.id&&x.id.toLowerCase()===newId.toLowerCase()))return alert("Já existe um animal com esta identificação.");const before=displayId(a),actor=auditActor(),editNow=new Date().toISOString();Object.assign(a,{id:newId,sex:editSex.value,birth:editBirth.value||null,father:editFather.value.trim(),mother:editMother.value.trim(),pgf:editPGF.value.trim(),pgm:editPGM.value.trim(),mgf:editMGF.value.trim(),mgm:editMGM.value.trim(),breed:editBreed.value.trim(),notes:editNotes.value.trim(),lastEditedBy:actor.name,lastEditedByLogin:actor.login,lastEditedByUid:actor.uid,lastEditedAt:editNow});if(a.origin==="Nascimento"){const ev=movementEventForAnimal("birth",a.uid);if(ev){ev.id=a.id||"";ev.sex=a.sex;ev.date=a.birth||ev.date;ev.mother=a.mother||"";ev.father=a.father||"";ev.breed=a.breed||"";ev.editedBy=actor.name;ev.editedByLogin=actor.login;ev.editedByUid=actor.uid;ev.editedAt=editNow;saveMovementEvents()}}delete a.fatherReproUid;delete a.damKey;learnGenealogyFromAnimal(a,true);refreshPedigreeAutocomplete();log(`Animal ${before}: cadastro e genealogia editados${before!==displayId(a)?`; identificação alterada para ${displayId(a)}`:""}.`);save();renderStock();openAnimal(a.uid)}
function addAnimal(){if(currentUser?.role==="FIELD")return alert("Sem permissão.");const id=newId.value.trim()||null;if(id&&herd.some(x=>x.id&&x.id.toLowerCase()===id.toLowerCase()))return alert("Identificação já cadastrada.");const actor=auditActor(),createdAt=new Date().toISOString();const a={uid:"u"+Date.now(),id,sex:newSex.value,birth:newBirth.value||null,father:newFather.value.trim(),mother:newMother.value.trim(),pgf:newPGF.value.trim(),pgm:newPGM.value.trim(),mgf:newMGF.value.trim(),mgm:newMGM.value.trim(),breed:newBreed.value.trim(),status:"ATIVO",origin:"Cadastro manual",notes:"",createdBy:actor.name,createdByLogin:actor.login,createdByUid:actor.uid,createdAt};herd.push(a);learnGenealogyFromAnimal(a,true);refreshPedigreeAutocomplete();log(`Animal ${displayId(a)} cadastrado manualmente e incluído no estoque.`);renderStock();save();showScreen("stock")}
function moveTab(tab,btn){["birth","sale","death"].forEach(x=>document.getElementById(x+"Tab").classList.toggle("hidden",x!==tab));document.querySelectorAll("#moves>.tabrow .tabbtn").forEach(b=>b.classList.remove("active"));btn.classList.add("active")}
function registerBirth(){const id=birthId.value.trim()||null;if(id&&herd.some(x=>x.id&&x.id.toLowerCase()===id.toLowerCase()))return alert("Identificação já cadastrada.");const mother=birthMother.value.trim(),date=birthDate.value;if(!date)return alert("Informe a data.");if(mother){const mom=herd.find(x=>x.id===mother&&x.sex==="F");if(mom){const children=herd.filter(x=>x.mother===mother&&x.birth).sort((a,b)=>b.birth.localeCompare(a.birth));if(children.length){const last=children[0].birth;const min=new Date(last+"T12:00:00");min.setMonth(min.getMonth()+9);const newD=new Date(date+"T12:00:00");const sameTwin=twinCheck.checked&&date===last;if(newD<min&&!sameTwin)return alert(`Nascimento bloqueado: último parto em ${fmtDate(last)}. Regra mínima de 9 meses, salvo gemelar na mesma data.`)}}}
 const selectedSire=reproducers.find(r=>normalizeReproName(r.name)===normalizeReproName(birthFather.value));
 const selectedDam=mother ? herd.find(x=>x.sex==="F"&&x.id&&normalizeReproName(x.id)===normalizeReproName(mother)) : null;
 const actor=auditActor(),createdAt=new Date().toISOString();const a={uid:"u"+Date.now(),id,sex:birthSex.value,birth:date,father:birthFather.value,mother,breed:birthBreed.value.trim(),status:"ATIVO",origin:"Nascimento",notes:"",fatherReproUid:selectedSire?.uid||null,damKey:selectedDam?("herd:"+selectedDam.uid):null,createdBy:actor.name,createdByLogin:actor.login,createdByUid:actor.uid,createdAt};herd.push(a);addMovementEvent({type:"birth",date,animalUid:a.uid,id:a.id||"",sex:a.sex,mother:a.mother||"",father:a.father||"",breed:a.breed||"",createdAt,user:actor.name,userLogin:actor.login,userUid:actor.uid});log(`Nascimento registrado: ${displayId(a)}. Estoque aumentado automaticamente.`);renderStock();save();alert("Nascimento registrado e estoque atualizado.");birthId.value=""}
function saleMode(m){saleManual.classList.toggle("hidden",m!=="manual");saleExcel.classList.toggle("hidden",m!=="excel");saleManualBtn.classList.toggle("active",m==="manual");saleExcelBtn.classList.toggle("active",m==="excel")}
function addSaleAnimal(){const id=saleAnimal.value.trim();if(!id)return;const a=herd.find(x=>x.id===id&&x.status==="ATIVO");if(!a)return alert("Animal não encontrado no estoque ativo.");if(saleSelected.includes(a.uid))return alert("Animal já selecionado.");saleSelected.push(a.uid);saleAnimal.value="";renderSaleSelected()}
function renderSaleSelected(){const root=document.getElementById("saleSelected");root.replaceChildren();saleSelected.forEach(uid=>{const a=herd.find(x=>x.uid===uid);if(!a)return;const row=document.createElement("div"),name=document.createElement("span"),button=document.createElement("button");row.className="row";name.textContent=displayId(a);button.className="icon";button.type="button";button.textContent="×";button.onclick=()=>removeSale(uid);row.append(name,button);root.append(row)})}
function removeSale(uid){saleSelected=saleSelected.filter(x=>x!==uid);renderSaleSelected()}
function simulateSaleAnalysis(){saleAnalysis.classList.remove("hidden")}
function confirmSale(){if(!saleBuyer.value.trim())return alert("Informe o comprador.");if(!saleManual.classList.contains("hidden")){if(!saleSelected.length)return alert("Selecione ao menos um animal.");const date=saleDate.value||today(),buyer=saleBuyer.value.trim();saleSelected.forEach(uid=>{const a=herd.find(x=>x.uid===uid);if(a){a.status="VENDIDO";addMovementEvent({type:"sale",date,animalUid:a.uid,id:a.id||"",sex:a.sex,buyer})}});log(`Venda para ${buyer}: ${saleSelected.length} animal(is) baixados do estoque.`);saleSelected=[];renderSaleSelected();renderStock();save();alert("Venda registrada e estoque atualizado.")}else{alert("Nesta prévia, o Excel de venda está em modo demonstrativo. A leitura real será ligada quando definirmos o formato da planilha.")}}
function renderDeathMode(){deathIdentified.classList.toggle("hidden",deathMode.value!=="identified");deathUnidentified.classList.toggle("hidden",deathMode.value!=="unidentified")}
function registerDeath(){let a;if(deathMode.value==="identified"){a=herd.find(x=>x.id===deathId.value.trim()&&x.status==="ATIVO");if(!a)return alert("Animal não encontrado no estoque ativo.")}else{a=activeHerd().find(x=>!x.id&&x.sex===deathSex.value&&rangeOf(x)===deathAge.value);if(!a)return alert("Nenhum animal sem identificação encontrado nessa combinação.")}const date=deathDate.value||today(),cause=deathCause.value;a.status="MORTO";addMovementEvent({type:"death",date,animalUid:a.uid,id:a.id||"",sex:a.sex,cause});log(`Morte registrada: ${displayId(a)} (${cause}). Animal retirado do estoque ativo.`);renderStock();save();alert("Morte registrada e estoque atualizado.")}

function canonicalGenealogyName(s){
  return normalizeReproName(s)
    .replace(/[^\p{L}\p{N}\s]/gu," ")
    .split(/\s+/)
    .filter(Boolean)
    .filter(w=>!["fiv","da","de","do","das","dos"].includes(w))
    .join(" ");
}

function findReproducerForAnimal(a){
  if(!a || !a.father) return null;

  if(a.fatherReproUid){
    const byUid=reproducers.find(r=>r.uid===a.fatherReproUid);
    if(byUid) return byUid;
  }

  const exact=normalizeReproName(a.father);
  let matches=reproducers.filter(r=>normalizeReproName(r.name)===exact);
  if(matches.length===1) return matches[0];

  const canon=canonicalGenealogyName(a.father);
  matches=reproducers.filter(r=>canonicalGenealogyName(r.name)===canon);
  if(matches.length===1) return matches[0];

  // Legacy tolerance: "Bugatti de Navirai" x "Bugatti FIV de Naviraí".
  matches=reproducers.filter(r=>{
    const rn=canonicalGenealogyName(r.name);
    return canon.length>=5 && rn.length>=5 && (rn.includes(canon) || canon.includes(rn));
  });
  if(matches.length===1) return matches[0];

  return null;
}

function resolveAnimalGenealogy(a){
  if(!a) return {pgf:"",pgm:"",mgf:"",mgm:""};

  const sire=findReproducerForAnimal(a);

  let dam=null;
  if(a.damKey) dam=findDamByKey(a.damKey);
  if(!dam && a.mother){
    const momKey=normalizeReproName(a.mother);
    dam=herd.find(x=>x.sex==="F" && x.id && normalizeReproName(x.id)===momKey)
      || historicalDams.find(x=>normalizeReproName(x.id||x.name||"")===momKey);
  }

  return {
    pgf:(sire && sire.father) || a.pgf || "",
    pgm:(sire && sire.mother) || a.pgm || "",
    mgf:(dam && dam.father) || a.mgf || "",
    mgm:(dam && dam.mother) || a.mgm || ""
  };
}

function migrateLegacyGenealogyLinks(){
  let changed=false;
  herd.forEach(a=>{
    if(!a.father || a.fatherReproUid) return;
    const sire=findReproducerForAnimal(a);
    if(sire){
      a.fatherReproUid=sire.uid;
      changed=true;
    }
  });
  if(changed) save();
}

function registeredBirthRecords(){
 const byUid=new Map();
 movementEvents.filter(e=>e.type==="birth"&&e.animalUid).forEach(e=>byUid.set(e.animalUid,{uid:e.animalUid,id:e.id||"",sex:e.sex||"",birth:e.date||"",mother:e.mother||"",father:e.father||"",breed:e.breed||"",origin:"Nascimento"}));
 herd.filter(a=>a.origin==="Nascimento").forEach(a=>byUid.set(a.uid,a));
 return [...byUid.values()];
}
function dayDiffISO(a,b){
 const da=new Date(a+"T12:00:00"),db=new Date(b+"T12:00:00");
 return Math.round((db-da)/86400000);
}
function renderReproductiveHistory(a){
 const card=document.getElementById("reproductiveHistoryCard");
 if(!card)return;
 const eligible=a&&a.sex==="F"&&String(a.id||"").trim();
 card.classList.toggle("hidden",!eligible);
 if(!eligible)return;
 const damKey=normalizeReproName(a.id);
 const calves=registeredBirthRecords().filter(c=>c.birth&&c.mother&&normalizeReproName(c.mother)===damKey).sort((x,y)=>(x.birth||"").localeCompare(y.birth||"")||String(x.id||"").localeCompare(String(y.id||""),"pt-BR"));
 rhCalfCount.textContent=calves.length;
 const uniqueDates=[...new Set(calves.map(c=>c.birth))].sort();
 const intervals=[];
 for(let i=1;i<uniqueDates.length;i++){const d=dayDiffISO(uniqueDates[i-1],uniqueDates[i]);if(Number.isFinite(d)&&d>=0)intervals.push(d)}
 rhAverageInterval.textContent=intervals.length?`${Math.round(intervals.reduce((s,n)=>s+n,0)/intervals.length)} dias`:"—";
 rhBirthList.replaceChildren();
 if(!calves.length){
   const empty=document.createElement("div");
   empty.className="center muted";
   empty.style.padding="10px 0";
   empty.textContent="Nenhuma cria registrada no sistema para esta fêmea.";
   rhBirthList.append(empty);
   return;
 }
 const head=document.createElement("div");
 head.className="repro-history-head";
 ["Data","Cria","Sexo","Intervalo"].forEach(label=>{const span=document.createElement("span");span.textContent=label;head.append(span)});
 rhBirthList.append(head);
 let lastParturitionDate="";
 calves.forEach(c=>{
   let interval="—";
   if(lastParturitionDate){interval=c.birth===lastParturitionDate?"Mesmo parto":`${dayDiffISO(lastParturitionDate,c.birth)} dias`}
   if(c.birth!==lastParturitionDate)lastParturitionDate=c.birth;
   const row=document.createElement("div");
   row.className="repro-history-row";
   const date=document.createElement("span");date.textContent=fmtDate(c.birth);
   const identification=document.createElement("b");identification.textContent=c.id||"Sem identificação";
   const sex=document.createElement("span");sex.textContent=c.sex==="F"?"Fêmea":c.sex==="M"?"Macho":"—";
   const intervalElement=document.createElement("span");intervalElement.textContent=interval;
   row.append(date,identification,sex,intervalElement);
   rhBirthList.append(row);
 });
}

function searchIndividual(){
 const q=individualSearch.value.trim().toLowerCase();
 const a=herd.find(x=>x.id&&x.id.toLowerCase()===q);
 searchResult.classList.toggle("hidden",!a);
 searchNotFound.classList.toggle("hidden",!!a);
 if(!a)return;
 currentAnimalUid=a.uid;
 const g=resolveAnimalGenealogy(a);
 srId.textContent=displayId(a);
 srSexAge.textContent=`${a.sex==="F"?" Fêmea":" Macho"} • ${ageText(a)}`;
 srMeta.textContent=`Nascimento: ${fmtDate(a.birth)} • Raça: ${a.breed||"—"} • Status: ${a.status}`;
 srFather.textContent=a.father||"Não informado";
 srMother.textContent=a.mother||"Não informada";
 srPGF.textContent=g.pgf||"Não informado";
 srPGM.textContent=g.pgm||"Não informada";
 srMGF.textContent=g.mgf||"Não informado";
 srMGM.textContent=g.mgm||"Não informada";
 renderReproductiveHistory(a);
 applyPermissions();
}
function editGenealogyFromSearch(){if(currentUser?.role==="FIELD")return alert("Funcionário de campo não pode editar a genealogia.");if(!currentAnimalUid)return alert("Pesquise um animal primeiro.");openEditAnimal()}
function initials(name){return (name||"?").split(/\s+/).slice(0,2).map(x=>x[0]).join("").toUpperCase()}
function statusText(r){return r.status==="linked"?"Genealogia vinculada":r.status==="manual"?"Preenchida manualmente":r.status==="notfound"?"Genealogia não encontrada":"Padrão do sistema"}
function renderReproducers(){
 const q=(reproSearch?.value||"").trim().toLowerCase();
 reproList.replaceChildren();
 reproducers.filter(r=>!q||r.name.toLowerCase().includes(q)).forEach(r=>{
   const row=document.createElement("div");row.className="repro";
   const avatar=document.createElement("div");avatar.className="avatar";avatar.textContent=initials(r.name);
   const detail=document.createElement("div");detail.style.cursor="pointer";detail.addEventListener("click",()=>openReproDetail(r.uid));
   const name=document.createElement("b");name.textContent=r.name;detail.append(name);
   const menu=document.createElement("button");menu.className="icon kebab";menu.type="button";menu.textContent="⋮";menu.addEventListener("click",event=>openReproActions(r.uid,event));
   row.append(avatar,detail,menu);reproList.append(row);
 });
 birthFather.replaceChildren();
 reproducers.forEach(r=>{const option=document.createElement("option");option.value=r.name;option.textContent=r.name;birthFather.append(option)});
}
function openReproActions(uid,e){if(e)e.stopPropagation();reproMenuUid=uid;const r=reproducers.find(x=>x.uid===uid);reproActionTitle.textContent=r?.name||"Reprodutor";reproActionOverlay.classList.remove("hidden")}
function closeReproActions(){reproActionOverlay.classList.add("hidden");reproMenuUid=null}
function viewReproFromMenu(){const uid=reproMenuUid;closeReproActions();if(uid)openReproDetail(uid)}
function editReproFromMenu(){const uid=reproMenuUid;closeReproActions();if(uid){currentReproUid=uid;openReproEdit()}}
function deleteReproFromMenu(){const uid=reproMenuUid;closeReproActions();if(uid)deleteReproducer(uid)}
function openReproDetail(uid){currentReproUid=uid;showScreen("reproDetail");renderReproDetail()}
function renderReproDetail(){
 const r=reproducers.find(x=>x.uid===currentReproUid);if(!r)return;
 rdAvatar.textContent=initials(r.name);rdName.textContent=r.name;rdCode.textContent="";
 rdRegister.textContent=r.register||"—";rdCentralCode.textContent=r.code||"—";rdFather.textContent=r.father||"Não informado";rdMother.textContent=r.mother||"Não informada";
 rdPGF.textContent=r.pgf||"Não informado";rdPGM.textContent=r.pgm||"Não informada";rdMGF.textContent=r.mgf||"Não informado";rdMGM.textContent=r.mgm||"Não informada";
 rdSource.textContent="";
}
function openReproEdit(){
 if(currentUser?.role==="FIELD")return alert("Sem permissão.");
 const r=reproducers.find(x=>x.uid===currentReproUid);if(!r)return;
 refreshPedigreeAutocomplete();
 erName.value=r.name;erRegister.value=r.register||"";erCode.value=r.code||"";erFather.value=r.father||"";erMother.value=r.mother||"";erPGF.value=r.pgf||"";erPGM.value=r.pgm||"";erMGF.value=r.mgf||"";erMGM.value=r.mgm||"";showScreen("editRepro")
}
function saveReproEdit(){
 if(currentUser?.role==="FIELD")return alert("Sem permissão.");
 const r=reproducers.find(x=>x.uid===currentReproUid);if(!r)return;
 const old=r.name;r.name=erName.value.trim()||r.name;r.register=erRegister.value.trim();r.code=erCode.value.trim();r.father=erFather.value.trim();r.mother=erMother.value.trim();r.pgf=erPGF.value.trim();r.pgm=erPGM.value.trim();r.mgf=erMGF.value.trim();r.mgm=erMGM.value.trim();r.status=(r.father||r.mother||r.register||r.code)?(r.status==="linked"?"linked":"manual"):"notfound";r.source=r.status==="linked"?r.source:"Cadastro editado manualmente";
 learnGenealogyFromReproducer(r,true);refreshPedigreeAutocomplete();log(`Reprodutor ${old} editado.`);save();renderReproducers();openReproDetail(r.uid)
}
function deleteReproducer(uid){
 if(currentUser?.role==="FIELD")return alert("Sem permissão.");
 const r=reproducers.find(x=>x.uid===uid);if(!r)return;
 if(r.status==="system")return alert("O reprodutor padrão do sistema não pode ser excluído.");
 const linked=herd.filter(a=>normalizeReproName(a.father)===normalizeReproName(r.name)).length;
 const msg=linked?`${r.name} está vinculado como pai de ${linked} animal(is). A exclusão removerá apenas o reprodutor da lista; a genealogia já gravada nas fichas dos animais será preservada. Excluir mesmo assim?`:`Excluir o reprodutor ${r.name}?`;
 if(!confirm(msg))return;
 reproducers=reproducers.filter(x=>x.uid!==uid);log(`Reprodutor ${r.name} excluído do cadastro. Genealogias históricas preservadas.`);save();renderReproducers();if(document.querySelector(".screen.active")?.id==="reproDetail")showScreen("repro");
}
function addReproducer(){
 if(currentUser?.role==="FIELD")return alert("Sem permissão.");
 const name=reproName.value.trim();if(!name)return alert("Informe o nome.");
 if(reproducers.some(r=>normalizeReproName(r.name)===normalizeReproName(name)))return alert("Esse reprodutor já está cadastrado.");
 const r={uid:"rep_"+Date.now(),name,register:reproRegister.value.trim(),code:reproCode.value.trim(),status:(reproFather.value.trim()||reproMother.value.trim()||reproRegister.value.trim())?"manual":"notfound",father:reproFather.value.trim(),mother:reproMother.value.trim(),pgf:reproPGF.value.trim(),pgm:reproPGM.value.trim(),mgf:reproMGF.value.trim(),mgm:reproMGM.value.trim(),source:"Preenchimento manual"};
 reproducers.push(r);learnGenealogyFromReproducer(r,true);refreshPedigreeAutocomplete();log(`Reprodutor ${name} cadastrado.`);save();renderReproducers();showScreen("repro")
}

function reportAgeBand(months){if(months===null)return"Idade não informada";if(months<12)return"0–12 meses";if(months<24)return"12–24 meses";if(months<36)return"24–36 meses";return"36+ meses"}
function reportFilteredAnimals(list){const sex=document.getElementById("reportSex")?.value||"",ident=document.getElementById("reportIdentified")?.value||"";return list.filter(a=>{if(sex&&a.sex!==sex)return false;if(ident==="identified"&&!String(a.id||"").trim())return false;if(ident==="unidentified"&&String(a.id||"").trim())return false;return true})}
function reportInPeriod(date){const from=document.getElementById("reportDateFrom")?.value||"",to=document.getElementById("reportDateTo")?.value||"";if(!date)return !from&&!to;return(!from||date>=from)&&(!to||date<=to)}
function reportStockRows(){return reportFilteredAnimals(activeHerd()).map(a=>{const g=resolveAnimalGenealogy(a);return {"Identificação":a.id||"","Sexo":a.sex==="F"?"Fêmea":a.sex==="M"?"Macho":"","Data de nascimento":a.birth||"","Idade (meses)":monthsOld(a.birth),"Faixa etária":reportAgeBand(monthsOld(a.birth)),"Pai":a.father||"","Mãe":a.mother||"","Avô paterno":g.pgf||"","Avó paterna":g.pgm||"","Avô materno":g.mgf||"","Avó materna":g.mgm||"","Raça":a.breed||"","Peso último manejo (kg)":a.weight??"","Origem":a.origin||"","Observações":a.notes||""}})}
function reportSummaryRows(){const map={};reportFilteredAnimals(activeHerd()).forEach(a=>{const sexo=a.sex==="F"?"Fêmeas":a.sex==="M"?"Machos":"Não informado",faixa=reportAgeBand(monthsOld(a.birth)),key=sexo+"|"+faixa;map[key]=(map[key]||0)+1});return Object.entries(map).map(([k,v])=>{const[sexo,faixa]=k.split("|");return{"Sexo":sexo,"Faixa etária":faixa,"Quantidade":v}})}
function reportEventRows(type){
 let events=movementEvents.filter(e=>e.type===type&&reportInPeriod(e.date));
 const seen=new Set(events.map(e=>e.animalUid).filter(Boolean));
 if(type==="birth"){
  herd.filter(a=>a.origin==="Nascimento"&&!seen.has(a.uid)&&reportInPeriod(a.birth)).forEach(a=>events.push({type:"birth",date:a.birth,animalUid:a.uid,id:a.id||"",sex:a.sex,mother:a.mother||"",father:a.father||"",breed:a.breed||"",user:""}))
 }else if(!document.getElementById("reportDateFrom").value&&!document.getElementById("reportDateTo").value){
  const st=type==="sale"?"VENDIDO":"MORTO";
  herd.filter(a=>a.status===st&&!seen.has(a.uid)).forEach(a=>events.push({type,date:"",animalUid:a.uid,id:a.id||"",sex:a.sex,user:""}))
 }
 events=events.filter(e=>{const a=herd.find(x=>x.uid===e.animalUid)||e;return reportFilteredAnimals([a]).length});
 return events.sort((a,b)=>(a.date||"").localeCompare(b.date||"")).map(e=>{
  const current=e.animalUid?herd.find(x=>x.uid===e.animalUid):null;
  if(type==="birth"){
   const a=current||e;
   return {"Data":a.birth||e.date||"","Identificação":a.id||e.id||"","Sexo":a.sex==="F"?"Fêmea":a.sex==="M"?"Macho":"","Mãe":a.mother||"","Pai":a.father||"","Raça":a.breed||"","Responsável pelo lançamento":auditLabel(a.createdBy||e.user||"",a.createdByLogin||e.userLogin||""),"Data/hora do lançamento":auditDateTime(a.createdAt||e.createdAt||""),"Última edição por":(a.lastEditedBy||e.editedBy)?auditLabel(a.lastEditedBy||e.editedBy||"",a.lastEditedByLogin||e.editedByLogin||""):"","Data/hora da última edição":auditDateTime(a.lastEditedAt||e.editedAt||"")}
  }
  if(type==="sale"){
   const a=current||e;
   return {"Data":e.date||"","Identificação":a.id||e.id||"","Sexo":a.sex==="F"?"Fêmea":a.sex==="M"?"Macho":"","Comprador":e.buyer||"","Responsável pelo lançamento":auditLabel(e.user||"",e.userLogin||""),"Data/hora do lançamento":auditDateTime(e.createdAt||""),"Última edição por":e.editedBy?auditLabel(e.editedBy,e.editedByLogin||""):"","Data/hora da última edição":auditDateTime(e.editedAt||"")}
  }
  const a=current||e;
  return {"Data":e.date||"","Identificação":a.id||e.id||"","Sexo":a.sex==="F"?"Fêmea":a.sex==="M"?"Macho":"","Causa":e.cause||"","Responsável pelo lançamento":auditLabel(e.user||"",e.userLogin||""),"Data/hora do lançamento":auditDateTime(e.createdAt||""),"Última edição por":e.editedBy?auditLabel(e.editedBy,e.editedByLogin||""):"","Data/hora da última edição":auditDateTime(e.editedAt||"")}
 })
}
function reportMovementRows(){const births=reportEventRows("birth").length,sales=reportEventRows("sale").filter(r=>r.Data||(!reportDateFrom.value&&!reportDateTo.value)).length,deaths=reportEventRows("death").filter(r=>r.Data||(!reportDateFrom.value&&!reportDateTo.value)).length,current=reportFilteredAnimals(activeHerd()).length;const initial=current-births+sales+deaths;return[{"Estoque inicial estimado":initial,"Nascimentos":births,"Vendas":sales,"Mortes":deaths,"Estoque final":current}]}
function currentReportRows(){const type=reportType.value;if(type==="stock")return reportStockRows();if(type==="summary")return reportSummaryRows();if(type==="births")return reportEventRows("birth");if(type==="sales")return reportEventRows("sale");if(type==="deaths")return reportEventRows("death");if(type==="movement")return reportMovementRows();return[]}
function renderReportPreview(){
 if(!document.getElementById("reportPreview"))return;
 const rows=currentReportRows(),type=reportType.value,strong=document.createElement("b");strong.textContent=rows.length;
 reportPreview.replaceChildren(strong,document.createTextNode(" registro(s) no relatório selecionado."));
 if(["sales","deaths","movement"].includes(type)&&movementEvents.length===0){const note=document.createElement("span");note.className="muted";note.textContent="Movimentações antigas sem data estruturada aparecem apenas quando nenhum período é filtrado. Novos lançamentos passam a registrar a data corretamente.";reportPreview.append(document.createElement("br"),note)}
}
function exportReportRows(rows,name){if(typeof XLSX==="undefined")return alert("A biblioteca de Excel não foi carregada. Conecte-se à internet e tente novamente.");if(!rows.length)return alert("Não há dados para exportar com os filtros escolhidos.");const ws=XLSX.utils.json_to_sheet(rows),wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Relatório");XLSX.writeFile(wb,name+"_"+today()+".xlsx")}
function exportCurrentReport(){const names={stock:"estoque_detalhado",summary:"estoque_resumido",births:"nascimentos",sales:"vendas",deaths:"mortes",movement:"movimentacao_estoque"};exportReportRows(currentReportRows(),names[reportType.value]||"relatorio_rebanho")}

function renderHistory(){
 historyList.replaceChildren();
 if(!history.length){const empty=document.createElement("div");empty.className="center muted";empty.textContent="Ainda não há alterações nesta demonstração.";historyList.append(empty);return}
 history.forEach(h=>{const row=document.createElement("div");row.className="row";const content=document.createElement("div");const message=document.createElement("b");message.textContent=h.msg||"";const when=document.createElement("div");when.className="muted";when.textContent=h.when||"";content.append(message,when);row.append(content);historyList.append(row)});
}
function setHeader(t,s){title.textContent=t;subtitle.textContent=s||"Agropecuária Cacimba"}
const labels={stock:["Estoque do Rebanho","Agropecuária Cacimba"],moves:["Movimentações","Nascimento, venda e morte"],search:["Pesquisa","Consulta rápida offline"],repro:["Reprodutores","Proprietário / Administrador"],more:["Mais","Configurações e cadastros"],addAnimal:["Cadastrar animal","Entrada manual no estoque"],importStock:["Importar estoque","Carga inicial via Excel"],editAnimal:["Editar Animal","Ficha individual"],addRepro:["Adicionar reprodutor","Cadastro e genealogia"],reproDetail:["Ficha do reprodutor","Genealogia"],editRepro:["Editar reprodutor","Cadastro e genealogia"],history:["Histórico","Auditoria de alterações"],reports:["Relatórios","Exportação para Excel"],users:["Usuários","Gerenciamento de acessos"],addUser:["Cadastrar usuário","Novo acesso ao sistema"],account:["Minha conta","Usuário e perfil"]}
function showScreen(id,push=true){
 if(currentUser){
   if(currentUser.role==="FIELD"&&["repro","addRepro","reproDetail","editRepro","users","addUser","importStock","addAnimal","editAnimal","reports"].includes(id))return alert("Seu perfil não tem acesso a este módulo.");
   if(currentUser.role==="ADMIN"&&["users","addUser"].includes(id))return alert("Somente o Proprietário pode gerenciar usuários.");
 }
 const cur=document.querySelector(".screen.active")?.id;if(push&&cur&&cur!==id)navHistory.push(cur);document.querySelectorAll(".screen").forEach(s=>s.classList.toggle("active",s.id===id));const l=labels[id]||[title.textContent,subtitle.textContent];setHeader(l[0],l[1]);backBtn.style.visibility=["stock","moves","search","repro","more"].includes(id)?"hidden":"visible";document.querySelectorAll(".nav").forEach(n=>n.classList.toggle("active",n.dataset.target===id));window.scrollTo(0,0);if(id==="stock")renderStock();if(id==="repro")renderReproducers();if(id==="history")renderHistory();if(id==="reports"){if(!reportDateTo.value)reportDateTo.value=today();renderReportPreview()}if(id==="users"){if(currentUser?.role==="OWNER"&&sessionToken&&navigator.onLine){const loading=document.createElement("div");loading.className="center muted";loading.textContent="Carregando usuários...";usersList.replaceChildren(loading);refreshUsers()}else renderUsers()}if(id==="account")renderAccount();if(id==="reproDetail")renderReproDetail();applyPermissions()}
function navTo(id,btn){navHistory=[];showScreen(id,false)}
function goBack(){const id=navHistory.pop()||"stock";showScreen(id,false);if(id==="ageList")renderAgeScreen();if(id==="animalDetail")renderAnimalDetail()}
