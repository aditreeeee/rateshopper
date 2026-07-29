/* ==========================================================================
   Reports — a single consolidated Rate Intelligence reporting module: four
   reports (Competitor Rate Comparison, Historical Rate Trend, Rate Parity,
   Market Rate Summary) behind one shared filter bar and a tab strip, all
   built from the same seeded demo data / helpers used elsewhere in the
   portal (PORTALDATA, MAPPING, DB). Rate/price data only — no occupancy,
   ADR-vs-RevPAR, or booking data.
   ========================================================================== */
let rpRangeDays = 14;      // global Date Range filter — used by reports 1/3/4
let rp2RangeMode = '14';   // Historical Rate Trend's own local range control
let rp2Chart = null, rp4Chart = null;
let rpSelectedCompetitors = null; // Set of competitor ids, null = not yet initialized (defaults to all)

// Shared Chart.js animation preset — see js/property-dashboard.js for the same helper.
function chartAnim(isBar){
  return {
    duration: 850, easing: 'easeOutQuart',
    delay: (ctx)=> isBar
      ? (ctx.type==='data' ? ctx.dataIndex*30 + (ctx.datasetIndex||0)*80 : 0)
      : (ctx.datasetIndex||0) * 150
  };
}

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Reports', subtitle:'Every Rate Intelligence report in one place, ready to export.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  const property = DB.properties.get(propertyId);

  const ourChannels = DB.channels.byProperty(propertyId);
  const ourMaster = ourChannels.find(c=>c.type==='master');
  const ourRooms = ourMaster ? DB.rooms.byChannel(ourMaster.id) : [];
  // Only the real properties your Company Admin actually assigned to you — same set as every
  // other Rate Intelligence page (Dashboard, Rate Shopper, Market Intelligence, Rate Matrix).
  const comps = PORTALDATA.comparisonRealProperties();
  rpSelectedCompetitors = new Set(comps.map(c=>c.id));

  if(!ourRooms.length){
    document.querySelectorAll('#rp_tabCompare,#rp_tabTrend,#rp_tabParity,#rp_tabMarket').forEach(el=>{
      el.innerHTML = `<div class="empty-state"><i class="bi bi-door-closed"></i><h5>No rooms for this property</h5><p class="mb-0">Add a room and rate plan first.</p></div>`;
    });
    return;
  }

  // ---- Filter option population ----
  document.getElementById('rp_room').innerHTML += ourRooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  document.getElementById('rp_mealPlan').innerHTML += PORTALDATA.MEAL_PLANS.map(m=>`<option value="${m}">${m}</option>`).join('');
  document.getElementById('rp_channel').innerHTML = ourChannels.map(c=>`<option value="${c.id}" ${c.type==='master'?'selected':''}>${c.name}</option>`).join('');

  function renderCompetitorMenu(){
    const menu = document.getElementById('rp_competitorMenu');
    menu.innerHTML = `
      <div class="mx-check-actions">
        <button type="button" class="btn btn-link btn-sm p-0" id="rp_compAll">Select All</button>
        <span class="text-muted">·</span>
        <button type="button" class="btn btn-link btn-sm p-0" id="rp_compNone">Clear</button>
      </div>
      ${comps.map(c=>`<label class="mx-check-row"><input type="checkbox" class="rp-comp-check" value="${c.id}" ${rpSelectedCompetitors.has(c.id)?'checked':''}>${c.name}</label>`).join('') || '<div class="text-muted small px-2">No comparison properties assigned yet.</div>'}
    `;
    document.getElementById('rp_compAll').addEventListener('click', ()=>{ rpSelectedCompetitors = new Set(comps.map(c=>c.id)); renderCompetitorMenu(); renderActiveTab(); });
    document.getElementById('rp_compNone').addEventListener('click', ()=>{ rpSelectedCompetitors = new Set(); renderCompetitorMenu(); renderActiveTab(); });
    document.querySelectorAll('.rp-comp-check').forEach(cb=>{
      cb.addEventListener('change', ()=>{
        if(cb.checked) rpSelectedCompetitors.add(cb.value); else rpSelectedCompetitors.delete(cb.value);
        updateCompetitorBtnLabel();
        renderActiveTab();
      });
    });
    updateCompetitorBtnLabel();
  }
  function updateCompetitorBtnLabel(){
    const btn = document.getElementById('rp_competitorBtn');
    if(rpSelectedCompetitors.size === comps.length) btn.textContent = 'All Competitors';
    else if(rpSelectedCompetitors.size === 0) btn.textContent = 'No Competitors';
    else btn.textContent = `${rpSelectedCompetitors.size} Competitor${rpSelectedCompetitors.size>1?'s':''}`;
  }

  // ---- Shared helpers (same model as Rate Matrix / Mapping Review) ----
  function findRoomOnChannel(pid, refChannel, roomName){
    if(!refChannel) return null;
    const channels = DB.channels.byProperty(pid);
    const target = channels.find(c=>c.id===refChannel.id) || channels.find(c=>c.channelCode===refChannel.channelCode);
    if(!target) return null;
    return DB.rooms.byChannel(target.id).find(r=>r.name===roomName) || null;
  }
  function rateFor(channelRoom, dateKey, mealPlanFilter, ratePlanFilter){
    if(!channelRoom) return null;
    let plans = DB.ratePlans.byRoom(channelRoom.id);
    if(mealPlanFilter) plans = plans.filter(p=>p.mealPlan===mealPlanFilter);
    if(ratePlanFilter==='refundable') plans = plans.filter(p=>p.refundable);
    else if(ratePlanFilter==='nonrefundable') plans = plans.filter(p=>!p.refundable);
    const plan = plans[0];
    if(!plan) return null;
    const day = DB.rates.forPlan(plan.id)[dateKey];
    const price = day ? day.price : channelRoom.basePrice;
    return { price, plan };
  }
  // Average price over the last `days` days (the shared Date Range filter — 7D/14D/30D) instead
  // of a single day's snapshot, so that filter actually changes what reports 1/3/4 show.
  function avgRate(channelRoom, mealPlanFilter, ratePlanFilter, days){
    if(!channelRoom) return null;
    let plans = DB.ratePlans.byRoom(channelRoom.id);
    if(mealPlanFilter) plans = plans.filter(p=>p.mealPlan===mealPlanFilter);
    if(ratePlanFilter==='refundable') plans = plans.filter(p=>p.refundable);
    else if(ratePlanFilter==='nonrefundable') plans = plans.filter(p=>!p.refundable);
    const plan = plans[0];
    if(!plan) return null;
    let sum = 0, count = 0;
    for(let d=-(days-1); d<=0; d++){
      const dateKey = PORTALDATA.dateKeyOffset(d);
      const day = DB.rates.forPlan(plan.id)[dateKey];
      sum += day ? day.price : channelRoom.basePrice;
      count++;
    }
    return { price: Math.round(sum/count), plan };
  }
  function filters(){
    return {
      roomFilter: document.getElementById('rp_room').value,
      mealPlanFilter: document.getElementById('rp_mealPlan').value,
      ratePlanFilter: document.getElementById('rp_ratePlan').value,
      channel: DB.channels.get(document.getElementById('rp_channel').value) || ourMaster
    };
  }
  // Visible competitors (respecting the multi-select) with their MAPPING-verified matched rooms
  function visibleCompetitorMappings(roomFilter){
    return comps.filter(c=>rpSelectedCompetitors.has(c.id)).map(c=>{
      MAPPING.ensureAutoMapped(propertyId, c.realPropertyId);
      const ev = MAPPING.evaluate(propertyId, c.realPropertyId);
      let mapped = ev.rooms.filter(r=>r.compRoom);
      if(roomFilter) mapped = mapped.filter(r=>r.ourRoom.id===roomFilter);
      return { comp:c, mapped };
    }).filter(x=>x.mapped.length);
  }

  function renderTabs(){
    document.querySelectorAll('#rpTabs .nav-link').forEach(btn=>{
      btn.addEventListener('click', function(){
        document.querySelectorAll('#rpTabs .nav-link').forEach(b=>b.classList.remove('active'));
        this.classList.add('active');
        const tab = this.dataset.tab;
        document.getElementById('rp_tabCompare').classList.toggle('d-none', tab!=='compare');
        document.getElementById('rp_tabTrend').classList.toggle('d-none', tab!=='trend');
        document.getElementById('rp_tabParity').classList.toggle('d-none', tab!=='parity');
        document.getElementById('rp_tabMarket').classList.toggle('d-none', tab!=='market');
        renderActiveTab();
      });
    });
  }
  function activeTab(){ return document.querySelector('#rpTabs .nav-link.active').dataset.tab; }
  function renderActiveTab(){
    const tab = activeTab();
    if(tab==='compare') renderCompare();
    else if(tab==='trend') renderTrend();
    else if(tab==='parity') renderParity();
    else renderMarket();
  }

  /* ======================================================================
     1. Competitor Rate Comparison Report
     ====================================================================== */
  function renderCompare(){
    const { roomFilter, mealPlanFilter, ratePlanFilter, channel } = filters();
    const myRooms = ourRooms.filter(r=> !roomFilter || r.id===roomFilter);
    const compMaps = visibleCompetitorMappings(roomFilter);

    const rows = [];
    myRooms.forEach(myRoom=>{
      const myChannelRoom = findRoomOnChannel(propertyId, channel, myRoom.name);
      const myResult = avgRate(myChannelRoom, mealPlanFilter, ratePlanFilter, rpRangeDays);
      const myRate = myResult ? myResult.price : null;

      // Every competitor mapped to this room, for the Lowest/Highest/Market Average columns
      const compRatesForRoom = [];
      compMaps.forEach(({comp, mapped})=>{
        const m = mapped.find(x=>x.ourRoom.id===myRoom.id);
        if(!m) return;
        const compChannelRoom = findRoomOnChannel(comp.realPropertyId, channel, m.compRoom.name);
        const result = avgRate(compChannelRoom, mealPlanFilter, ratePlanFilter, rpRangeDays);
        if(result) compRatesForRoom.push({ comp, compRoom:m.compRoom, plan:result.plan, rate:result.price });
      });
      if(!compRatesForRoom.length) return;

      const allRates = compRatesForRoom.map(r=>r.rate);
      const lowest = Math.min(...allRates), highest = Math.max(...allRates);
      const marketAvg = Math.round(allRates.reduce((a,b)=>a+b,0)/allRates.length);

      compRatesForRoom.forEach(cr=>{
        const diff = myRate!=null ? cr.rate - myRate : null;
        const diffPct = (myRate) ? (diff/myRate*100) : null;
        rows.push({ myRoom, cr, myRate, diff, diffPct, lowest, highest, marketAvg });
      });
    });

    document.getElementById('rp1_summary').textContent = `${rows.length} room comparisons across ${myRooms.length} of your rooms and ${compMaps.length} competitor propert${compMaps.length===1?'y':'ies'} — average rate over the last ${rpRangeDays} days.`;

    document.getElementById('rp1_table').innerHTML = `
      <thead><tr>
        <th>My Property</th><th>Competitor</th><th>Room</th><th>Meal Plan</th><th>Channel</th>
        <th>My Rate</th><th>Competitor Rate</th><th>Difference (₹)</th><th>Difference (%)</th>
        <th>Lowest Rate</th><th>Highest Rate</th><th>Market Average</th>
      </tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td class="fw-semibold">${property.name}</td>
        <td>${r.cr.comp.name}</td>
        <td>${r.myRoom.name}</td>
        <td>${r.cr.plan.mealPlan}</td>
        <td>${(()=>{ const meta = DB.CHANNEL_TYPES[channel&&channel.type] || DB.CHANNEL_TYPES.custom; return `<i class="bi ${meta.icon} me-1" style="color:${meta.color}"></i>${channel?channel.name:'—'}`; })()}</td>
        <td class="fw-semibold">${r.myRate!=null?APP.fmtCurrency(r.myRate):'—'}</td>
        <td class="fw-semibold">${APP.fmtCurrency(r.cr.rate)}</td>
        <td class="${r.diff==null?'':r.diff>=0?'text-danger':'text-success'}">${r.diff==null?'—':`${r.diff>=0?'+':''}${APP.fmtCurrency(r.diff)}`}</td>
        <td class="${r.diffPct==null?'':r.diffPct>=0?'text-danger':'text-success'}">${r.diffPct==null?'—':`${r.diffPct>=0?'+':''}${r.diffPct.toFixed(1)}%`}</td>
        <td>${APP.fmtCurrency(r.lowest)}</td>
        <td>${APP.fmtCurrency(r.highest)}</td>
        <td>${APP.fmtCurrency(r.marketAvg)}</td>
      </tr>`).join('') || `<tr><td colspan="12" class="text-center text-muted py-4">No mapped room comparisons for these filters.</td></tr>`}</tbody>`;
  }

  /* ======================================================================
     2. Historical Rate Trend Report
     ====================================================================== */
  function numDaysForRp2(range){
    if(range==='monthly'){ const n = new Date(); return new Date(n.getFullYear(), n.getMonth()+1, 0).getDate(); }
    if(range==='yearly') return 365;
    return Number(range);
  }
  function renderTrend(){
    const { roomFilter, mealPlanFilter, ratePlanFilter, channel } = filters();
    const days = numDaysForRp2(rp2RangeMode);
    const step = rp2RangeMode==='yearly' ? 7 : 1;
    const labels = [];
    const offsets = [];
    for(let d=-(days-1); d<=0; d+=step){ offsets.push(d); labels.push(PORTALDATA.dateKeyOffset(d).slice(5)); }

    const myRoom = roomFilter ? ourRooms.find(r=>r.id===roomFilter) : ourRooms[0];
    const compMaps = visibleCompetitorMappings(roomFilter);

    document.getElementById('rp2_caption').textContent = `${myRoom ? myRoom.name : 'All Rooms'} · ${rp2RangeMode==='yearly'?'weekly samples over 1 year':rp2RangeMode==='monthly'?'this month':`last ${days} days`}`;

    const myData = offsets.map(d=>{
      const dk = PORTALDATA.dateKeyOffset(d);
      const channelRoom = findRoomOnChannel(propertyId, channel, myRoom.name);
      const result = rateFor(channelRoom, dk, mealPlanFilter, ratePlanFilter);
      return result ? result.price : null;
    });

    const compSeries = compMaps.map(({comp, mapped})=>{
      const m = mapped.find(x=>x.ourRoom.id===myRoom.id) || mapped[0];
      const data = offsets.map(d=>{
        const dk = PORTALDATA.dateKeyOffset(d);
        const compChannelRoom = findRoomOnChannel(comp.realPropertyId, channel, m.compRoom.name);
        const result = rateFor(compChannelRoom, dk, mealPlanFilter, ratePlanFilter);
        return result ? result.price : null;
      });
      return { name:comp.name, data };
    });

    const marketAvgData = offsets.map((d,i)=>{
      const vals = compSeries.map(s=>s.data[i]).filter(v=>v!=null);
      return vals.length ? Math.round(vals.reduce((a,b)=>a+b,0)/vals.length) : null;
    });

    const palette = ['#a9b0c9','#9fd6ca','#c3aee8','#f2c194','#e6a8c4','#a6d9a6','#e3a6a6','#a9c6e8'];
    const datasets = [
      { label:'My Rate', data:myData, borderColor:'#3861fb', backgroundColor:'rgba(56,97,251,.1)', borderWidth:3, fill:true, tension:.3, pointRadius:0, spanGaps:true },
      { label:'Market Average', data:marketAvgData, borderColor:'#8c5cf7', backgroundColor:'transparent', borderDash:[5,4], borderWidth:2, tension:.3, pointRadius:0, spanGaps:true }
    ];
    compSeries.forEach((s,i)=> datasets.push({ label:s.name, data:s.data, borderColor:palette[i%palette.length], backgroundColor:'transparent', borderWidth:1.25, tension:.3, pointRadius:0, spanGaps:true }));

    if(rp2Chart) rp2Chart.destroy();
    rp2Chart = new Chart(document.getElementById('rp2_chart'), {
      type:'line',
      data:{ labels, datasets },
      options:{
        responsive:true, interaction:{mode:'index', intersect:false}, animation:chartAnim(false),
        plugins:{ legend:{position:'bottom'}, tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${ctx.parsed.y!=null?APP.fmtCurrency(ctx.parsed.y):'—'}`}} },
        scales:{ y:{ticks:{callback:v=>APP.fmtCurrency(v)}} }
      }
    });
  }

  /* ======================================================================
     3. Rate Parity Report — Direct (Master) vs. every OTA channel, property-wide
     ====================================================================== */
  function renderParity(){
    const { roomFilter, mealPlanFilter, ratePlanFilter } = filters();
    const myRoomsFiltered = ourRooms.filter(r=> !roomFilter || r.id===roomFilter);
    const otaChannels = ourChannels.filter(c=>c.type!=='master');

    function avgRateOnChannel(channel){
      const rates = [];
      myRoomsFiltered.forEach(room=>{
        const channelRoom = findRoomOnChannel(propertyId, channel, room.name);
        const result = avgRate(channelRoom, mealPlanFilter, ratePlanFilter, rpRangeDays);
        if(result) rates.push(result.price);
      });
      return rates.length ? Math.round(rates.reduce((a,b)=>a+b,0)/rates.length) : null;
    }
    function violationsOnChannel(channel, directAvg){
      let count = 0;
      myRoomsFiltered.forEach(room=>{
        const channelRoom = findRoomOnChannel(propertyId, channel, room.name);
        const result = avgRate(channelRoom, mealPlanFilter, ratePlanFilter, rpRangeDays);
        if(result && directAvg!=null && result.price < directAvg) count++;
      });
      return count;
    }

    const directAvg = avgRateOnChannel(ourMaster);
    const allChannelAvgs = [{ channel:ourMaster, avg:directAvg }, ...otaChannels.map(c=>({ channel:c, avg:avgRateOnChannel(c) }))].filter(x=>x.avg!=null);
    const cheapest = allChannelAvgs.length ? allChannelAvgs.reduce((min,x)=> x.avg<min.avg?x:min) : null;

    const rows = otaChannels.map(channel=>{
      const otaAvg = avgRateOnChannel(channel);
      const diff = (otaAvg!=null && directAvg!=null) ? otaAvg-directAvg : null;
      const status = diff==null ? null : diff>=0 ? 'parity' : 'undercut';
      const violations = directAvg!=null ? violationsOnChannel(channel, directAvg) : 0;
      return { channel, otaAvg, diff, status, violations };
    });

    document.getElementById('rp3_table').innerHTML = `
      <thead><tr><th>Channel</th><th>Direct Rate</th><th>OTA Rate</th><th>Difference</th><th>Parity Status</th><th>Violations</th><th>Cheapest Channel</th></tr></thead>
      <tbody>${rows.map(r=>{
        const meta = DB.CHANNEL_TYPES[r.channel.type] || DB.CHANNEL_TYPES.custom;
        return `<tr>
          <td><i class="bi ${meta.icon} me-1" style="color:${meta.color}"></i>${r.channel.name}</td>
          <td class="fw-semibold">${directAvg!=null?APP.fmtCurrency(directAvg):'—'}</td>
          <td class="fw-semibold">${r.otaAvg!=null?APP.fmtCurrency(r.otaAvg):'—'}</td>
          <td class="${r.diff==null?'':r.diff<0?'text-danger':'text-success'}">${r.diff==null?'—':`${r.diff>=0?'+':''}${APP.fmtCurrency(r.diff)}`}</td>
          <td>${r.status==null?'<span class="text-muted">—</span>':r.status==='parity'?'<span class="badge-status badge-active"><i class="bi bi-check-circle-fill me-1"></i>At Parity</span>':'<span class="badge-status badge-inactive"><i class="bi bi-exclamation-triangle-fill me-1"></i>Undercut</span>'}</td>
          <td>${r.violations>0?`<span class="badge bg-danger-subtle text-danger">${r.violations} room(s)</span>`:'<span class="text-muted">0</span>'}</td>
          <td>${cheapest ? `<i class="bi ${(DB.CHANNEL_TYPES[cheapest.channel.type]||DB.CHANNEL_TYPES.custom).icon} me-1"></i>${cheapest.channel.name}` : '—'}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="7" class="text-center text-muted py-4">No OTA channels found for this property.</td></tr>`}</tbody>`;
  }

  /* ======================================================================
     4. Market Rate Summary Report
     ====================================================================== */
  function renderMarket(){
    const { roomFilter, mealPlanFilter, ratePlanFilter, channel } = filters();
    const compMaps = visibleCompetitorMappings(roomFilter);

    // One representative rate per competitor: the selected room's rate, or (if "All Rooms")
    // the average across every room mapped to that competitor.
    const compRates = compMaps.map(({comp, mapped})=>{
      const rates = mapped.map(m=>{
        const compChannelRoom = findRoomOnChannel(comp.realPropertyId, channel, m.compRoom.name);
        const result = avgRate(compChannelRoom, mealPlanFilter, ratePlanFilter, rpRangeDays);
        return result ? result.price : null;
      }).filter(v=>v!=null);
      if(!rates.length) return null;
      return { comp, rate: Math.round(rates.reduce((a,b)=>a+b,0)/rates.length) };
    }).filter(Boolean).sort((a,b)=>a.rate-b.rate);

    if(!compRates.length){
      document.getElementById('rp4_kpis').innerHTML = `<div class="col-12">${PWIDGETS.emptyState('bi-globe-americas','No market data','Adjust your filters or ask your Company Admin to assign comparison properties.')}</div>`;
      document.getElementById('rp4_table').innerHTML = '';
      if(rp4Chart){ rp4Chart.destroy(); rp4Chart=null; }
      return;
    }

    const rates = compRates.map(c=>c.rate);
    const lowest = rates[0], highest = rates[rates.length-1];
    const avg = Math.round(rates.reduce((a,b)=>a+b,0)/rates.length);
    const median = rates[Math.floor(rates.length/2)];
    const range = highest-lowest;

    document.getElementById('rp4_kpis').innerHTML = [
      PWIDGETS.kpiCard({icon:'bi-arrow-down-circle', color:'#12b76a', bg:'#e7faf1', label:'Lowest Market Rate', value:APP.fmtCurrency(lowest), desc:'The cheapest rate among your visible comparison properties today.'}),
      PWIDGETS.kpiCard({icon:'bi-arrow-up-circle', color:'#ff4d5e', bg:'#fff0f1', label:'Highest Market Rate', value:APP.fmtCurrency(highest), desc:'The most expensive rate among your visible comparison properties today.'}),
      PWIDGETS.kpiCard({icon:'bi-bar-chart', color:'#3861fb', bg:'#eef4ff', label:'Average Market Rate', value:APP.fmtCurrency(avg), desc:'The average rate across your visible comparison properties today.'}),
      PWIDGETS.kpiCard({icon:'bi-distribute-vertical', color:'#8c5cf7', bg:'#f3eeff', label:'Median Rate', value:APP.fmtCurrency(median), desc:'The middle rate when every comparison property is sorted low to high.'}),
      PWIDGETS.kpiCard({icon:'bi-arrows-expand', color:'#b9791a', bg:'#fff8e6', label:'Price Range', value:APP.fmtCurrency(range), desc:'The spread between the highest and lowest market rate today.'}),
    ].join('');

    if(rp4Chart) rp4Chart.destroy();
    rp4Chart = new Chart(document.getElementById('rp4_chart'), {
      type:'bar',
      data:{ labels: compRates.map(c=>c.comp.name), datasets:[{ data: compRates.map(c=>c.rate), backgroundColor:'#3861fb', borderRadius:6 }] },
      options:{ indexAxis:'y', responsive:true, animation:chartAnim(true), plugins:{legend:{display:false}}, scales:{x:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
    });

    document.getElementById('rp4_table').innerHTML = `
      <thead><tr><th>Rank</th><th>Competitor</th><th>Rate</th><th>Vs. Average</th></tr></thead>
      <tbody>${compRates.map((c,i)=>{
        const diff = c.rate-avg;
        return `<tr>
          <td>#${i+1}</td>
          <td>${c.comp.name}</td>
          <td class="fw-semibold">${APP.fmtCurrency(c.rate)}</td>
          <td class="${diff>=0?'text-danger':'text-success'}">${diff>=0?'+':''}${APP.fmtCurrency(diff)}</td>
        </tr>`;
      }).join('')}</tbody>`;
  }

  /* ======================================================================
     Export (current tab only) / Print / Reset / Wiring
     ====================================================================== */
  function currentTableId(){
    const tab = activeTab();
    return tab==='compare' ? 'rp1_table' : tab==='parity' ? 'rp3_table' : tab==='market' ? 'rp4_table' : null;
  }
  function exportCsv(){
    const tableId = currentTableId();
    if(!tableId){ APP.toast('Nothing to Export', 'Switch to a table-based report tab to export its data.', 'warn'); return; }
    const table = document.getElementById(tableId);
    const lines = [...table.querySelectorAll('tr')].map(tr=>
      [...tr.children].map(cell=>`"${cell.textContent.trim().replace(/"/g,'""')}"`).join(',')
    );
    const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `report-${activeTab()}-${DB.fmtDate(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    APP.toast('Export Complete', 'Your CSV file has been downloaded.', 'success');
  }

  function resetFilters(){
    rpRangeDays = 14;
    document.querySelectorAll('#rp_rangeGroup [data-range]').forEach(b=>{
      b.classList.toggle('btn-outline-primary', b.dataset.range==='14');
      b.classList.toggle('btn-soft', b.dataset.range!=='14');
    });
    document.getElementById('rp_room').value = '';
    document.getElementById('rp_mealPlan').value = '';
    document.getElementById('rp_channel').value = ourMaster ? ourMaster.id : '';
    document.getElementById('rp_ratePlan').value = '';
    rpSelectedCompetitors = new Set(comps.map(c=>c.id));
    renderCompetitorMenu();
    renderActiveTab();
  }

  document.querySelectorAll('#rp_rangeGroup [data-range]').forEach(btn=>{
    btn.addEventListener('click', function(){
      rpRangeDays = Number(this.dataset.range);
      document.querySelectorAll('#rp_rangeGroup [data-range]').forEach(b=>{
        const active = b===this;
        b.classList.toggle('btn-soft', !active); b.classList.toggle('btn-outline-primary', active);
      });
      renderActiveTab();
    });
  });
  document.querySelectorAll('#rp2_rangeGroup [data-range]').forEach(btn=>{
    btn.addEventListener('click', function(){
      rp2RangeMode = this.dataset.range;
      document.querySelectorAll('#rp2_rangeGroup [data-range]').forEach(b=>{
        const active = b===this;
        b.classList.toggle('btn-soft', !active); b.classList.toggle('btn-outline-primary', active);
      });
      renderTrend();
    });
  });

  ['rp_room','rp_mealPlan','rp_channel','rp_ratePlan'].forEach(id=>{
    document.getElementById(id).addEventListener('change', renderActiveTab);
  });
  document.getElementById('rp_reset').addEventListener('click', resetFilters);
  document.getElementById('rp_exportCsv').addEventListener('click', (e)=>{ e.preventDefault(); exportCsv(); });
  document.getElementById('rp_exportExcel').addEventListener('click', (e)=>{ e.preventDefault(); APP.toast('Export Started', 'Your Excel workbook is being prepared for download.', 'success'); });
  document.getElementById('rp_exportPdf').addEventListener('click', (e)=>{ e.preventDefault(); APP.toast('Export Started', 'Your PDF report is being prepared for download.', 'success'); });
  document.getElementById('rp_print').addEventListener('click', ()=> window.print());

  renderTabs();
  renderCompetitorMenu();
  renderActiveTab();
});
