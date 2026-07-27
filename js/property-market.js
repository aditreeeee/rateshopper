// Shared Chart.js animation preset — see js/property-dashboard.js for the same helper; bars
// cascade in one-by-one, lines draw in with a smooth ease so the page feels alive on load.
function chartAnim(isBar){
  return {
    duration: 850, easing: 'easeOutQuart',
    delay: (ctx)=> isBar
      ? (ctx.type==='data' ? ctx.dataIndex*30 + (ctx.datasetIndex||0)*80 : 0)
      : (ctx.datasetIndex||0) * 150
  };
}

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Market Intelligence', subtitle:'An executive overview of the competitive market around your property.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  // Only the competitors your Company Admin actually mapped to you — same set as Competitors/Rate Shopper.
  const comps = PORTALDATA.comparisonRealProperties();
  const today = PORTALDATA.dateKeyOffset(0);

  if(!comps.length){
    document.getElementById('marketTrendKpis').innerHTML = `<div class="col-12">${PWIDGETS.emptyState('bi-globe-americas','No comparison properties assigned yet','Your Company Admin hasn\'t selected any benchmark properties for you yet.')}</div>`;
    return;
  }

  const avgRateOn = dk => Math.round(comps.reduce((s,c)=>s+PORTALDATA.competitorRateOnDate(c,dk),0)/comps.length);

  const rates = comps.map(c=>PORTALDATA.competitorRateOnDate(c, today)).sort((a,b)=>a-b);
  const marketAvg = avgRateOn(today);
  const median = rates[Math.floor(rates.length/2)];
  const lowestRate = rates[0], highestRate = rates[rates.length-1];
  const cheapest = comps.reduce((min,c)=> PORTALDATA.competitorRateOnDate(c,today) < PORTALDATA.competitorRateOnDate(min,today) ? c : min);
  const priciest = comps.reduce((max,c)=> PORTALDATA.competitorRateOnDate(c,today) > PORTALDATA.competitorRateOnDate(max,today) ? c : max);
  const supply = comps.length;

  const dailyPct = (((marketAvg - avgRateOn(PORTALDATA.dateKeyOffset(-1))) / avgRateOn(PORTALDATA.dateKeyOffset(-1))) * 100).toFixed(1);
  const weeklyPct = (((marketAvg - avgRateOn(PORTALDATA.dateKeyOffset(-7))) / avgRateOn(PORTALDATA.dateKeyOffset(-7))) * 100).toFixed(1);
  const monthlyPct = (((marketAvg - avgRateOn(PORTALDATA.dateKeyOffset(-30))) / avgRateOn(PORTALDATA.dateKeyOffset(-30))) * 100).toFixed(1);

  const trendCard = (label, pct, desc) => PWIDGETS.kpiCard({
    icon: pct>=0?'bi-graph-up-arrow':'bi-graph-down-arrow', color: pct>=0?'#ff4d5e':'#12b76a', bg: pct>=0?'#fff0f1':'#e7faf1',
    label, value:`${pct>=0?'+':''}${pct}%`, desc
  });

  document.getElementById('marketTrendKpis').innerHTML = [
    PWIDGETS.kpiCard({icon:'bi-bar-chart', color:'#3861fb', bg:'#eef4ff', label:'Market Average', value:APP.fmtCurrency(marketAvg),
      desc:'The average rate across all your assigned comparison properties today.'}),
    PWIDGETS.kpiCard({icon:'bi-distribute-vertical', color:'#8c5cf7', bg:'#f3eeff', label:'Median Rate', value:APP.fmtCurrency(median),
      desc:'The middle rate when every comparison property is sorted low to high — less skewed by one or two extreme outliers than the average.'}),
    PWIDGETS.kpiCard({icon:'bi-arrow-down-circle', color:'#12b76a', bg:'#e7faf1', label:'Lowest Rate', value:APP.fmtCurrency(lowestRate),
      desc:'The single cheapest rate found among all your comparison properties today.'}),
    PWIDGETS.kpiCard({icon:'bi-arrow-up-circle', color:'#ff4d5e', bg:'#fff0f1', label:'Highest Rate', value:APP.fmtCurrency(highestRate),
      desc:'The single most expensive rate found among all your comparison properties today.'}),
    PWIDGETS.kpiCard({icon:'bi-trophy', color:'#12b76a', bg:'#e7faf1', label:'Cheapest Competitor', value:cheapest.name, sub:APP.fmtCurrency(PORTALDATA.competitorRateOnDate(cheapest,today)),
      desc:'Which comparison property currently has the lowest rate.'}),
    PWIDGETS.kpiCard({icon:'bi-gem', color:'#ff4d5e', bg:'#fff0f1', label:'Most Expensive Competitor', value:priciest.name, sub:APP.fmtCurrency(PORTALDATA.competitorRateOnDate(priciest,today)),
      desc:'Which comparison property currently has the highest rate.'}),
    trendCard('Daily Market Trend', Number(dailyPct), "How much the market average has moved since yesterday."),
    trendCard('Weekly Market Trend', Number(weeklyPct), 'How much the market average has moved compared to 7 days ago.'),
    trendCard('Monthly Market Trend', Number(monthlyPct), 'How much the market average has moved compared to 30 days ago.'),
    PWIDGETS.kpiCard({icon:'bi-buildings', color:'#3861fb', bg:'#eef4ff', label:'Tracked Competitors', value:supply,
      desc:'How many comparison properties your Company Admin has assigned to you for benchmarking.'}),
  ].join('');

  const labels=[], data=[];
  for(let d=-30; d<=30; d+=2){ const dk=PORTALDATA.dateKeyOffset(d); labels.push(dk.slice(5)); data.push(avgRateOn(dk)); }
  new Chart(document.getElementById('marketTrendChart'), {
    type:'line',
    data:{ labels, datasets:[{label:'Market Average', data, borderColor:'#8c5cf7', backgroundColor:'rgba(140,92,247,.08)', tension:.35, fill:true}] },
    options:{ responsive:true, animation:chartAnim(false), plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
  });

  const buckets={}; rates.forEach(r=>{ const b=Math.floor(r/1000)*1000; buckets[b]=(buckets[b]||0)+1; });
  const bkeys = Object.keys(buckets).map(Number).sort((a,b)=>a-b);
  new Chart(document.getElementById('marketDistChart'), {
    type:'bar',
    data:{ labels:bkeys.map(k=>`₹${k/1000}k+`), datasets:[{label:'Hotels', data:bkeys.map(k=>buckets[k]), backgroundColor:'#3861fb', borderRadius:6}] },
    options:{ responsive:true, animation:chartAnim(true), plugins:{legend:{display:false}} }
  });

  // ---- Competitor Pricing Matrix: competitor rows x next 7 days ----
  const matrixDays = Array.from({length:7}).map((_,d)=> PORTALDATA.dateKeyOffset(d));
  document.getElementById('pricingMatrixTable').innerHTML = `
    <thead><tr><th>Competitor</th>${matrixDays.map(dk=>`<th>${new Date(dk+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'})}</th>`).join('')}</tr></thead>
    <tbody>${comps.map(c=>`<tr>
      <td class="fw-semibold">${c.name}</td>
      ${matrixDays.map(dk=>`<td>${APP.fmtCurrency(PORTALDATA.competitorRateOnDate(c,dk))}</td>`).join('')}
    </tr>`).join('')}</tbody>`;

  const movement = [...comps].map(c=>{
    const t = PORTALDATA.competitorRateOnDate(c,today), y = PORTALDATA.competitorRateOnDate(c, PORTALDATA.dateKeyOffset(-7));
    return {c, chg:((t-y)/y*100)};
  }).sort((a,b)=>Math.abs(b.chg)-Math.abs(a.chg)).slice(0,10);
  document.getElementById('movementTable').innerHTML = `
    <thead><tr><th>Competitor</th><th>7 Days Ago</th><th>Today</th><th>Change</th></tr></thead>
    <tbody>${movement.map(m=>`<tr>
      <td>${m.c.name}</td>
      <td>${APP.fmtCurrency(PORTALDATA.competitorRateOnDate(m.c, PORTALDATA.dateKeyOffset(-7)))}</td>
      <td>${APP.fmtCurrency(PORTALDATA.competitorRateOnDate(m.c, today))}</td>
      <td class="${m.chg>=0?'text-danger':'text-success'} fw-semibold">${m.chg>=0?'+':''}${m.chg.toFixed(1)}%</td>
    </tr>`).join('')}</tbody>`;

  document.getElementById('marketSummary').innerHTML = `
    <div class="kv-row"><span class="k">Total Competitors</span><span class="v">${supply}</span></div>
    <div class="kv-row"><span class="k">Avg. Star Rating</span><span class="v">${(comps.reduce((s,c)=>s+c.stars,0)/comps.length).toFixed(1)}★</span></div>
    <div class="kv-row"><span class="k">Price Spread</span><span class="v">${APP.fmtCurrency(highestRate-lowestRate)}</span></div>`;

  const newListings = comps.filter(c=> seededPct(c.id+'new') > 0.85).slice(0,4);
  document.getElementById('newListings').innerHTML = newListings.length ? newListings.map(c=>`
    <div class="d-flex align-items-center gap-2 mb-2">
      <img src="${c.image}" style="width:32px;height:32px;border-radius:8px;object-fit:cover">
      <div class="flex-grow-1"><div class="fw-semibold" style="font-size:.8rem">${c.name}</div><div class="text-muted" style="font-size:.7rem">${c.city}, ${c.country}</div></div>
      <span class="badge bg-success-subtle text-success">New</span>
    </div>`).join('') : PWIDGETS.emptyState('bi-building-add','No new listings','No new competitors detected recently.');

  function seededPct(seed){ let h=0; for(let i=0;i<seed.length;i++){h=(h*31+seed.charCodeAt(i))|0;} return (Math.abs(h)%1000)/1000; }
});
