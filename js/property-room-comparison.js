/* ==========================================================================
   Room Rate Comparison — per-room, per-rate-plan price comparison against
   mapped competitor rooms. Price comparison only: no occupancy/ADR/RevPAR/
   bookings/demand.

   Every card on this page (KPIs, Rate Plan Trend Analysis, Meal Plan
   Comparison, the Room Comparison table, Distribution, Ranking, History)
   reads from ONE shared filter state — Room, Channel, Meal Plan, Date Range —
   set in the single top filter bar. There used to be three separate channel
   selectors and a locally-scoped meal plan control on the Trend Analysis card
   that could disagree with the rest of the page; that's gone now, so nothing
   here can show conflicting numbers for the same underlying data.

   All rate figures are averaged over the selected date range (7D/14D/30D/
   90D/1Y) ending today — there's no more separate "current vs. average"
   toggle or single-date picker; the range control covers both.
   ========================================================================== */
let rcDistChart = null, rcMealPlanChart = null;
let rcAllRows = [];
let rcPage = 0;
const RC_PAGE_SIZE = 50;
let rcSort = { key:'compRate', dir:'asc' };

// Shared filter state — read by every render function below.
let mealPlanFilter = '';   // '' | EP | CP | MAP | AP
let rcDays = 14;           // 7 | 14 | 30 | 90 | 365
let rcChartStyle = 'bar';  // 'line' | 'bar' — applies to the Trend Analysis and Meal Plan Comparison charts; bar is the default view here

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
// Chart.js renders its own canvas text, which otherwise defaults to the browser's generic
// sans-serif stack instead of the page's actual font.
if(window.Chart) Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Comparison', subtitle:'Compare your rooms, rate plans, and channels against mapped competitors, all in one place.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  PWIDGETS.initTabbar('cmp_tabs');

  const channels = DB.channels.byProperty(propertyId);
  const master = channels.find(c=>c.type==='master');
  const myRooms = master ? DB.rooms.byChannel(master.id) : [];
  // Only the real properties your Company Admin actually assigned to you — same set as
  // Competitors/Rate Shopper/Market Intelligence.
  const compsAll = PORTALDATA.comparisonRealProperties().map(c=>({...c, group:'real'}));

  document.getElementById('rc_room').innerHTML += myRooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  document.getElementById('rc_channel').innerHTML += PORTALDATA.CHANNELS.map(c=>`<option value="${c.key}">${c.label}</option>`).join('');

  // ---- date-range helper: last `days` dates ending today ----
  function rangeDates(days){ return Array.from({length:days}).map((_,d)=> PORTALDATA.dateKeyOffset(d - (days-1))); }
  function avgOf(vals){
    const nums = vals.filter(v=>v!=null);
    return nums.length ? Math.round(nums.reduce((a,b)=>a+b,0)/nums.length) : null;
  }
  // Pick the rate plan a room's price should be read from — honoring the Meal Plan filter.
  // When a meal plan is selected and the room has no matching plan, returns null (skip this
  // room) instead of silently falling back to a different plan, which would misrepresent the
  // room as offering a meal plan it doesn't.
  function pickPlan(plans, mealPlan){
    if(!plans.length) return null;
    if(!mealPlan) return plans[0];
    return plans.find(p=>p.mealPlan===mealPlan) || null;
  }
  // Direct stays the exact stored price (no invented markup/jitter); every OTA channel gets its
  // real markdown/markup + jitter via PORTALDATA.channelRate, same as everywhere else on the page.
  function rateOnChannel(raw, channelKey){
    return channelKey==='direct' ? raw : PORTALDATA.channelRate(raw, channelKey, PORTALDATA.dateKeyOffset(0));
  }

  // ---- "My Rate" for a room, averaged over the selected date range, honoring the Meal Plan
  // and Channel filters. Returns null if the room has no rate plan matching the Meal Plan filter. ----
  function myRoomRate(room, channelFilter){
    const rp = pickPlan(DB.ratePlans.byRoom(room.id), mealPlanFilter);
    if(!rp) return null;
    const baseFor = dk=>{ const day = DB.rates.forPlan(rp.id)[dk]; return day ? day.price : room.basePrice; };
    const raw = avgOf(rangeDates(rcDays).map(baseFor));
    if(raw==null) return null;
    return channelFilter ? PORTALDATA.channelRate(raw, channelFilter, PORTALDATA.dateKeyOffset(0)) : raw;
  }

  // ---- Resolve a competitor's mapped room for one of ours via the same Room Mapping system
  // Rate Matrix uses (MAPPING.ensureAutoMapped/evaluate) — fuzzy name-similarity auto-matching
  // that self-heals on load, instead of requiring an exact room-name match. ----
  function mappedCompRoom(comp, room){
    MAPPING.ensureAutoMapped(propertyId, comp.realPropertyId);
    const ev = MAPPING.evaluate(propertyId, comp.realPropertyId);
    const entry = ev.rooms.find(r=>r.ourRoom.id===room.id);
    return entry && entry.compRoom ? entry.compRoom : null;
  }

  // ---- Competitor's matched-room rate for a specific room, averaged over the date range,
  // honoring the Meal Plan and Channel filters. ----
  function compRoomRate(comp, room, channelFilter){
    const compRoom = mappedCompRoom(comp, room);
    if(!compRoom) return null;
    const compPlan = pickPlan(DB.ratePlans.byRoom(compRoom.id), mealPlanFilter);
    if(!compPlan) return null;
    const baseFor = dk=>{ const day = DB.rates.forPlan(compPlan.id)[dk]; return day ? day.price : compRoom.basePrice; };
    const raw = avgOf(rangeDates(rcDays).map(baseFor));
    if(raw==null) return null;
    return channelFilter ? PORTALDATA.channelRate(raw, channelFilter, PORTALDATA.dateKeyOffset(0)) : raw;
  }

  // ---- Build the flat comparison-row dataset for the currently selected filters ----
  function buildRows(channelFilter){
    // "All Channels" (no filter) shows every channel's price side by side, one row per channel,
    // instead of silently collapsing to the Direct rate — otherwise "All Channels" behaved
    // exactly like picking Direct, which isn't what that option implies.
    const channelsToShow = channelFilter ? [channelFilter] : PORTALDATA.CHANNELS.map(c=>c.key);
    const rows = [];
    myRooms.forEach(room=>{
      let plans = DB.ratePlans.byRoom(room.id);
      if(mealPlanFilter) plans = plans.filter(p=>p.mealPlan===mealPlanFilter);
      plans.forEach(rp=>{
        const myBaseFor = dk=>{ const d=DB.rates.forPlan(rp.id)[dk]; return d ? d.price : room.basePrice; };
        const myRaw = avgOf(rangeDates(rcDays).map(myBaseFor));
        if(myRaw==null) return;

        compsAll.forEach(comp=>{
          const compRoom = mappedCompRoom(comp, room);
          if(!compRoom) return;
          const compPlans = DB.ratePlans.byRoom(compRoom.id);
          const compPlan = compPlans.find(p=>p.mealPlan===rp.mealPlan) || compPlans[0];
          if(!compPlan) return;
          const baseFor = dk=>{ const d=DB.rates.forPlan(compPlan.id)[dk]; return d ? d.price : compRoom.basePrice; };
          const raw = avgOf(rangeDates(rcDays).map(baseFor));
          if(raw==null) return;
          const compRoomName = compRoom.name;
          const ratePlanName = compPlan.name;
          const lastUpdated = compPlan.createdAt || PORTALDATA.dateKeyOffset(0);

          channelsToShow.forEach(channelKey=>{
            const myRate = rateOnChannel(myRaw, channelKey);
            const compRate = rateOnChannel(raw, channelKey);
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
    });
    return rows;
  }

  function applyFilters(rows){
    const roomId = document.getElementById('rc_room').value;
    const search = document.getElementById('rc_search').value.trim().toLowerCase();
    return rows.filter(r=>{
      if(roomId && r.myRoomId !== roomId) return false;
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
  // visible while scrolling through competitor rows below. ----
  function buildFrozenRows(channelFilter){
    const roomId = document.getElementById('rc_room').value;
    const rooms = roomId ? myRooms.filter(r=>r.id===roomId) : myRooms;
    const rows = [];
    rooms.forEach(room=>{
      let plans = DB.ratePlans.byRoom(room.id);
      if(mealPlanFilter) plans = plans.filter(p=>p.mealPlan===mealPlanFilter);
      plans.forEach(rp=>{
        const myBaseFor = dk=>{ const d=DB.rates.forPlan(rp.id)[dk]; return d ? d.price : room.basePrice; };
        const myRaw = avgOf(rangeDates(rcDays).map(myBaseFor));
        if(myRaw==null) return;
        const myRate = channelFilter ? PORTALDATA.channelRate(myRaw, channelFilter, PORTALDATA.dateKeyOffset(0)) : myRaw;
        rows.push({ roomName:room.name, ratePlanName:rp.name, myRate });
      });
    });
    return rows;
  }

  function renderKpis(filteredRows, channelFilter){
    const roomsInScope = focusRooms();
    const myRatesUnique = roomsInScope.map(r=> myRoomRate(r, channelFilter));
    const ourAvg = avgOf(myRatesUnique) || 0;
    const compRates = filteredRows.map(r=>r.compRate);
    const compAvg = avgOf(compRates) || 0;
    const cheaper = filteredRows.filter(r=>r.position==='lower').length;
    const pricier = filteredRows.filter(r=>r.position==='higher').length;
    const rangeLabel = rcDays===365 ? '1 year' : `${rcDays} days`;

    document.getElementById('rcKpis').innerHTML = [
      PWIDGETS.kpiCard({icon:'bi-house-door-fill', color:'#3861fb', bg:'#eef4ff', label:'Our Avg. Rate', value:APP.fmtCurrency(ourAvg),
        desc:`Average rate over the last ${rangeLabel}, across the rooms in scope, on the selected channel.`}),
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

    const channelFilter = document.getElementById('rc_channel').value;
    const frozenRows = buildFrozenRows(channelFilter);
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
  // "All Rooms" is chosen. ----
  function focusRooms(){
    const roomId = document.getElementById('rc_room').value;
    if(roomId){ const r = myRooms.find(x=>x.id===roomId); return r ? [r] : []; }
    return myRooms;
  }

  function topCompetitorsForRoom(room, channelFilter, limit){
    const list = compsAll.map(c=>{
      const rate = compRoomRate(c, room, channelFilter);
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
    inner.style.height = Math.max(200, barGroupCount * perGroupPx) + 'px';
  }

  function renderDistribution(channelFilter){
    const rooms = focusRooms();
    const wrap = document.getElementById('rc_distChartWrap');
    if(!rooms.length){ wrap.innerHTML = PWIDGETS.emptyState('bi-door-closed','No rooms','Nothing to compare for the current filters.'); return; }
    if(!document.getElementById('rc_distChart')){ wrap.innerHTML = `<div id="rc_distChartInner"><canvas id="rc_distChart"></canvas></div>`; }

    if(rooms.length === 1){
      const room = rooms[0];
      const myRate = myRoomRate(room, channelFilter);
      const top5 = topCompetitorsForRoom(room, channelFilter, 5);
      if(myRate==null && !top5.length){
        wrap.innerHTML = PWIDGETS.emptyState('bi-slash-circle', `No ${mealPlanFilter||'matching'} rate data`, 'Try a different meal plan or room.');
        return;
      }
      const labels = ['My Room', ...top5.map(t=>t.comp.name)];
      const data = [myRate, ...top5.map(t=>t.rate)];
      const colors = ['#3861fb', ...top5.map((_,i)=>['#a9b0c9','#9fd6ca','#c3aee8','#f2c194','#e6a8c4'][i%5])];
      setDistChartHeight(labels.length, 36);
      if(rcDistChart) rcDistChart.destroy();
      rcDistChart = new Chart(document.getElementById('rc_distChart'), {
        type:'bar',
        data:{ labels, datasets:[{ data, backgroundColor:colors, borderRadius:6 }] },
        options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, animation:chartAnim(true), plugins:{legend:{display:false}}, scales:{x:{ticks:{callback:v=>v!=null?APP.fmtCurrency(v):''}}} }
      });
      return;
    }

    // "All Rooms": grouped bars per room — My Rate vs Market Average for that room.
    const labels = rooms.map(r=>r.name);
    const myData = rooms.map(r=> myRoomRate(r, channelFilter));
    const marketData = rooms.map(r=>{
      const rates = compsAll.map(c=>compRoomRate(c, r, channelFilter)).filter(v=>v!=null);
      return avgOf(rates);
    });
    setDistChartHeight(labels.length, 52);
    if(rcDistChart) rcDistChart.destroy();
    rcDistChart = new Chart(document.getElementById('rc_distChart'), {
      type: 'bar', // horizontal comparison always reads best as bars
      data:{ labels, datasets:[
        { label:'My Rate', data:myData, backgroundColor:'#3861fb', borderRadius:6 },
        { label:'Market Avg', data:marketData, backgroundColor:'#c3aee8', borderRadius:6 }
      ]},
      options:{ indexAxis:'y', responsive:true, maintainAspectRatio:false, animation:chartAnim(true), plugins:{legend:{position:'bottom'}}, scales:{x:{ticks:{callback:v=>v!=null?APP.fmtCurrency(v):''}}} }
    });
  }

  function renderRanking(channelFilter){
    const rooms = focusRooms();
    if(!rooms.length){ document.getElementById('rc_rankTable').innerHTML = ''; return; }

    let list = [];
    rooms.forEach(room=>{
      const myRate = myRoomRate(room, channelFilter);
      compsAll.forEach(c=>{
        const rate = compRoomRate(c, room, channelFilter);
        if(rate!=null) list.push({ name:c.name, roomName:room.name, rate, isMe:false });
      });
      if(myRate!=null) list.push({ name:'My Property', roomName:room.name, rate:myRate, isMe:true });
    });
    list.sort((a,b)=>a.rate-b.rate);
    if(rooms.length > 1) list = list.slice(0, 25); // cap the combined view to a readable top slice

    const myRateLookup = new Map(rooms.map(r=>[r.name, myRoomRate(r, channelFilter)]));

    document.getElementById('rc_rankTable').innerHTML = `
      <thead><tr><th>Rank</th><th>Property</th><th>Room</th><th>Avg. Rate</th><th>Difference vs. Mine</th></tr></thead>
      <tbody>${list.map((r,i)=>{
        const myRateForRow = myRateLookup.get(r.roomName);
        const diff = myRateForRow!=null ? r.rate - myRateForRow : null;
        return `<tr class="${r.isMe?'fw-bold':''}" style="${r.isMe?'background:var(--brand-50)':''}">
          <td>#${i+1}</td>
          <td>${r.isMe?'<i class="bi bi-star-fill me-1" style="color:var(--brand-500)"></i>':''}${r.name}</td>
          <td>${r.roomName}</td>
          <td class="fw-semibold">${APP.fmtCurrency(r.rate)}</td>
          <td class="${diff==null?'':diff>=0?'text-danger':'text-success'}">${r.isMe?'—':diff==null?'—':`${diff>=0?'+':''}${APP.fmtCurrency(diff)}`}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="5" class="text-center text-muted py-3">No data</td></tr>`}</tbody>`;
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
    const channelFilter = document.getElementById('rc_channel').value;
    rcAllRows = buildRows(channelFilter);
    const filtered = renderTable();
    renderKpis(filtered, channelFilter);
    renderDistribution(channelFilter);
    renderRanking(channelFilter);
  }

  ['rc_room','rc_channel'].forEach(id=>{
    document.getElementById(id).addEventListener('input', ()=>{ rcPage = 0; renderAll(); });
  });
  document.getElementById('rc_search').addEventListener('input', ()=>{ rcPage = 0; renderTable(); });
  document.getElementById('rc_prevPage').addEventListener('click', ()=>{ rcPage--; renderTable(); });
  document.getElementById('rc_nextPage').addEventListener('click', ()=>{ rcPage++; renderTable(); });
  document.getElementById('rc_exportCsv').addEventListener('click', exportCsv);
  document.getElementById('rc_exportExcel').addEventListener('click', ()=> APP.toast('Export Started', 'Your Excel workbook is being prepared for download.', 'success'));
  document.getElementById('rc_print').addEventListener('click', ()=> window.print());

  // Edge hover-scroll — hover near an edge of the Room Comparison table and it scrolls smoothly
  // toward it for as long as the cursor stays there, same interaction as Rate Shopper's Rate
  // Matrix/Rate Parity grids. #rc_tableWrap itself is never rebuilt (only #rc_table's innerHTML
  // is, on every renderTable()), so it's safe to grab once rather than re-querying per frame.
  (function wireEdgeScroll(){
    const wrap = document.getElementById('rc_tableWrap');
    const zones = [
      { el:document.getElementById('rc_edgeUp'),    dx:0,  dy:-9 },
      { el:document.getElementById('rc_edgeDown'),  dx:0,  dy:9  },
      { el:document.getElementById('rc_edgeLeft'),  dx:-9, dy:0  },
      { el:document.getElementById('rc_edgeRight'), dx:9,  dy:0  },
    ];
    let raf = null;
    function tick(dx, dy){
      wrap.scrollBy({ left:dx, top:dy });
      raf = requestAnimationFrame(()=> tick(dx, dy));
    }
    zones.forEach(z=>{
      if(!z.el) return;
      z.el.addEventListener('mouseenter', ()=>{
        z.el.classList.add('is-active');
        cancelAnimationFrame(raf);
        tick(z.dx, z.dy);
      });
      z.el.addEventListener('mouseleave', ()=>{
        z.el.classList.remove('is-active');
        cancelAnimationFrame(raf);
        raf = null;
      });
    });
  })();

  /* ======================================================================
     Rate Plan Trend Analysis — meal-plan-scoped (All Plans/EP/CP/MAP/AP) rate
     vs. market, driven entirely by the shared top filter bar.
     ====================================================================== */
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

  // Meal-plan rate, then the Channel filter's markup/markdown on top. Returns null when the
  // property/competitor has no rooms on this meal plan at all (see mealPlanRateOnDate).
  function rptaRateFor(pid, dateKey){
    const base = PORTALDATA.mealPlanRateOnDate(pid, mealPlanFilter, dateKey);
    if(base==null) return null;
    const channelFilter = document.getElementById('rc_channel').value;
    return channelFilter ? PORTALDATA.channelRate(base, channelFilter, dateKey) : base;
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
    const channelFilter = document.getElementById('rc_channel').value;
    const channelLabel = channelFilter ? (PORTALDATA.CHANNELS.find(c=>c.key===channelFilter)||{}).label : 'all channels';

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
    const styleIsBar = rcChartStyle === 'bar';
    const months = trailingMonths();
    const days = currentMonthDays();

    const yearly = rptaDatasets(months, styleIsBar);
    const myValid = yearly.myData.filter(v=>v!=null);
    const compAvgs = yearly.compSeries.map(cs=>({ comp:cs.comp, avg: avgOf(cs.data) })).filter(c=>c.avg!=null);
    renderRptaKpis(myValid.length ? avgOf(myValid) : null, compAvgs);

    const tooltipFmt = { plugins:{ tooltip:{ callbacks:{ label: ctx=>`${ctx.dataset.label}: ${ctx.parsed.y!=null?APP.fmtCurrency(ctx.parsed.y):'—'}` } }, legend:{ position:'bottom', labels:{ boxWidth:10, boxHeight:10 } } } };

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

  /* ======================================================================
     Meal Plan Rate Comparison — All Properties: a single compact chart
     showing the average rate for EACH meal plan (EP/CP/MAP/AP), My Property
     vs. every tracked competitor, over the selected date range/channel/room.
     Independent of the Meal Plan filter (it always shows all four plans side
     by side) so you can see plan-by-plan positioning without switching the
     filter back and forth.
     ====================================================================== */
  function renderMealPlanComparison(channelFilter){
    const plans = DB.MEAL_PLANS; // ['EP','CP','MAP','AP']
    const isBar = rcChartStyle === 'bar';

    function avgForPlan(pid, plan){
      const vals = rangeDates(rcDays).map(dk=>{
        const base = PORTALDATA.mealPlanRateOnDate(pid, plan, dk);
        if(base==null) return null;
        return channelFilter ? PORTALDATA.channelRate(base, channelFilter, dk) : base;
      });
      return avgOf(vals);
    }

    const myData = plans.map(p=> avgForPlan(propertyId, p));
    const compSeries = compsAll.slice(0,5).map((c,i)=>({
      comp:c, data: plans.map(p=> avgForPlan(c.realPropertyId, p)),
      color: RPTA_PALETTE[i%RPTA_PALETTE.length]
    })).filter(cs=> cs.data.some(v=>v!=null));

    const datasets = [
      { label:'My Property', data:myData, backgroundColor:'#3861fb', borderColor:'#3861fb', borderRadius: isBar?6:0, borderWidth: isBar?0:3, fill:false, tension:.3 },
      ...compSeries.map(cs=>({ label:cs.comp.name, data:cs.data, backgroundColor:cs.color, borderColor:cs.color, borderRadius: isBar?6:0, borderWidth: isBar?0:2, fill:false, tension:.3 }))
    ];

    if(rcMealPlanChart) rcMealPlanChart.destroy();
    rcMealPlanChart = new Chart(document.getElementById('rc_mealPlanChart'), {
      type: isBar ? 'bar' : 'line',
      data:{ labels: plans, datasets },
      options:{
        responsive:true, animation:chartAnim(isBar),
        plugins:{ legend:{position:'bottom', labels:{boxWidth:10,boxHeight:10}}, tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.parsed.y!=null?APP.fmtCurrency(ctx.parsed.y):'No data'}`}} },
        scales:{ y:{ticks:{callback:v=>APP.fmtCurrency(v)}} }
      }
    });
  }

  /* ======================================================================
     Shared filter bar wiring
     ====================================================================== */
  document.querySelectorAll('#rc_mealPlanGroup button').forEach(btn=>{
    btn.addEventListener('click', function(){
      mealPlanFilter = this.dataset.plan;
      document.querySelectorAll('#rc_mealPlanGroup button').forEach(b=>{ b.classList.remove('btn-outline-primary'); b.classList.add('btn-soft'); });
      this.classList.remove('btn-soft'); this.classList.add('btn-outline-primary');
      rcPage = 0;
      renderRpta();
      renderAll();
    });
  });
  document.querySelectorAll('#rc_rangeGroup button').forEach(btn=>{
    btn.addEventListener('click', function(){
      rcDays = Number(this.dataset.days);
      document.querySelectorAll('#rc_rangeGroup button').forEach(b=>{ b.classList.remove('btn-outline-primary'); b.classList.add('btn-soft'); });
      this.classList.remove('btn-soft'); this.classList.add('btn-outline-primary');
      rcPage = 0;
      renderAll();
      renderMealPlanComparison(document.getElementById('rc_channel').value);
    });
  });
  document.querySelectorAll('#rc_chartStyleGroup button').forEach(btn=>{
    btn.addEventListener('click', function(){
      rcChartStyle = this.dataset.style;
      document.querySelectorAll('#rc_chartStyleGroup button').forEach(b=>{ b.classList.remove('btn-outline-primary'); b.classList.add('btn-soft'); });
      this.classList.remove('btn-soft'); this.classList.add('btn-outline-primary');
      renderRpta();
      renderMealPlanComparison(document.getElementById('rc_channel').value);
    });
  });
  // The top Channel/Room selectors also drive the Trend Analysis and Meal Plan Comparison charts.
  document.getElementById('rc_channel').addEventListener('input', ()=>{ renderRpta(); renderMealPlanComparison(document.getElementById('rc_channel').value); });
  document.getElementById('rc_room').addEventListener('input', ()=>{ renderRpta(); });

  /* ======================================================================
     Tab switching — Room Rate Comparison / Rate Plan Trend Analysis / Channel Comparison.
     Chart.js can't size a canvas that was hidden (display:none) at creation time, so each
     tab's charts are re-rendered (destroy + recreate) the first time its tab becomes visible
     rather than only resized.
     ====================================================================== */
  document.querySelectorAll('#cmp_tabs .nav-link').forEach(btn=>{
    btn.addEventListener('click', function(){
      document.querySelectorAll('#cmp_tabs .nav-link').forEach(b=>b.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('cmp_tabRooms').classList.toggle('d-none', this.dataset.tab!=='rooms');
      document.getElementById('cmp_tabTrend').classList.toggle('d-none', this.dataset.tab!=='trend');
      document.getElementById('cmp_tabValueProp').classList.toggle('d-none', this.dataset.tab!=='valueprop');
      document.getElementById('cmp_tabChannels').classList.toggle('d-none', this.dataset.tab!=='channels');
      if(this.dataset.tab==='trend'){ renderRpta(); renderMealPlanComparison(document.getElementById('rc_channel').value); }
      if(this.dataset.tab==='valueprop'){ renderValueProposition(propertyId, compsAll, PORTALDATA.dateKeyOffset(0)); }
      if(this.dataset.tab==='channels'){ renderChannelAnalysis(propertyId); }
    });
  });

  if(!myRooms.length){
    document.getElementById('rcKpis').innerHTML = `<div class="col-12">${PWIDGETS.emptyState('bi-door-closed','No rooms found','Add rooms to your property\'s Master Channel to use Room Rate Comparison.')}</div>`;
    document.getElementById('rptaCard').classList.add('d-none');
    return;
  }
  renderAll();
  renderRpta();
  renderMealPlanComparison('');
  renderValueProposition(propertyId, compsAll, PORTALDATA.dateKeyOffset(0));
  renderChannelAnalysis(propertyId);
});

/* ==========================================================================
   Channel Performance — moved here from Market Intelligence, which duplicated this exact
   per-channel/room-parity breakdown right alongside its own Channel Analysis. Room Rate
   Comparison is the Analysis-stage home for per-room/per-channel breakdowns, so this belongs
   here rather than in Forecast & Actions (which is now Forecast/Action Center only).
   ========================================================================== */
/* ==========================================================================
   Value Proposition Analysis — moved here from Market Intelligence (which is now
   Forecast & Actions). Two separate, independent readings instead of one forced composite
   number:
   • Value Score — normalized 0-100 quality score from Amenity Score, Meal Plan Quality,
     Cancellation Flexibility, and Room Size (each normalized against the highest value seen in
     this comparison set, so it's always relative to your actual competitors, not an arbitrary
     fixed scale).
   • Price Position — your rate vs. the average of your mapped competitors, as a plain %.
   Kept as two numbers on purpose: "how good is it" and "how expensive is it" answer different
   questions, and collapsing them into one score hides which one is actually driving the result.
   ========================================================================== */
let vpChart = null;
const VP_WEIGHTS = { amenity:0.3, mealPlan:0.3, cancellation:0.2, roomSize:0.2 };
function renderValueProposition(propertyId, comps, today){
  const mealRank = { EP:0, CP:1, MAP:2, AP:3 };

  function rawProfile(pid){
    const p = DB.properties.get(pid);
    const amenities = (p && p.amenities) ? p.amenities.length : 0;
    const channels = DB.channels.byProperty(pid);
    const master = channels.find(c=>c.type==='master');
    const rooms = master ? DB.rooms.byChannel(master.id) : [];
    const plans = rooms.flatMap(r=>DB.ratePlans.byRoom(r.id));
    const refundablePct = plans.length ? Math.round(plans.filter(pl=>pl.refundable).length/plans.length*100) : 0;
    const mealPlanAvgRank = plans.length ? plans.reduce((s,pl)=>s+(mealRank[pl.mealPlan]||0),0)/plans.length : 0; // 0..3
    const roomsWithSize = rooms.filter(r=>r.size);
    const avgRoomSize = roomsWithSize.length ? Math.round(roomsWithSize.reduce((s,r)=>s+r.size,0)/roomsWithSize.length) : 0;
    return { amenities, refundablePct, mealPlanAvgRank, avgRoomSize };
  }

  const rows = [{ name:'My Property', isMe:true, rate:PORTALDATA.myRateOnDate(propertyId, today), ...rawProfile(propertyId) }];
  comps.forEach(c=>{
    rows.push({ name:c.name, isMe:false, rate:PORTALDATA.competitorRateOnDate(c, today), ...rawProfile(c.realPropertyId) });
  });

  // Normalize each raw factor against the max seen across THIS comparison set — so the score
  // always reflects standing relative to your actual competitors, not a fixed/arbitrary scale.
  const maxAmenities = Math.max(1, ...rows.map(r=>r.amenities));
  const maxRoomSize = Math.max(1, ...rows.map(r=>r.avgRoomSize));
  const haveRoomSize = maxRoomSize > 1;

  rows.forEach(r=>{
    const amenityScore = (r.amenities/maxAmenities)*100;
    const mealPlanQuality = (r.mealPlanAvgRank/3)*100;
    const cancellationFlexibility = r.refundablePct;
    const roomSizeScore = haveRoomSize ? (r.avgRoomSize/maxRoomSize)*100 : null;
    // If no property in the set has room-size data, drop that weight and re-normalize the rest
    // rather than silently scoring everyone 0 on a factor nobody actually has data for.
    const parts = [
      { w:VP_WEIGHTS.amenity, v:amenityScore },
      { w:VP_WEIGHTS.mealPlan, v:mealPlanQuality },
      { w:VP_WEIGHTS.cancellation, v:cancellationFlexibility },
      ...(roomSizeScore!=null ? [{ w:VP_WEIGHTS.roomSize, v:roomSizeScore }] : [])
    ];
    const totalW = parts.reduce((s,p)=>s+p.w,0);
    r.valueScore = Math.round(parts.reduce((s,p)=>s+p.w*p.v,0)/totalW);
    r.amenityScore = Math.round(amenityScore); r.mealPlanQuality = Math.round(mealPlanQuality); r.roomSizeScore = roomSizeScore!=null?Math.round(roomSizeScore):null;
  });

  const compRates = comps.map(c=>PORTALDATA.competitorRateOnDate(c, today));
  const compAvg = compRates.length ? Math.round(compRates.reduce((a,b)=>a+b,0)/compRates.length) : null;
  rows.forEach(r=>{ r.pricePositionPct = compAvg ? Math.round(((r.rate-compAvg)/compAvg)*1000)/10 : null; });

  const ranked = [...rows].sort((a,b)=>b.valueScore-a.valueScore);
  const myRank = ranked.findIndex(r=>r.isMe) + 1;
  const mine = rows[0];

  document.getElementById('vp_summary').textContent = mine.pricePositionPct!=null
    ? `Value Score rank: #${myRank} of ${rows.length}. Price Position: ${mine.pricePositionPct>=0?'+':''}${mine.pricePositionPct}% vs. the ${comps.length}-competitor average — Value Score is quality (amenities, meal plan, flexibility, room size) normalized 0-100; Price Position is purely how your rate compares.`
    : `Value Score rank: #${myRank} of ${rows.length}. Add comparison properties to see Price Position.`;

  if(vpChart) vpChart.destroy();
  vpChart = new Chart(document.getElementById('vp_chart'), {
    type:'bar',
    data:{ labels: ranked.map(r=>r.name), datasets:[{ label:'Value Score', data: ranked.map(r=>r.valueScore), backgroundColor: ranked.map(r=>r.isMe?'#3861fb':'#c3aee8'), borderRadius:5 }] },
    options:{ indexAxis:'y', responsive:true, animation:chartAnim(true), plugins:{legend:{display:false},
      tooltip:{callbacks:{label:ctx=>`Value Score: ${ctx.parsed.x}/100`}}}, scales:{x:{min:0,max:100,ticks:{precision:0}}} }
  });

  function pricePositionCell(pct){
    if(pct==null) return '<span class="text-muted">—</span>';
    const cls = pct>0 ? 'text-danger' : pct<0 ? 'text-success' : 'text-muted';
    const label = pct>0 ? 'above avg' : pct<0 ? 'below avg' : 'at avg';
    return `<span class="${cls} fw-semibold">${pct>=0?'+':''}${pct}% ${label}</span>`;
  }

  document.getElementById('vp_table').innerHTML = `
    <thead><tr><th>Property</th><th class="text-end">Rate</th><th class="text-center">Value Score</th><th class="text-center">Price Position</th></tr></thead>
    <tbody>${ranked.map(r=>`<tr class="${r.isMe?'rc-frozen-row':''}">
      <td class="fw-semibold">${r.isMe?'<i class="bi bi-star-fill me-1" style="color:var(--brand-500)"></i>':''}${r.name}</td>
      <td class="text-end">${APP.fmtCurrency(r.rate)}</td>
      <td class="text-center fw-bold">${r.valueScore}/100</td>
      <td class="text-center">${pricePositionCell(r.pricePositionPct)}</td>
    </tr>`).join('')}</tbody>`;
}

let caChart = null;
function renderChannelAnalysis(propertyId){
  const todayKey = DB.fmtDate(new Date());
  const channels = DB.channels.byProperty(propertyId);
  const master = channels.find(c=>c.type==='master');

  function channelAvgRateOnDate(channelId, dateKey){
    const rooms = DB.rooms.byChannel(channelId);
    let sum = 0, count = 0;
    rooms.forEach(room=>{
      DB.ratePlans.byRoom(room.id).forEach(rp=>{
        const day = DB.rates.forPlan(rp.id)[dateKey];
        sum += day ? day.price : room.basePrice;
        count++;
      });
    });
    return count ? Math.round(sum/count) : null;
  }

  const WINDOW_DAYS = 30;
  const directCurrent = master ? channelAvgRateOnDate(master.id, todayKey) : null;

  const channelMetrics = channels.map(ch=>{
    const series = [];
    for(let d=0; d<WINDOW_DAYS; d++){
      const dk = DB.fmtDate(new Date(Date.now()+d*86400000));
      const rate = channelAvgRateOnDate(ch.id, dk);
      if(rate!=null) series.push(rate);
    }
    const current = channelAvgRateOnDate(ch.id, todayKey);
    const lowest = series.length ? Math.min(...series) : null;
    const highest = series.length ? Math.max(...series) : null;
    const average = series.length ? Math.round(series.reduce((a,b)=>a+b,0)/series.length) : null;
    const diff = (current!=null && directCurrent!=null) ? current-directCurrent : null;
    return { channel: ch, current, lowest, highest, average, diff };
  });

  document.getElementById('channelCards').innerHTML = channelMetrics.map(m=>{
    const meta = DB.CHANNEL_TYPES[m.channel.type] || DB.CHANNEL_TYPES.custom;
    return `<div class="col-md-6 col-xl-4">
      <div class="channel-perf-card">
        <div class="d-flex align-items-center gap-2 mb-2">
          <i class="bi ${meta.icon}" style="color:${meta.color}"></i>
          <span class="fw-bold" style="font-size:.9rem">${m.channel.name}</span>
          <span class="text-muted" style="font-size:.68rem">#${m.channel.channelCode}</span>
          ${m.channel.id===(master&&master.id) ? '<span class="badge bg-primary-subtle text-primary ms-auto" style="font-size:.6rem">Direct</span>' : ''}
        </div>
        <div class="kv-row"><span class="k">Current Rate</span><span class="v fw-semibold">${m.current!=null?APP.fmtCurrency(m.current):'—'}</span></div>
        <div class="kv-row"><span class="k">Lowest Rate</span><span class="v">${m.lowest!=null?APP.fmtCurrency(m.lowest):'—'}</span></div>
        <div class="kv-row"><span class="k">Highest Rate</span><span class="v">${m.highest!=null?APP.fmtCurrency(m.highest):'—'}</span></div>
        <div class="kv-row"><span class="k">Average Rate</span><span class="v">${m.average!=null?APP.fmtCurrency(m.average):'—'}</span></div>
        <div class="kv-row"><span class="k">Rate Difference</span><span class="v ${m.diff==null?'':m.diff>0?'text-danger':m.diff<0?'text-success':''}">${m.diff==null?'—':`${m.diff>=0?'+':''}${APP.fmtCurrency(m.diff)}`}</span></div>
        <div class="kpi-desc">Current/Lowest/Highest/Average are this channel's rate today vs. over the next 30 days. Difference compares it to your Direct rate today.</div>
      </div>
    </div>`;
  }).join('');

  if(caChart) caChart.destroy();
  caChart = new Chart(document.getElementById('channelRateChart'), {
    type:'bar',
    data:{
      labels: channelMetrics.map(m=>m.channel.name),
      datasets:[{label:'Current Rate', data: channelMetrics.map(m=>m.current||0), backgroundColor: channelMetrics.map(m=>(DB.CHANNEL_TYPES[m.channel.type]||DB.CHANNEL_TYPES.custom).color), borderRadius:6}]
    },
    options:{ responsive:true, plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
  });

  const otaChannelsAll = channels.filter(c=>c.id !== (master && master.id));
  const myRoomsAll = master ? DB.rooms.byChannel(master.id) : [];

  document.getElementById('ca_room').innerHTML = `<option value="">All Rooms</option>` + myRoomsAll.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  document.getElementById('ca_channel').innerHTML = `<option value="">All Channels (OTA Avg.)</option>` + otaChannelsAll.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');

  function renderParityTable(){
    const roomFilter = document.getElementById('ca_room').value;
    const channelFilter = document.getElementById('ca_channel').value;
    const otaChannels = channelFilter ? otaChannelsAll.filter(c=>c.id===channelFilter) : otaChannelsAll;
    const rows = [];

    if(master){
      myRoomsAll.filter(room=> !roomFilter || room.id===roomFilter).forEach(room=>{
        DB.ratePlans.byRoom(room.id).forEach(rp=>{
          const directData = DB.rates.forPlan(rp.id)[todayKey];
          const directRate = directData ? directData.price : room.basePrice;

          const channelRates = [{ label: master.name, rate: directRate }];
          otaChannels.forEach(chan=>{
            const matchRoom = DB.rooms.byChannel(chan.id).find(r=> r.name===room.name);
            if(!matchRoom) return;
            const plans = DB.ratePlans.byRoom(matchRoom.id);
            const matchPlan = plans.find(p=> p.mealPlan===rp.mealPlan) || plans[0];
            if(!matchPlan) return;
            const dayData = DB.rates.forPlan(matchPlan.id)[todayKey];
            channelRates.push({ label: chan.name, rate: dayData ? dayData.price : matchRoom.basePrice });
          });

          const otaRates = channelRates.filter(c=>c.label!==master.name);
          const otaAvg = otaRates.length ? Math.round(otaRates.reduce((s,c)=>s+c.rate,0)/otaRates.length) : null;
          const diff = otaAvg!=null ? otaAvg-directRate : null;
          const cheapest = channelRates.reduce((min,c)=> c.rate<min.rate?c:min, channelRates[0]);
          const priciest = channelRates.reduce((max,c)=> c.rate>max.rate?c:max, channelRates[0]);

          let status, statusClass;
          if(!otaRates.length){ status='No OTA Data'; statusClass='badge-inactive'; }
          else if(cheapest.label===master.name){ status='At Parity'; statusClass='badge-active'; }
          else { status='Undercut'; statusClass='badge-inactive'; }

          rows.push({ room, rp, directRate, otaAvg, diff, cheapest, priciest, status, statusClass });
        });
      });
    }

    const otaRateLabel = channelFilter ? (otaChannelsAll.find(c=>c.id===channelFilter)||{}).name+' Rate' : 'OTA Rate (Avg.)';
    document.getElementById('parityTable').innerHTML = `
      <thead><tr><th>Room</th><th>Rate Plan</th><th>Direct Rate</th><th>${otaRateLabel}</th><th>Difference</th><th>Cheapest Channel</th><th>Most Expensive Channel</th><th>Parity Status</th></tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td class="fw-semibold">${r.room.name}</td>
        <td>${r.rp.name}</td>
        <td class="fw-semibold">${APP.fmtCurrency(r.directRate)}</td>
        <td>${r.otaAvg!=null?APP.fmtCurrency(r.otaAvg):'—'}</td>
        <td class="${r.diff==null?'':r.diff<0?'text-danger':'text-success'}">${r.diff==null?'—':`${r.diff>=0?'+':''}${APP.fmtCurrency(r.diff)}`}</td>
        <td>${r.cheapest.label}</td>
        <td>${r.priciest.label}</td>
        <td><span class="badge-status ${r.statusClass}">${r.status}</span></td>
      </tr>`).join('') || `<tr><td colspan="8" class="text-center text-muted py-4">No rooms found for these filters.</td></tr>`}</tbody>`;
  }

  document.getElementById('ca_room').addEventListener('change', renderParityTable);
  document.getElementById('ca_channel').addEventListener('change', renderParityTable);
  renderParityTable();
}
