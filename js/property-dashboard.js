let priceTrendChart = null;
const trendDatasets = { daily:null, weekly:null, monthly:null };

// Shared Chart.js animation preset — bars cascade in left-to-right/dataset-by-dataset, lines
// draw in with a slightly longer, smoother ease so the dashboard feels alive rather than static.
function chartAnim(isBar){
  return {
    duration: 850, easing: 'easeOutQuart',
    delay: (ctx)=> isBar
      ? (ctx.type==='data' ? ctx.dataIndex*30 + (ctx.datasetIndex||0)*80 : 0)
      : (ctx.datasetIndex||0) * 150
  };
}

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Rate Intelligence Dashboard', subtitle:'Your executive view of rate position and competitor movement.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  // Only the competitors your Company Admin actually mapped to you — same set as Competitors/Rate Shopper/Market Intelligence.
  const comps = PORTALDATA.comparisonRealProperties();
  const today = PORTALDATA.dateKeyOffset(0);

  const myRate = PORTALDATA.myRateOnDate(propertyId, today);
  const compRatesToday = comps.map(c=>PORTALDATA.competitorRateOnDate(c, today));
  const marketAvg = compRatesToday.length ? Math.round(compRatesToday.reduce((a,b)=>a+b,0)/compRatesToday.length) : myRate;
  const lowest = compRatesToday.length ? Math.min(...compRatesToday) : myRate;
  const highest = compRatesToday.length ? Math.max(...compRatesToday) : myRate;
  const priceIndex = Math.round((myRate/marketAvg)*100);
  const ratePosition = myRate<lowest ? 'Below Market' : myRate>highest ? 'Above Market' : 'Within Market';
  const parityScore = Math.max(40, 100 - DB.rand(0,25));
  const yesterdayRate = PORTALDATA.myRateOnDate(propertyId, PORTALDATA.dateKeyOffset(-1));
  const rateChangePct = ((myRate-yesterdayRate)/yesterdayRate*100).toFixed(1);

  // ---- Slim market snapshot banner ----
  document.getElementById('marketSnapshotBar').innerHTML = `
    <div class="snap-item"><i class="bi bi-cash-coin"></i> My Rate <b>${APP.fmtCurrency(myRate)}</b></div>
    <span class="snap-sep">|</span>
    <div class="snap-item"><i class="bi bi-bar-chart"></i> Market Avg <b>${APP.fmtCurrency(marketAvg)}</b></div>
    <span class="snap-sep">|</span>
    <div class="snap-item"><i class="bi bi-arrow-down-circle"></i> Lowest <b>${APP.fmtCurrency(lowest)}</b></div>
    <span class="snap-sep">|</span>
    <div class="snap-item"><i class="bi bi-arrow-up-circle"></i> Highest <b>${APP.fmtCurrency(highest)}</b></div>
    <span class="snap-sep">|</span>
    <div class="snap-item"><i class="bi bi-signpost-split"></i> Position <b>${ratePosition}</b></div>
    <span class="snap-sep">|</span>
    <div class="snap-item"><i class="bi bi-buildings"></i> Competitors Tracked <b>${comps.length}</b></div>`;

  document.getElementById('kpiPrimary').innerHTML = [
    PWIDGETS.kpiCard({icon:'bi-cash-coin', color:'#3861fb', bg:'#eef4ff', label:'Current Hotel Rate', value:APP.fmtCurrency(myRate), sub:`${rateChangePct>=0?'+':''}${rateChangePct}% vs yesterday`, subDir: rateChangePct>=0?'up':'down',
      desc:"Your own property's rate for today, on your Direct (Master) channel."}),
    PWIDGETS.kpiCard({icon:'bi-bar-chart', color:'#8c5cf7', bg:'#f3eeff', label:'Market Average', value:APP.fmtCurrency(marketAvg), sub:`${comps.length} competitors tracked`, subDir:'flat',
      desc:"The average rate across all your assigned comparison properties for today."}),
    PWIDGETS.kpiCard({icon:'bi-arrow-down-circle', color:'#12b76a', bg:'#e7faf1', label:'Lowest Competitor', value:APP.fmtCurrency(lowest),
      desc:'The cheapest rate among your comparison properties today.'}),
    PWIDGETS.kpiCard({icon:'bi-arrow-up-circle', color:'#ff4d5e', bg:'#fff0f1', label:'Highest Competitor', value:APP.fmtCurrency(highest),
      desc:'The most expensive rate among your comparison properties today.'}),
  ].join('');

  document.getElementById('kpiSecondary').innerHTML = [
    PWIDGETS.kpiCard({icon:'bi-speedometer', color:'#b9791a', bg:'#fff8e6', label:'Price Index', value:`${priceIndex}`, sub:'vs. market = 100',
      desc:'Your rate as a percentage of the market average. 100 = exactly at market; above 100 means you\'re priced higher than the market, below means lower.'}),
    PWIDGETS.kpiCard({icon:'bi-signpost-split', color:'#3861fb', bg:'#eef4ff', label:'Rate Position', value:ratePosition,
      desc:"Whether your rate sits below, within, or above the range set by your cheapest and most expensive comparison properties."}),
    PWIDGETS.kpiCard({icon:'bi-shield-check', color:'#00c2a8', bg:'#e6fbf8', label:'Rate Parity Score', value:`${parityScore}/100`,
      desc:'How consistently your rate is honored across channels — a lower score means one or more OTAs may be undercutting your Direct rate.'}),
    PWIDGETS.kpiCard({icon:'bi-percent', color: rateChangePct>=0?'#12b76a':'#ff4d5e', bg: rateChangePct>=0?'#e7faf1':'#fff0f1', label:'Rate Change %', value:`${rateChangePct>=0?'+':''}${rateChangePct}%`,
      desc:"How much your own rate has moved compared to yesterday."}),
  ].join('');

  function avgCompRateOn(dk){
    if(!comps.length) return PORTALDATA.myRateOnDate(propertyId, dk);
    return Math.round(comps.reduce((s,c)=>s+PORTALDATA.competitorRateOnDate(c,dk),0)/comps.length);
  }
  function minMaxCompRateOn(dk){
    if(!comps.length){ const r = PORTALDATA.myRateOnDate(propertyId, dk); return {min:r, max:r}; }
    const rates = comps.map(c=>PORTALDATA.competitorRateOnDate(c,dk));
    return { min: Math.min(...rates), max: Math.max(...rates) };
  }

  // My Rate vs. Market Average: -30..+30 days
  const labels = [], myLine = [], marketLine = [];
  for(let d=-30; d<=30; d+=3){
    const dk = PORTALDATA.dateKeyOffset(d);
    labels.push(dk.slice(5));
    myLine.push(PORTALDATA.myRateOnDate(propertyId, dk));
    marketLine.push(avgCompRateOn(dk));
  }
  new Chart(document.getElementById('rateTrendChart'), {
    type:'line',
    data:{ labels, datasets:[
      {label:'My Rate', data:myLine, borderColor:'#3861fb', backgroundColor:'rgba(56,97,251,.08)', tension:.35, fill:true},
      {label:'Market Average', data:marketLine, borderColor:'#ff9f43', backgroundColor:'transparent', borderDash:[5,4], tension:.35}
    ]},
    options:{ responsive:true, animation:chartAnim(false), plugins:{legend:{position:'bottom'}}, scales:{y:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
  });

  // ---- Competitor Comparison: compact table ----
  const compRows = comps.map(c=>{
    const rate = PORTALDATA.competitorRateOnDate(c, today);
    const diff = rate - myRate;
    return { name:c.name, rate, diff };
  }).sort((a,b)=>a.rate-b.rate);
  document.getElementById('competitorComparisonTable').innerHTML = `
    <thead><tr><th>Competitor</th><th>Rate</th><th>Difference</th></tr></thead>
    <tbody>${compRows.map(r=>`<tr>
      <td>${r.name}</td>
      <td class="fw-semibold">${APP.fmtCurrency(r.rate)}</td>
      <td class="${r.diff>=0?'text-danger':'text-success'}">${r.diff>=0?'+':''}${APP.fmtCurrency(r.diff)}</td>
    </tr>`).join('') || `<tr><td colspan="3" class="text-center text-muted py-3">No comparison properties assigned yet.</td></tr>`}</tbody>`;

  // ---- Rate Distribution: bell curve over competitor rates today ----
  const n = compRatesToday.length;
  const mean = n ? compRatesToday.reduce((a,b)=>a+b,0)/n : myRate;
  const variance = n ? compRatesToday.reduce((s,r)=>s+Math.pow(r-mean,2),0)/n : 0;
  const stddev = Math.sqrt(variance) || Math.max(1, mean*0.05);
  const bellLabels = [], bellData = [];
  const spanMin = mean - 3*stddev, spanMax = mean + 3*stddev;
  const steps = 30;
  for(let i=0; i<=steps; i++){
    const x = spanMin + (spanMax-spanMin)*(i/steps);
    const y = (1/(stddev*Math.sqrt(2*Math.PI))) * Math.exp(-0.5*Math.pow((x-mean)/stddev,2));
    bellLabels.push(`₹${Math.round(x)}`);
    bellData.push(y);
  }
  new Chart(document.getElementById('priceDistChart'), {
    type:'line',
    data:{ labels:bellLabels, datasets:[{label:'Rate Distribution', data:bellData, borderColor:'#8c5cf7', backgroundColor:'rgba(140,92,247,.12)', tension:.4, fill:true, pointRadius:0}] },
    options:{ responsive:true, animation:chartAnim(false), plugins:{legend:{display:false}}, scales:{ x:{ticks:{maxTicksLimit:6}}, y:{display:false} } }
  });

  // ---- Price Trends: merged daily/weekly/monthly, tab-switchable ----
  const dailyLabels=[], dailyData=[];
  for(let d=-13; d<=0; d++){ const dk=PORTALDATA.dateKeyOffset(d); dailyLabels.push(dk.slice(5)); dailyData.push(PORTALDATA.myRateOnDate(propertyId,dk)); }
  trendDatasets.daily = { labels:dailyLabels, data:dailyData, color:'#3861fb' };

  const weeklyLabels=[], weeklyData=[];
  for(let w=11; w>=0; w--){
    let sum=0; for(let d=0; d<7; d++){ sum += PORTALDATA.myRateOnDate(propertyId, PORTALDATA.dateKeyOffset(-(w*7+d))); }
    weeklyLabels.push(`W-${w}`); weeklyData.push(Math.round(sum/7));
  }
  trendDatasets.weekly = { labels:weeklyLabels, data:weeklyData, color:'#00c2a8' };

  const monthlyLabels=[], monthlyData=[];
  for(let m=5; m>=0; m--){
    let sum=0, cnt=0; for(let d=0; d<30; d+=5){ sum += PORTALDATA.myRateOnDate(propertyId, PORTALDATA.dateKeyOffset(-(m*30+d))); cnt++; }
    monthlyLabels.push(`M-${m}`); monthlyData.push(Math.round(sum/cnt));
  }
  trendDatasets.monthly = { labels:monthlyLabels, data:monthlyData, color:'#8c5cf7' };

  function renderTrend(range){
    const t = trendDatasets[range];
    if(priceTrendChart) priceTrendChart.destroy();
    priceTrendChart = new Chart(document.getElementById('priceTrendChart'), {
      type:'line',
      data:{ labels:t.labels, datasets:[{data:t.data, borderColor:t.color, backgroundColor:t.color+'15', tension:.3, fill:true, pointRadius:0}] },
      options:{ responsive:true, animation:chartAnim(false), plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
    });
  }
  renderTrend('daily');
  document.querySelectorAll('#trendTabGroup [data-range]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('#trendTabGroup [data-range]').forEach(b=>{
        b.classList.toggle('btn-outline-primary', b===btn);
        b.classList.toggle('btn-soft', b!==btn);
      });
      renderTrend(btn.dataset.range);
    });
  });

  // Channel Price Comparison — real channels for this property (Master + OTAs)
  const dashChannels = DB.channels.byProperty(propertyId);
  function channelAvgRateOnDate(channelId, dateKey){
    const rooms = DB.rooms.byChannel(channelId);
    let sum=0, count=0;
    rooms.forEach(room=>{ DB.ratePlans.byRoom(room.id).forEach(rp=>{
      const day = DB.rates.forPlan(rp.id)[dateKey];
      sum += day ? day.price : room.basePrice; count++;
    }); });
    return count ? Math.round(sum/count) : null;
  }
  new Chart(document.getElementById('channelCompareChart'), {
    type:'bar',
    data:{
      labels: dashChannels.map(ch=>ch.name),
      datasets:[{ data: dashChannels.map(ch=>channelAvgRateOnDate(ch.id,today)||0), backgroundColor: dashChannels.map(ch=>(DB.CHANNEL_TYPES[ch.type]||DB.CHANNEL_TYPES.custom).color), borderRadius:6 }]
    },
    options:{ responsive:true, animation:chartAnim(true), plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
  });

  // ---- Competitor Update Heatmap (30 days) — intensity = % of tracked competitors whose rate changed vs the prior day ----
  document.getElementById('updateHeatmap').innerHTML = Array.from({length:30}).map((_,d)=>{
    const dk = PORTALDATA.dateKeyOffset(d);
    const prevDk = PORTALDATA.dateKeyOffset(d-1);
    const changed = comps.filter(c=> PORTALDATA.competitorRateOnDate(c,dk) !== PORTALDATA.competitorRateOnDate(c,prevDk)).length;
    const intensity = comps.length ? Math.round((changed/comps.length)*100) : 0;
    return `<div class="heatmap-cell" style="background:${PWIDGETS.heatCellColor(intensity)}" title="${dk}: ${changed}/${comps.length} competitors changed rate">${new Date(dk+'T00:00:00').getDate()}</div>`;
  }).join('');

  // ---- 14-Day Price Calendar: Date | My Rate | Lowest Competitor | Highest Competitor | Difference ----
  const rows14 = Array.from({length:14}).map((_,d)=>{
    const dk = PORTALDATA.dateKeyOffset(d);
    const mine = PORTALDATA.myRateOnDate(propertyId, dk);
    const {min, max} = minMaxCompRateOn(dk);
    const diff = mine-min;
    return `<tr>
      <td>${new Date(dk+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'})} ${PORTALDATA.isWeekend(dk)?'<span class="badge bg-light text-dark border ms-1" style="font-size:.62rem">Weekend</span>':''} ${PORTALDATA.isHoliday(dk)?'<span class="badge bg-warning-subtle text-warning-emphasis ms-1" style="font-size:.62rem">Holiday</span>':''}</td>
      <td class="fw-semibold">${APP.fmtCurrency(mine)}</td>
      <td class="text-success">${APP.fmtCurrency(min)}</td>
      <td class="text-danger">${APP.fmtCurrency(max)}</td>
      <td class="${diff>=0?'text-danger':'text-success'}">${diff>=0?'+':''}${APP.fmtCurrency(diff)}</td>
    </tr>`;
  }).join('');
  document.getElementById('priceCalendarTable').innerHTML = `
    <thead><tr><th>Date</th><th>My Rate</th><th>Lowest Competitor</th><th>Highest Competitor</th><th>Difference</th></tr></thead>
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
