document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Revenue Dashboard', subtitle:'Your executive view of rate position, demand and competitor movement.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  const property = DB.properties.get(propertyId);
  const comps = PORTALDATA.competitors(propertyId);
  const today = PORTALDATA.dateKeyOffset(0);

  const myRate = PORTALDATA.myRateOnDate(propertyId, today);
  const compRatesToday = comps.map(c=>PORTALDATA.competitorRateOnDate(c, today));
  const marketAvg = Math.round(compRatesToday.reduce((a,b)=>a+b,0)/compRatesToday.length);
  const lowest = Math.min(...compRatesToday);
  const highest = Math.max(...compRatesToday);
  const priceIndex = Math.round((myRate/marketAvg)*100);
  const ratePosition = myRate<lowest ? 'Below Market' : myRate>highest ? 'Above Market' : 'Within Market';
  const revenueOpportunity = Math.max(0, marketAvg-myRate) * DB.rand(12,20);
  const parityScore = Math.max(40, 100 - DB.rand(0,25));
  const demand = PORTALDATA.demandIndex(propertyId, today);
  const yesterdayRate = PORTALDATA.myRateOnDate(propertyId, PORTALDATA.dateKeyOffset(-1));
  const rateChangePct = ((myRate-yesterdayRate)/yesterdayRate*100).toFixed(1);
  const adr = myRate;
  const occ = PORTALDATA.expectedOccupancy(propertyId, today);
  const revpar = Math.round(adr * occ/100);
  const weeklyRevenue = Math.round(adr * occ/100 * (property?.rooms||60) * 7 * 0.01 * DB.rand(90,110));
  const monthlyRevenue = weeklyRevenue * 4;
  const los = (DB.rand(15,32)/10).toFixed(1);
  const pickup7 = PORTALDATA.pickup(propertyId, PORTALDATA.dateKeyOffset(7));
  const cancelTrend = DB.rand(-15,10);
  const bookingPace = DB.rand(-10,25);

  document.getElementById('kpiPrimary').innerHTML = [
    PWIDGETS.kpiCard({icon:'bi-cash-coin', color:'#3861fb', bg:'#eef4ff', label:'Current Hotel Rate', value:APP.fmtCurrency(myRate), sub:`${rateChangePct>=0?'+':''}${rateChangePct}% vs yesterday`, subDir: rateChangePct>=0?'up':'down'}),
    PWIDGETS.kpiCard({icon:'bi-bar-chart', color:'#8c5cf7', bg:'#f3eeff', label:'Market Average', value:APP.fmtCurrency(marketAvg), sub:`${comps.length} competitors tracked`, subDir:'flat'}),
    PWIDGETS.kpiCard({icon:'bi-arrow-down-circle', color:'#12b76a', bg:'#e7faf1', label:'Lowest Competitor', value:APP.fmtCurrency(lowest)}),
    PWIDGETS.kpiCard({icon:'bi-arrow-up-circle', color:'#ff4d5e', bg:'#fff0f1', label:'Highest Competitor', value:APP.fmtCurrency(highest)}),
  ].join('');

  document.getElementById('kpiSecondary').innerHTML = [
    PWIDGETS.kpiCard({icon:'bi-speedometer', color:'#b9791a', bg:'#fff8e6', label:'Price Index', value:`${priceIndex}`, sub:'vs. market = 100'}),
    PWIDGETS.kpiCard({icon:'bi-signpost-split', color:'#3861fb', bg:'#eef4ff', label:'Rate Position', value:ratePosition}),
    PWIDGETS.kpiCard({icon:'bi-graph-up-arrow', color:'#12b76a', bg:'#e7faf1', label:'Revenue Opportunity', value:APP.fmtCurrency(revenueOpportunity)}),
    PWIDGETS.kpiCard({icon:'bi-shield-check', color:'#00c2a8', bg:'#e6fbf8', label:'Rate Parity Score', value:`${parityScore}/100`}),
    PWIDGETS.kpiCard({icon:'bi-fire', color:'#ff4d5e', bg:'#fff0f1', label:'Market Demand', value:`${demand}/100`}),
    PWIDGETS.kpiCard({icon:'bi-lightbulb', color:'#8c5cf7', bg:'#f3eeff', label:'Recommended Price', value:APP.fmtCurrency(PORTALDATA.recommendations(propertyId)[0].expectedRate)}),
    PWIDGETS.kpiCard({icon:'bi-percent', color: rateChangePct>=0?'#12b76a':'#ff4d5e', bg: rateChangePct>=0?'#e7faf1':'#fff0f1', label:'Rate Change %', value:`${rateChangePct>=0?'+':''}${rateChangePct}%`}),
    PWIDGETS.kpiCard({icon:'bi-calendar-week', color:'#3861fb', bg:'#eef4ff', label:'Weekly Revenue', value:APP.fmtCurrency(weeklyRevenue)}),
    PWIDGETS.kpiCard({icon:'bi-calendar-month', color:'#3861fb', bg:'#eef4ff', label:'Monthly Revenue', value:APP.fmtCurrency(monthlyRevenue)}),
    PWIDGETS.kpiCard({icon:'bi-cash-stack', color:'#b9791a', bg:'#fff8e6', label:'ADR', value:APP.fmtCurrency(adr)}),
    PWIDGETS.kpiCard({icon:'bi-graph-up', color:'#12b76a', bg:'#e7faf1', label:'RevPAR', value:APP.fmtCurrency(revpar)}),
    PWIDGETS.kpiCard({icon:'bi-moon-stars', color:'#8c5cf7', bg:'#f3eeff', label:'Length of Stay', value:`${los} nights`}),
    PWIDGETS.kpiCard({icon:'bi-arrow-up-right-circle', color: pickup7>=0?'#12b76a':'#ff4d5e', bg: pickup7>=0?'#e7faf1':'#fff0f1', label:'Pickup (7d)', value:`${pickup7>=0?'+':''}${pickup7} bookings`}),
    PWIDGETS.kpiCard({icon:'bi-x-octagon', color: cancelTrend<=0?'#12b76a':'#ff4d5e', bg: cancelTrend<=0?'#e7faf1':'#fff0f1', label:'Cancellation Trend', value:`${cancelTrend>=0?'+':''}${cancelTrend}%`}),
    PWIDGETS.kpiCard({icon:'bi-speedometer2', color: bookingPace>=0?'#12b76a':'#ff4d5e', bg: bookingPace>=0?'#e7faf1':'#fff0f1', label:'Booking Pace', value:`${bookingPace>=0?'+':''}${bookingPace}%`}),
    PWIDGETS.kpiCard({icon:'bi-people', color:'#3861fb', bg:'#eef4ff', label:'Occupancy Trend', value:`${occ}%`}),
  ].join('');

  // Rate trend chart: -30..+30 days, my rate vs market average
  const labels = [], myLine = [], marketLine = [];
  for(let d=-30; d<=30; d+=3){
    const dk = PORTALDATA.dateKeyOffset(d);
    labels.push(dk.slice(5));
    myLine.push(PORTALDATA.myRateOnDate(propertyId, dk));
    const avg = Math.round(comps.reduce((s,c)=>s+PORTALDATA.competitorRateOnDate(c,dk),0)/comps.length);
    marketLine.push(avg);
  }
  new Chart(document.getElementById('rateTrendChart'), {
    type:'line',
    data:{ labels, datasets:[
      {label:'My Rate', data:myLine, borderColor:'#3861fb', backgroundColor:'rgba(56,97,251,.08)', tension:.35, fill:true},
      {label:'Market Average', data:marketLine, borderColor:'#ff9f43', backgroundColor:'transparent', borderDash:[5,4], tension:.35}
    ]},
    options:{ responsive:true, plugins:{legend:{position:'bottom'}}, scales:{y:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
  });

  // Occupancy forecast chart (14 days)
  const occLabels=[], occData=[];
  for(let d=0; d<14; d++){ const dk=PORTALDATA.dateKeyOffset(d); occLabels.push(dk.slice(5)); occData.push(PORTALDATA.expectedOccupancy(propertyId,dk)); }
  new Chart(document.getElementById('occForecastChart'), {
    type:'bar',
    data:{ labels:occLabels, datasets:[{label:'Occupancy %', data:occData, backgroundColor:'#00c2a8', borderRadius:6}] },
    options:{ responsive:true, plugins:{legend:{display:false}}, scales:{y:{max:100}} }
  });

  // Price distribution histogram
  const buckets = {}; compRatesToday.forEach(r=>{ const b = Math.floor(r/1000)*1000; buckets[b]=(buckets[b]||0)+1; });
  const bucketKeys = Object.keys(buckets).map(Number).sort((a,b)=>a-b);
  new Chart(document.getElementById('priceDistChart'), {
    type:'bar',
    data:{ labels:bucketKeys.map(k=>`₹${k/1000}k+`), datasets:[{label:'Competitors', data:bucketKeys.map(k=>buckets[k]), backgroundColor:'#8c5cf7', borderRadius:6}] },
    options:{ responsive:true, plugins:{legend:{display:false}} }
  });

  // Demand heatmap (30 days)
  document.getElementById('demandHeatmap').innerHTML = Array.from({length:30}).map((_,d)=>{
    const dk = PORTALDATA.dateKeyOffset(d);
    const dm = PORTALDATA.demandIndex(propertyId, dk);
    return `<div class="heatmap-cell" style="background:${PWIDGETS.heatCellColor(dm)}" title="${dk}: demand ${dm}">${new Date(dk+'T00:00:00').getDate()}</div>`;
  }).join('');

  // Price calendar table (14 days)
  const rows14 = Array.from({length:14}).map((_,d)=>{
    const dk = PORTALDATA.dateKeyOffset(d);
    const mine = PORTALDATA.myRateOnDate(propertyId, dk);
    const mkt = Math.round(comps.reduce((s,c)=>s+PORTALDATA.competitorRateOnDate(c,dk),0)/comps.length);
    const diff = mine-mkt;
    return `<tr>
      <td>${new Date(dk+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'})} ${PORTALDATA.isWeekend(dk)?'<span class="badge bg-light text-dark border ms-1" style="font-size:.62rem">Weekend</span>':''} ${PORTALDATA.isHoliday(dk)?'<span class="badge bg-warning-subtle text-warning-emphasis ms-1" style="font-size:.62rem">Holiday</span>':''}</td>
      <td class="fw-semibold">${APP.fmtCurrency(mine)}</td>
      <td>${APP.fmtCurrency(mkt)}</td>
      <td class="${diff>=0?'text-danger':'text-success'}">${diff>=0?'+':''}${APP.fmtCurrency(diff)}</td>
      <td>${PORTALDATA.expectedOccupancy(propertyId,dk)}%</td>
    </tr>`;
  }).join('');
  document.getElementById('priceCalendarTable').innerHTML = `
    <thead><tr><th>Date</th><th>My Rate</th><th>Market Avg</th><th>Difference</th><th>Occupancy</th></tr></thead>
    <tbody>${rows14}</tbody>`;

  // Rate position gauge
  const pos = Math.max(0, Math.min(100, priceIndex));
  document.getElementById('ratePositionWidget').innerHTML = `
    <div class="rate-gauge">
      <div class="rate-gauge-bar"><div class="rate-gauge-marker" style="left:${pos}%"></div></div>
      <div class="rate-gauge-labels w-100"><span>Cheapest</span><span>Market</span><span>Priciest</span></div>
      <div class="text-center mt-2"><div class="fw-bold fs-5">${priceIndex}</div><div class="text-muted small">${ratePosition}</div></div>
    </div>`;

  // Leaderboard (top 5 by rate diff)
  const leaderboard = [...comps].map(c=>({...c, rate:PORTALDATA.competitorRateOnDate(c,today)})).sort((a,b)=>a.rate-b.rate).slice(0,5);
  document.getElementById('leaderboardWidget').innerHTML = leaderboard.map((c,i)=>`
    <div class="leaderboard-row">
      <div class="leaderboard-rank">${i+1}</div>
      <img src="${c.image}" style="width:34px;height:34px;border-radius:8px;object-fit:cover">
      <div class="flex-grow-1">
        <div class="fw-semibold" style="font-size:.82rem">${c.name}</div>
        <div class="text-muted" style="font-size:.7rem">${c.distanceKm}km • ${c.stars}★</div>
      </div>
      <div class="fw-bold" style="font-size:.82rem">${APP.fmtCurrency(c.rate)}</div>
    </div>`).join('');

  // Recommendations widget (top 3)
  const recs = PORTALDATA.recommendations(propertyId).slice(0,3);
  document.getElementById('recsWidget').innerHTML = recs.map(r=>`
    <div class="d-flex align-items-center justify-content-between mb-2 pb-2 border-bottom" style="border-color:var(--border-1) !important">
      <div>
        <span class="rec-badge ${r.action}"><i class="bi ${r.action==='increase'?'bi-arrow-up':r.action==='decrease'?'bi-arrow-down':'bi-dash'}"></i>${r.action==='hold'?'Hold':(r.action==='increase'?'+':'-')+APP.fmtCurrency(r.amount)}</span>
        <div class="text-muted mt-1" style="font-size:.7rem;max-width:220px">${r.reason}</div>
      </div>
      <div class="text-end"><div class="fw-bold" style="font-size:.8rem">${r.confidence}%</div><div class="text-muted" style="font-size:.65rem">confidence</div></div>
    </div>`).join('');

  // Upcoming events widget (next 30 days)
  const events = [];
  for(let d=1; d<30; d++){ const dk=PORTALDATA.dateKeyOffset(d); const ev=PORTALDATA.localEventOn(dk); if(ev) events.push({dk,ev}); }
  document.getElementById('eventsWidget').innerHTML = events.length ? events.slice(0,4).map(e=>`
    <div class="d-flex align-items-center gap-2 mb-2">
      <div class="stat-icon" style="width:34px;height:34px;background:#fff8e6;color:#b9791a"><i class="bi bi-calendar-event"></i></div>
      <div><div class="fw-semibold" style="font-size:.8rem">${e.ev}</div><div class="text-muted" style="font-size:.7rem">${APP.fmtDateReadable(e.dk)}</div></div>
    </div>`).join('') : PWIDGETS.emptyState('bi-calendar-x','No events found','No local events detected in the next 30 days.');

  // Channel performance widget (top channels by ADR)
  document.getElementById('channelPerfWidget').innerHTML = PORTALDATA.CHANNELS.slice(0,5).map(ch=>{
    const rate = PORTALDATA.channelRate(myRate, ch.key, today);
    return `<div class="d-flex align-items-center justify-content-between mb-2">
      ${PWIDGETS.channelChip(ch.key)}
      <span class="fw-semibold" style="font-size:.8rem">${APP.fmtCurrency(rate)}</span>
    </div>`;
  }).join('');
});
