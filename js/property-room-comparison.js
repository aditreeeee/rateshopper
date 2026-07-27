/* ==========================================================================
   Room Rate Comparison — per-room, per-rate-plan price comparison against
   mapped competitor rooms. Price comparison only: no occupancy/ADR/RevPAR/
   bookings/demand. Row generation is kept as a flat array + client-side
   pagination/sort/filter so the table stays responsive even if the
   underlying property/competitor set grows into the thousands of rooms.
   ========================================================================== */
let rcTrendChart = null, rcDistChart = null;
let rcAllRows = [];
let rcPage = 0;
const RC_PAGE_SIZE = 50;
let rcSort = { key:'compRate', dir:'asc' };
let rcTrendDays = 30;

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Room Rate Comparison', subtitle:'Compare your rooms against mapped competitor rooms, plan by plan, channel by channel.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);

  const channels = DB.channels.byProperty(propertyId);
  const master = channels.find(c=>c.type==='master');
  const myRooms = master ? DB.rooms.byChannel(master.id) : [];
  const compsAll = [...PORTALDATA.comparisonRealProperties().map(c=>({...c, group:'real'})), ...PORTALDATA.competitors(propertyId).filter(c=>!c.isReal).map(c=>({...c, group:'synthetic'}))];

  document.getElementById('rc_date').value = PORTALDATA.dateKeyOffset(0);
  document.getElementById('rc_room').innerHTML += myRooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  document.getElementById('rc_ratePlan').innerHTML += PORTALDATA.MEAL_PLANS.map(m=>`<option value="${m}">${m}</option>`).join('');
  document.getElementById('rc_channel').innerHTML += PORTALDATA.CHANNELS.map(c=>`<option value="${c.key}">${c.label}</option>`).join('');

  function myRoomRateOnDate(room, dateKey){
    const plans = DB.ratePlans.byRoom(room.id);
    if(!plans.length) return room.basePrice;
    const day = DB.rates.forPlan(plans[0].id)[dateKey];
    return day ? day.price : room.basePrice;
  }

  // ---- Build the flat comparison-row dataset for the currently selected date/channel ----
  function buildRows(dateKey, channelFilter){
    const rows = [];
    myRooms.forEach(room=>{
      const plans = DB.ratePlans.byRoom(room.id);
      plans.forEach(rp=>{
        const dayData = DB.rates.forPlan(rp.id)[dateKey];
        const myRate = dayData ? dayData.price : room.basePrice;

        compsAll.forEach(comp=>{
          let compRoomName, ratePlanName, channelKey, compRate, lastUpdated;

          if(comp.group==='real'){
            const compChannels = DB.channels.byProperty(comp.realPropertyId);
            const compMaster = compChannels.find(c=>c.type==='master');
            if(!compMaster) return;
            const compRoom = DB.rooms.byChannel(compMaster.id).find(r=>r.name===room.name);
            if(!compRoom) return;
            const compPlans = DB.ratePlans.byRoom(compRoom.id);
            const compPlan = compPlans.find(p=>p.mealPlan===rp.mealPlan) || compPlans[0];
            if(!compPlan) return;
            const compDay = DB.rates.forPlan(compPlan.id)[dateKey];
            const baseRate = compDay ? compDay.price : compRoom.basePrice;
            channelKey = channelFilter || 'direct';
            compRate = channelFilter ? PORTALDATA.channelRate(baseRate, channelFilter, dateKey) : baseRate;
            compRoomName = compRoom.name;
            ratePlanName = compPlan.name;
            lastUpdated = compPlan.createdAt || dateKey;
          } else {
            if(comp.roomType !== room.name) return;
            channelKey = channelFilter || comp.primaryChannel;
            compRate = PORTALDATA.channelRate(PORTALDATA.competitorRateOnDate(comp, dateKey), channelKey, dateKey);
            compRoomName = comp.roomType;
            ratePlanName = `${comp.mealPlan} Rate Plan`;
            lastUpdated = comp.createdAt || dateKey;
          }

          const diff = compRate - myRate;
          const diffPct = myRate ? (diff/myRate*100) : 0;
          const position = Math.abs(diffPct) < 1 ? 'same' : diff > 0 ? 'higher' : 'lower';

          rows.push({
            compId: comp.id, compName: comp.name, compRoomName, channelKey, ratePlanName,
            myRoomId: room.id, myRoomName: room.name, myRatePlanName: rp.name, myRateMealPlan: rp.mealPlan,
            myRate, compRate, diff, diffPct, position, lastUpdated, isReal: comp.group==='real'
          });
        });
      });
    });
    return rows;
  }

  function applyFilters(rows){
    const roomId = document.getElementById('rc_room').value;
    const mealPlan = document.getElementById('rc_ratePlan').value;
    const group = document.getElementById('rc_group').value;
    const search = document.getElementById('rc_search').value.trim().toLowerCase();
    return rows.filter(r=>{
      if(roomId && r.myRoomId !== roomId) return false;
      if(mealPlan && r.myRateMealPlan !== mealPlan) return false;
      if(group === 'real' && !r.isReal) return false;
      if(group === 'synthetic' && r.isReal) return false;
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

  function renderKpis(filteredRows, dateKey){
    const myRatesUnique = [...new Map(myRooms.map(r=>[r.id, myRoomRateOnDate(r, dateKey)])).values()];
    const ourAvg = myRatesUnique.length ? Math.round(myRatesUnique.reduce((a,b)=>a+b,0)/myRatesUnique.length) : 0;
    const compRates = filteredRows.map(r=>r.compRate);
    const compAvg = compRates.length ? Math.round(compRates.reduce((a,b)=>a+b,0)/compRates.length) : 0;
    const cheaper = filteredRows.filter(r=>r.position==='lower').length;
    const pricier = filteredRows.filter(r=>r.position==='higher').length;

    document.getElementById('rcKpis').innerHTML = [
      PWIDGETS.kpiCard({icon:'bi-house-door-fill', color:'#3861fb', bg:'#eef4ff', label:'Our Avg. Rate', value:APP.fmtCurrency(ourAvg),
        desc:'The average current rate across all of your own rooms on the Master (Direct) channel.'}),
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

    document.getElementById('rc_summary').textContent = `${filtered.length} matched room comparisons across ${myRooms.length} of your rooms and ${compsAll.length} tracked competitors`;

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

    document.getElementById('rc_table').innerHTML = thead + `<tbody>${body || `<tr><td colspan="${cols.length}" class="text-center text-muted py-4">No matched room comparisons for these filters.</td></tr>`}</tbody>`;
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

  // ---- Room-level scope for charts/ranking/history: the selected room, or the first room ----
  function focusRoom(){
    const roomId = document.getElementById('rc_room').value;
    return myRooms.find(r=>r.id===roomId) || myRooms[0] || null;
  }

  function topCompetitorsForRoom(room, dateKey, channelFilter, limit){
    if(!room) return [];
    const seen = new Map();
    rcAllRows.filter(r=>r.myRoomId===room.id).forEach(r=>{ if(!seen.has(r.compId)) seen.set(r.compId, r); });
    return [...seen.values()].sort((a,b)=>a.compRate-b.compRate).slice(0, limit);
  }

  function renderDistribution(dateKey, channelFilter){
    const room = focusRoom();
    if(!room){ document.getElementById('rc_distChart').replaceWith(document.createElement('div')); return; }
    const myRate = myRoomRateOnDate(room, dateKey);
    const top5 = topCompetitorsForRoom(room, dateKey, channelFilter, 5);
    const labels = ['My Room', ...top5.map(r=>r.compName)];
    const data = [myRate, ...top5.map(r=>r.compRate)];
    const colors = ['#3861fb', ...top5.map((_,i)=>['#a9b0c9','#9fd6ca','#c3aee8','#f2c194','#e6a8c4'][i%5])];

    if(rcDistChart) rcDistChart.destroy();
    rcDistChart = new Chart(document.getElementById('rc_distChart'), {
      type:'bar',
      data:{ labels, datasets:[{ data, backgroundColor:colors, borderRadius:6 }] },
      options:{ indexAxis:'y', responsive:true, plugins:{legend:{display:false}}, scales:{x:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
    });
  }

  function renderRanking(dateKey){
    const room = focusRoom();
    if(!room){ document.getElementById('rc_rankTable').innerHTML = ''; return; }
    const myRate = myRoomRateOnDate(room, dateKey);
    const seen = new Map();
    rcAllRows.filter(r=>r.myRoomId===room.id).forEach(r=>{ if(!seen.has(r.compId)) seen.set(r.compId, r); });
    const list = [...seen.values()].map(r=>({ name:r.compName, roomName:r.compRoomName, rate:r.compRate, isMe:false }));
    list.push({ name:'My Property', roomName:room.name, rate:myRate, isMe:true });
    list.sort((a,b)=>a.rate-b.rate);

    document.getElementById('rc_rankTable').innerHTML = `
      <thead><tr><th>Rank</th><th>Property</th><th>Room</th><th>Current Rate</th><th>Difference vs. Mine</th></tr></thead>
      <tbody>${list.map((r,i)=>{
        const diff = r.rate - myRate;
        return `<tr class="${r.isMe?'fw-bold':''}" style="${r.isMe?'background:var(--brand-50)':''}">
          <td>#${i+1}</td>
          <td>${r.isMe?'<i class="bi bi-star-fill me-1" style="color:var(--brand-500)"></i>':''}${r.name}</td>
          <td>${r.roomName}</td>
          <td class="fw-semibold">${APP.fmtCurrency(r.rate)}</td>
          <td class="${diff>=0?'text-danger':'text-success'}">${r.isMe?'—':`${diff>=0?'+':''}${APP.fmtCurrency(diff)}`}</td>
        </tr>`;
      }).join('') || `<tr><td colspan="5" class="text-center text-muted py-3">No data</td></tr>`}</tbody>`;
  }

  function renderTrend(){
    const room = focusRoom();
    const channelFilter = document.getElementById('rc_channel').value;
    if(!room) return;
    const dateKey = document.getElementById('rc_date').value || PORTALDATA.dateKeyOffset(0);
    const top5 = topCompetitorsForRoom(room, dateKey, channelFilter, 5);
    const plans = DB.ratePlans.byRoom(room.id);
    const myPlan = plans[0];

    const labels = [];
    for(let d=-rcTrendDays; d<=0; d++) labels.push(PORTALDATA.dateKeyOffset(d).slice(5));

    const myData = [];
    for(let d=-rcTrendDays; d<=0; d++){
      const dk = PORTALDATA.dateKeyOffset(d);
      const day = myPlan ? DB.rates.forPlan(myPlan.id)[dk] : null;
      myData.push(day ? day.price : room.basePrice);
    }

    const datasets = [{ label:'My Room Rate', data:myData, borderColor:'#3861fb', backgroundColor:'rgba(56,97,251,.1)', borderWidth:3, fill:true, tension:.3, pointRadius:0 }];
    const palette = ['#a9b0c9','#9fd6ca','#c3aee8','#f2c194','#e6a8c4'];
    top5.forEach((r,i)=>{
      const comp = compsAll.find(c=>c.id===r.compId);
      const data = [];
      for(let d=-rcTrendDays; d<=0; d++){
        const dk = PORTALDATA.dateKeyOffset(d);
        if(comp.group==='real'){
          const compChannels = DB.channels.byProperty(comp.realPropertyId);
          const compMaster = compChannels.find(c=>c.type==='master');
          const compRoom = compMaster ? DB.rooms.byChannel(compMaster.id).find(x=>x.name===room.name) : null;
          const compPlan = compRoom ? DB.ratePlans.byRoom(compRoom.id)[0] : null;
          const day = compPlan ? DB.rates.forPlan(compPlan.id)[dk] : null;
          data.push(day ? day.price : (compRoom ? compRoom.basePrice : PORTALDATA.competitorRateOnDate(comp, dk)));
        } else {
          data.push(PORTALDATA.channelRate(PORTALDATA.competitorRateOnDate(comp, dk), channelFilter||comp.primaryChannel, dk));
        }
      }
      datasets.push({ label:r.compName, data, borderColor:palette[i%5], backgroundColor:'transparent', borderWidth:1.5, tension:.3, pointRadius:0 });
    });

    if(rcTrendChart) rcTrendChart.destroy();
    rcTrendChart = new Chart(document.getElementById('rc_trendChart'), {
      type:'line',
      data:{ labels, datasets },
      options:{
        responsive:true, interaction:{mode:'index', intersect:false},
        plugins:{ legend:{position:'bottom'}, tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${APP.fmtCurrency(ctx.parsed.y)}`}} },
        scales:{ y:{ticks:{callback:v=>APP.fmtCurrency(v)}} }
      }
    });
  }

  function renderHistory(){
    const room = focusRoom();
    const channelFilter = document.getElementById('rc_channel').value;
    const compareDays = Number(document.getElementById('rc_compare').value);
    if(!room){ document.getElementById('rc_historyTable').innerHTML = ''; return; }
    const plans = DB.ratePlans.byRoom(room.id);
    const myPlan = plans[0];
    const relevantComps = compsAll.filter(c=>{
      if(c.group==='real'){
        const compChannels = DB.channels.byProperty(c.realPropertyId);
        const compMaster = compChannels.find(x=>x.type==='master');
        return compMaster && DB.rooms.byChannel(compMaster.id).some(x=>x.name===room.name);
      }
      return c.roomType === room.name;
    });

    function compRateOn(comp, dk){
      if(comp.group==='real'){
        const compChannels = DB.channels.byProperty(comp.realPropertyId);
        const compMaster = compChannels.find(x=>x.type==='master');
        const compRoom = compMaster ? DB.rooms.byChannel(compMaster.id).find(x=>x.name===room.name) : null;
        const compPlan = compRoom ? DB.ratePlans.byRoom(compRoom.id)[0] : null;
        const day = compPlan ? DB.rates.forPlan(compPlan.id)[dk] : null;
        return day ? day.price : (compRoom ? compRoom.basePrice : 0);
      }
      return PORTALDATA.channelRate(PORTALDATA.competitorRateOnDate(comp, dk), channelFilter||comp.primaryChannel, dk);
    }

    const days = Array.from({length: compareDays}).map((_,d)=> PORTALDATA.dateKeyOffset(d - (compareDays-1)));
    const rows = days.map(dk=>{
      const day = myPlan ? DB.rates.forPlan(myPlan.id)[dk] : null;
      const myRate = day ? day.price : room.basePrice;
      const rates = relevantComps.map(c=>compRateOn(c, dk)).filter(v=>v>0);
      const marketAvg = rates.length ? Math.round(rates.reduce((a,b)=>a+b,0)/rates.length) : myRate;
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
    rcAllRows = buildRows(dateKey, channelFilter);
    const filtered = renderTable();
    renderKpis(filtered, dateKey);
    renderDistribution(dateKey, channelFilter);
    renderRanking(dateKey);
    renderTrend();
    renderHistory();
  }

  ['rc_date','rc_room','rc_ratePlan','rc_channel','rc_group','rc_compare'].forEach(id=>{
    document.getElementById(id).addEventListener('input', ()=>{ rcPage = 0; renderAll(); });
  });
  document.getElementById('rc_search').addEventListener('input', ()=>{ rcPage = 0; renderTable(); });
  document.getElementById('rc_prevPage').addEventListener('click', ()=>{ rcPage--; renderTable(); });
  document.getElementById('rc_nextPage').addEventListener('click', ()=>{ rcPage++; renderTable(); });
  document.getElementById('rc_exportCsv').addEventListener('click', exportCsv);
  document.getElementById('rc_exportExcel').addEventListener('click', ()=> APP.toast('Export Started', 'Your Excel workbook is being prepared for download.', 'success'));
  document.getElementById('rc_print').addEventListener('click', ()=> window.print());

  document.querySelectorAll('#rc_trendRangeGroup button').forEach(btn=>{
    btn.addEventListener('click', function(){
      rcTrendDays = Number(this.dataset.days);
      document.querySelectorAll('#rc_trendRangeGroup button').forEach(b=>{ b.classList.remove('btn-outline-primary'); b.classList.add('btn-soft'); });
      this.classList.remove('btn-soft'); this.classList.add('btn-outline-primary');
      renderTrend();
    });
  });

  if(!myRooms.length){
    document.getElementById('rcKpis').innerHTML = `<div class="col-12">${PWIDGETS.emptyState('bi-door-closed','No rooms found','Add rooms to your property\'s Master Channel to use Room Rate Comparison.')}</div>`;
    return;
  }
  renderAll();
});
