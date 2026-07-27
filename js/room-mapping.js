/* ==========================================================================
   Room & Meal Plan Mapping ("Mapping Review") — lets a Company Admin match
   their own rooms/rate plans against a chosen competitor property's rooms/
   rate plans, with a confidence score, so features that need to compare
   "the same" room across properties (Rate Parity, Channel Analysis, Room
   Rate Comparison) aren't limited to a plain name-equality match. Persisted
   to localStorage the same way every other mock-DB record is (DB.get/set),
   keyed per Property+Competitor pair so it's a straightforward table in a
   future SQL Server schema: RoomMappings(PropertyRoomId, CompetitorRoomId,
   Confidence, Status), RatePlanMappings(PropertyRatePlanId, CompetitorRatePlanId, Confidence, Status).
   ========================================================================== */
let rmSelectedRoomId = null;

document.addEventListener('DOMContentLoaded', ()=>{
  const me = RBAC.currentUser();
  if(!me){ APP.requireAuth(); return; }
  const isOwner = me.role === RBAC.ROLES.PROPERTY_OWNER;

  const allProperties = DB.properties.all();
  // Property Owner: always their own property, mapped against one of their assigned comparison
  // properties (never an arbitrary one). Company Admin: any property vs. any other, via query params.
  const propertyId = isOwner ? me.parentPropertyId : (APP.qs('propertyId') || APP.qs('id') || (allProperties[0] && allProperties[0].id));
  const candidateCompetitors = isOwner
    ? PORTALDATA.comparisonRealProperties().map(c=>DB.properties.get(c.realPropertyId)).filter(Boolean)
    : allProperties.filter(p=>p.id!==propertyId);
  // A Property Owner can only map against a competitor actually assigned to them — ignore any
  // ?competitorId= that isn't in their candidate list rather than trusting it outright.
  const requestedCompetitorId = APP.qs('competitorId');
  const competitorId = (requestedCompetitorId && (!isOwner || candidateCompetitors.some(c=>c.id===requestedCompetitorId)))
    ? requestedCompetitorId
    : (candidateCompetitors[0] || {}).id;

  const property = DB.properties.get(propertyId);
  const competitor = DB.properties.get(competitorId);

  PORTAL.mountForRole({
    title:'Mapping Review',
    subtitle: property && competitor ? `Match ${property.name}'s rooms and rate plans against ${competitor.name}.` : 'Match your rooms and rate plans against a competitor property.',
    breadcrumb:[{label:'Dashboard', href:'dashboard.html'},{label:'Mapping'}]
  });

  if(!property || !competitor || property.id===competitor.id){
    document.getElementById('page-content').innerHTML = `<div class="section-card">${
      isOwner
        ? 'Your Company Admin hasn\'t assigned any comparison properties for you to map rooms against yet.'
        : (allProperties.length < 2
          ? 'You need at least two properties in the system to review a room mapping (one as the property, one as the competitor).'
          : 'Could not resolve a property and a competitor to compare — pass ?propertyId=&competitorId= or add more properties.')
    }</div>`;
    return;
  }

  const ourMaster = DB.channels.byProperty(property.id).find(c=>c.type==='master');
  const compMaster = DB.channels.byProperty(competitor.id).find(c=>c.type==='master');
  const ourRooms = ourMaster ? DB.rooms.byChannel(ourMaster.id) : [];
  const compRooms = compMaster ? DB.rooms.byChannel(compMaster.id) : [];

  const ROOM_MAP_KEY = `hop_room_mapping_${property.id}_${competitor.id}`;
  const PLAN_MAP_KEY = `hop_rateplan_mapping_${property.id}_${competitor.id}`;
  // roomMap: { [ourRoomId]: { competitorRoomId, confidence, status } }
  // planMap: { [ourRatePlanId]: { competitorRatePlanId, confidence, status } }
  let roomMap = DB.get(ROOM_MAP_KEY, {});
  let planMap = DB.get(PLAN_MAP_KEY, {});

  function statusFor(confidence){
    if(confidence >= 95) return 'mapped';
    if(confidence >= 60) return 'partial';
    return 'unmapped';
  }
  function confidenceLabel(c){
    if(c==null) return '<span class="text-muted">—</span>';
    const cls = c>=95 ? 'high' : c>=60 ? 'mid' : 'low';
    return `<span class="rm-confidence ${cls}">${c}%</span>`;
  }

  function normalize(name){ return (name||'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
  function similarity(a, b){
    if(a.trim().toLowerCase() === b.trim().toLowerCase()) return 98;
    const wa = normalize(a), wb = normalize(b);
    const shared = wa.filter(w=>wb.includes(w)).length;
    const union = new Set([...wa, ...wb]).size;
    if(!union || !shared) return 0;
    return Math.round(45 + (shared/union) * 50);
  }

  // ---- Auto Map Rooms: greedy best-match-first, 1:1, deterministic ----
  function autoMapRooms(){
    const pairs = [];
    ourRooms.forEach(or=>{
      compRooms.forEach(cr=>{
        const score = similarity(or.name, cr.name);
        if(score > 0) pairs.push({ourId:or.id, compId:cr.id, score});
      });
    });
    pairs.sort((a,b)=>b.score-a.score);
    const usedOur = new Set(), usedComp = new Set();
    const map = {};
    pairs.forEach(p=>{
      if(usedOur.has(p.ourId) || usedComp.has(p.compId)) return;
      usedOur.add(p.ourId); usedComp.add(p.compId);
      map[p.ourId] = { competitorRoomId:p.compId, confidence:p.score, status:statusFor(p.score) };
    });
    roomMap = map;
    autoMapPlansForAllRooms();
    render();
    APP.toast('Auto Map Complete', `${Object.keys(roomMap).length} of ${ourRooms.length} rooms matched automatically.`, 'success');
  }

  // ---- Auto Map Rate Plans for a single room pair: match by meal plan, then refundable flag ----
  function autoMapPlansForRoom(ourRoomId){
    const mapping = roomMap[ourRoomId];
    if(!mapping) return;
    const ourPlans = DB.ratePlans.byRoom(ourRoomId);
    const compPlans = DB.ratePlans.byRoom(mapping.competitorRoomId);
    const usedComp = new Set();
    ourPlans.forEach(op=>{
      let best = null, bestScore = 0;
      compPlans.forEach(cp=>{
        if(usedComp.has(cp.id)) return;
        let score = 0;
        if(cp.mealPlan === op.mealPlan) score += 70;
        if(cp.refundable === op.refundable) score += 25;
        if(score > bestScore){ bestScore = score; best = cp; }
      });
      if(best){
        usedComp.add(best.id);
        planMap[op.id] = { competitorRatePlanId:best.id, confidence: Math.min(99, bestScore+ (bestScore?20:0)), status: statusFor(Math.min(99, bestScore + (bestScore?20:0))) };
      } else {
        delete planMap[op.id];
      }
    });
  }
  function autoMapPlansForAllRooms(){
    Object.keys(roomMap).forEach(ourRoomId=> autoMapPlansForRoom(ourRoomId));
  }

  function clearAll(){
    roomMap = {}; planMap = {};
    render();
    APP.toast('Mappings Cleared', 'All room and rate plan mappings were removed.', 'success');
  }

  function save(){
    DB.set(ROOM_MAP_KEY, roomMap);
    DB.set(PLAN_MAP_KEY, planMap);
    APP.toast('Mapping Saved', 'Room and rate plan mappings have been saved.', 'success');
  }

  // ---- Property picker (Company Admin only — a Property Owner is always locked to their own
  // property) and Competitor picker (shown whenever there's more than one candidate) — without
  // these, a Company Admin landing here cold had no way to choose which pair to review at all. ----
  function setupPropPicker(){
    if(isOwner) return;
    const picker = document.getElementById('rm_propPicker');
    if(allProperties.length <= 1) return;
    picker.classList.remove('d-none');
    document.getElementById('rm_propName').classList.add('d-none');
    picker.innerHTML = allProperties.map(p=>`<option value="${p.id}" ${p.id===property.id?'selected':''}>${p.name}</option>`).join('');
    picker.addEventListener('change', ()=>{
      const url = new URL(location.href);
      url.searchParams.set('propertyId', picker.value);
      url.searchParams.delete('id');
      url.searchParams.delete('competitorId'); // old competitor may not make sense for the new property
      location.href = url.toString();
    });
  }
  function setupCompPicker(){
    const picker = document.getElementById('rm_compPicker');
    if(candidateCompetitors.length <= 1) return;
    picker.classList.remove('d-none');
    document.getElementById('rm_compName').classList.add('d-none');
    picker.innerHTML = candidateCompetitors.map(c=>`<option value="${c.id}" ${c.id===competitor.id?'selected':''}>${c.name}</option>`).join('');
    picker.addEventListener('change', ()=>{
      const url = new URL(location.href);
      url.searchParams.set('competitorId', picker.value);
      location.href = url.toString();
    });
  }

  // ---- Per-room mapping notes — persisted the same way as the mappings themselves ----
  const NOTES_KEY = `hop_room_mapping_notes_${property.id}_${competitor.id}`;
  let notesMap = DB.get(NOTES_KEY, {});
  function openNotes(){
    if(!rmSelectedRoomId){ APP.toast('Select a Room', 'Choose a room first to add mapping notes.', 'error'); return; }
    const room = ourRooms.find(r=>r.id===rmSelectedRoomId);
    const next = prompt(`Mapping notes for ${room.name}:`, notesMap[rmSelectedRoomId] || '');
    if(next === null) return;
    if(next.trim()){ notesMap[rmSelectedRoomId] = next.trim(); } else { delete notesMap[rmSelectedRoomId]; }
    DB.set(NOTES_KEY, notesMap);
    renderSelectedPlans();
    APP.toast('Notes Saved', `Mapping notes updated for ${room.name}.`, 'success');
  }

  // ---- Summary ----
  function renderSummary(){
    const mappedRooms = ourRooms.filter(r=>roomMap[r.id] && roomMap[r.id].status!=='unmapped').length;
    const ourPlanIds = ourRooms.flatMap(r=>DB.ratePlans.byRoom(r.id).map(p=>p.id));
    const mappedPlans = ourPlanIds.filter(id=>planMap[id] && planMap[id].status!=='unmapped').length;
    const roomsPct = ourRooms.length ? Math.round(mappedRooms/ourRooms.length*100) : 0;
    const plansPct = ourPlanIds.length ? Math.round(mappedPlans/ourPlanIds.length*100) : 0;
    const overallPct = Math.round((roomsPct+plansPct)/2);

    document.getElementById('rm_roomsFraction').textContent = `${mappedRooms} / ${ourRooms.length}`;
    document.getElementById('rm_roomsBar').style.width = roomsPct+'%';
    document.getElementById('rm_plansFraction').textContent = `${mappedPlans} / ${ourPlanIds.length}`;
    document.getElementById('rm_plansBar').style.width = plansPct+'%';
    document.getElementById('rm_overallPct').textContent = overallPct+'%';
    document.getElementById('rm_ring').style.setProperty('--pct', overallPct);

    document.getElementById('rm_propLogo').style.backgroundImage = `url('${property.logo}')`;
    document.getElementById('rm_propName').textContent = property.name;
    document.getElementById('rm_propLoc').textContent = `${property.city}, ${property.country}`;
    document.getElementById('rm_compLogo').style.backgroundImage = `url('${competitor.logo}')`;
    document.getElementById('rm_compName').textContent = competitor.name;
    document.getElementById('rm_compLoc').textContent = `${competitor.city}, ${competitor.country}`;
  }

  // ---- Our Rooms table ----
  function renderOurTable(){
    const search = document.getElementById('rm_ourSearch').value.trim().toLowerCase();
    const statusFilter = document.getElementById('rm_ourStatus').value;
    let rows = ourRooms.filter(r=> !search || r.name.toLowerCase().includes(search));
    rows = rows.filter(r=>{
      if(!statusFilter) return true;
      const m = roomMap[r.id];
      const st = m ? m.status : 'unmapped';
      return st === statusFilter;
    });
    document.getElementById('rm_ourRoomsTitle').textContent = `Our Rooms (${property.name})`;

    document.getElementById('rm_ourTable').innerHTML = `
      <thead><tr><th>Our Room</th><th>Room Type</th><th>Status</th><th>Mapped To</th><th>Confidence</th><th>Action</th></tr></thead>
      <tbody>${rows.map(r=>{
        const m = roomMap[r.id];
        const st = m ? m.status : 'unmapped';
        const compRoom = m ? compRooms.find(c=>c.id===m.competitorRoomId) : null;
        return `<tr class="rm-room-row ${rmSelectedRoomId===r.id?'selected':''}" data-room-id="${r.id}">
          <td><span class="rm-room-icon"><i class="bi ${roomIcon(r.category)}"></i></span>${r.name}</td>
          <td>${r.category}</td>
          <td>${statusPill(st)}</td>
          <td>${compRoom ? compRoom.name : '—'}</td>
          <td>${confidenceLabel(m ? m.confidence : null)}</td>
          <td><button class="btn btn-sm-icon btn-soft rm-map-btn" data-room-id="${r.id}">${m?'Edit':'Map'}</button></td>
        </tr>`;
      }).join('') || `<tr><td colspan="6" class="text-center text-muted py-4">No rooms found.</td></tr>`}</tbody>`;

    document.querySelectorAll('#rm_ourTable .rm-room-row').forEach(tr=>{
      tr.addEventListener('click', ()=>{ rmSelectedRoomId = tr.dataset.roomId; render(); });
    });
    document.querySelectorAll('#rm_ourTable .rm-map-btn').forEach(btn=>{
      btn.addEventListener('click', (e)=>{ e.stopPropagation(); rmSelectedRoomId = btn.dataset.roomId; render(); document.getElementById('rm_selectedPlansTable').scrollIntoView({behavior:'smooth', block:'nearest'}); });
    });
  }

  function roomIcon(category){
    const map = { Deluxe:'bi-door-closed-fill', Suite:'bi-house-door-fill', Standard:'bi-door-closed', Premium:'bi-gem', Family:'bi-people-fill' };
    return map[category] || 'bi-door-closed';
  }

  function statusPill(st){
    if(st==='mapped') return '<span class="badge-status badge-active">Mapped</span>';
    if(st==='partial') return '<span class="badge bg-warning-subtle text-warning-emphasis">Partial</span>';
    return '<span class="badge-status badge-inactive">Not Mapped</span>';
  }

  // ---- Competitor Rooms table (selection picks the match for the currently selected our-room) ----
  function renderCompTable(){
    const search = document.getElementById('rm_compSearch').value.trim().toLowerCase();
    const roomType = document.getElementById('rm_compRoomType').value;
    let rows = compRooms.filter(r=> !search || r.name.toLowerCase().includes(search));
    if(roomType) rows = rows.filter(r=>r.category===roomType);
    document.getElementById('rm_compRoomsTitle').textContent = `Competitor Rooms (${competitor.name})`;
    document.getElementById('rm_pickHint').classList.toggle('d-none', !!rmSelectedRoomId);

    const mappedFromSelected = rmSelectedRoomId ? (roomMap[rmSelectedRoomId] || {}).competitorRoomId : null;
    const takenElsewhere = new Set(Object.entries(roomMap).filter(([oid])=>oid!==rmSelectedRoomId).map(([,v])=>v.competitorRoomId));

    document.getElementById('rm_compTable').innerHTML = `
      <thead><tr><th></th><th>Competitor Room</th><th>Room Type</th><th>Status</th><th>Mapped To</th></tr></thead>
      <tbody>${rows.map(r=>{
        const mappedToOur = Object.entries(roomMap).find(([,v])=>v.competitorRoomId===r.id);
        const st = mappedToOur ? roomMap[mappedToOur[0]].status : 'unmapped';
        const ourName = mappedToOur ? (ourRooms.find(o=>o.id===mappedToOur[0])||{}).name : null;
        const taken = takenElsewhere.has(r.id);
        const disabled = !rmSelectedRoomId || taken;
        return `<tr class="rm-comp-row ${!disabled?'pickable':''} ${taken&&rmSelectedRoomId?'taken':''}" data-comp-id="${r.id}" title="${taken&&rmSelectedRoomId?'Already mapped to another room':''}">
          <td><input type="radio" name="rm_compPick" ${mappedFromSelected===r.id?'checked':''} ${disabled?'disabled':''} data-comp-id="${r.id}" class="rm-comp-pick"></td>
          <td>${r.name}</td>
          <td>${r.category}</td>
          <td>${statusPill(st)}</td>
          <td>${ourName || '—'}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="5" class="text-center text-muted py-4">No competitor rooms found.</td></tr>`}</tbody>`;

    function pick(compId){
      if(!rmSelectedRoomId || takenElsewhere.has(compId)) return;
      const score = similarity(ourRooms.find(o=>o.id===rmSelectedRoomId).name, compRooms.find(c=>c.id===compId).name);
      const confidence = Math.max(score, 90); // a manual pick is always at least "high confidence"
      roomMap[rmSelectedRoomId] = { competitorRoomId:compId, confidence, status:statusFor(confidence) };
      autoMapPlansForRoom(rmSelectedRoomId);
      render();
    }
    document.querySelectorAll('#rm_compTable .rm-comp-pick').forEach(radio=>{
      radio.addEventListener('change', ()=> pick(radio.dataset.compId));
    });
    document.querySelectorAll('#rm_compTable .rm-comp-row.pickable').forEach(tr=>{
      tr.addEventListener('click', (e)=>{ if(e.target.tagName!=='INPUT') pick(tr.dataset.compId); });
    });
  }

  // ---- Selected room's rate-plan mapping ----
  function renderSelectedPlans(){
    const summaryEl = document.getElementById('rm_selectedSummary');
    const tableEl = document.getElementById('rm_selectedPlansTable');
    if(!rmSelectedRoomId){
      summaryEl.textContent = 'Select a room on the left to review its mapping.';
      tableEl.innerHTML = '';
      return;
    }
    const ourRoom = ourRooms.find(r=>r.id===rmSelectedRoomId);
    const mapping = roomMap[rmSelectedRoomId];
    const compRoom = mapping ? compRooms.find(c=>c.id===mapping.competitorRoomId) : null;
    const note = notesMap[rmSelectedRoomId];
    summaryEl.innerHTML = `<div class="rm-connector">
        <span class="rm-connector-chip mine"><i class="bi ${roomIcon(ourRoom.category)}"></i>${ourRoom.name}</span>
        <i class="bi bi-arrow-right rm-connector-arrow"></i>
        <span class="rm-connector-chip ${compRoom?'':'empty'}">${compRoom ? `<i class="bi ${roomIcon(compRoom.category)}"></i>${compRoom.name}` : 'Not mapped yet'}</span>
        ${mapping ? confidenceLabel(mapping.confidence) : ''}
      </div>`
      + (note ? `<div class="mt-2"><i class="bi bi-sticky-fill text-warning me-1"></i>${note}</div>` : '');

    if(!compRoom){ tableEl.innerHTML = `<tbody><tr><td class="text-center text-muted py-3">Map this room to a competitor room first.</td></tr></tbody>`; return; }

    const ourPlans = DB.ratePlans.byRoom(rmSelectedRoomId);
    const compPlans = DB.ratePlans.byRoom(compRoom.id);
    tableEl.innerHTML = `
      <thead><tr><th>Our Rate Plan (Meal Plan)</th><th>Refundable</th><th>Competitor Rate Plan (Meal Plan)</th><th>Refundable</th><th>Status</th><th>Confidence</th><th>Action</th></tr></thead>
      <tbody>${ourPlans.map(op=>{
        const pm = planMap[op.id];
        const cp = pm ? compPlans.find(c=>c.id===pm.competitorRatePlanId) : null;
        const st = pm ? pm.status : 'unmapped';
        return `<tr>
          <td>${op.name.split(' - ')[0]} <span class="text-muted">(${op.mealPlan})</span></td>
          <td>${op.refundable?'Yes':'No'}</td>
          <td><select class="form-select form-select-sm rm-plan-pick" data-our-plan-id="${op.id}">
            <option value="">— Not Mapped —</option>
            ${compPlans.map(cpo=>`<option value="${cpo.id}" ${cp&&cp.id===cpo.id?'selected':''}>${cpo.name.split(' - ')[0]} (${cpo.mealPlan})</option>`).join('')}
          </select></td>
          <td>${cp ? (cp.refundable?'Yes':'No') : '—'}</td>
          <td>${statusPill(st)}</td>
          <td>${confidenceLabel(pm ? pm.confidence : null)}</td>
          <td><button class="btn btn-sm-icon btn-soft" title="Edit" onclick="document.querySelector('[data-our-plan-id=\\'${op.id}\\']').focus()"><i class="bi bi-pencil"></i></button></td>
        </tr>`;
      }).join('') || `<tr><td colspan="7" class="text-center text-muted py-3">No rate plans on this room yet.</td></tr>`}</tbody>`;

    document.querySelectorAll('.rm-plan-pick').forEach(sel=>{
      sel.addEventListener('change', ()=>{
        const ourPlanId = sel.dataset.ourPlanId;
        if(!sel.value){ delete planMap[ourPlanId]; render(); return; }
        const ourPlan = ourPlans.find(p=>p.id===ourPlanId);
        const compPlan = compPlans.find(p=>p.id===sel.value);
        let score = 0;
        if(compPlan.mealPlan===ourPlan.mealPlan) score += 70;
        if(compPlan.refundable===ourPlan.refundable) score += 25;
        const confidence = Math.max(score + (score?20:0), 90);
        planMap[ourPlanId] = { competitorRatePlanId: sel.value, confidence, status: statusFor(confidence) };
        render();
      });
    });
  }

  // ---- Tab 2: all rate plan mappings across every mapped room ----
  function renderAllPlansTable(){
    const search = document.getElementById('rm_planSearch').value.trim().toLowerCase();
    const rows = [];
    ourRooms.forEach(room=>{
      const mapping = roomMap[room.id];
      const compRoom = mapping ? compRooms.find(c=>c.id===mapping.competitorRoomId) : null;
      DB.ratePlans.byRoom(room.id).forEach(op=>{
        const pm = planMap[op.id];
        const cp = (pm && compRoom) ? DB.ratePlans.byRoom(compRoom.id).find(c=>c.id===pm.competitorRatePlanId) : null;
        rows.push({ room, op, compRoom, cp, pm });
      });
    });
    const filtered = rows.filter(r=> !search || r.room.name.toLowerCase().includes(search) || r.op.name.toLowerCase().includes(search));

    document.getElementById('rm_allPlansTable').innerHTML = `
      <thead><tr><th>Our Room</th><th>Our Rate Plan</th><th>Competitor Room</th><th>Competitor Rate Plan</th><th>Status</th><th>Confidence</th></tr></thead>
      <tbody>${filtered.map(r=>{
        const st = r.pm ? r.pm.status : 'unmapped';
        return `<tr>
          <td>${r.room.name}</td>
          <td>${r.op.name.split(' - ')[0]} <span class="text-muted">(${r.op.mealPlan})</span></td>
          <td>${r.compRoom ? r.compRoom.name : '<span class="text-muted">Room not mapped</span>'}</td>
          <td>${r.cp ? `${r.cp.name.split(' - ')[0]} (${r.cp.mealPlan})` : '—'}</td>
          <td>${statusPill(st)}</td>
          <td>${confidenceLabel(r.pm ? r.pm.confidence : null)}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="6" class="text-center text-muted py-4">No rate plans found.</td></tr>`}</tbody>`;
  }

  function renderSteps(){
    const mapping = rmSelectedRoomId ? roomMap[rmSelectedRoomId] : null;
    const hasPlanMapped = mapping ? DB.ratePlans.byRoom(rmSelectedRoomId).some(p=>planMap[p.id]) : false;
    const step1 = document.getElementById('rm_step1'), step2 = document.getElementById('rm_step2'), step3 = document.getElementById('rm_step3');
    step1.classList.toggle('done', !!rmSelectedRoomId);
    step1.classList.toggle('active', !rmSelectedRoomId);
    step2.classList.toggle('done', !!mapping);
    step2.classList.toggle('active', !!rmSelectedRoomId && !mapping);
    step3.classList.toggle('done', hasPlanMapped);
    step3.classList.toggle('active', !!mapping && !hasPlanMapped);
  }

  function render(){
    renderSummary();
    renderOurTable();
    renderCompTable();
    renderSelectedPlans();
    renderAllPlansTable();
    renderSteps();
  }

  // ---- room type filter options (from competitor room categories) ----
  const roomTypes = [...new Set(compRooms.map(r=>r.category))];
  document.getElementById('rm_compRoomType').innerHTML += roomTypes.map(t=>`<option value="${t}">${t}</option>`).join('');

  ['rm_ourSearch','rm_ourStatus'].forEach(id=> document.getElementById(id).addEventListener('input', renderOurTable));
  ['rm_compSearch','rm_compRoomType'].forEach(id=> document.getElementById(id).addEventListener('input', renderCompTable));
  document.getElementById('rm_planSearch').addEventListener('input', renderAllPlansTable);

  document.getElementById('rm_autoMap').addEventListener('click', autoMapRooms);
  document.getElementById('rm_autoMapPlans').addEventListener('click', (e)=>{ e.preventDefault(); autoMapPlansForAllRooms(); render(); APP.toast('Rate Plans Auto Mapped', 'Rate plans matched for every currently mapped room.', 'success'); });
  document.getElementById('rm_clearAll').addEventListener('click', (e)=>{ e.preventDefault(); clearAll(); });
  document.getElementById('rm_save').addEventListener('click', save);
  document.getElementById('rm_notesBtn').addEventListener('click', openNotes);

  document.querySelectorAll('#rmTabs .nav-link').forEach(btn=>{
    btn.addEventListener('click', function(){
      document.querySelectorAll('#rmTabs .nav-link').forEach(b=>b.classList.remove('active'));
      this.classList.add('active');
      const tab = this.dataset.tab;
      document.getElementById('rm_tabRooms').classList.toggle('d-none', tab!=='rooms');
      document.getElementById('rm_tabPlans').classList.toggle('d-none', tab!=='plans');
    });
  });

  setupPropPicker();
  setupCompPicker();
  render();
});
