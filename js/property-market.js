document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Market Intelligence', subtitle:'An executive overview of the competitive market around your property.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  const comps = PORTALDATA.competitors(propertyId);
  const today = PORTALDATA.dateKeyOffset(0);

  const rates = comps.map(c=>PORTALDATA.competitorRateOnDate(c, today)).sort((a,b)=>a-b);
  const marketAvg = Math.round(rates.reduce((a,b)=>a+b,0)/rates.length);
  const median = rates[Math.floor(rates.length/2)];
  const cheapest = comps.reduce((min,c)=> PORTALDATA.competitorRateOnDate(c,today) < PORTALDATA.competitorRateOnDate(min,today) ? c : min);
  const priciest = comps.reduce((max,c)=> PORTALDATA.competitorRateOnDate(c,today) > PORTALDATA.competitorRateOnDate(max,today) ? c : max);
  const demand = PORTALDATA.demandIndex(propertyId, today);
  const weekendRate = Math.round(comps.reduce((s,c)=>s+PORTALDATA.competitorRateOnDate(c, PORTALDATA.dateKeyOffset(nextWeekendOffset())),0)/comps.length);
  const weekendPremium = (((weekendRate-marketAvg)/marketAvg)*100).toFixed(1);
  const holidayDate = PORTALDATA.dateKeyOffset(nextHolidayOffset());
  const holidayRate = Math.round(comps.reduce((s,c)=>s+PORTALDATA.competitorRateOnDate(c, holidayDate),0)/comps.length);
  const holidayPremium = (((holidayRate-marketAvg)/marketAvg)*100).toFixed(1);
  const marketOcc = PORTALDATA.expectedOccupancy(propertyId, today);
  const supply = comps.length;
  const yesterdayAvg = Math.round(comps.reduce((s,c)=>s+PORTALDATA.competitorRateOnDate(c, PORTALDATA.dateKeyOffset(-1)),0)/comps.length);
  const marketTrendPct = (((marketAvg-yesterdayAvg)/yesterdayAvg)*100).toFixed(1);

  function nextWeekendOffset(){ for(let d=0; d<7; d++){ if(PORTALDATA.isWeekend(PORTALDATA.dateKeyOffset(d))) return d; } return 5; }
  function nextHolidayOffset(){ for(let d=0; d<365; d++){ if(PORTALDATA.isHoliday(PORTALDATA.dateKeyOffset(d))) return d; } return 30; }

  document.getElementById('marketKpis').innerHTML = [
    PWIDGETS.kpiCard({icon:'bi-bar-chart', color:'#3861fb', bg:'#eef4ff', label:'Market Average', value:APP.fmtCurrency(marketAvg)}),
    PWIDGETS.kpiCard({icon:'bi-distribute-vertical', color:'#8c5cf7', bg:'#f3eeff', label:'Median Rate', value:APP.fmtCurrency(median)}),
    PWIDGETS.kpiCard({icon:'bi-arrow-down-circle', color:'#12b76a', bg:'#e7faf1', label:'Cheapest Hotel', value:cheapest.name, sub:APP.fmtCurrency(PORTALDATA.competitorRateOnDate(cheapest,today))}),
    PWIDGETS.kpiCard({icon:'bi-arrow-up-circle', color:'#ff4d5e', bg:'#fff0f1', label:'Most Expensive', value:priciest.name, sub:APP.fmtCurrency(PORTALDATA.competitorRateOnDate(priciest,today))}),
    PWIDGETS.kpiCard({icon:'bi-fire', color:'#ff9f43', bg:'#fff4e8', label:'Demand Index', value:`${demand}/100`}),
    PWIDGETS.kpiCard({icon:'bi-calendar-week', color:'#3861fb', bg:'#eef4ff', label:'Weekend Premium', value:`${weekendPremium>=0?'+':''}${weekendPremium}%`}),
    PWIDGETS.kpiCard({icon:'bi-stars', color:'#b9791a', bg:'#fff8e6', label:'Holiday Premium', value:`${holidayPremium>=0?'+':''}${holidayPremium}%`}),
    PWIDGETS.kpiCard({icon:'bi-people', color:'#00c2a8', bg:'#e6fbf8', label:'Market Occupancy', value:`${marketOcc}%`}),
    PWIDGETS.kpiCard({icon:'bi-graph-up', color: marketTrendPct>=0?'#ff4d5e':'#12b76a', bg: marketTrendPct>=0?'#fff0f1':'#e7faf1', label:'Market Trend', value:`${marketTrendPct>=0?'+':''}${marketTrendPct}%`}),
    PWIDGETS.kpiCard({icon:'bi-buildings', color:'#3861fb', bg:'#eef4ff', label:'Supply (Tracked Hotels)', value:supply}),
  ].join('');

  const labels=[], data=[];
  for(let d=-30; d<=30; d+=2){ const dk=PORTALDATA.dateKeyOffset(d); labels.push(dk.slice(5)); data.push(Math.round(comps.reduce((s,c)=>s+PORTALDATA.competitorRateOnDate(c,dk),0)/comps.length)); }
  new Chart(document.getElementById('marketTrendChart'), {
    type:'line',
    data:{ labels, datasets:[{label:'Market Average', data, borderColor:'#8c5cf7', backgroundColor:'rgba(140,92,247,.08)', tension:.35, fill:true}] },
    options:{ responsive:true, plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
  });

  const buckets={}; rates.forEach(r=>{ const b=Math.floor(r/1000)*1000; buckets[b]=(buckets[b]||0)+1; });
  const bkeys = Object.keys(buckets).map(Number).sort((a,b)=>a-b);
  new Chart(document.getElementById('marketDistChart'), {
    type:'bar',
    data:{ labels:bkeys.map(k=>`₹${k/1000}k+`), datasets:[{label:'Hotels', data:bkeys.map(k=>buckets[k]), backgroundColor:'#3861fb', borderRadius:6}] },
    options:{ responsive:true, plugins:{legend:{display:false}} }
  });

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
    <div class="kv-row"><span class="k">Avg. Distance</span><span class="v">${(comps.reduce((s,c)=>s+c.distanceKm,0)/comps.length).toFixed(1)} km</span></div>
    <div class="kv-row"><span class="k">Price Spread</span><span class="v">${APP.fmtCurrency(rates[rates.length-1]-rates[0])}</span></div>`;

  const newListings = comps.filter(c=> seededPct(c.id+'new') > 0.85).slice(0,4);
  document.getElementById('newListings').innerHTML = newListings.length ? newListings.map(c=>`
    <div class="d-flex align-items-center gap-2 mb-2">
      <img src="${c.image}" style="width:32px;height:32px;border-radius:8px;object-fit:cover">
      <div class="flex-grow-1"><div class="fw-semibold" style="font-size:.8rem">${c.name}</div><div class="text-muted" style="font-size:.7rem">${c.distanceKm}km away</div></div>
      <span class="badge bg-success-subtle text-success">New</span>
    </div>`).join('') : PWIDGETS.emptyState('bi-building-add','No new listings','No new competitors detected recently.');

  function seededPct(seed){ let h=0; for(let i=0;i<seed.length;i++){h=(h*31+seed.charCodeAt(i))|0;} return (Math.abs(h)%1000)/1000; }
});
