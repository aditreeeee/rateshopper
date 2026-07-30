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
  // Rate Parity Score — % of your own Direct-vs-OTA room/rate-plan pairs (today) where the OTA
  // isn't undercutting your Direct rate. Shared with Market Intelligence's parity alert and
  // pricing recommendation (PORTALDATA.parityScore/firstParityViolation) so the two pages never
  // disagree on whether a parity issue exists.
  const parityScore = PORTALDATA.parityScore(propertyId, today);
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
    if(rateTrendChart) rateTrendChart.destroy();
    rateTrendChart = new Chart(document.getElementById('rateTrendChart'), {
      type:'line',
      data:{ labels, datasets:[
        {label:'Our Property Avg. Rate', data:myLine, borderColor:'#3861fb', backgroundColor:'rgba(56,97,251,.1)', borderWidth:3, tension:.35, fill:true, pointRadius:0, pointHoverRadius:5},
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
  trendDatasets.daily = { labels:dailyLabels, data:dailyData, color:'#3861fb', legendLabel:'My Rate — Daily (last 14 days)' };

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
    if(priceTrendChart) priceTrendChart.destroy();
    const ctx = document.getElementById('priceTrendChart').getContext('2d');
    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, t.color+'40');
    gradient.addColorStop(1, t.color+'02');
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
  const toneIcon = { warn:'#b9791a', danger:'#ff4d5e', success:'#12b76a', info:'#3861fb' };
  const toneBg = { warn:'#fff8e6', danger:'#fff0f1', success:'#e7faf1', info:'#eef4ff' };

  document.getElementById('ratePositionWidget').innerHTML = `
    <div class="rp-brief">
      <div class="rp-brief-head">
        <div class="text-muted flex-grow-1" style="font-size:.72rem">Executive summary from Insight Generation &amp; Action Center</div>
        <span class="badge bg-primary-subtle text-primary" style="font-size:.58rem"><i class="bi bi-stars me-1"></i>AI</span>
      </div>
      <ul class="rp-brief-list">
        ${brief.map((b,i)=>`<li class="rp-brief-item" style="animation-delay:${i*60}ms">
          <span class="rp-brief-dot" style="background:${toneBg[b.tone]};color:${toneIcon[b.tone]}"><i class="bi ${b.icon}"></i></span>
          <span>${b.text}</span>
        </li>`).join('')}
      </ul>
      <a href="property-market.html?tab=action" class="rp-brief-link">Open Action Center <i class="bi bi-arrow-right ms-1"></i></a>
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

  // Channel performance widget (top channels by ADR)
  document.getElementById('channelPerfWidget').innerHTML = PORTALDATA.CHANNELS.slice(0,5).map(ch=>{
    const rate = PORTALDATA.channelRate(myRate, ch.key, today);
    return `<div class="d-flex align-items-center justify-content-between mb-2">
      ${PWIDGETS.channelChip(ch.key)}
      <span class="fw-semibold" style="font-size:.8rem">${APP.fmtCurrency(rate)}</span>
    </div>`;
  }).join('');
});

/* ==========================================================================
   Revenue Intelligence Calendar — replaces the old Price Calendar table. A compact month grid
   where each day carries only the essentials (rate, a market-position color, an action icon);
   everything else (mapped competitor prices, parity, recommendation, confidence, recent
   competitor movement, suggested rate) lives in a rich hover/click popover instead of being
   crammed into the cell itself. Reuses the same signals as Today's Revenue Brief and Market
   Intelligence (PORTALDATA.myRateOnDate/competitorRateOnDate/firstParityViolation) so this
   calendar never disagrees with the rest of the dashboard about what's happening on a given date.
   ========================================================================== */
function initRevenueCalendar(propertyId, comps){
  const grid = document.getElementById('ric_grid');
  const popover = document.getElementById('ric_popover');
  if(!grid || !popover) return;

  let anchor = new Date(); anchor.setDate(1); anchor.setHours(0,0,0,0);
  let pinnedDk = null; // date key currently pinned open by a click, or null if only hover-shown
  let hideTimer = null;

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
    const moves = comps.map(c=>{
      const t = PORTALDATA.competitorRateOnDate(c, dk), y = PORTALDATA.competitorRateOnDate(c, prevDk);
      return t>y ? 1 : t<y ? -1 : 0;
    });
    const upCount = moves.filter(m=>m>0).length, downCount = moves.filter(m=>m<0).length;

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

    return { dk, date, myR, compRates, mktAvg, gapPct, tone, violation, upCount, downCount, action, actionIcon, confidence, suggested };
  }

  const TONE_META = {
    opp:     { label:'Opportunity', color:'var(--success)' },
    risk:    { label:'Risk',        color:'var(--danger)'  },
    aligned: { label:'Aligned',     color:'var(--text-3)'  }
  };

  function popoverHtml(info){
    const tm = TONE_META[info.tone];
    return `
      <div class="ric-pop-head">
        <div>
          <div class="ric-pop-date">${info.date.toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'short'})}</div>
          <span class="ric-pop-tone" style="color:${tm.color}"><i class="bi bi-record-fill"></i>${tm.label}</span>
        </div>
        <button type="button" class="ric-pop-close" id="ric_popClose" aria-label="Close"><i class="bi bi-x-lg"></i></button>
      </div>
      <div class="ric-pop-grid">
        <div><span class="k">Our Rate</span><span class="v">${APP.fmtCurrency(info.myR)}</span></div>
        <div><span class="k">Market Avg</span><span class="v">${APP.fmtCurrency(info.mktAvg)}</span></div>
        <div><span class="k">Price Gap</span><span class="v ${info.gapPct>=0?'text-danger':'text-success'}">${info.gapPct>=0?'+':''}${info.gapPct.toFixed(1)}%</span></div>
        <div><span class="k">Parity</span><span class="v ${info.violation?'text-danger':'text-success'}">${info.violation?'Undercut':'On Track'}</span></div>
      </div>
      ${info.compRates.length ? `<div class="ric-pop-section">
        <div class="ric-pop-label">Mapped Competitors</div>
        <div class="ric-pop-comp-list">
          ${info.compRates.slice(0,5).map(c=>`<div class="ric-pop-row"><span>${c.name}</span><span>${APP.fmtCurrency(c.rate)}</span></div>`).join('')}
        </div>
      </div>` : `<div class="ric-pop-section"><div class="text-muted" style="font-size:.72rem">No comparison properties assigned yet.</div></div>`}
      ${info.violation ? `<div class="ric-pop-alert"><i class="bi bi-exclamation-octagon-fill"></i><span>${info.violation.channel.name} undercutting Direct by ${Math.round((info.violation.directPrice-info.violation.otaPrice)/info.violation.directPrice*100)}%</span></div>` : ''}
      <div class="ric-pop-recommend">
        <span class="ric-pop-rec-icon"><i class="bi ${info.actionIcon}"></i></span>
        <div class="flex-grow-1">
          <div class="d-flex justify-content-between align-items-center gap-2">
            <span class="ric-pop-rec-title">${info.action==='Hold' ? 'Hold current rate' : info.action+' rate'}</span>
            <span class="ric-pop-confidence">${info.confidence}%</span>
          </div>
          ${info.action!=='Hold' ? `<div class="ric-pop-rec-sub">Suggested: <b>${APP.fmtCurrency(info.suggested)}</b></div>` : `<div class="ric-pop-rec-sub">Well positioned — no change needed</div>`}
        </div>
      </div>
      ${comps.length ? `<div class="ric-pop-moves"><i class="bi bi-activity"></i>${info.upCount} up · ${info.downCount} down vs. previous day</div>` : ''}
    `;
  }

  function positionPopover(cell){
    const r = cell.getBoundingClientRect();
    const popW = Math.min(300, window.innerWidth - 24);
    popover.style.width = popW+'px';
    popover.classList.remove('d-none');
    const popH = popover.offsetHeight;
    let left = r.left + r.width/2 - popW/2;
    left = Math.max(12, Math.min(left, window.innerWidth - popW - 12));
    let top = r.bottom + 10;
    let arrowAbove = true;
    if(top + popH > window.innerHeight - 12){ top = r.top - popH - 10; arrowAbove = false; }
    popover.style.left = left+'px';
    popover.style.top = top+'px';
    popover.classList.toggle('arrow-top', arrowAbove);
    popover.classList.toggle('arrow-bottom', !arrowAbove);
    popover.style.setProperty('--ric-arrow-x', (r.left + r.width/2 - left)+'px');
  }

  function show(cell){
    clearTimeout(hideTimer);
    const info = dayInfo(new Date(cell.dataset.dk+'T00:00:00'));
    popover.innerHTML = popoverHtml(info);
    positionPopover(cell);
    document.getElementById('ric_popClose').addEventListener('click', hide);
  }
  function scheduleHide(){
    if(pinnedDk) return;
    hideTimer = setTimeout(hide, 180);
  }
  function hide(){
    clearTimeout(hideTimer);
    pinnedDk = null;
    popover.classList.add('d-none');
    grid.querySelectorAll('.ric-cell.is-pinned').forEach(c=>c.classList.remove('is-pinned'));
  }

  popover.addEventListener('mouseenter', ()=> clearTimeout(hideTimer));
  popover.addEventListener('mouseleave', scheduleHide);
  document.addEventListener('click', (e)=>{
    if(pinnedDk && !popover.contains(e.target) && !e.target.closest('.ric-cell')) hide();
  });

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
      html += `<button type="button" class="${cellClasses.join(' ')}" data-dk="${dk}" style="animation-delay:${(d%7)*22}ms" aria-label="${date.toDateString()}: ${info.action} recommended, our rate ${APP.fmtCurrency(info.myR)}">
        <span class="ric-cell-bar"></span>
        <span class="ric-date">${d}${dk===todayKey?'<i class=\"ric-today-dot\"></i>':''}</span>
        <span class="ric-rate">${APP.fmtCurrency(info.myR)}</span>
        <span class="ric-action-dot"><i class="bi ${info.actionIcon}"></i></span>
      </button>`;
    }
    grid.innerHTML = html;

    grid.querySelectorAll('.ric-cell[data-dk]').forEach(cell=>{
      cell.addEventListener('mouseenter', ()=> show(cell));
      cell.addEventListener('mouseleave', scheduleHide);
      cell.addEventListener('focus', ()=> show(cell));
      cell.addEventListener('blur', scheduleHide);
      cell.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(pinnedDk === cell.dataset.dk){ hide(); return; }
        grid.querySelectorAll('.ric-cell.is-pinned').forEach(c=>c.classList.remove('is-pinned'));
        pinnedDk = cell.dataset.dk;
        cell.classList.add('is-pinned');
        show(cell);
      });
    });
  }

  document.getElementById('ric_prevMonth').addEventListener('click', ()=>{ anchor.setMonth(anchor.getMonth()-1); hide(); render(); });
  document.getElementById('ric_nextMonth').addEventListener('click', ()=>{ anchor.setMonth(anchor.getMonth()+1); hide(); render(); });
  window.addEventListener('resize', ()=>{ if(!popover.classList.contains('d-none')){ const c=grid.querySelector('.ric-cell.is-pinned')||grid.querySelector('.ric-cell.is-today'); if(c) positionPopover(c); } });

  render();
}
