/* ==========================================================================
   Room Rate Comparison — per-room, per-rate-plan price comparison against
   mapped competitor rooms. Price comparison only: no occupancy/ADR/RevPAR/
   bookings/demand. Row generation is kept as a flat array + client-side
   pagination/sort/filter so the table stays responsive even if the
   underlying property/competitor set grows into the thousands of rooms.
   When "All Rooms" is selected, the room-scoped sections (distribution,
   ranking, trend, history) compare across every one of the owner's rooms
   instead of defaulting to a single one.
   ========================================================================== */
let rcDistChart = null;
let rcAllRows = [];
let rcPage = 0;
const RC_PAGE_SIZE = 50;
let rcSort = { key:'compRate', dir:'asc' };

// Shared Chart.js animation preset — same helper as the Dashboard/Market Intelligence pages;
// bars cascade in one-by-one, lines draw in with a smooth ease.
function chartAnim(isBar){
  return {
    duration: 850, easing: 'easeOutQuart',
    delay: (ctx)=> isBar
      ? (ctx.type==='data' ? ctx.dataIndex*30 + (ctx.datasetIndex||0)*80 : 0)
      : (ctx.datasetIndex||0) * 150
  };
}

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Room Rate Comparison', subtitle:'Compare your rooms against mapped competitor rooms, plan by plan, channel by channel.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);

  const channels = DB.channels.byProperty(propertyId);
  const master = channels.find(c=>c.type==='master');
  const myRooms = master ? DB.rooms.byChannel(master.id) : [];
  // Only the real properties your Company Admin actually assigned to you — same set as
  // Competitors/Rate Shopper/Market Intelligence. The portal's larger synthetic "market sample"
  // pool (used only on the Competitors browse page) never belongs here, otherwise a single
  // assigned property balloons into dozens of comparisons that were never actually assigned.
  const compsAll = PORTALDATA.comparisonRealProperties().map(c=>({...c, group:'real'}));

  document.getElementById('rc_date').value = PORTALDATA.dateKeyOffset(0);
  document.getElementById('rc_room').innerHTML += myRooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  document.getElementById('rc_channel').innerHTML += PORTALDATA.CHANNELS.map(c=>`<option value="${c.key}">${c.label}</option>`).join('');
  // Second Channel selector, right on the Room Comparison table itself — kept in sync with the
  // top filters-bar's rc_channel (either one can drive the filter without the two disagreeing).
  document.getElementById('rc_channel2').innerHTML += PORTALDATA.CHANNELS.map(c=>`<option value="${c.key}">${c.label}</option>`).join('');
  document.getElementById('rpta_channel').innerHTML += PORTALDATA.CHANNELS.map(c=>`<option value="${c.key}">${c.label}</option>`).join('');

  // Meal plan (All Plans/EP/CP/MAP/AP) — the single shared control that now drives both the
  // Rate Plan Trend Analysis charts/KPIs above AND the merged-in Room Comparison table below,
  // via the #rpta_mealPlanGroup buttons (there's no separate table-only meal plan filter anymore).
  let mealPlanFilter = '';

  // ---- date-range helper: last `days` dates ending today ----
  function rangeDates(days){ return Array.from({length:days}).map((_,d)=> PORTALDATA.dateKeyOffset(d - (days-1))); }
  function avgOf(vals){
    const nums = vals.filter(v=>v!=null);
    return nums.length ? Math.round(nums.reduce((a,b)=>a+b,0)/nums.length) : 0;
  }

  // ---- "My Rate" for a room, either on one date or averaged over the compare range. Runs the
  // same channelRate() markup/markdown the competitor side already gets, so switching the
  // Channel filter moves our own rate too — otherwise "My Rate" silently stayed pinned to the
  // flat Direct/master price no matter what channel was selected. ----
  function myRoomRate(room, dateKey, useAvg, days, channelFilter){
    const plans = DB.ratePlans.byRoom(room.id);
    const rp = plans[0];
    if(!rp) return room.basePrice;
    const baseFor = dk=>{ const day = DB.rates.forPlan(rp.id)[dk]; return day ? day.price : room.basePrice; };
    const raw = useAvg ? avgOf(rangeDates(days).map(baseFor)) : baseFor(dateKey);
    return channelFilter ? PORTALDATA.channelRate(raw, channelFilter, useAvg ? PORTALDATA.dateKeyOffset(0) : dateKey) : raw;
  }

  // ---- Resolve a competitor's mapped room for one of ours via the same Room Mapping system
  // Rate Matrix uses (MAPPING.ensureAutoMapped/evaluate) — fuzzy name-similarity auto-matching
  // that self-heals on load, instead of requiring an exact room-name match. An exact-match lookup
  // silently dropped a competitor from every comparison the moment their room naming differed
  // even slightly (e.g. "Deluxe Room" vs "Deluxe King Room"), which meant "all assigned
  // competitors" in practice was only "competitors who happen to name rooms identically to us". ----
  function mappedCompRoom(comp, room){
    MAPPING.ensureAutoMapped(propertyId, comp.realPropertyId);
    const ev = MAPPING.evaluate(propertyId, comp.realPropertyId);
    const entry = ev.rooms.find(r=>r.ourRoom.id===room.id);
    return entry && entry.compRoom ? entry.compRoom : null;
  }

  // ---- Competitor's matched-room rate for a specific room, either snapshot or averaged ----
  function compRoomRate(comp, room, dateKey, channelFilter, useAvg, days){
    const compRoom = mappedCompRoom(comp, room);
    if(!compRoom) return null;
    const compPlan = DB.ratePlans.byRoom(compRoom.id)[0];
    const baseFor = dk=>{
      const day = compPlan ? DB.rates.forPlan(compPlan.id)[dk] : null;
      return day ? day.price : compRoom.basePrice;
    };
    const raw = useAvg ? avgOf(rangeDates(days).map(baseFor)) : baseFor(dateKey);
    return channelFilter ? PORTALDATA.channelRate(raw, channelFilter, useAvg ? PORTALDATA.dateKeyOffset(0) : dateKey) : raw;
  }

  // ---- Build the flat comparison-row dataset for the currently selected date/channel/metric ----
  function buildRows(dateKey, channelFilter, useAvg, days){
    const rows = [];
    myRooms.forEach(room=>{
      const plans = DB.ratePlans.byRoom(room.id);
      plans.forEach(rp=>{
        // Same channel-adjustment myRoomRate() applies, but scoped to this specific rate plan
        // (myRoomRate always uses the room's first plan — buildRows needs each plan in turn).
        const myBaseFor = dk=>{ const d=DB.rates.forPlan(rp.id)[dk]; return d ? d.price : room.basePrice; };
        const myRaw = useAvg ? avgOf(rangeDates(days).map(myBaseFor)) : myBaseFor(dateKey);
        const myRate = channelFilter ? PORTALDATA.channelRate(myRaw, channelFilter, useAvg ? PORTALDATA.dateKeyOffset(0) : dateKey) : myRaw;

        compsAll.forEach(comp=>{
          const compRoom = mappedCompRoom(comp, room);
          if(!compRoom) return;
          const compPlans = DB.ratePlans.byRoom(compRoom.id);
          const compPlan = compPlans.find(p=>p.mealPlan===rp.mealPlan) || compPlans[0];
          if(!compPlan) return;
          const channelKey = channelFilter || 'direct';
          const baseFor = dk=>{ const d=DB.rates.forPlan(compPlan.id)[dk]; return d ? d.price : compRoom.basePrice; };
          const raw = useAvg ? avgOf(rangeDates(days).map(baseFor)) : baseFor(dateKey);
          const compRate = channelFilter ? PORTALDATA.channelRate(raw, channelFilter, dateKey) : raw;
          const compRoomName = compRoom.name;
          const ratePlanName = compPlan.name;
          const lastUpdated = compPlan.createdAt || dateKey;

          const diff = compRate - myRate;
          const diffPct = myRate ? (diff/myRate*100) : 0;
          const position = Math.abs(diffPct) < 1 ? 'same' : diff > 0 ? 'higher' : 'lower';

          rows.push({
            compId: comp.id, compName: comp.name, compRoomName, channelKey, ratePlanName,
            myRoomId: room.id, myRoomName: room.name, myRatePlanName: rp.name, myRateMealPlan: rp.mealPlan,
            myRate, compRate, diff, diffPct, position, lastUpdated, isReal: true
          });
        });
      });
    });
    return rows;
  }

  function applyFilters(rows){
    const roomId = document.getElementById('rc_room').value;
    const mealPlan = mealPlanFilter;
    const search = document.getElementById('rc_search').value.trim().toLowerCase();
    return rows.filter(r=>{
      if(roomId && r.myRoomId !== roomId) return false;
      if(mealPlan && r.myRateMealPlan !== mealPlan) return false;
      if(search && !(r.compName.toLowerCase().includes(search) || r.compRoomName.toLowerCase().includes(search) || r.myRoomName.toLowerCase().includes(search))) return false;
      return true;
    });
  }

  function sortRows(rows){
    const { key, dir } = rcSort;
    const mul = dir === 'asc' ? 1 : -1;
    return [...rows].sort((a,b)=>{
      let av = a[key], bv = b[key];
      if(typeof av === 'string') return av.localeCompare(bv) * mul;
      return (av-bv) * mul;
    });
  }

  function positionBadge(pos){
    const map = { higher:['badge-inactive','Higher'], lower:['badge-active','Lower'], same:['badge-status','Same'] };
    const [cls,label] = map[pos];
    return `<span class="badge-status ${cls}">${label}</span>`;
  }

  // ---- Frozen reference rows: my own room(s), pinned to the top of the table so they stay
  // visible while scrolling through competitor rows below. Rebuilt from the same Room/Rate
  // Plan/Date/Rate-Metric filters as the rest of the page, so they always adapt to them. ----
  function buildFrozenRows(dateKey, useAvg, days, channelFilter){
    const roomId = document.getElementById('rc_room').value;
    const mealPlan = mealPlanFilter;
    const rooms = roomId ? myRooms.filter(r=>r.id===roomId) : myRooms;
    const rows = [];
    rooms.forEach(room=>{
      let plans = DB.ratePlans.byRoom(room.id);
      if(mealPlan) plans = plans.filter(p=>p.mealPlan===mealPlan);
      plans.forEach(rp=>{
        const myBaseFor = dk=>{ const d=DB.rates.forPlan(rp.id)[dk]; return d ? d.price : room.basePrice; };
        const myRaw = useAvg ? avgOf(rangeDates(days).map(myBaseFor)) : myBaseFor(dateKey);
        const myRate = channelFilter ? PORTALDATA.channelRate(myRaw, channelFilter, useAvg ? PORTALDATA.dateKeyOffset(0) : dateKey) : myRaw;
        rows.push({ roomName:room.name, ratePlanName:rp.name, myRate });
      });
    });
    return rows;
  }

  function renderKpis(filteredRows, dateKey, useAvg, days, channelFilter){
    const roomsInScope = focusRooms();
    const myRatesUnique = roomsInScope.map(r=> myRoomRate(r, dateKey, useAvg, days, channelFilter));
    const ourAvg = avgOf(myRatesUnique);
    const compRates = filteredRows.map(r=>r.compRate);
    const compAvg = avgOf(compRates);
    const cheaper = filteredRows.filter(r=>r.position==='lower').length;
    const pricier = filteredRows.filter(r=>r.position==='higher').length;

    document.getElementById('rcKpis').innerHTML = [
      PWIDGETS.kpiCard({icon:'bi-house-door-fill', color:'#3861fb', bg:'#eef4ff', label:'Our Avg. Rate', value:APP.fmtCurrency(ourAvg),
        desc:'The average rate across the rooms in scope (all rooms, or just the one selected), on the channel selected in the Channel filter (Direct by default).'}),
      PWIDGETS.kpiCard({icon:'bi-buildings', color:'#8c5cf7', bg:'#f3eeff', label:'Competitors Avg. Rate', value:APP.fmtCurrency(compAvg),
        desc:'The average rate across every matched competitor room in the current filter selection.'}),
      PWIDGETS.kpiCard({icon:'bi-arrow-down-circle', color:'#12b76a', bg:'#e7faf1', label:'Cheaper Than Us', value:cheaper,
        desc:'How many matched competitor rooms are currently priced below your equivalent room.'}),
      PWIDGETS.kpiCard({icon:'bi-arrow-up-circle', color:'#ff4d5e', bg:'#fff0f1', label:'Pricier Than Us', value:pricier,
        desc:'How many matched competitor rooms are currently priced above your equivalent room.'}),
    ].join('');
  }

  function renderTable(){
    const filtered = sortRows(applyFilters(rcAllRows));
    const totalPages = Math.max(1, Math.ceil(filtered.length / RC_PAGE_SIZE));
    rcPage = Math.min(rcPage, totalPages-1);
    const start = rcPage * RC_PAGE_SIZE;
    const pageRows = filtered.slice(start, start+RC_PAGE_SIZE);

    document.getElementById('rc_summary').textContent = `${filtered.length} matched room comparisons across ${myRooms.length} of your rooms and ${compsAll.length} assigned comparison ${compsAll.length===1?'property':'properties'}`;

    const cols = [
      {key:'compName', label:'Competitor Property'},
      {key:'compRoomName', label:'Competitor Room'},
      {key:'channelKey', label:'Channel'},
      {key:'ratePlanName', label:'Rate Plan'},
      {key:'myRate', label:'My Rate'},
      {key:'compRate', label:'Competitor Rate'},
      {key:'diff', label:'Difference (₹)'},
      {key:'diffPct', label:'Difference (%)'},
      {key:'position', label:'Price Position'},
      {key:'lastUpdated', label:'Last Updated'},
    ];
    const thead = `<thead><tr>${cols.map(c=>`<th class="th-sortable ${rcSort.key===c.key?'active':''}" data-key="${c.key}">${c.label}${rcSort.key===c.key?`<i class="bi ${rcSort.dir==='asc'?'bi-caret-up-fill':'bi-caret-down-fill'}"></i>`:'<i class="bi bi-caret-up-fill" style="opacity:.15"></i>'}</th>`).join('')}</tr></thead>`;

    const dateKey = document.getElementById('rc_date').value || PORTALDATA.dateKeyOffset(0);
    const useAvg = document.getElementById('rc_rateMetric').value === 'avg';
    const compareDays = Number(document.getElementById('rc_compare').value);
    const channelFilter = document.getElementById('rc_channel').value;
    const frozenRows = buildFrozenRows(dateKey, useAvg, compareDays, channelFilter);
    // The "My Property" label + star only need to appear once — the row tint already groups
    // every frozen row visually, so repeating the label on each one was just noise.
    const frozenHtml = frozenRows.map((r,i)=>`
      <tr class="rc-frozen-row">
        <td class="fw-semibold">${i===0 ? '<i class="bi bi-star-fill me-1" style="color:var(--brand-500)"></i>My Property' : ''}</td>
        <td>${r.roomName}</td>
        <td>${PWIDGETS.channelChip(channelFilter || 'direct')}</td>
        <td style="font-size:.78rem">${r.ratePlanName}</td>
        <td class="fw-bold">${APP.fmtCurrency(r.myRate)}</td>
        <td class="text-muted">—</td>
        <td class="text-muted">—</td>
        <td class="text-muted">—</td>
        <td><span class="badge bg-primary-subtle text-primary" style="font-size:.65rem">My Room</span></td>
        <td class="text-muted" style="font-size:.72rem">Live</td>
      </tr>`).join('');

    const body = pageRows.map(r=>`
      <tr>
        <td class="fw-semibold">${r.compName}</td>
        <td>${r.compRoomName}</td>
        <td>${PWIDGETS.channelChip(r.channelKey)}</td>
        <td style="font-size:.78rem">${r.ratePlanName}</td>
        <td class="fw-semibold">${APP.fmtCurrency(r.myRate)}</td>
        <td class="fw-semibold">${APP.fmtCurrency(r.compRate)}</td>
        <td class="${r.diff>=0?'text-danger':'text-success'}">${r.diff>=0?'+':''}${APP.fmtCurrency(r.diff)}</td>
        <td class="${r.diff>=0?'text-danger':'text-success'}">${r.diff>=0?'+':''}${r.diffPct.toFixed(1)}%</td>
        <td>${positionBadge(r.position)}</td>
        <td style="font-size:.72rem" class="text-muted">${r.lastUpdated}</td>
      </tr>`).join('');

    document.getElementById('rc_table').innerHTML = thead + `<tbody>${frozenHtml}${body || `<tr><td colspan="${cols.length}" class="text-center text-muted py-4">No matched room comparisons for these filters.</td></tr>`}</tbody>`;
    document.getElementById('rc_pageInfo').textContent = filtered.length ? `Showing ${start+1}-${Math.min(start+RC_PAGE_SIZE, filtered.length)} of ${filtered.length}` : 'No rows';
    document.getElementById('rc_prevPage').disabled = rcPage <= 0;
    document.getElementById('rc_nextPage').disabled = rcPage >= totalPages-1;

    document.querySelectorAll('#rc_table .th-sortable').forEach(th=>{
      th.addEventListener('click', ()=>{
        const key = th.dataset.key;
        if(rcSort.key === key) rcSort.dir = rcSort.dir==='asc' ? 'desc' : 'asc';
        else rcSort = { key, dir:'asc' };
        rcPage = 0;
        renderTable();
      });
    });

    return filtered;
  }

  // ---- Room scope for the derived sections below: the selected room, or every room when
  // "All Rooms" is chosen — each of those rooms is then compared against its own matched
  // competitors instead of silently falling back to a single room. ----
  function focusRooms(){
    const roomId = document.getElementById('rc_room').value;
    if(roomId){ const r = myRooms.find(x=>x.id===roomId); return r ? [r] : []; }
    return myRooms;
  }

  function matchedCompsForRoom(room){ return compsAll; }

  function topCompetitorsForRoom(room, dateKey, channelFilter, useAvg, days, limit){
    const list = matchedCompsForRoom(room).map(c=>{
      const rate = compRoomRate(c, room, dateKey, channelFilter, useAvg, days);
      return rate!=null ? { comp:c, rate } : null;
    }).filter(Boolean);
    list.sort((a,b)=>a.rate-b.rate);
    return list.slice(0, limit);
  }

  // Fixed pixel height for the horizontal bar chart's own inner container — enough per bar
  // group to stay readable, with the outer .rc-chart-scroll wrapper scrolling once it's taller
  // than its max-height instead of squeezing every bar into a fixed canvas.
  function setDistChartHeight(barGroupCount, perGroupPx){
    const inner = document.getElementById('rc_distChartInner');
    inner.style.height = Math.max(220, barGroupCount * perGroupPx) + 'px';
  }

  function renderDistribution(dateKey, channelFilter, useAvg, days){
    const rooms = focusRooms();
    if(!rooms.length) return;

    if(rooms.length === 1){
      const room = rooms[0];
      const myRate = myRoomRate(room, dateKey, useAvg, days, channelFilter);
      const top5 = topCompetitorsForRoom(room, dateKey, channelFilter, useAvg, days, 5);
      const labels = ['My Room', ...top5.map(t=>t.comp.name)];
      const data = [myRate, ...top5.map(t=>t.rate)];
      const colors = ['#3861fb', ...top5.map((_,i)=>['#a9b0c9','#9fd6ca','#c3aee8','#f2c194','#e6a8c4'][i%5])];
      setDistChartHeight(labels.length, 38);
      if(rcDistChart) rcDistChart.destroy();
      rcDistChart = new Chart(document.getElementById('rc_distChart'), {
        type:'bar',
        data:{ labels, datasets:[{ data, backgroundColor:colors, borderRadius:6 }] },
        options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, animation:chartAnim(true), plugins:{legend:{display:false}}, scales:{x:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
      });
      return;
    }

    // "All Rooms": grouped bars per room — My Rate vs Market Average for that room.
    const labels = rooms.map(r=>r.name);
    const myData = rooms.map(r=> myRoomRate(r, dateKey, useAvg, days, channelFilter));
    const marketData = rooms.map(r=>{
      const rates = matchedCompsForRoom(r).map(c=>compRoomRate(c, r, dateKey, channelFilter, useAvg, days)).filter(v=>v!=null);
      return avgOf(rates);
    });
    setDistChartHeight(labels.length, 54);
    if(rcDistChart) rcDistChart.destroy();
    rcDistChart = new Chart(document.getElementById('rc_distChart'), {
      type:'bar',
      data:{ labels, datasets:[
        { label:'My Rate', data:myData, backgroundColor:'#3861fb', borderRadius:6 },
        { label:'Market Avg', data:marketData, backgroundColor:'#c3aee8', borderRadius:6 }
      ]},
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, animation:chartAnim(true), plugins:{legend:{position:'bottom'}}, scales:{x:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
    });
  }

  function renderRanking(dateKey, channelFilter, useAvg, days){
    const rooms = focusRooms();
    if(!rooms.length){ document.getElementById('rc_rankTable').innerHTML = ''; return; }

    let list = [];
    rooms.forEach(room=>{
      const myRate = myRoomRate(room, dateKey, useAvg, days, channelFilter);
      matchedCompsForRoom(room).forEach(c=>{
        const rate = compRoomRate(c, room, dateKey, channelFilter, useAvg, days);
        if(rate!=null) list.push({ name:c.name, roomName:room.name, rate, isMe:false });
      });
      list.push({ name:'My Property', roomName:room.name, rate:myRate, isMe:true });
    });
    list.sort((a,b)=>a.rate-b.rate);
    if(rooms.length > 1) list = list.slice(0, 25); // cap the combined view to a readable top slice

    const myRateLookup = new Map(rooms.map(r=>[r.name, myRoomRate(r, dateKey, useAvg, days, channelFilter)]));

    document.getElementById('rc_rankTable').innerHTML = `
      <thead><tr><th>Rank</th><th>Property</th><th>Room</th><th>Current Rate</th><th>Difference vs. Mine</th></tr></thead>
      <tbody>${list.map((r,i)=>{
        const myRateForRow = myRateLookup.get(r.roomName);
        const diff = r.rate - myRateForRow;
        return `<tr class="${r.isMe?'fw-bold':''}" style="${r.isMe?'background:var(--brand-50)':''}">
          <td>#${i+1}</td>
          <td>${r.isMe?'<i class="bi bi-star-fill me-1" style="color:var(--brand-500)"></i>':''}${r.name}</td>
          <td>${r.roomName}</td>
          <td class="fw-semibold">${APP.fmtCurrency(r.rate)}</td>
          <td class="${diff>=0?'text-danger':'text-success'}">${r.isMe?'—':`${diff>=0?'+':''}${APP.fmtCurrency(diff)}`}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="5" class="text-center text-muted py-3">No data</td></tr>`}</tbody>`;
  }

  function renderHistory(channelFilter, compareDays){
    const rooms = focusRooms();
    if(!rooms.length){ document.getElementById('rc_historyTable').innerHTML = ''; return; }

    const days = rangeDates(compareDays);
    const rows = days.map(dk=>{
      const myRate = avgOf(rooms.map(r=>myRoomRate(r, dk, false, 1, channelFilter)));
      const rates = [];
      rooms.forEach(r=> matchedCompsForRoom(r).forEach(c=>{ const rate=compRoomRate(c, r, dk, channelFilter, false, 1); if(rate!=null) rates.push(rate); }));
      const marketAvg = rates.length ? avgOf(rates) : myRate;
      const lowest = rates.length ? Math.min(...rates) : myRate;
      const highest = rates.length ? Math.max(...rates) : myRate;
      const diff = myRate - lowest;
      return { dk, myRate, marketAvg, lowest, highest, diff };
    });

    document.getElementById('rc_historyTable').innerHTML = `
      <thead><tr><th>Date</th><th>My Rate</th><th>Market Average</th><th>Lowest Competitor</th><th>Highest Competitor</th><th>Difference</th></tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td>${new Date(r.dk+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short',year:'2-digit'})}</td>
        <td class="fw-semibold">${APP.fmtCurrency(r.myRate)}</td>
        <td>${APP.fmtCurrency(r.marketAvg)}</td>
        <td class="text-success">${APP.fmtCurrency(r.lowest)}</td>
        <td class="text-danger">${APP.fmtCurrency(r.highest)}</td>
        <td class="${r.diff>=0?'text-danger':'text-success'}">${r.diff>=0?'+':''}${APP.fmtCurrency(r.diff)}</td>
      </tr>`).join('')}</tbody>`;
  }

  function exportCsv(){
    const filtered = sortRows(applyFilters(rcAllRows));
    const headers = ['Competitor Property','Competitor Room','Channel','Rate Plan','My Rate','Competitor Rate','Difference (₹)','Difference (%)','Price Position','Last Updated'];
    const lines = [headers.join(',')];
    filtered.forEach(r=>{
      lines.push([r.compName, r.compRoomName, r.channelKey, r.ratePlanName, r.myRate, r.compRate, r.diff, r.diffPct.toFixed(1), r.position, r.lastUpdated]
        .map(v=>`"${String(v).replace(/"/g,'""')}"`).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `room-rate-comparison-${PORTALDATA.dateKeyOffset(0)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    APP.toast('Export Complete', 'Your CSV file has been downloaded.', 'success');
  }

  function renderAll(){
    const dateKey = document.getElementById('rc_date').value || PORTALDATA.dateKeyOffset(0);
    const channelFilter = document.getElementById('rc_channel').value;
    const useAvg = document.getElementById('rc_rateMetric').value === 'avg';
    const compareDays = Number(document.getElementById('rc_compare').value);
    rcAllRows = buildRows(dateKey, channelFilter, useAvg, compareDays);
    const filtered = renderTable();
    renderKpis(filtered, dateKey, useAvg, compareDays, channelFilter);
    renderDistribution(dateKey, channelFilter, useAvg, compareDays);
    renderRanking(dateKey, channelFilter, useAvg, compareDays);
    renderHistory(channelFilter, compareDays);
  }

  ['rc_date','rc_room','rc_channel','rc_compare','rc_rateMetric'].forEach(id=>{
    document.getElementById(id).addEventListener('input', ()=>{ rcPage = 0; renderAll(); });
  });
  // The Room Comparison table's own Channel selector mirrors the top filters-bar one — changing
  // either updates both, so there's never a mismatch between the two.
  document.getElementById('rc_channel2').addEventListener('input', function(){
    document.getElementById('rc_channel').value = this.value;
    rcPage = 0; renderAll();
  });
  document.getElementById('rc_channel').addEventListener('input', function(){
    document.getElementById('rc_channel2').value = this.value;
  });
  document.getElementById('rc_search').addEventListener('input', ()=>{ rcPage = 0; renderTable(); });
  document.getElementById('rc_prevPage').addEventListener('click', ()=>{ rcPage--; renderTable(); });
  document.getElementById('rc_nextPage').addEventListener('click', ()=>{ rcPage++; renderTable(); });
  document.getElementById('rc_exportCsv').addEventListener('click', exportCsv);
  document.getElementById('rc_exportExcel').addEventListener('click', ()=> APP.toast('Export Started', 'Your Excel workbook is being prepared for download.', 'success'));
  document.getElementById('rc_print').addEventListener('click', ()=> window.print());

  /* ======================================================================
     Rate Plan Trend Analysis — meal-plan-scoped (All Plans/EP/CP/MAP/AP) rate
     vs. market. The meal plan control here is shared with the merged-in Room
     Comparison table below (mealPlanFilter, declared above) — picking a plan
     re-renders both together. Chart style (line/bar) stays local to the charts.
     ====================================================================== */
  let rptaStyle = 'line';
  let rptaChannel = ''; // '' = All Channels — independent from the merged table's own rc_channel filter
  let rptaYearChart = null, rptaMonthChart = null;
  const RPTA_PALETTE = ['#a9b0c9','#9fd6ca','#c3aee8','#f2c194','#e6a8c4'];

  // 12 trailing calendar months ending this month, sampled on the 15th of each — smooth enough
  // for the seasonal wave in mealPlanRateOnDate without needing a full daily scan per month.
  function trailingMonths(){
    const now = new Date();
    const months = [];
    for(let i=11; i>=0; i--){
      const d = new Date(now.getFullYear(), now.getMonth()-i, 15);
      months.push({ label: d.toLocaleDateString('en-IN',{month:'short',year:'2-digit'}), dateKey: DB.fmtDate(d) });
    }
    return months;
  }
  function currentMonthDays(){
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    return Array.from({length:daysInMonth}).map((_,i)=>{
      const d = new Date(now.getFullYear(), now.getMonth(), i+1);
      return { label: String(i+1), dateKey: DB.fmtDate(d) };
    });
  }

  // Meal-plan rate, then the Channel filter's markup/markdown on top — same two-step composition
  // myRoomRate()/compRoomRate() already use elsewhere on this page. Returns null when the
  // property/competitor has no rooms on this meal plan at all (see mealPlanRateOnDate).
  function rptaRateFor(pid, dateKey){
    const base = PORTALDATA.mealPlanRateOnDate(pid, mealPlanFilter, dateKey);
    if(base==null) return null;
    return rptaChannel ? PORTALDATA.channelRate(base, rptaChannel, dateKey) : base;
  }

  function rptaDatasets(points, styleIsBar){
    const myData = points.map(p=> rptaRateFor(propertyId, p.dateKey));
    const compSeriesRaw = compsAll.slice(0,5).map((c,i)=>({
      comp: c,
      data: points.map(p=> rptaRateFor(c.realPropertyId, p.dateKey)),
      color: RPTA_PALETTE[i%RPTA_PALETTE.length]
    }));
    // A competitor with zero data points for this meal plan (they simply don't offer it) is
    // dropped from the chart/legend entirely instead of drawing an invisible, all-gap line.
    const compSeries = compSeriesRaw.filter(cs=> cs.data.some(v=>v!=null));
    // My property is always the thicker, solid, unmistakably-mine series; every competitor is a
    // thinner dashed line (or a lighter bar) so the two never compete for attention.
    const datasets = [{
      label: 'My Property', data: myData,
      borderColor:'#3861fb', backgroundColor: styleIsBar ? '#3861fb' : 'rgba(56,97,251,.12)',
      borderWidth: styleIsBar ? 0 : 4, fill: !styleIsBar, tension:.35, pointRadius: styleIsBar?0:3,
      pointBackgroundColor:'#3861fb', order:0
    }];
    compSeries.forEach(cs=>{
      datasets.push({
        label: cs.comp.name, data: cs.data,
        borderColor: cs.color, backgroundColor: styleIsBar ? cs.color+'99' : 'transparent',
        borderWidth: styleIsBar ? 0 : 1.5, borderDash: styleIsBar ? undefined : [5,4],
        fill:false, tension:.35, pointRadius:0, order:1
      });
    });
    return { myData, compSeries, datasets };
  }

  function renderRptaKpis(myAvg, compAvgs){
    const planLabel = mealPlanFilter || 'All Plans';
    const channelLabel = rptaChannel ? (PORTALDATA.CHANNELS.find(c=>c.key===rptaChannel)||{}).label : 'all channels';

    // No data at all for my property under this meal plan — say so plainly instead of silently
    // showing a number that isn't really about the plan the buttons say is selected.
    if(myAvg==null){
      document.getElementById('rpta_kpis').innerHTML = `<div class="col-12">${
        PWIDGETS.emptyState('bi-slash-circle', `No ${planLabel} rooms`, `Your property doesn't have any ${planLabel} rate plans, so there's nothing to compare for this meal plan.`)
      }</div>`;
      return;
    }

    const marketAvg = compAvgs.length ? avgOf(compAvgs.map(c=>c.avg)) : null;
    const gapPct = marketAvg ? ((myAvg-marketAvg)/marketAvg*100) : null;
    const sorted = [...compAvgs].sort((a,b)=>b.avg-a.avg);
    const highest = sorted[0], lowest = sorted[sorted.length-1];

    document.getElementById('rpta_kpis').innerHTML = [
      PWIDGETS.kpiCard({icon:'bi-house-door-fill', color:'#3861fb', bg:'#eef4ff', label:`My 12-Mo. Avg (${planLabel})`, value:APP.fmtCurrency(myAvg),
        desc:`Your average ${planLabel} rate across the trailing 12 months, on ${channelLabel}.`}),
      PWIDGETS.kpiCard({icon:'bi-graph-up-arrow', color:'#8c5cf7', bg:'#f3eeff', label:'Market Average', value: marketAvg!=null?APP.fmtCurrency(marketAvg):'—',
        desc: marketAvg!=null ? `The average ${planLabel} rate across every tracked competitor, same 12-month window.` : `No tracked competitors offer ${planLabel}.`}),
      PWIDGETS.kpiCard({icon: (gapPct==null||gapPct<=0)?'bi-arrow-down-circle':'bi-arrow-up-circle', color: (gapPct==null||gapPct<=0)?'#12b76a':'#ff4d5e', bg: (gapPct==null||gapPct<=0)?'#e7faf1':'#fff0f1', label:'Your Gap vs. Market', value: gapPct!=null?`${gapPct>=0?'+':''}${gapPct.toFixed(1)}%`:'—',
        desc: gapPct==null ? 'No market data to compare against.' : gapPct<=0 ? 'You are priced below the market average.' : 'You are priced above the market average.'}),
      PWIDGETS.kpiCard({icon:'bi-arrow-up-circle', color:'#ff4d5e', bg:'#fff0f1', label:'Highest Competitor', value: highest?APP.fmtCurrency(highest.avg):'—',
        desc: highest ? `${highest.comp.name}, for ${planLabel}.` : `No tracked competitors offer ${planLabel}.`}),
      PWIDGETS.kpiCard({icon:'bi-arrow-down-circle', color:'#12b76a', bg:'#e7faf1', label:'Lowest Competitor', value: lowest?APP.fmtCurrency(lowest.avg):'—',
        desc: lowest ? `${lowest.comp.name}, for ${planLabel}.` : `No tracked competitors offer ${planLabel}.`}),
    ].join('');
  }

  function renderRpta(){
    const styleIsBar = rptaStyle === 'bar';
    const months = trailingMonths();
    const days = currentMonthDays();

    const yearly = rptaDatasets(months, styleIsBar);
    const myValid = yearly.myData.filter(v=>v!=null);
    const compAvgs = yearly.compSeries.map(cs=>({ comp:cs.comp, avg: avgOf(cs.data) }));
    renderRptaKpis(myValid.length ? avgOf(myValid) : null, compAvgs);

    const tooltipFmt = { plugins:{ tooltip:{ callbacks:{ label: ctx=>`${ctx.dataset.label}: ${APP.fmtCurrency(ctx.parsed.y)}` } }, legend:{ position:'bottom', labels:{ boxWidth:10, boxHeight:10 } } } };

    if(rptaYearChart) rptaYearChart.destroy();
    rptaYearChart = new Chart(document.getElementById('rpta_yearChart'), {
      type: styleIsBar ? 'bar' : 'line',
      data:{ labels: months.map(m=>m.label), datasets: yearly.datasets },
      options:{ responsive:true, interaction:{mode:'index', intersect:false}, animation:chartAnim(styleIsBar), ...tooltipFmt,
        scales:{ y:{ticks:{callback:v=>APP.fmtCurrency(v)}}, x:{grid:{display:false}} } }
    });

    const monthly = rptaDatasets(days, styleIsBar);
    if(rptaMonthChart) rptaMonthChart.destroy();
    rptaMonthChart = new Chart(document.getElementById('rpta_monthChart'), {
      type: styleIsBar ? 'bar' : 'line',
      data:{ labels: days.map(d=>d.label), datasets: monthly.datasets },
      options:{ responsive:true, interaction:{mode:'index', intersect:false}, animation:chartAnim(styleIsBar), ...tooltipFmt,
        scales:{ y:{ticks:{callback:v=>APP.fmtCurrency(v)}}, x:{grid:{display:false}} } }
    });
  }

  document.querySelectorAll('#rpta_mealPlanGroup button').forEach(btn=>{
    btn.addEventListener('click', function(){
      mealPlanFilter = this.dataset.plan;
      document.querySelectorAll('#rpta_mealPlanGroup button').forEach(b=>{ b.classList.remove('btn-outline-primary'); b.classList.add('btn-soft'); });
      this.classList.remove('btn-soft'); this.classList.add('btn-outline-primary');
      rcPage = 0;
      renderRpta();
      renderAll(); // the merged-in Room Comparison table/KPIs below share this same meal plan filter
    });
  });
  document.querySelectorAll('#rpta_chartStyleGroup button').forEach(btn=>{
    btn.addEventListener('click', function(){
      rptaStyle = this.dataset.style;
      document.querySelectorAll('#rpta_chartStyleGroup button').forEach(b=>{ b.classList.remove('btn-outline-primary'); b.classList.add('btn-soft'); });
      this.classList.remove('btn-soft'); this.classList.add('btn-outline-primary');
      renderRpta();
    });
  });
  document.getElementById('rpta_channel').addEventListener('change', function(){
    rptaChannel = this.value;
    renderRpta();
  });

  if(!myRooms.length){
    document.getElementById('rcKpis').innerHTML = `<div class="col-12">${PWIDGETS.emptyState('bi-door-closed','No rooms found','Add rooms to your property\'s Master Channel to use Room Rate Comparison.')}</div>`;
    document.getElementById('rptaCard').classList.add('d-none');
    return;
  }
  renderAll();
  renderRpta();
});
