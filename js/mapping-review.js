/* ==========================================================================
   Mapping Review — a contextual exception workflow, not a standalone module.
   Rooms and rate plans are auto-matched between a property and a competitor
   the moment they're first seen together (ensureAutoMapped, called from the
   Competitors module on load — the closest thing this app has to "a
   competitor was added or refreshed"). A human only needs to open the
   review modal when auto-mapping couldn't confidently resolve everything:
   new/changed rooms, low-confidence matches, or a mapping that pointed at
   a room/rate plan that no longer exists. Persisted the same way every
   other mock-DB record is (DB.get/set) keyed per Property+Competitor pair —
   a straightforward RoomMappings(PropertyRoomId, CompetitorRoomId,
   Confidence, Status) / RatePlanMappings(...) table in a future SQL Server
   schema.
   ========================================================================== */
const MAPPING = (() => {

  const CONFIDENCE_THRESHOLD = 90; // manual picks & strong auto-matches clear this; anything below needs review

  function roomMapKey(propertyId, competitorId){ return `hop_room_mapping_${propertyId}_${competitorId}`; }
  function planMapKey(propertyId, competitorId){ return `hop_rateplan_mapping_${propertyId}_${competitorId}`; }

  function masterRooms(propertyId){
    const master = DB.channels.byProperty(propertyId).find(c=>c.type==='master');
    return master ? DB.rooms.byChannel(master.id) : [];
  }

  function statusFor(confidence){
    if(confidence >= 95) return 'mapped';
    if(confidence >= 60) return 'partial';
    return 'unmapped';
  }
  function needsReviewStatus(status){ return status !== 'mapped'; }

  function normalize(name){ return (name||'').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
  function similarity(a, b){
    if(a.trim().toLowerCase() === b.trim().toLowerCase()) return 98;
    const wa = normalize(a), wb = normalize(b);
    const shared = wa.filter(w=>wb.includes(w)).length;
    const union = new Set([...wa, ...wb]).size;
    if(!union || !shared) return 0;
    return Math.round(45 + (shared/union) * 50);
  }

  // ---- Room-pair match score: every competitor room must land in the SAME master category
  // (Standard/Deluxe/Suite/Family — the same tiering used across the whole app) as the room it's
  // compared against, or price comparisons across channels stop meaning anything ("Standard Twin"
  // vs "Presidential Suite" isn't a rate-parity signal, it's noise). A same-category pair is
  // boosted well above a same-category-less name coincidence, so greedy pairing in autoMap()
  // always prefers staying within category even when a cross-category name match scores higher
  // on text alone. ----
  function matchScore(ourRoom, compRoom){
    const nameScore = similarity(ourRoom.name, compRoom.name);
    const sameCategory = ourRoom.category && compRoom.category && ourRoom.category === compRoom.category;
    return sameCategory ? Math.min(99, nameScore + 35) : Math.round(nameScore * 0.5);
  }

  // ---- Rate-plan auto-match for one already-mapped room pair: meal plan + refundable flag ----
  function autoMapPlansForRoom(ourRoomId, compRoomId, planMap){
    const ourPlans = DB.ratePlans.byRoom(ourRoomId);
    const compPlans = DB.ratePlans.byRoom(compRoomId);
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
        const confidence = Math.min(99, bestScore + (bestScore?20:0));
        planMap[op.id] = { competitorRatePlanId:best.id, confidence, status:statusFor(confidence) };
      }
    });
  }

  // ---- Full auto-map: greedy best-match-first room pairing (1:1), then rate plans per pair ----
  function autoMap(propertyId, competitorId){
    const ourRooms = masterRooms(propertyId);
    const compRooms = masterRooms(competitorId);
    const roomMap = {}, planMap = {};

    const pairs = [];
    ourRooms.forEach(or=> compRooms.forEach(cr=>{
      const score = matchScore(or, cr);
      if(score > 0) pairs.push({ourId:or.id, compId:cr.id, score});
    }));
    pairs.sort((a,b)=>b.score-a.score);
    const usedOur = new Set(), usedComp = new Set();
    pairs.forEach(p=>{
      if(usedOur.has(p.ourId) || usedComp.has(p.compId)) return;
      usedOur.add(p.ourId); usedComp.add(p.compId);
      roomMap[p.ourId] = { competitorRoomId:p.compId, confidence:p.score, status:statusFor(p.score) };
      autoMapPlansForRoom(p.ourId, p.compId, planMap);
    });

    DB.set(roomMapKey(propertyId, competitorId), roomMap);
    DB.set(planMapKey(propertyId, competitorId), planMap);
    return { roomMap, planMap };
  }

  // ---- Silently keep a pair's mapping current: run auto-map the first time a pair is seen,
  // then on every subsequent load, heal anything invalid (points at a room/rate-plan that no
  // longer exists) and fill in mappings for rooms that have never been matched at all — without
  // ever touching a mapping a human already approved or that's already confidently auto-matched. ----
  function ensureAutoMapped(propertyId, competitorId){
    const rmKey = roomMapKey(propertyId, competitorId), pmKey = planMapKey(propertyId, competitorId);
    const everRun = DB.get(rmKey, null) !== null;
    if(!everRun){ autoMap(propertyId, competitorId); return; }

    const ourRooms = masterRooms(propertyId);
    const compRooms = masterRooms(competitorId);
    const compRoomIds = new Set(compRooms.map(r=>r.id));
    let roomMap = DB.get(rmKey, {});
    let planMap = DB.get(pmKey, {});
    let changed = false;

    // Heal invalid room mappings (their competitor room was deleted) — drop back to unmapped
    // rather than pointing at nothing, so it surfaces as needing review.
    Object.keys(roomMap).forEach(ourRoomId=>{
      const m = roomMap[ourRoomId];
      if(m.competitorRoomId && !compRoomIds.has(m.competitorRoomId)){ delete roomMap[ourRoomId]; changed = true; }
    });

    // Auto-match any of our rooms that have never been mapped at all, against whatever
    // competitor rooms aren't already claimed.
    const usedComp = new Set(Object.values(roomMap).map(m=>m.competitorRoomId));
    ourRooms.forEach(or=>{
      if(roomMap[or.id]) return;
      let best = null, bestScore = 0;
      compRooms.forEach(cr=>{
        if(usedComp.has(cr.id)) return;
        const score = matchScore(or, cr);
        if(score > bestScore){ bestScore = score; best = cr; }
      });
      if(best && bestScore > 0){
        usedComp.add(best.id);
        roomMap[or.id] = { competitorRoomId:best.id, confidence:bestScore, status:statusFor(bestScore) };
        autoMapPlansForRoom(or.id, best.id, planMap);
        changed = true;
      }
    });

    // Heal/fill rate plans for every room that IS mapped but has missing/invalid plan entries.
    Object.keys(roomMap).forEach(ourRoomId=>{
      const compRoomId = roomMap[ourRoomId].competitorRoomId;
      const compPlanIds = new Set(DB.ratePlans.byRoom(compRoomId).map(p=>p.id));
      DB.ratePlans.byRoom(ourRoomId).forEach(op=>{
        const pm = planMap[op.id];
        if(pm && !compPlanIds.has(pm.competitorRatePlanId)){ delete planMap[op.id]; changed = true; }
      });
      if(DB.ratePlans.byRoom(ourRoomId).some(op=>!planMap[op.id])){
        autoMapPlansForRoom(ourRoomId, compRoomId, planMap);
        changed = true;
      }
    });

    if(changed){ DB.set(rmKey, roomMap); DB.set(pmKey, planMap); }
  }

  // ---- Evaluate current mapping state without changing anything — what the review modal (and
  // the Competitors card badge) needs to know. ----
  function evaluate(propertyId, competitorId){
    const ourRooms = masterRooms(propertyId);
    const compRooms = masterRooms(competitorId);
    const roomMap = DB.get(roomMapKey(propertyId, competitorId), {});
    const planMap = DB.get(planMapKey(propertyId, competitorId), {});

    const rooms = ourRooms.map(or=>{
      const m = roomMap[or.id];
      const compRoom = m ? compRooms.find(c=>c.id===m.competitorRoomId) : null;
      const status = m && compRoom ? m.status : 'unmapped';
      return { ourRoom:or, mapping:m||null, compRoom, status, needsReview: needsReviewStatus(status) };
    });

    const plans = [];
    rooms.filter(r=>r.compRoom).forEach(r=>{
      DB.ratePlans.byRoom(r.ourRoom.id).forEach(op=>{
        const pm = planMap[op.id];
        const compPlan = pm ? DB.ratePlans.byRoom(r.compRoom.id).find(p=>p.id===pm.competitorRatePlanId) : null;
        const status = pm && compPlan ? pm.status : 'unmapped';
        plans.push({ ourRoom:r.ourRoom, ourPlan:op, compRoom:r.compRoom, mapping:pm||null, compPlan, status, needsReview: needsReviewStatus(status) });
      });
    });

    return {
      ourRooms, compRooms, roomMap, planMap, rooms, plans,
      flaggedRooms: rooms.filter(r=>r.needsReview),
      flaggedPlans: plans.filter(p=>p.needsReview),
      mappedRoomCount: rooms.filter(r=>!r.needsReview).length,
      totalRooms: ourRooms.length
    };
  }

  function saveRoomMapping(propertyId, competitorId, ourRoomId, compRoomId){
    const rmKey = roomMapKey(propertyId, competitorId), pmKey = planMapKey(propertyId, competitorId);
    const roomMap = DB.get(rmKey, {});
    const planMap = DB.get(pmKey, {});
    if(!compRoomId){ delete roomMap[ourRoomId]; }
    else {
      // Confidence reflects the actual pair chosen — a small "human confirmed this" bonus on top
      // of the real name-similarity score, not a flat floor. Picking a genuinely dissimilar room
      // still shows up honestly as low/partial confidence instead of being hidden behind 90%.
      const ourRoom = DB.rooms.get(ourRoomId), compRoom = DB.rooms.get(compRoomId);
      const confidence = Math.min(99, matchScore(ourRoom, compRoom) + 10);
      roomMap[ourRoomId] = { competitorRoomId:compRoomId, confidence, status:statusFor(confidence) };
      autoMapPlansForRoom(ourRoomId, compRoomId, planMap);
    }
    DB.set(rmKey, roomMap);
    DB.set(pmKey, planMap);
  }

  function savePlanMapping(propertyId, competitorId, ourPlanId, compPlanId){
    const pmKey = planMapKey(propertyId, competitorId);
    const planMap = DB.get(pmKey, {});
    if(!compPlanId){ delete planMap[ourPlanId]; }
    else {
      // Same principle as room mapping: confidence adapts to how well the chosen rate plan
      // actually matches (meal plan + refundable flag), plus a small confirmation bonus — it
      // isn't forced up to a fixed floor regardless of what was picked.
      const ourPlan = DB.ratePlans.get(ourPlanId), compPlan = DB.ratePlans.get(compPlanId);
      let score = 0;
      if(compPlan.mealPlan===ourPlan.mealPlan) score += 70;
      if(compPlan.refundable===ourPlan.refundable) score += 25;
      const confidence = Math.min(99, score + 10);
      planMap[ourPlanId] = { competitorRatePlanId:compPlanId, confidence, status:statusFor(confidence) };
    }
    DB.set(pmKey, planMap);
  }

  // ---- UI: a single reusable modal, injected on first use ----
  function statusPill(status){
    if(status==='mapped') return '<span class="badge-status badge-active">Mapped</span>';
    if(status==='partial') return '<span class="badge bg-warning-subtle text-warning-emphasis">Partial</span>';
    return '<span class="badge-status badge-inactive">Not Mapped</span>';
  }
  function confidencePill(c){
    if(c==null) return '<span class="text-muted">—</span>';
    const cls = c>=95 ? 'high' : c>=60 ? 'mid' : 'low';
    return `<span class="rm-confidence ${cls}">${c}%</span>`;
  }

  function ensureModal(){
    if(document.getElementById('mappingReviewModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="modal fade" id="mappingReviewModal" tabindex="-1">
        <div class="modal-dialog modal-dialog-centered modal-lg">
          <div class="modal-content" style="border-radius:18px;border:none">
            <div class="modal-header border-0 pb-0">
              <div>
                <h5 class="modal-title fw-bold mb-0">Mapping Review</h5>
                <div class="text-muted small" id="mr_subtitle">-</div>
              </div>
              <button class="btn-close" data-bs-dismiss="modal"></button>
            </div>
            <div class="modal-body" id="mr_body"></div>
          </div>
        </div>
      </div>`);
  }

  let mrCtx = null; // { propertyId, competitorId, competitorName }
  let mrShowAll = false;

  function renderModalBody(){
    const { propertyId, competitorId, competitorName } = mrCtx;
    const ev = evaluate(propertyId, competitorId);

    document.getElementById('mr_subtitle').textContent =
      `${competitorName} — ${ev.mappedRoomCount} of ${ev.totalRooms} rooms mapped with high confidence`;

    const flaggedRoomRows = ev.flaggedRooms.map(r=>{
      const current = r.compRoom ? r.compRoom.id : '';
      return `
      <tr>
        <td class="fw-semibold">${r.ourRoom.name}<div class="text-muted" style="font-size:.7rem">${r.ourRoom.category||'—'}</div></td>
        <td>
          <select class="form-select form-select-sm mr-room-pick" data-our-room-id="${r.ourRoom.id}" data-initial="${current}">
            <option value="">— Not Mapped —</option>
            ${ev.compRooms.map(cr=>`<option value="${cr.id}" ${current===cr.id?'selected':''}>${cr.name} (${cr.category||'—'})</option>`).join('')}
          </select>
        </td>
        <td>${confidencePill(r.mapping?r.mapping.confidence:null)}</td>
        <td>${statusPill(r.status)}</td>
        <td><button type="button" class="btn btn-primary btn-sm mr-room-save" data-our-room-id="${r.ourRoom.id}" disabled>Save</button></td>
      </tr>`;
    }).join('');

    const flaggedPlanRows = ev.flaggedPlans.map(p=>{
      const current = p.compPlan ? p.compPlan.id : '';
      return `
      <tr>
        <td>${p.ourRoom.name}<div class="text-muted" style="font-size:.7rem">${p.ourPlan.name.split(' - ')[0]} (${p.ourPlan.mealPlan})</div></td>
        <td>
          <select class="form-select form-select-sm mr-plan-pick" data-our-plan-id="${p.ourPlan.id}" data-initial="${current}">
            <option value="">— Not Mapped —</option>
            ${DB.ratePlans.byRoom(p.compRoom.id).map(cp=>`<option value="${cp.id}" ${current===cp.id?'selected':''}>${cp.name.split(' - ')[0]} (${cp.mealPlan})</option>`).join('')}
          </select>
        </td>
        <td>${confidencePill(p.mapping?p.mapping.confidence:null)}</td>
        <td>${statusPill(p.status)}</td>
        <td><button type="button" class="btn btn-primary btn-sm mr-plan-save" data-our-plan-id="${p.ourPlan.id}" disabled>Save</button></td>
      </tr>`;
    }).join('');

    const allGoodMsg = `<div class="rm-empty"><i class="bi bi-check2-circle text-success"></i><p>Everything is mapped with high confidence — nothing needs your review.</p></div>`;

    const okRoomRows = ev.rooms.filter(r=>!r.needsReview).map(r=>`
      <tr><td>${r.ourRoom.name}<div class="text-muted" style="font-size:.7rem">${r.ourRoom.category||'—'}</div></td><td>${r.compRoom.name}<div class="text-muted" style="font-size:.7rem">${r.compRoom.category||'—'}</div></td><td>${confidencePill(r.mapping.confidence)}</td><td>${statusPill(r.status)}</td></tr>`).join('');
    const okPlanRows = ev.plans.filter(p=>!p.needsReview).map(p=>`
      <tr><td>${p.ourRoom.name} <span class="text-muted">(${p.ourPlan.mealPlan})</span></td><td>${p.compPlan.name.split(' - ')[0]} (${p.compPlan.mealPlan})</td><td>${confidencePill(p.mapping.confidence)}</td><td>${statusPill(p.status)}</td></tr>`).join('');

    document.getElementById('mr_body').innerHTML = `
      ${!ev.flaggedRooms.length && !ev.flaggedPlans.length ? allGoodMsg : `
        ${ev.flaggedRooms.length ? `
        <div class="fw-semibold small mb-2"><i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>Rooms needing review (${ev.flaggedRooms.length})</div>
        <div class="text-muted mb-2" style="font-size:.72rem">Pick a match from the dropdown, then click Save to confirm it.</div>
        <div class="table-responsive mb-3"><table class="table-modern w-100">
          <thead><tr><th>Our Room</th><th>Competitor Room</th><th>Confidence</th><th>Status</th><th></th></tr></thead>
          <tbody>${flaggedRoomRows}</tbody>
        </table></div>` : ''}
        ${ev.flaggedPlans.length ? `
        <div class="fw-semibold small mb-2"><i class="bi bi-exclamation-triangle-fill text-warning me-1"></i>Rate plans needing review (${ev.flaggedPlans.length})</div>
        <div class="table-responsive mb-3"><table class="table-modern w-100">
          <thead><tr><th>Room / Rate Plan</th><th>Competitor Rate Plan</th><th>Confidence</th><th>Status</th><th></th></tr></thead>
          <tbody>${flaggedPlanRows}</tbody>
        </table></div>` : ''}
      `}
      <button type="button" class="btn btn-link btn-sm px-0" id="mr_toggleAll">${mrShowAll?'Hide fully mapped items':'Show all mappings'}</button>
      <div class="${mrShowAll?'':'d-none'}" id="mr_allWrap">
        ${okRoomRows ? `<div class="fw-semibold small mt-2 mb-2 text-muted">Mapped rooms</div>
        <div class="table-responsive mb-3"><table class="table-modern w-100">
          <thead><tr><th>Our Room</th><th>Competitor Room</th><th>Confidence</th><th>Status</th></tr></thead>
          <tbody>${okRoomRows}</tbody>
        </table></div>` : ''}
        ${okPlanRows ? `<div class="fw-semibold small mb-2 text-muted">Mapped rate plans</div>
        <div class="table-responsive"><table class="table-modern w-100">
          <thead><tr><th>Room / Rate Plan</th><th>Competitor Rate Plan</th><th>Confidence</th><th>Status</th></tr></thead>
          <tbody>${okPlanRows}</tbody>
        </table></div>` : ''}
        ${(!okRoomRows && !okPlanRows) ? '<div class="text-muted small">No fully-mapped items yet.</div>' : ''}
      </div>
    `;

    // A picked dropdown value is only staged, not saved — the row's Save button only lights up
    // once the selection actually differs from what's currently mapped, and committing it is a
    // deliberate click rather than an implicit save-on-change.
    document.querySelectorAll('.mr-room-pick').forEach(sel=>{
      sel.addEventListener('change', ()=>{
        const btn = document.querySelector(`.mr-room-save[data-our-room-id="${sel.dataset.ourRoomId}"]`);
        btn.disabled = (sel.value === sel.dataset.initial);
      });
    });
    document.querySelectorAll('.mr-plan-pick').forEach(sel=>{
      sel.addEventListener('change', ()=>{
        const btn = document.querySelector(`.mr-plan-save[data-our-plan-id="${sel.dataset.ourPlanId}"]`);
        btn.disabled = (sel.value === sel.dataset.initial);
      });
    });
    document.querySelectorAll('.mr-room-save').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const sel = document.querySelector(`.mr-room-pick[data-our-room-id="${btn.dataset.ourRoomId}"]`);
        saveRoomMapping(propertyId, competitorId, btn.dataset.ourRoomId, sel.value || null);
        APP.toast('Mapping Saved', 'Room mapping has been saved.', 'success');
        renderModalBody();
      });
    });
    document.querySelectorAll('.mr-plan-save').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const sel = document.querySelector(`.mr-plan-pick[data-our-plan-id="${btn.dataset.ourPlanId}"]`);
        savePlanMapping(propertyId, competitorId, btn.dataset.ourPlanId, sel.value || null);
        APP.toast('Mapping Saved', 'Rate plan mapping has been saved.', 'success');
        renderModalBody();
      });
    });
    document.getElementById('mr_toggleAll').addEventListener('click', ()=>{ mrShowAll = !mrShowAll; renderModalBody(); });
  }

  // Open the review modal for a property/competitor pair. Call sites: the Competitors module's
  // "Review Mapping" action (manual trigger), or automatically after ensureAutoMapped() finds
  // something it couldn't confidently resolve.
  function review(propertyId, competitorId, competitorName){
    ensureModal();
    mrCtx = { propertyId, competitorId, competitorName };
    mrShowAll = false;
    renderModalBody();
    new bootstrap.Modal(document.getElementById('mappingReviewModal')).show();
  }

  return { CONFIDENCE_THRESHOLD, ensureAutoMapped, evaluate, review };
})();
