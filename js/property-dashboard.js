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
  const cheapestComp = comps.length ? comps.reduce((min,c)=> PORTALDATA.competitorRateOnDate(c,today) < PORTALDATA.competitorRateOnDate(min,today) ? c : min) : null;
  const priciestComp = comps.length ? comps.reduce((max,c)=> PORTALDATA.competitorRateOnDate(c,today) > PORTALDATA.competitorRateOnDate(max,today) ? c : max) : null;
  const priceIndex = Math.round((myRate/marketAvg)*100);
  const ratePosition = myRate<lowest ? 'Below Market' : myRate>highest ? 'Above Market' : 'Within Market';
  // Rate Parity Score — % of your own Direct-vs-OTA room/rate-plan pairs (today) where the OTA
  // isn't undercutting your Direct rate. Shared with Market Intelligence's parity alert and
  // pricing recommendation (PORTALDATA.parityScore/firstParityViolation) so the two pages never
  // disagree on whether a parity issue exists.
  const parityScore = PORTALDATA.parityScore(propertyId, today);
  const yesterdayRate = PORTALDATA.myRateOnDate(propertyId, PORTALDATA.dateKeyOffset(-1));
  const rateChangePct = ((myRate-yesterdayRate)/yesterdayRate*100).toFixed(1);

  // ---- Slim quick-actions bar — one-click shortcuts to the pages an owner reaches for most
  // often; the stats this used to show (My Rate, Market Avg, Lowest/Highest, Position,
  // Competitors Tracked) are already covered by the KPI cards directly below. ----
  document.getElementById('quickActionsBar').innerHTML = [
    { icon:'bi-calendar3-week', label:'Set Rates', href:`property-details.html?id=${propertyId}&tab=ratecalendar` },
    { icon:'bi-magic', label:'View Forecast', href:'property-market.html?tab=recommendations' },
    { icon:'bi-lightning-charge-fill', label:'Action Center', href:'property-market.html?tab=action' },
    { icon:'bi-search', label:'Rate Shopper', href:'property-rate-shopper.html' },
    { icon:'bi-building', label:'Competitors', href:'property-competitors.html' },
  ].map(a=>`<a href="${a.href}" class="qa-btn"><i class="bi ${a.icon}"></i>${a.label}</a>`).join('');

  // ---- Section 1: Your Property ----
  document.getElementById('kpiYourProperty').innerHTML = [
    PWIDGETS.kpiCard({icon:'bi-cash-coin', color:'#0041d9', bg:'#e6e6fa', label:'Current Hotel Rate', value:APP.fmtCurrency(myRate), sub:`${rateChangePct>=0?'+':''}${rateChangePct}% vs yesterday`, subDir: rateChangePct>=0?'up':'down',
      desc:"Your own property's rate for today, on your Direct (Master) channel."}),
    PWIDGETS.kpiCard({icon:'bi-percent', color: rateChangePct>=0?'#12b76a':'#ff4d5e', bg: rateChangePct>=0?'#e7faf1':'#fff0f1', label:'Rate Change %', value:`${rateChangePct>=0?'+':''}${rateChangePct}%`,
      desc:"How much your own rate has moved compared to yesterday."}),
    PWIDGETS.kpiCard({icon:'bi-speedometer', color:'#0073cf', bg:'#e6e6fa', label:'Price Index', value:`${priceIndex}`, sub:'vs. market = 100',
      desc:'Your rate as a percentage of the market average. 100 = exactly at market; above 100 means you\'re priced higher than the market, below means lower.'}),
    PWIDGETS.kpiCard({icon:'bi-signpost-split', color:'#0041d9', bg:'#e6e6fa', label:'Rate Position', value:ratePosition,
      desc:"Whether your rate sits below, within, or above the range set by your cheapest and most expensive comparison properties."}),
    PWIDGETS.kpiCard({icon:'bi-shield-check', color:'#00c2a8', bg:'#e6fbf8', label:'Rate Parity Score', value:`${parityScore}/100`,
      desc:'How consistently your rate is honored across channels — a lower score means one or more OTAs may be undercutting your Direct rate.'}),
  ].join('');

  // ---- Section 2: Market Overview — every card mentions the total tracked competitor count ----
  document.getElementById('kpiMarketOverview').innerHTML = [
    PWIDGETS.kpiCard({icon:'bi-bar-chart', color:'#8c5cf7', bg:'#f3eeff', label:'Market Average', value:APP.fmtCurrency(marketAvg), sub:`across ${comps.length} competitors tracked`, subDir:'flat',
      desc:"The average rate across all your assigned comparison properties for today."}),
    PWIDGETS.kpiCard({icon:'bi-arrow-down-circle', color:'#12b76a', bg:'#e7faf1', label:'Lowest Market Rate', value:APP.fmtCurrency(lowest), sub:`out of ${comps.length} competitors tracked`, subDir:'flat',
      desc:'The cheapest rate among your comparison properties today.'}),
    PWIDGETS.kpiCard({icon:'bi-arrow-up-circle', color:'#ff4d5e', bg:'#fff0f1', label:'Highest Market Rate', value:APP.fmtCurrency(highest), sub:`out of ${comps.length} competitors tracked`, subDir:'flat',
      desc:'The most expensive rate among your comparison properties today.'}),
    // Value leads with the rate (a short number, like every other card in this row) and the
    // property name moves to the sub-line — a full competitor name as the headline "value" could
    // run to two lines on a narrow 1/5-width card, stretching every other card in the same row
    // to match its height and leaving them with an odd gap of empty space underneath.
    PWIDGETS.kpiCard({icon:'bi-trophy', color:'#12b76a', bg:'#e7faf1', label:'Cheapest Competitor', value: cheapestComp ? APP.fmtCurrency(PORTALDATA.competitorRateOnDate(cheapestComp,today)) : '—', sub: cheapestComp ? cheapestComp.name : `out of ${comps.length} tracked`, subDir:'flat',
      desc:'Which comparison property currently has the lowest rate.'}),
    PWIDGETS.kpiCard({icon:'bi-gem', color:'#ff4d5e', bg:'#fff0f1', label:'Most Expensive Competitor', value: priciestComp ? APP.fmtCurrency(PORTALDATA.competitorRateOnDate(priciestComp,today)) : '—', sub: priciestComp ? priciestComp.name : `out of ${comps.length} tracked`, subDir:'flat',
      desc:'Which comparison property currently has the highest rate.'}),
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

  // My Rate vs. Market Average — four series (Our Property, Market Average, Highest/Lowest
  // Competitor) over a selectable trailing window, so "where do I stand" and "how wide is the
  // market spread" are both visible on the same chart instead of just the average.
  let rateTrendChart = null;
  function renderRateTrend(days){
    const labels = [], myLine = [], marketLine = [], highLine = [], lowLine = [];
    for(let d=-(days-1); d<=0; d++){
      const dk = PORTALDATA.dateKeyOffset(d);
      labels.push(dk.slice(5));
      myLine.push(PORTALDATA.myRateOnDate(propertyId, dk));
      marketLine.push(avgCompRateOn(dk));
      const { min, max } = minMaxCompRateOn(dk);
      highLine.push(max);
      lowLine.push(min);
    }
    document.getElementById('rateTrendSubtitle').textContent = `Our rate vs. the market, trailing ${days} days.`;
    // Update the existing chart in place (labels/data only) rather than destroy+recreate — Chart.js
    // animates the transition between the old and new values, so switching 7D/14D/30D reads as a
    // smooth tween instead of the chart flashing away and redrawing from scratch.
    if(rateTrendChart){
      rateTrendChart.data.labels = labels;
      rateTrendChart.data.datasets[0].data = myLine;
      rateTrendChart.data.datasets[1].data = marketLine;
      rateTrendChart.data.datasets[2].data = highLine;
      rateTrendChart.data.datasets[3].data = lowLine;
      rateTrendChart.update();
      return;
    }
    rateTrendChart = new Chart(document.getElementById('rateTrendChart'), {
      type:'line',
      data:{ labels, datasets:[
        {label:'Our Property Avg. Rate', data:myLine, borderColor:'#0041d9', backgroundColor:'rgba(56,97,251,.1)', borderWidth:3, tension:.35, fill:true, pointRadius:0, pointHoverRadius:5},
        {label:'Market Average', data:marketLine, borderColor:'#ff9f43', backgroundColor:'transparent', borderDash:[5,4], borderWidth:2, tension:.35, fill:false, pointRadius:0, pointHoverRadius:4},
        {label:'Highest Competitor', data:highLine, borderColor:'#ff4d5e', backgroundColor:'transparent', borderDash:[2,3], borderWidth:1.5, tension:.35, fill:false, pointRadius:0, pointHoverRadius:4},
        {label:'Lowest Competitor', data:lowLine, borderColor:'#12b76a', backgroundColor:'transparent', borderDash:[2,3], borderWidth:1.5, tension:.35, fill:false, pointRadius:0, pointHoverRadius:4}
      ]},
      options:{
        responsive:true, animation:chartAnim(false), interaction:{mode:'index', intersect:false},
        plugins:{
          legend:{ position:'bottom', labels:{boxWidth:12, boxHeight:12, usePointStyle:true, pointStyle:'line', padding:14} },
          tooltip:{ callbacks:{ label:ctx=>`${ctx.dataset.label}: ${APP.fmtCurrency(ctx.parsed.y)}` } }
        },
        scales:{ y:{ ticks:{ callback:v=>APP.fmtCurrency(v) } } }
      }
    });
  }
  renderRateTrend(14);
  document.querySelectorAll('#rateTrendRangeGroup [data-days]').forEach(btn=>{
    btn.addEventListener('click', function(){
      document.querySelectorAll('#rateTrendRangeGroup [data-days]').forEach(b=>{ b.classList.remove('btn-outline-primary'); b.classList.add('btn-soft'); });
      this.classList.remove('btn-soft'); this.classList.add('btn-outline-primary');
      renderRateTrend(Number(this.dataset.days));
    });
  });

  // ---- Competitor Comparison: compact table ----
  const compRows = comps.map(c=>{
    const rate = PORTALDATA.competitorRateOnDate(c, today);
    const diff = rate - myRate;
    return { name:c.name, rate, diff };
  }).sort((a,b)=>a.rate-b.rate);
  document.getElementById('competitorComparisonChip').textContent = `${comps.length} tracked`;
  document.getElementById('competitorComparisonTable').innerHTML = `
    <thead><tr><th>Competitor</th><th>Rate</th><th>Difference</th></tr></thead>
    <tbody>${compRows.map(r=>`<tr>
      <td>${r.name}</td>
      <td class="fw-semibold">${APP.fmtCurrency(r.rate)}</td>
      <td class="${r.diff>=0?'text-danger':'text-success'}">${r.diff>=0?'+':''}${APP.fmtCurrency(r.diff)}</td>
    </tr>`).join('') || `<tr><td colspan="3" class="text-center text-muted py-3">No comparison properties assigned yet.</td></tr>`}</tbody>`;

  // ---- Price Trends: merged daily/weekly/monthly, tab-switchable ----
  const dailyLabels=[], dailyData=[];
  for(let d=-13; d<=0; d++){ const dk=PORTALDATA.dateKeyOffset(d); dailyLabels.push(dk.slice(5)); dailyData.push(PORTALDATA.myRateOnDate(propertyId,dk)); }
  trendDatasets.daily = { labels:dailyLabels, data:dailyData, color:'#0041d9', legendLabel:'My Rate — Daily (last 14 days)' };

  const weeklyLabels=[], weeklyData=[];
  for(let w=11; w>=0; w--){
    let sum=0; for(let d=0; d<7; d++){ sum += PORTALDATA.myRateOnDate(propertyId, PORTALDATA.dateKeyOffset(-(w*7+d))); }
    weeklyLabels.push(`W-${w}`); weeklyData.push(Math.round(sum/7));
  }
  trendDatasets.weekly = { labels:weeklyLabels, data:weeklyData, color:'#00c2a8', legendLabel:'My Rate — Weekly Average (last 12 weeks)' };

  const monthlyLabels=[], monthlyData=[];
  for(let m=5; m>=0; m--){
    let sum=0, cnt=0; for(let d=0; d<30; d+=5){ sum += PORTALDATA.myRateOnDate(propertyId, PORTALDATA.dateKeyOffset(-(m*30+d))); cnt++; }
    monthlyLabels.push(`M-${m}`); monthlyData.push(Math.round(sum/cnt));
  }
  trendDatasets.monthly = { labels:monthlyLabels, data:monthlyData, color:'#8c5cf7', legendLabel:'My Rate — Monthly Average (last 6 months)' };

  // A legend on a single-line chart still earns its keep here: the line's meaning (what's
  // averaged, over what window) changes with the Daily/Weekly/Monthly toggle, so the label needs
  // to change with it too instead of leaving the line unexplained.
  function renderTrend(range){
    const t = trendDatasets[range];
    const ctx = document.getElementById('priceTrendChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, t.color+'40');
    gradient.addColorStop(1, t.color+'02');
    // Update in place — Daily/Weekly/Monthly still tween the line rather than blinking away and
    // redrawing, even though the label meaning, color, and point count all change together.
    if(priceTrendChart){
      const ds = priceTrendChart.data.datasets[0];
      priceTrendChart.data.labels = t.labels;
      ds.data = t.data; ds.label = t.legendLabel;
      ds.borderColor = t.color; ds.backgroundColor = gradient;
      ds.pointHoverBackgroundColor = t.color;
      priceTrendChart.update();
      return;
    }
    priceTrendChart = new Chart(ctx, {
      type:'line',
      data:{ labels:t.labels, datasets:[{
        label:t.legendLabel, data:t.data, borderColor:t.color, backgroundColor:gradient,
        borderWidth:2.5, tension:.35, fill:true, pointRadius:0, pointHoverRadius:5,
        pointHoverBackgroundColor:t.color, pointHoverBorderColor:'#fff', pointHoverBorderWidth:2
      }] },
      options:{
        responsive:true, maintainAspectRatio:false, animation:chartAnim(false),
        interaction:{ mode:'index', intersect:false },
        plugins:{
          legend:{ display:true, position:'bottom', labels:{boxWidth:12, boxHeight:12, usePointStyle:true, pointStyle:'line', padding:14} },
          tooltip:{ callbacks:{ label:ctx=>APP.fmtCurrency(ctx.parsed.y) } }
        },
        scales:{
          x:{ grid:{ display:false }, ticks:{ maxRotation:0, autoSkip:true, maxTicksLimit:7 } },
          y:{ grid:{ color:'rgba(120,130,160,.12)' }, ticks:{ callback:v=>APP.fmtCurrency(v), maxTicksLimit:5 } }
        }
      }
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

  initRevenueCalendar(propertyId, comps);

  // ---- Today's Revenue Brief — an executive summary distilled from the same underlying
  // signals as Market Intelligence's Insight Generation and Action Center (market gap, channel
  // parity, competitor movement, room-level pricing opportunity), so the Dashboard's headline
  // card and the deeper analysis pages never tell a different story. Each bullet only appears
  // when its condition is actually true today — nothing here is filler. ----
  function generateRevenueBrief(){
    const bullets = [];
    const overallDiffPct = ((myRate-marketAvg)/marketAvg*100);

    if(Math.abs(overallDiffPct) >= 4){
      const over = overallDiffPct > 0;
      bullets.push({ icon: over?'bi-arrow-up-circle-fill':'bi-arrow-down-circle-fill', tone: over?'warn':'danger',
        text:`You are ${Math.abs(overallDiffPct).toFixed(0)}% ${over?'above':'below'} market.` });
    } else {
      bullets.push({ icon:'bi-check-circle-fill', tone:'success', text:'Your rate is well aligned with the market today.' });
    }

    if(comps.length){
      const moves = comps.map(c=>{
        const t = PORTALDATA.competitorRateOnDate(c, today);
        const y = PORTALDATA.competitorRateOnDate(c, PORTALDATA.dateKeyOffset(-1));
        return t>y ? 1 : t<y ? -1 : 0;
      });
      const upCount = moves.filter(m=>m>0).length, downCount = moves.filter(m=>m<0).length;
      if(upCount>0 && upCount>=downCount){
        bullets.push({ icon:'bi-graph-up-arrow', tone:'info', text:`${upCount} competitor${upCount===1?'':'s'} increased ${upCount===1?'its':'their'} price today.` });
      } else if(downCount>0){
        bullets.push({ icon:'bi-graph-down-arrow', tone:'warn', text:`${downCount} competitor${downCount===1?'':'s'} cut ${downCount===1?'its':'their'} price today.` });
      }
    }

    const violation = PORTALDATA.firstParityViolation(propertyId, today);
    if(violation){
      const gapPct = Math.round((violation.directPrice-violation.otaPrice)/violation.directPrice*100);
      bullets.push({ icon:'bi-exclamation-octagon-fill', tone:'danger', text:`${violation.channel.name} parity issue detected — ${gapPct}% below your Direct rate.` });
    }

    // Which of my own rooms is priced furthest below its matched competitor rooms (same room
    // name on each comparison property's Master channel) — the strongest case for a rate raise.
    const channels = DB.channels.byProperty(propertyId);
    const master = channels.find(c=>c.type==='master');
    if(master && comps.length){
      function roomAvgRate(roomId){
        const plans = DB.ratePlans.byRoom(roomId);
        if(!plans.length) return null;
        const room = DB.rooms.get(roomId);
        const prices = plans.map(p=>{ const day=DB.rates.forPlan(p.id)[today]; return day ? day.price : room.basePrice; });
        return prices.reduce((a,b)=>a+b,0)/prices.length;
      }
      let best = null;
      DB.rooms.byChannel(master.id).forEach(room=>{
        const myRoomRate = roomAvgRate(room.id);
        if(myRoomRate==null) return;
        const matched = [];
        comps.forEach(c=>{
          const compMaster = DB.channels.byProperty(c.realPropertyId).find(ch=>ch.type==='master');
          if(!compMaster) return;
          const matchRoom = DB.rooms.byChannel(compMaster.id).find(r=>r.name===room.name);
          if(!matchRoom) return;
          const rate = roomAvgRate(matchRoom.id);
          if(rate!=null) matched.push(rate);
        });
        if(!matched.length) return;
        const matchedAvg = matched.reduce((a,b)=>a+b,0)/matched.length;
        const gapPct = ((matchedAvg-myRoomRate)/myRoomRate)*100; // positive = my room is cheaper = opportunity
        if(gapPct>6 && (!best || gapPct>best.gapPct)) best = { room, gapPct };
      });
      if(best) bullets.push({ icon:'bi-door-open-fill', tone:'success', text:`${best.room.name} has the strongest pricing opportunity — ${Math.round(best.gapPct)}% below comparable rooms.` });
    }

    return bullets.slice(0,4);
  }

  const brief = generateRevenueBrief();
  const toneIcon = { warn:'#b9791a', danger:'#ff4d5e', success:'#12b76a', info:'#0041d9' };
  const toneBg = { warn:'#fff8e6', danger:'#fff0f1', success:'#e7faf1', info:'#e6e6fa' };

  document.getElementById('revenueBriefChip').innerHTML = `<i class="bi bi-stars me-1"></i>${brief.length} Insight${brief.length===1?'':'s'}`;
  document.getElementById('ratePositionWidget').innerHTML = `
    <div class="rp-brief">
      <ul class="rp-brief-list">
        ${brief.map(b=>`<li class="rp-brief-item">
          <span class="rp-brief-dot" style="background:${toneBg[b.tone]};color:${toneIcon[b.tone]}"><i class="bi ${b.icon}"></i></span>
          <span>${b.text}</span>
        </li>`).join('')}
      </ul>
      <a href="property-market.html?tab=action" class="rp-brief-link">Open Action Center <i class="bi bi-arrow-right ms-1"></i></a>
    </div>`;

  // Leaderboard (top 5 by rate diff) — each row's chip shows that competitor's rate vs. mine, so
  // the leaderboard reads as "who's cheaper/pricier than me and by how much" at a glance instead
  // of just a raw price list you'd have to mentally compare to the number up in the KPI row.
  const leaderboard = [...comps].map(c=>({...c, rate:PORTALDATA.competitorRateOnDate(c,today)})).sort((a,b)=>a.rate-b.rate).slice(0,5);
  document.getElementById('leaderboardWidget').innerHTML = leaderboard.map((c,i)=>{
    const diffPct = myRate ? ((c.rate-myRate)/myRate*100) : 0;
    const cheaper = diffPct < 0;
    return `<div class="leaderboard-row">
      <div class="leaderboard-rank">${i+1}</div>
      <img src="${c.image}" style="width:34px;height:34px;border-radius:8px;object-fit:cover">
      <div class="flex-grow-1">
        <div class="fw-semibold" style="font-size:.82rem">${c.name}</div>
        <div class="text-muted" style="font-size:.7rem">${c.distanceKm}km • ${c.stars}★</div>
      </div>
      <div class="text-end">
        <div class="fw-bold" style="font-size:.82rem">${APP.fmtCurrency(c.rate)}</div>
        <span class="dash-chip ${cheaper?'dash-chip-down':'dash-chip-up'}">${diffPct>=0?'+':''}${diffPct.toFixed(0)}%</span>
      </div>
    </div>`;
  }).join('');

  // Channel performance widget (top channels by ADR) — a "vs Direct" chip per channel makes the
  // list answer "which channels are undercutting my own Direct rate" without a separate lookup.
  document.getElementById('channelPerfChip').textContent = `${PORTALDATA.CHANNELS.length} Channels`;
  document.getElementById('channelPerfWidget').innerHTML = `<div class="d-flex flex-column gap-2">${PORTALDATA.CHANNELS.slice(0,5).map(ch=>{
    const rate = PORTALDATA.channelRate(myRate, ch.key, today);
    const diffPct = myRate ? ((rate-myRate)/myRate*100) : 0;
    const isDirect = ch.key === 'direct';
    return `<div class="d-flex align-items-center justify-content-between">
      ${PWIDGETS.channelChip(ch.key)}
      <div class="text-end d-flex align-items-center gap-2">
        ${isDirect ? '' : `<span class="dash-chip ${diffPct<0?'dash-chip-down':'dash-chip-up'}">${diffPct>=0?'+':''}${diffPct.toFixed(0)}%</span>`}
        <span class="fw-semibold" style="font-size:.8rem">${APP.fmtCurrency(rate)}</span>
      </div>
    </div>`;
  }).join('')}</div>`;
});

/* ==========================================================================
   Revenue Intelligence Calendar — a compact month grid where each day carries only the
   essentials (rate, a market-position color, an action indicator); everything else (mapped
   competitor prices, parity, recommendation, confidence, recent competitor movement, suggested
   rate) lives in the persistent detail panel beside the grid — hover previews a date, click locks
   it in — rather than a floating popover the user has to chase around the screen. Reuses the
   same signals as Today's Revenue Brief and Decision & Actions
   (PORTALDATA.myRateOnDate/competitorRateOnDate/firstParityViolation) so this calendar never
   disagrees with the rest of the dashboard about what's happening on a given date.
   ========================================================================== */
function initRevenueCalendar(propertyId, comps){
  const grid = document.getElementById('ric_grid');
  const detail = document.getElementById('ric_detail');
  if(!grid || !detail) return;

  let anchor = new Date(); anchor.setDate(1); anchor.setHours(0,0,0,0);
  let pinnedDk = null; // date key locked in by a click — survives mouse-out, previewed by hover otherwise

  function dayInfo(date){
    const dk = DB.fmtDate(date);
    const prevDk = DB.fmtDate(new Date(date.getTime()-86400000));
    const myR = PORTALDATA.myRateOnDate(propertyId, dk);
    const compRates = comps.map(c=>({ name:c.name, rate:PORTALDATA.competitorRateOnDate(c, dk) })).sort((a,b)=>a.rate-b.rate);
    const mktAvg = compRates.length ? Math.round(compRates.reduce((s,c)=>s+c.rate,0)/compRates.length) : myR;
    const gapPct = mktAvg ? ((myR-mktAvg)/mktAvg*100) : 0;
    // Opportunity = priced below market (room to raise) · Risk = priced above it (losing
    // competitiveness) · Aligned = within a quiet band either side — the vast majority of days,
    // deliberately left unaccented so the few days that actually need a look stand out.
    const tone = gapPct <= -4 ? 'opp' : gapPct >= 4 ? 'risk' : 'aligned';
    const violation = comps.length ? PORTALDATA.firstParityViolation(propertyId, dk) : null;
    const moveDeltas = comps.map(c=>{
      const t = PORTALDATA.competitorRateOnDate(c, dk), y = PORTALDATA.competitorRateOnDate(c, prevDk);
      return y ? ((t-y)/y*100) : 0;
    });
    const upCount = moveDeltas.filter(m=>m>0).length, downCount = moveDeltas.filter(m=>m<0).length;
    const avgMovePct = moveDeltas.length ? moveDeltas.reduce((a,b)=>a+b,0)/moveDeltas.length : 0;

    let action, actionIcon, confidence, suggested;
    if(gapPct <= -6){
      action = 'Increase'; actionIcon = 'bi-arrow-up-circle-fill';
      confidence = Math.min(96, 58 + Math.round(Math.abs(gapPct)));
      suggested = Math.max(500, Math.round((myR + (mktAvg-myR)*0.6)/10)*10);
    } else if(gapPct >= 6){
      action = 'Decrease'; actionIcon = 'bi-arrow-down-circle-fill';
      confidence = Math.min(96, 58 + Math.round(Math.abs(gapPct)));
      suggested = Math.max(500, Math.round((myR - (myR-mktAvg)*0.5)/10)*10);
    } else {
      action = 'Hold'; actionIcon = 'bi-check-circle-fill'; confidence = 88; suggested = myR;
    }
    if(violation) actionIcon = 'bi-exclamation-octagon-fill';

    // ---- Market Position — where "you" rank among every mapped competitor on this date, plus a
    // Price Index (100 = exactly at market average) — same convention as the Dashboard KPIs. ----
    const property = DB.properties.get(propertyId);
    const ranked = [...compRates.map(c=>({ name:c.name, rate:c.rate, isMe:false })),
      { name:`${property ? property.name : 'Your Property'} (You)`, rate:myR, isMe:true }]
      .sort((a,b)=>a.rate-b.rate);
    const rank = ranked.findIndex(r=>r.isMe)+1;
    const priceIndex = mktAvg ? Math.round((myR/mktAvg)*100) : 100;

    return { dk, date, myR, compRates, mktAvg, gapPct, tone, violation, upCount, downCount, avgMovePct, action, actionIcon, confidence, suggested,
      ranked, rank, priceIndex };
  }

  const TONE_META = {
    opp:     { label:'Opportunity', dotClass:'tone-opp'     },
    risk:    { label:'Risk',        dotClass:'tone-risk'    },
    aligned: { label:'Aligned',     dotClass:'tone-aligned' }
  };

  function detailHtml(info, isPinned){
    const tm = TONE_META[info.tone];
    const actionLabel = info.action==='Increase' ? 'Raise Rate' : info.action==='Decrease' ? 'Lower Rate' : 'Hold Rate';

    // ---- Recommendation rationale — market position and rate-parity only, never a revenue or
    // booking-volume claim (this app models rates, not occupancy/bookings). ----
    let rationale;
    if(info.violation){
      rationale = `${info.violation.channel.name} is undercutting your Direct rate — resolving this parity gap takes priority over any rate move above.`;
    } else if(info.action==='Increase'){
      rationale = `Market average is running ${Math.abs(info.gapPct).toFixed(1)}% above your rate — room to raise while staying competitively positioned.`;
    } else if(info.action==='Decrease'){
      rationale = `You're priced ${Math.abs(info.gapPct).toFixed(1)}% above the market average — a measured pullback keeps you from losing competitive ground.`;
    } else {
      rationale = `Your rate is well aligned with the ${info.compRates.length}-property market average — no change needed.`;
    }

    return `
      <div class="ric-detail-head">
        <div>
          <div class="ric-detail-date">${info.date.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'short',year:'numeric'})}</div>
          <span class="ric-detail-tone"><span class="dot ${tm.dotClass}"></span>${tm.label}</span>
        </div>
        ${isPinned ? `<span class="ric-detail-pin"><i class="bi bi-pin-angle-fill me-1"></i>Selected</span>` : ''}
      </div>

      <div class="ric-detail-label mb-2">Market Position</div>
      <div class="ric-position-grid cols-4 mb-3">
        <div class="fc-scenario-stat"><div class="k">Rank</div><div class="v">${info.rank} / ${info.ranked.length}</div></div>
        <div class="fc-scenario-stat"><div class="k">Your Rate</div><div class="v">${APP.fmtCurrency(info.myR)}</div></div>
        <div class="fc-scenario-stat"><div class="k">Market Avg</div><div class="v">${APP.fmtCurrency(info.mktAvg)}</div></div>
        <div class="fc-scenario-stat"><div class="k">Price Index</div><div class="v">${info.priceIndex}</div></div>
      </div>

      <div class="ric-detail-grid mb-1">
        <div>
          <span class="k">Rate vs Market</span>
          <span class="v" style="${info.gapPct>=0?'color:var(--ric-risk)':'color:var(--ric-opp)'}">${info.gapPct>=0?'+':''}${info.gapPct.toFixed(1)}%</span>
        </div>
        <div>
          <span class="k">Parity Status</span>
          <span class="v" style="${info.violation?'color:var(--ric-alert)':'color:var(--ric-opp)'}">${info.violation?'Undercut':'On Track'}</span>
        </div>
      </div>
      <div class="ric-detail-grid mb-3">
        <div class="text-muted" style="font-size:.66rem;line-height:1.4">Your rate is ${Math.abs(info.gapPct).toFixed(1)}% ${info.gapPct>=0?'above':'below'} the mapped-competitor average.</div>
        <div class="text-muted" style="font-size:.66rem;line-height:1.4">${info.violation ? `${info.violation.channel.name} undercutting Direct by ${Math.round((info.violation.directPrice-info.violation.otaPrice)/info.violation.directPrice*100)}%.` : 'No parity issues detected on this date.'}</div>
      </div>

      ${info.ranked.length>1 ? `<div class="ric-detail-section">
        <div class="ric-detail-label">Competitor Rates</div>
        <div class="ric-comp-table">
          ${info.ranked.map((r,i)=>{
            const diffPct = info.mktAvg ? ((r.rate-info.mktAvg)/info.mktAvg*100) : 0;
            return `<div class="ric-comp-row ${r.isMe?'is-me':''}">
              <span class="ric-comp-rank">${i+1}</span>
              <span class="ric-comp-name">${r.name}</span>
              <span class="ric-comp-rate">${APP.fmtCurrency(r.rate)}</span>
              <span class="ric-comp-diff ${diffPct>=0?'up':'down'}">${diffPct>=0?'+':''}${diffPct.toFixed(1)}%</span>
            </div>`;
          }).join('')}
          ${Array.from({length:Math.max(0, 5-info.ranked.length)}).map(()=>`<div class="ric-comp-row ric-comp-row-filler"></div>`).join('')}
        </div>
      </div>` : `<div class="ric-detail-section"><div class="text-muted" style="font-size:.71rem">No comparison properties assigned yet.</div></div>`}

      <div class="ric-detail-section">
        <div class="d-flex align-items-center justify-content-between mb-2">
          <div class="ric-detail-label mb-0">Recommendation</div>
          <span class="ric-chip chip-ai"><i class="bi bi-stars me-1"></i>AI Recommended</span>
        </div>
        <div class="ric-detail-recommend">
          <span class="ric-detail-rec-icon"><i class="bi ${info.actionIcon}"></i></span>
          <div class="flex-grow-1">
            <div class="d-flex justify-content-between align-items-center gap-2">
              <span class="ric-detail-rec-title">${actionLabel}</span>
              <span class="ric-detail-confidence">${info.confidence}% Confidence</span>
            </div>
            <div class="ric-confidence-track"><div class="ric-confidence-fill" style="width:${info.confidence}%"></div></div>
            <div class="ric-detail-rec-sub">${rationale}</div>
            ${info.action!=='Hold' ? `<div class="ric-detail-rec-sub">Suggested: <b>${APP.fmtCurrency(info.suggested)}</b></div>` : ''}
          </div>
        </div>
      </div>

      ${comps.length ? `<div class="ric-detail-section">
        <div class="ric-detail-label">Market Signals</div>
        <div class="ric-position-grid cols-3">
          <div class="fc-scenario-stat"><div class="k">Moving Up</div><div class="v">${info.upCount}</div></div>
          <div class="fc-scenario-stat"><div class="k">Moving Down</div><div class="v">${info.downCount}</div></div>
          <div class="fc-scenario-stat"><div class="k">Momentum</div><div class="v" style="font-size:.74rem">${Math.abs(info.avgMovePct)<1 ? 'Stable' : (info.avgMovePct>=0?'Rising':'Falling')}</div></div>
        </div>
      </div>` : ''}
    `;
  }

  // The panel always reflects a real date: hover previews it, a click locks it in (pinnedDk)
  // until another date is clicked or the month changes — never an empty state once the calendar
  // has rendered at least once.
  function renderDetail(dk){
    const cell = dk ? grid.querySelector(`.ric-cell[data-dk="${dk}"]`) : null;
    if(!cell){
      detail.innerHTML = `<div class="ric-detail-empty"><i class="bi bi-calendar3"></i><span>Hover or select a date to see its full breakdown</span></div>`;
      return;
    }
    const info = dayInfo(new Date(dk+'T00:00:00'));
    detail.innerHTML = detailHtml(info, pinnedDk===dk);
  }

  function syncPinnedCellClass(){
    grid.querySelectorAll('.ric-cell.is-pinned').forEach(c=>c.classList.remove('is-pinned'));
    if(pinnedDk){
      const c = grid.querySelector(`.ric-cell[data-dk="${pinnedDk}"]`);
      if(c) c.classList.add('is-pinned');
    }
  }

  function render(){
    document.getElementById('ric_monthLabel').textContent = anchor.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
    const year = anchor.getFullYear(), month = anchor.getMonth();
    const firstDow = new Date(year,month,1).getDay();
    const daysInMonth = new Date(year,month+1,0).getDate();
    const todayKey = DB.fmtDate(new Date());
    const dowLabels = ['S','M','T','W','T','F','S'];

    let html = dowLabels.map(d=>`<div class="ric-dow">${d}</div>`).join('');
    for(let i=0;i<firstDow;i++) html += `<div class="ric-cell ric-empty"></div>`;
    for(let d=1; d<=daysInMonth; d++){
      const date = new Date(year,month,d);
      const dk = DB.fmtDate(date);
      const info = dayInfo(date);
      const cellClasses = ['ric-cell', `tone-${info.tone}`];
      if(dk===todayKey) cellClasses.push('is-today');
      if(info.action!=='Hold') cellClasses.push('has-action');
      html += `<button type="button" class="${cellClasses.join(' ')}" data-dk="${dk}" aria-label="${date.toDateString()}: ${info.action} recommended, our rate ${APP.fmtCurrency(info.myR)}">
        <span class="ric-date">${d}${dk===todayKey?'<i class=\"ric-today-dot\"></i>':''}</span>
        <span class="ric-rate">${APP.fmtCurrency(info.myR)}</span>
        <span class="ric-action-dot"></span>
      </button>`;
    }
    // Always render full weeks (a whole number of 7-cell rows), minimum 5 — some months (e.g. a
    // 28-day February starting on Sunday) only need 4 rows of real dates, and any month can end
    // mid-row (e.g. August 2026 needs 6 rows but the last one only has 2 real dates in it).
    // Trailing filler cells complete whatever the final row is, so every row — including a mostly-
    // empty last one — is a full set of real grid items and gets its hairline borders like any
    // other row, instead of a row with missing gridlines/borders on the un-rendered cells.
    const cellsSoFar = firstDow + daysInMonth;
    const rowsNeeded = Math.max(5, Math.ceil(cellsSoFar/7));
    const minCells = rowsNeeded*7;
    for(let i=cellsSoFar; i<minCells; i++) html += `<div class="ric-cell ric-empty"></div>`;
    grid.innerHTML = html;
    // .ric-grid's CSS default assumes 6 week-rows; keep the actual row count in sync so a
    // 5-row month doesn't reserve a 6th, fully empty row's worth of height (blank space with no
    // border at all, since it would have zero grid items in it).
    grid.style.gridTemplateRows = `auto repeat(${rowsNeeded}, 1fr)`;

    // Whatever date was pinned/hovered before a re-render (e.g. month navigation) may no longer
    // exist in this month — fall back to today if visible, else the 1st of the displayed month,
    // so the panel is never left showing stale or blank content.
    if(!grid.querySelector(`.ric-cell[data-dk="${pinnedDk}"]`)) pinnedDk = null;
    const defaultDk = grid.querySelector(`.ric-cell[data-dk="${todayKey}"]`) ? todayKey : DB.fmtDate(new Date(year,month,1));
    syncPinnedCellClass();
    renderDetail(pinnedDk || defaultDk);

    grid.querySelectorAll('.ric-cell[data-dk]').forEach(cell=>{
      cell.addEventListener('mouseenter', ()=> renderDetail(cell.dataset.dk));
      cell.addEventListener('mouseleave', ()=> renderDetail(pinnedDk || defaultDk));
      cell.addEventListener('focus', ()=> renderDetail(cell.dataset.dk));
      cell.addEventListener('click', ()=>{
        pinnedDk = pinnedDk===cell.dataset.dk ? null : cell.dataset.dk;
        syncPinnedCellClass();
        renderDetail(pinnedDk || defaultDk);
      });
    });
  }

  document.getElementById('ric_prevMonth').addEventListener('click', ()=>{ anchor.setMonth(anchor.getMonth()-1); render(); });
  document.getElementById('ric_nextMonth').addEventListener('click', ()=>{ anchor.setMonth(anchor.getMonth()+1); render(); });

  render();
}
