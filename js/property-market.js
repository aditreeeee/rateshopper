// Expandable analysis cards — one delegated listener covers every .insight-toggle button on the
// page (Insight Generation and Forecast Opportunity cards alike), including any re-rendered after
// this listener is attached, since it's bound on document rather than on the buttons themselves.
document.addEventListener('click', (e)=>{
  const toggle = e.target.closest('.insight-toggle');
  if(!toggle) return;
  const card = toggle.closest('.insight-card');
  if(!card) return;
  const expanded = card.classList.toggle('is-expanded');
  const count = toggle.textContent.match(/\((\d+)\)/);
  toggle.innerHTML = `<i class="bi bi-chevron-down"></i>${expanded?'Hide details':'Show details'}${count?` (${count[1]})`:''}`;
});

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Forecast & Actions', subtitle:'Forward-looking pricing forecasts, market insights, and an action center to apply them.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  PWIDGETS.initTabbar('mi_tabs');
  // Only the competitors your Company Admin actually mapped to you — same set as Competitors/Rate Shopper.
  const comps = PORTALDATA.comparisonRealProperties();
  const today = PORTALDATA.dateKeyOffset(0);

  document.querySelectorAll('#mi_tabs .nav-link').forEach(btn=>{
    btn.addEventListener('click', function(){
      document.querySelectorAll('#mi_tabs .nav-link').forEach(b=>b.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('mi_tabRecommendations').classList.toggle('d-none', this.dataset.tab!=='recommendations');
      document.getElementById('mi_tabAction').classList.toggle('d-none', this.dataset.tab!=='action');
      if(this.dataset.tab==='action') renderActionCenter(propertyId);
    });
  });
  renderMarketInsights(propertyId);
  renderActionCenter(propertyId);
  document.getElementById('mi_staleBadge').innerHTML = PWIDGETS.staleBadge(PORTALDATA.lastScrapedAt(propertyId));

  // "Ready to apply these pricing decisions?" CTA — jumps straight to the Action Center tab
  // (same pattern as Comparison's "Next: Forecast & Actions" banner), no page reload needed
  // since Action Center is just another tab on this same page.
  document.getElementById('fc_goToAction').addEventListener('click', ()=>{
    document.querySelector('#mi_tabs [data-tab="action"]').click();
  });

  // ---- Forecast — Top Forecasted Opportunities + Scenario Planner (moved in from the standalone
  // Forecast page). Uses the full tracked competitor pool (assigned comparisons + the Competitors
  // page's synthetic pool) so it always has real market data to project against, even for an
  // owner with nothing assigned yet — the room-level insight below still scopes to the real,
  // assigned comparison set (`comps`) since only those have actual DB room/rate-plan data. ----
  const forecastComps = PORTALDATA.competitors(propertyId);
  const totalRooms = DB.rooms.byProperty(propertyId).reduce((s,r)=>s+(r.totalRooms||0), 0) || 20;

  // ---- Forecast Period — 7/14/30 Days presets or a manual custom range, applied via
  // fcStartOffset (days from today the window begins) + fcHorizonDays (its length). Both
  // Scenario Planner and Top Forecasted Opportunities read whatever these are currently set to
  // every time refreshForecast() runs. ----
  let fcStartOffset = 0;
  let fcHorizonDays = 14;

  // Rebuildable on demand — buildForecastDays() reads "my rate" fresh from DB every time it's
  // called, so re-running this after a rate change (Action Center's "Apply Rate Change", or a
  // Rate Calendar edit elsewhere in the app) keeps the Forecast tab's Opportunities and Scenario
  // Planner in sync with the actual current price instead of showing whatever it was on page load.
  function refreshForecast(){
    const freshDays = buildForecastDays(propertyId, forecastComps, fcStartOffset, fcHorizonDays);
    renderForecastOpportunities(propertyId, comps, forecastComps, freshDays, totalRooms);
    initScenarioPlanner(freshDays, totalRooms, forecastComps.length);
  }
  refreshForecast();
  window.__refreshForecast = refreshForecast;

  // ---- Forecast Period controls ----
  function applyForecastPeriod(startOffset, horizonDays, activeDaysBtn){
    fcStartOffset = startOffset; fcHorizonDays = horizonDays;
    document.querySelectorAll('#fc_rangeGroup [data-days]').forEach(b=>{
      const active = b===activeDaysBtn;
      b.classList.toggle('btn-outline-primary', active); b.classList.toggle('btn-soft', !active);
    });
    refreshForecast();
  }
  document.querySelectorAll('#fc_rangeGroup [data-days]').forEach(btn=>{
    btn.addEventListener('click', ()=> applyForecastPeriod(0, Number(btn.dataset.days), btn));
  });
  document.getElementById('fc_applyRange').addEventListener('click', ()=>{
    const startVal = document.getElementById('fc_startDate').value;
    const endVal = document.getElementById('fc_endDate').value;
    if(!startVal || !endVal){ APP.toast('Missing Dates', 'Please pick both a start and end date.', 'danger'); return; }
    const start = new Date(startVal+'T00:00:00'), end = new Date(endVal+'T00:00:00');
    if(start > end){ APP.toast('Invalid Range', 'The start date must be before the end date.', 'danger'); return; }
    const todayMidnight = new Date(); todayMidnight.setHours(0,0,0,0);
    const startOffset = Math.round((start-todayMidnight)/86400000);
    const horizonDays = Math.round((end-start)/86400000)+1;
    applyForecastPeriod(startOffset, horizonDays, null);
  });

  // Deep-link support (?tab=recommendations|action) — lets a link from elsewhere in
  // the app land directly on the right tab instead of always Forecast.
  const deepTab = APP.qs('tab');
  if(deepTab){
    const btn = document.querySelector(`#mi_tabs [data-tab="${deepTab}"]`);
    if(btn) btn.click();
  }
});

/* ==========================================================================
   Forecast — Top Forecasted Opportunities + Scenario Planner (moved in from the standalone
   Forecast page, which has been retired). A rolling rate/demand projection over whatever window
   the Forecast Period control is currently set to (7/14/30 Days, or a manual custom range):
   demand index and booking pace are the only two signals with no real-data source elsewhere in
   the app (this app models rates, not occupancy/bookings), so they're kept deliberately
   synthetic-but-deterministic, seeded off (propertyId + dateKey) so they're stable across reloads
   without their own persisted store. Every projection is rate-driven only — occupancy is not
   modeled.
   ========================================================================== */

function fcHash(str){ let h=0; for(let i=0;i<str.length;i++){ h=(h*31+str.charCodeAt(i))|0; } return Math.abs(h); }
function fcSeededFloat(seed){ return (fcHash(seed) % 10000) / 10000; }

function fcDemandIndex(propertyId, dateKey){
  let score = 50;
  if(PORTALDATA.isWeekend(dateKey)) score += 18;
  if(PORTALDATA.isHoliday(dateKey)) score += 25;
  score += (fcSeededFloat(propertyId+dateKey+'demand') - 0.5) * 24;
  return Math.max(5, Math.min(98, Math.round(score)));
}
function fcDemandTier(di){ return di>=65 ? 'High' : di>=40 ? 'Medium' : 'Low'; }
function fcBookingPace(propertyId, dateKey){
  return Math.round((fcSeededFloat(propertyId+dateKey+'pace') - 0.5) * 60);
}
function fcConfidenceFor(dayOffset, compCount){
  const base = Math.max(38, 97 - dayOffset*2.1);
  const bonus = Math.min(8, compCount*0.6);
  return Math.round(Math.min(97, base+bonus));
}

// startOffset: days from today the window begins (0 for the 7/14/30 Day presets, any integer
// for a manual custom range). horizonDays: length of the window in days.
function buildForecastDays(propertyId, forecastComps, startOffset, horizonDays){
  const days = [];
  for(let d=0; d<horizonDays; d++){
    const dayOffset = startOffset+d;
    const dateKey = PORTALDATA.dateKeyOffset(dayOffset);
    const myRate = PORTALDATA.myRateOnDate(propertyId, dateKey);
    const compRates = forecastComps.map(c=>PORTALDATA.competitorRateOnDate(c, dateKey));
    const marketAvg = compRates.length ? Math.round(compRates.reduce((a,b)=>a+b,0)/compRates.length) : myRate;
    const di = fcDemandIndex(propertyId, dateKey);
    const demandAdj = (di-50)/50 * 0.12; // +/-12% swing at demand extremes
    const recommended = Math.round((marketAvg * (1+demandAdj)) / 10) * 10;
    days.push({
      dateKey, dayOffset,
      myRate, marketAvg, recommended,
      gapPct: ((recommended-myRate)/myRate*100),
      demandIndex: di, tier: fcDemandTier(di),
      pace: fcBookingPace(propertyId, dateKey),
      confidence: fcConfidenceFor(dayOffset, forecastComps.length),
      isWeekend: PORTALDATA.isWeekend(dateKey), isHoliday: PORTALDATA.isHoliday(dateKey),
      lowRate: compRates.length ? Math.min(...compRates) : myRate,
      highRate: compRates.length ? Math.max(...compRates) : myRate
    });
  }
  return days;
}

function renderForecastOpportunities(propertyId, realComps, forecastComps, days, totalRooms){
  const rangeLabel = days.length>1
    ? `${APP.fmtDateReadable(days[0].dateKey)} – ${APP.fmtDateReadable(days[days.length-1].dateKey)}`
    : APP.fmtDateReadable(days[0].dateKey);
  document.getElementById('fc_horizonLabel').textContent = `${rangeLabel} (${days.length} day${days.length===1?'':'s'})`;
  const cards = [];

  // ---- 1. Best contiguous raise window ----
  const raiseDays = days.filter(d=>d.gapPct >= 8);
  if(raiseDays.length){
    const impact = raiseDays.reduce((s,d)=> s + (d.recommended-d.myRate)*totalRooms, 0);
    const avgConf = Math.round(raiseDays.reduce((s,d)=>s+d.confidence,0)/raiseDays.length);
    const firstDate = APP.fmtDateReadable(raiseDays[0].dateKey);
    const reasons = [];
    if(raiseDays.some(d=>d.isWeekend)) reasons.push('Includes weekend dates that historically command a premium.');
    if(raiseDays.some(d=>d.isHoliday)) reasons.push('A public holiday falls within this window.');
    reasons.push(`Market average is projected to run ${Math.round(raiseDays.reduce((s,d)=>s+d.gapPct,0)/raiseDays.length)}% above your current rate on these dates.`);
    cards.push({
      icon:'bi-graph-up-arrow', tone:'impact-positive', title:`Raise rates across ${raiseDays.length} date(s), starting ${firstDate}`,
      confidence:avgConf, impact, reasons, affectedDays:raiseDays,
      action:`Recommended: move toward the market-aligned rate — up to +${Math.round(Math.max(...raiseDays.map(d=>d.gapPct)))}% on the strongest date.`
    });
  }

  // ---- 2. Soft-demand window — a case for promotional pricing ----
  const softDays = days.filter(d=>d.demandIndex < 35);
  if(softDays.length >= 2){
    cards.push({
      icon:'bi-graph-down-arrow', tone:'impact-caution', title:`Soft demand projected on ${softDays.length} date(s)`,
      affectedDays:softDays,
      confidence:Math.round(softDays.reduce((s,d)=>s+d.confidence,0)/softDays.length),
      impact: null,
      reasons:[
        `Demand index averages just ${Math.round(softDays.reduce((s,d)=>s+d.demandIndex,0)/softDays.length)}/100 on these dates — well below a typical day.`,
        'No weekend or holiday driver identified for this stretch.',
        'A modest rate cut or value-add offer could help stimulate bookings before the window closes.'
      ],
      action:'Recommended: consider a targeted promotion or length-of-stay incentive for these dates.'
    });
  }

  // ---- 3. Rate parity risk carried into the forecast window ----
  const violation = PORTALDATA.firstParityViolation(propertyId, PORTALDATA.dateKeyOffset(0));
  if(violation){
    const gapPct = Math.round((violation.directPrice-violation.otaPrice)/violation.directPrice*100);
    cards.push({
      icon:'bi-exclamation-octagon-fill', tone:'impact-risk', title:'Rate parity issue will erode forecasted upside',
      confidence:92, impact:null,
      reasons:[
        `${violation.channel.name} is undercutting your Direct rate by ${gapPct}% on ${violation.room.name}.`,
        'Any projected rate increase above will be undermined if this channel keeps undercutting Direct.',
        'This is the same check used by your Dashboard\'s Rate Parity Score.'
      ],
      action:'Recommended: resolve channel parity before pushing rate increases live.'
    });
  }

  // ---- 4. OTA channel outlier carried forward, averaged across the forecast window ----
  const channels = DB.channels.byProperty(propertyId);
  const master = channels.find(c=>c.type==='master');
  const otaChannels = channels.filter(c=>c.type!=='master');
  if(otaChannels.length>=2){
    function channelAvgOverWindow(channelId){
      const chRooms = DB.rooms.byChannel(channelId);
      if(!chRooms.length) return null;
      let sum=0, count=0;
      days.forEach(d=>{
        chRooms.forEach(room=>{
          DB.ratePlans.byRoom(room.id).forEach(rp=>{
            const day = DB.rates.forPlan(rp.id)[d.dateKey];
            sum += day ? day.price : room.basePrice; count++;
          });
        });
      });
      return count ? Math.round(sum/count) : null;
    }
    const channelAvgs = otaChannels.map(ch=>({ ch, avg:channelAvgOverWindow(ch.id) })).filter(c=>c.avg!=null);
    if(channelAvgs.length>=2){
      const mean = channelAvgs.reduce((s,c)=>s+c.avg,0)/channelAvgs.length;
      const stdDev = Math.sqrt(channelAvgs.reduce((s,c)=>s+Math.pow(c.avg-mean,2),0)/channelAvgs.length);
      const outlier = channelAvgs.find(c=> stdDev>0 && Math.abs(c.avg-mean)>1.4*stdDev);
      if(outlier){
        const diffPct = Math.round((outlier.avg-mean)/mean*100);
        cards.push({
          icon:'bi-sliders', tone:'impact-caution', title:`${outlier.ch.name} is projected to drift from your other channels`,
          confidence:70, impact:null,
          reasons:[
            `Averaged over the next ${days.length} days, ${outlier.ch.name} is projected ${Math.abs(diffPct)}% ${diffPct>0?'above':'below'} your other OTA channels (${APP.fmtCurrency(Math.round(mean))} avg.).`,
            'Left unchecked, this widens into a channel-specific pricing inconsistency rather than a one-off.'
          ],
          action:`Recommended: review ${outlier.ch.name}'s channel-specific pricing rules.`
        });
      }
    }
  }

  // ---- 5. Competitor momentum — 7-day trend across the tracked competitor pool ----
  if(forecastComps.length){
    const nearTrend = forecastComps.map(c=>{
      const now = PORTALDATA.competitorRateOnDate(c, PORTALDATA.dateKeyOffset(0));
      const past = PORTALDATA.competitorRateOnDate(c, PORTALDATA.dateKeyOffset(-7));
      return past ? ((now-past)/past*100) : 0;
    });
    const avgMove = nearTrend.reduce((a,b)=>a+b,0)/nearTrend.length;
    if(Math.abs(avgMove) >= 4){
      const up = avgMove > 0;
      cards.push({
        icon: up ? 'bi-arrow-up-right-circle-fill' : 'bi-arrow-down-right-circle-fill',
        tone: up ? 'impact-positive' : 'impact-caution',
        title: up ? 'Competitor rates are trending upward' : 'Competitors are trending toward lower rates',
        confidence:74, impact:null,
        reasons:[
          `Your tracked competitor set moved ${Math.abs(avgMove).toFixed(1)}% ${up?'higher':'lower'} over the last 7 days.`,
          up ? 'Room to move with the market without losing your competitive position.' : 'Holding your rate flat risks widening the gap versus a softening market.'
        ],
        action: up ? 'Recommended: track this trend into next week before committing to a larger increase.' : 'Recommended: monitor closely — avoid increases until the market stabilizes.'
      });
    }
  }

  // ---- 6. Pinned/favorite competitor watch (Competitors page's user-curated tracking) ----
  const curated = forecastComps.filter(c=>c.pinned || c.favorite);
  if(curated.length){
    const todayKey = PORTALDATA.dateKeyOffset(0);
    const weekOut = PORTALDATA.dateKeyOffset(7);
    const moved = curated.map(c=>{
      const now = PORTALDATA.competitorRateOnDate(c, todayKey);
      const future = PORTALDATA.competitorRateOnDate(c, weekOut);
      return { c, pct: now ? ((future-now)/now*100) : 0 };
    }).sort((a,b)=> Math.abs(b.pct)-Math.abs(a.pct))[0];
    if(moved && Math.abs(moved.pct) >= 5){
      const up = moved.pct > 0;
      cards.push({
        icon:'bi-star-fill', tone: up ? 'impact-caution' : 'impact-positive',
        title:`Pinned competitor ${moved.c.name} projected to move ${Math.abs(moved.pct).toFixed(1)}% ${up?'higher':'lower'}`,
        confidence:66, impact:null,
        reasons:[
          `${moved.c.name} is one of your pinned/favorited competitors on the Competitors page.`,
          `Projected rate one week out: ${APP.fmtCurrency(PORTALDATA.competitorRateOnDate(moved.c, weekOut))}, vs. ${APP.fmtCurrency(PORTALDATA.competitorRateOnDate(moved.c, todayKey))} today.`
        ],
        action: up ? 'Recommended: room to move your own rate up alongside this competitor.' : 'Recommended: watch closely — this competitor may pull demand with a lower rate.'
      });
    }
  }

  // ---- 7. Room-level pricing opportunity — only the real, assigned comparison properties have
  // actual room/rate-plan data to match against. ----
  if(master && realComps.length){
    function roomAvgRateOnDate(roomId, dateKey){
      const plans = DB.ratePlans.byRoom(roomId);
      if(!plans.length) return null;
      const room = DB.rooms.get(roomId);
      const prices = plans.map(p=>{ const day=DB.rates.forPlan(p.id)[dateKey]; return day ? day.price : room.basePrice; });
      return prices.reduce((a,b)=>a+b,0)/prices.length;
    }
    let best = null;
    DB.rooms.byChannel(master.id).forEach(room=>{
      const myGaps = [];
      days.forEach(d=>{
        const myRoomRate = roomAvgRateOnDate(room.id, d.dateKey);
        if(myRoomRate==null) return;
        const matched = [];
        realComps.forEach(c=>{
          const compMaster = DB.channels.byProperty(c.realPropertyId).find(ch=>ch.type==='master');
          if(!compMaster) return;
          const matchRoom = DB.rooms.byChannel(compMaster.id).find(r=>r.name===room.name);
          if(!matchRoom) return;
          const rate = roomAvgRateOnDate(matchRoom.id, d.dateKey);
          if(rate!=null) matched.push(rate);
        });
        if(!matched.length) return;
        const matchedAvg = matched.reduce((a,b)=>a+b,0)/matched.length;
        myGaps.push(((matchedAvg-myRoomRate)/myRoomRate)*100);
      });
      if(!myGaps.length) return;
      const avgGap = myGaps.reduce((a,b)=>a+b,0)/myGaps.length;
      if(avgGap>6 && (!best || avgGap>best.avgGap)) best = { room, avgGap };
    });
    if(best){
      const roomImpact = Math.round((best.avgGap/100) * best.room.basePrice * (best.room.totalRooms||1) * days.length);
      cards.push({
        icon:'bi-door-open-fill', tone:'impact-positive', title:`${best.room.name} has the strongest room-level opportunity`,
        confidence:78, impact:roomImpact, affectedDays:days,
        reasons:[
          `Averaged over the next ${days.length} days, ${best.room.name} is priced ${Math.round(best.avgGap)}% below comparable rooms at your tracked comparison properties.`,
          'This is the same room-to-room matching used in Room Rate Comparison\'s Value Proposition Analysis.'
        ],
        action:`Recommended: prioritize a rate review for ${best.room.name} over other room types.`
      });
    }
  }

  document.getElementById('fc_insightGrid').innerHTML = cards.length ? cards.slice(0,8).map(c=>{
    // Every card names the specific stay dates it's about — the full forecast window for
    // cards that are an averaged/whole-window finding (OTA outlier, room-level, parity risk,
    // competitor momentum/pinned watch), or a genuine narrower subset for the two cards that
    // are literally about a specific run of dates (raise window, soft-demand window).
    const affected = c.affectedDays || days;
    const cardRangeLabel = affected.length>1
      ? `${APP.fmtDateReadable(affected[0].dateKey)} – ${APP.fmtDateReadable(affected[affected.length-1].dateKey)}`
      : APP.fmtDateReadable(affected[0].dateKey);
    const bestDay = affected.reduce((best,d)=> (!best || Math.abs(d.gapPct)>Math.abs(best.gapPct)) ? d : best, null);
    return `
    <div class="col-md-6 col-xl-4">
      <div class="insight-card forecast-card ${c.tone}">
        <div class="d-flex align-items-start gap-2 mb-2">
          <div class="insight-icon"><i class="bi ${c.icon}"></i></div>
          <div class="flex-grow-1">
            <div class="fw-bold" style="font-size:.86rem;line-height:1.25">${c.title}</div>
            <span class="insight-confidence-badge mt-1 d-inline-block">Confidence: ${c.confidence}%</span>
          </div>
        </div>
        <div class="forecast-meta-grid">
          <div class="fc-scenario-stat"><div class="k">Forecast Range</div><div class="v" style="font-size:.72rem">${cardRangeLabel}</div></div>
          <div class="fc-scenario-stat"><div class="k">Stay Dates Affected</div><div class="v">${affected.length}</div></div>
          <div class="fc-scenario-stat"><div class="k">Highest Opportunity</div><div class="v" style="font-size:.72rem">${APP.fmtDateReadable(bestDay.dateKey)}</div></div>
          <div class="fc-scenario-stat"><div class="k">Revenue Lift</div><div class="v ${c.impact>0?'pos':c.impact<0?'neg':''}">${c.impact!=null ? (c.impact>=0?'+':'-')+APP.fmtCurrency(Math.round(Math.abs(c.impact))) : '—'}</div></div>
        </div>
        <button type="button" class="insight-toggle"><i class="bi bi-chevron-down"></i>Show details (${c.reasons.length})</button>
        <ul class="insight-supporting mb-2">${c.reasons.map(r=>`<li>${r}</li>`).join('')}</ul>
        <div class="insight-action"><i class="bi bi-lightbulb-fill"></i>${c.action}</div>
      </div>
    </div>`;
  }).join('') : `<div class="col-12">${PWIDGETS.emptyState('bi-stars','No standout forecast signals right now','Your projected pricing and demand are well aligned — check back as new competitor data comes in.')}</div>`;
}

// Scenario Planner — compact "what if" card. Purely rate-driven (no occupancy modeled): every
// projection multiplies the adjusted rate straight through the full room inventory. No chart
// library involved — a lightweight CSS bar comparison redraws instantly on every slider tick.
function initScenarioPlanner(days, totalRooms, compCount){
  const slider = document.getElementById('fc_scenarioSlider');

  // Prominently show the active forecast window above the projection metrics, so it's always
  // clear exactly which dates "Projected Revenue" etc. below are being computed over.
  const windowLabel = days.length>1
    ? `${APP.fmtDateReadable(days[0].dateKey)} – ${APP.fmtDateReadable(days[days.length-1].dateKey)}`
    : APP.fmtDateReadable(days[0].dateKey);
  document.getElementById('fc_scenarioWindow').innerHTML = `<i class="bi bi-calendar-range me-1"></i>Forecast window: ${windowLabel} (${days.length} day${days.length===1?'':'s'})`;

  const avgMarket = Math.round(days.reduce((s,d)=>s+d.marketAvg,0)/days.length);
  const avgCurrentRate = Math.round(days.reduce((s,d)=>s+d.myRate,0)/days.length);
  const baselineRevenue = days.reduce((s,d)=> s + d.myRate*totalRooms, 0);
  const avgBaseConfidence = Math.round(days.reduce((s,d)=>s+d.confidence,0)/days.length);

  // Same convention as Rate Position elsewhere in the app (Dashboard, Revenue Calendar) — a
  // percentage gap from the market average, not the tracked pool's min/max extremes. With ~50
  // competitors in the pool those extremes span a huge range (roughly ₹2,200-₹15,000), so almost
  // no realistic rate — even at +/-20% — would ever cross them, making this read as stuck on
  // "Within Market" no matter what the slider did.
  function marketPosition(rate){
    const gapPct = ((rate-avgMarket)/avgMarket)*100;
    return gapPct <= -4 ? 'Below Market' : gapPct >= 4 ? 'Above Market' : 'Within Market';
  }

  function render(pct){
    const avgProjectedRate = Math.round(avgCurrentRate * (1+pct/100));
    const totalRevenue = days.reduce((s,d)=> s + Math.round(d.myRate*(1+pct/100))*totalRooms, 0);
    const deltaRevenue = totalRevenue - baselineRevenue;
    const priceIndex = Math.round((avgProjectedRate/avgMarket)*100);
    const position = marketPosition(avgProjectedRate);
    // A scenario further from today's actual rate leans more on the flat rate-driven assumption
    // (no occupancy/elasticity data to confirm it), so confidence tapers off with |pct|.
    const confidence = Math.max(35, Math.round(avgBaseConfidence - Math.abs(pct)*1.1));

    document.getElementById('fc_scenarioPct').textContent = `${pct>=0?'+':''}${pct}%`;

    document.getElementById('fc_scenarioStats').innerHTML = [
      { k:'Projected Revenue', v:`${deltaRevenue>=0?'+':''}${APP.fmtCurrency(Math.round(deltaRevenue))}`, cls: deltaRevenue>0?'pos':deltaRevenue<0?'neg':'' },
      { k:'Market Position', v:position },
      { k:'Price Index', v:priceIndex },
      { k:'Confidence', v:`${confidence}%` },
    ].map(s=>`<div class="col-6 col-md-3"><div class="fc-scenario-stat"><div class="k">${s.k}</div><div class="v ${s.cls||''}">${s.v}</div></div></div>`).join('');

    const maxVal = Math.max(avgCurrentRate, avgProjectedRate, avgMarket) || 1;
    const bars = [
      { label:'Current', val:avgCurrentRate, cls:'bar-current' },
      { label:'Projected', val:avgProjectedRate, cls:'bar-projected' },
      { label:'Market Avg.', val:avgMarket, cls:'bar-market' },
    ];
    document.getElementById('fc_scenarioTrend').innerHTML = bars.map(b=>`
      <div class="sp-trend-row">
        <span class="sp-trend-label">${b.label}</span>
        <div class="sp-trend-track"><div class="sp-trend-fill ${b.cls}" style="width:${Math.max(4,Math.round(b.val/maxVal*100))}%"></div></div>
        <span class="sp-trend-value">${APP.fmtCurrency(b.val)}</span>
      </div>`).join('');

    // ---- 2-3 line recommendation: expected impact, risk, and a suggested pricing move ----
    let summary;
    if(pct === 0){
      summary = `This is your current baseline — ${APP.fmtCurrency(avgCurrentRate)} average rate, ${position.toLowerCase()} vs. the ${compCount}-property comparison set. Move the slider to model a rate change.`;
    } else {
      const up = pct > 0;
      const impactLine = `A ${Math.abs(pct)}% ${up?'increase':'decrease'} projects ${APP.fmtCurrency(avgProjectedRate)} ADR (Price Index ${priceIndex}), landing ${position.toLowerCase()} at ${confidence}% confidence.`;
      const revenueLine = `Estimated ${deltaRevenue>=0?'gain':'loss'} of ${APP.fmtCurrency(Math.abs(Math.round(deltaRevenue)))} over ${days.length} days if held across your full inventory.`;
      let riskLine;
      if(up && Math.abs(pct)>=12) riskLine = 'Risk: a jump this large may soften demand — this model has no occupancy data to confirm it. Consider phasing the increase.';
      else if(up) riskLine = 'Suggested strategy: a measured increase, monitored against competitor response over the next few days.';
      else if(Math.abs(pct)>=12) riskLine = 'Risk: a cut this steep erodes ADR without a guaranteed booking-volume gain. Reserve for a clear soft-demand window.';
      else riskLine = 'Suggested strategy: use selectively on lower-demand dates rather than as a blanket rate change.';
      summary = `${impactLine} ${revenueLine} ${riskLine}`;
    }
    document.getElementById('fc_scenarioRecommend').innerHTML = `<i class="bi bi-lightbulb-fill"></i><span>${summary}</span>`;
  }
  // Reset to baseline and use .oninput (not addEventListener) — this function can be re-run after
  // a real rate change elsewhere on the page (see refreshForecast/window.__refreshForecast), and
  // assigning .oninput replaces any previous handler instead of stacking a duplicate one on top.
  slider.value = 0;
  render(0);
  slider.oninput = ()=> render(Number(slider.value));
}

// ---- Pricing Recommendations (merged in from the standalone Pricing Recommendations page) ----
/* ==========================================================================
   Market Insight Cards — WHY competitors are priced higher/lower than us, derived
   from real signals (star rating, amenities, meal plan, cancellation policy, demand
   trend, market variance, channel parity) instead of a bare price-difference number.
   Every card must be backed by at least one concrete data-driven reason — competitors
   with a price gap but no identifiable driver are skipped rather than shown with a
   generic "priced differently" message.
   ========================================================================== */
function generateMarketInsights(propertyId){
  const property = DB.properties.get(propertyId);
  const myStars = (property && property.stars) || 0;
  const myAmenities = new Set((property && property.amenities) || []);
  const comps = PORTALDATA.comparisonRealProperties();
  if(!comps.length) return [];

  const today = PORTALDATA.dateKeyOffset(0);
  const myRate = PORTALDATA.myRateOnDate(propertyId, today);
  if(!myRate) return [];

  const compData = comps.map(c=>{
    const rate = PORTALDATA.competitorRateOnDate(c, today);
    const rate7ago = PORTALDATA.competitorRateOnDate(c, PORTALDATA.dateKeyOffset(-7));
    const weeklyPct = rate7ago ? ((rate-rate7ago)/rate7ago*100) : 0;
    const diffPct = ((rate-myRate)/myRate*100);
    MAPPING.ensureAutoMapped(propertyId, c.realPropertyId);
    const ev = MAPPING.evaluate(propertyId, c.realPropertyId);
    const mappedPlan = ev.plans.find(p=>p.compPlan && p.ourPlan);
    return { comp:c, rate, diffPct, weeklyPct, mappedPlan };
  });

  const rates = compData.map(d=>d.rate);
  const mean = rates.reduce((a,b)=>a+b,0)/rates.length;
  const stdDev = Math.sqrt(rates.reduce((s,r)=>s+Math.pow(r-mean,2),0)/rates.length);

  const insights = [];
  const mealRank = {EP:0, CP:1, MAP:2, AP:3};

  // ---- Per-competitor drivers — only for gaps big enough to matter, and only when a
  // concrete reason can actually be identified in the data. ----
  [...compData].sort((a,b)=> Math.abs(b.diffPct)-Math.abs(a.diffPct)).forEach(d=>{
    if(Math.abs(d.diffPct) < 4) return;
    const higher = d.diffPct > 0;
    const reasons = [];

    const starDiff = d.comp.stars - myStars;
    if(higher && starDiff >= 1){
      reasons.push({ text:`${d.comp.stars}★ vs. your ${myStars}★ — a higher star rating supports a price premium.`, weight:starDiff+1, conf:'High' });
    } else if(!higher && starDiff <= -1){
      reasons.push({ text:`${d.comp.stars}★ vs. your ${myStars}★ — their lower star rating is consistent with the lower price.`, weight:Math.abs(starDiff)+1, conf:'High' });
    }

    if(d.mappedPlan){
      const ourMeal = d.mappedPlan.ourPlan.mealPlan, compMeal = d.mappedPlan.compPlan.mealPlan;
      if(higher && mealRank[compMeal] > mealRank[ourMeal]){
        reasons.push({ text:`${DB.MEAL_LABELS[compMeal]} is included on their matched room, while yours is ${DB.MEAL_LABELS[ourMeal]}.`, weight:2.5, conf:'High' });
      } else if(!higher && mealRank[compMeal] >= mealRank[ourMeal]){
        // They're cheaper AND match/beat our meal plan on the same matched room — a genuine
        // competitive threat (not "we offer more, yet we're cheaper", which would argue against
        // a decrease, not for one).
        reasons.push({ text:`Despite being cheaper, their matched room matches or beats your ${DB.MEAL_LABELS[ourMeal]} with ${DB.MEAL_LABELS[compMeal]} — hard to compete on value alone.`, weight:2, conf:'Medium' });
      }
      if(higher && d.mappedPlan.compPlan.refundable && !d.mappedPlan.ourPlan.refundable){
        reasons.push({ text:'Their matched rate offers free cancellation while yours is non-refundable — that flexibility adds perceived value.', weight:1.5, conf:'Medium' });
      }
    }

    const compAmenities = new Set(d.comp.amenities||[]);
    const extra = [...compAmenities].filter(a=>!myAmenities.has(a));
    if(higher && extra.length>=2){
      reasons.push({ text:`Stronger amenity offering — includes ${extra.slice(0,3).join(', ')}${extra.length>3?` +${extra.length-3} more`:''} that you don't have.`, weight:1.2, conf:'Medium' });
    } else if(!higher && extra.length>=2){
      // They're cheaper AND out-amenity us — a real competitive threat, unlike the case where
      // they're cheaper but offer less (which just explains the gap, it doesn't argue for a cut).
      reasons.push({ text:`Offers ${extra.slice(0,3).join(', ')}${extra.length>3?` +${extra.length-3} more`:''} that you don't have, while charging less — a real competitive threat.`, weight:1.2, conf:'Medium' });
    }

    if(Math.abs(d.weeklyPct) >= 5){
      if(d.weeklyPct>0) reasons.push({ text:`Raised their rate ${d.weeklyPct.toFixed(1)}% over the last 7 days — demand is pushing their price higher.`, weight:1, conf:'Medium' });
      else reasons.push({ text:`Cut their rate ${Math.abs(d.weeklyPct).toFixed(1)}% over the last 7 days — likely trying to stimulate demand.`, weight:1, conf:'Medium' });
    }

    if(stdDev>0 && Math.abs(d.rate-mean) > 1.5*stdDev){
      reasons.push({ text:'This gap exceeds normal variance across your comparison set — an outlier worth double-checking.', weight:1, conf:'Medium' });
    }

    if(!reasons.length) return; // no identifiable driver — skip rather than show a generic card

    reasons.sort((a,b)=>b.weight-a.weight);
    const primary = reasons[0];
    const recommendedPct = Math.min(Math.max(Math.abs(d.diffPct)*0.5, 2), 12);
    const priority = Math.abs(d.diffPct)>=15 ? 'High' : Math.abs(d.diffPct)>=8 ? 'Medium' : 'Low';
    const confidence = reasons.length>=2 ? 'High' : primary.conf;

    insights.push({
      icon: higher ? 'bi-arrow-up-circle-fill' : 'bi-arrow-down-circle-fill',
      color: higher ? 'var(--fa-text-mod)' : 'var(--fa-text-mild)', bg: higher ? 'var(--fa-tint-mod)' : 'var(--fa-tint-mild)',
      title: `${d.comp.name} is priced ${Math.abs(d.diffPct).toFixed(1)}% ${higher?'higher':'lower'}`,
      detail: primary.text,
      supporting: reasons.slice(1).map(r=>r.text),
      action: `Recommended: ${higher?'Increase':'Decrease'} by ${recommendedPct.toFixed(0)}%`,
      priority, confidence, impact: Math.abs(d.diffPct)
    });
  });

  // ---- Overall market positioning ----
  const marketAvg = Math.round(mean);
  const overallDiffPct = ((myRate-marketAvg)/marketAvg*100);
  if(Math.abs(overallDiffPct) >= 6){
    const over = overallDiffPct > 0;
    const pct = Math.min(Math.max(Math.abs(overallDiffPct)*0.5, 2), 10);
    insights.push({
      icon: over ? 'bi-exclamation-triangle-fill' : 'bi-graph-down-arrow',
      color: over ? 'var(--fa-text-strong)' : 'var(--fa-text-mod)', bg: over ? 'var(--fa-tint-strong)' : 'var(--fa-tint-mod)',
      title: over ? 'Your property is overpriced relative to the market' : 'Your property is underpriced relative to the market',
      detail: `Your rate is ${Math.abs(overallDiffPct).toFixed(1)}% ${over?'above':'below'} the ${comps.length}-property market average of ${APP.fmtCurrency(marketAvg)}.`,
      supporting: [],
      action: `Recommended: ${over?'Decrease':'Increase'} by ${pct.toFixed(0)}%`,
      priority: Math.abs(overallDiffPct)>=15 ? 'High' : 'Medium', confidence:'High', impact: Math.abs(overallDiffPct)
    });
  }

  // ---- Rate parity across your own channels — an OTA undercutting your Direct rate ----
  // Uses the same shared check as the Dashboard's Rate Parity Score KPI and Pricing
  // Recommendations' "Fix Rate Parity" trigger (PORTALDATA.firstParityViolation) so all three
  // agree on whether a violation exists.
  const violation0 = PORTALDATA.firstParityViolation(propertyId, today);
  if(violation0){
    const gapPct = ((violation0.directPrice-violation0.otaPrice)/violation0.directPrice*100);
    insights.push({
      icon:'bi-exclamation-octagon-fill', color:'var(--fa-text-strong)', bg:'var(--fa-tint-strong)',
      title:'Rate parity issue detected across channels',
      detail:`${violation0.channel.name} is listing ${violation0.room.name} at ${APP.fmtCurrency(violation0.otaPrice)} — ${gapPct.toFixed(1)}% below your Direct rate of ${APP.fmtCurrency(violation0.directPrice)}.`,
      supporting: [], action:'Recommended: Review channel parity settings',
      priority:'High', confidence:'High', impact: gapPct+10 // parity issues surface near the top
    });
  }

  insights.sort((a,b)=> b.impact-a.impact);
  return insights.slice(0, 8);
}

function renderMarketInsights(propertyId){
  const insights = generateMarketInsights(propertyId);
  document.getElementById('insightGrid').innerHTML = insights.length ? insights.map(ins=>`
    <div class="col-md-6 col-xl-4">
      <div class="insight-card priority-${ins.priority}">
        <div class="d-flex align-items-start gap-2 mb-2">
          <div class="insight-icon" style="background:${ins.bg};color:${ins.color}"><i class="bi ${ins.icon}"></i></div>
          <div class="flex-grow-1">
            <div class="fw-bold" style="font-size:.86rem;line-height:1.25">${ins.title}</div>
            <div class="d-flex gap-1 mt-1">
              <span class="insight-priority-badge ${ins.priority}">${ins.priority} Priority</span>
              <span class="insight-confidence-badge">Confidence: ${ins.confidence}</span>
            </div>
          </div>
        </div>
        <p class="text-muted small mb-2">${ins.detail}</p>
        ${ins.supporting.length ? `<button type="button" class="insight-toggle"><i class="bi bi-chevron-down"></i>Show details (${ins.supporting.length})</button>
        <ul class="insight-supporting mb-2">${ins.supporting.map(s=>`<li>${s}</li>`).join('')}</ul>` : ''}
        <div class="insight-action"><i class="bi bi-lightbulb-fill"></i>${ins.action}</div>
      </div>
    </div>`).join('') : `<div class="col-12">${PWIDGETS.emptyState('bi-stars','No standout insights right now','Your pricing looks well aligned with the market — nothing significant to flag today.')}</div>`;
}

/* ==========================================================================
   Pricing Recommendations — ten concrete recommended-action types, each with
   its own real, deterministic trigger condition against live rate/channel/
   room/market data (never random). A type only produces a card when its
   condition is actually met on this property today — never fabricated to
   fill space.
   ========================================================================== */
const REC_ACTION_TYPES = {
  increase:        { label:'Increase Price',                  icon:'bi-arrow-up-circle-fill',   color:'var(--fa-text-mild)', bg:'var(--fa-tint-mild)' },
  decrease:        { label:'Decrease Price',                  icon:'bi-arrow-down-circle-fill',  color:'var(--fa-text-mod)',  bg:'var(--fa-tint-mod)' },
  maintain:        { label:'Maintain Current Price',          icon:'bi-dash-circle-fill',        color:'var(--fa-text-mod)',  bg:'var(--fa-tint-mod)' },
  channelAdjust:   { label:'Adjust Channel-Specific Rates',   icon:'bi-sliders',                 color:'var(--fa-text-mild)', bg:'var(--fa-tint-mild)' },
  parity:          { label:'Fix Rate Parity Issues',          icon:'bi-exclamation-octagon-fill',color:'var(--fa-text-strong)', bg:'var(--fa-tint-strong)' },
  mealPlan:        { label:'Review Meal Plan Pricing',        icon:'bi-cup-hot-fill',            color:'var(--fa-text-mod)',  bg:'var(--fa-tint-mod)' },
  roomPositioning: { label:'Review Room Positioning',         icon:'bi-door-open-fill',          color:'var(--fa-text-mild)', bg:'var(--fa-tint-mild)' },
  roomValueGap:    { label:'Room Value Gap',                  icon:'bi-door-open-fill',          color:'var(--fa-text-mild)', bg:'var(--fa-tint-mild)' },
  promotions:      { label:'Monitor Competitor Promotions',   icon:'bi-megaphone-fill',          color:'var(--fa-text-mod)',  bg:'var(--fa-tint-mod)' },
  opportunity:     { label:'Capitalize on Market Opportunities', icon:'bi-graph-up-arrow',        color:'var(--fa-text-mild)', bg:'var(--fa-tint-mild)' },
};

function generatePricingRecommendations(propertyId){
  const today = PORTALDATA.dateKeyOffset(0);
  const myRate = PORTALDATA.myRateOnDate(propertyId, today);
  const comps = PORTALDATA.comparisonRealProperties();
  const recs = [];
  if(!myRate) return recs;

  // Every recommendation now carries a specific, human-readable title (not just the generic
  // type label), an effective date (or date range), which room type(s)/channel(s) it's actually
  // about, and a page to jump to for the full supporting analysis — on top of the existing
  // rate/confidence/priority fields.
  function push(type, title, detail, opts){
    recs.push({ type, title, detail, effectiveDate:today, affected:[], ...opts });
  }

  /* ---- 1/2/3. Increase / Decrease / Maintain — my rate vs. the tracked market average ---- */
  if(comps.length){
    const compRates = comps.map(c=>PORTALDATA.competitorRateOnDate(c, today));
    const marketAvg = Math.round(compRates.reduce((a,b)=>a+b,0)/compRates.length);
    const gapPct = ((marketAvg-myRate)/myRate*100);
    if(gapPct > 6){
      const amount = Math.round((marketAvg-myRate)*0.6/10)*10;
      push('increase', 'Increase Overall ADR',
        `Market average (${APP.fmtCurrency(marketAvg)}) across ${comps.length} tracked comparison properties is running ${gapPct.toFixed(1)}% above your rate — room to raise without losing competitiveness.`,
        { currentRate:myRate, expectedRate:myRate+amount, confidence:82, priority: gapPct>=15?'High':'Medium',
          affected:['All Rooms'] });
    } else if(gapPct < -6){
      const amount = Math.round((myRate-marketAvg)*0.5/10)*10;
      push('decrease', 'Decrease Overall ADR',
        `You're priced ${Math.abs(gapPct).toFixed(1)}% above the market average (${APP.fmtCurrency(marketAvg)}) across ${comps.length} tracked comparison properties — risk of losing share to competitors.`,
        { currentRate:myRate, expectedRate:myRate-amount, confidence:76, priority: Math.abs(gapPct)>=15?'High':'Medium',
          affected:['All Rooms'] });
    } else {
      push('maintain', 'Maintain Current Pricing',
        `Your rate is within ${Math.abs(gapPct).toFixed(1)}% of the ${comps.length}-property market average (${APP.fmtCurrency(marketAvg)}) — well aligned.`,
        { currentRate:myRate, expectedRate:myRate, confidence:90, priority:'Low', affected:['All Rooms'] });
    }
  }

  /* ---- 4. Adjust Channel-Specific Rates — one OTA channel's own price is a statistical
     outlier vs. the rest of your channel spread (not necessarily undercutting Direct — that's
     Rate Parity's job below; this is about a channel that's inconsistently priced overall). ---- */
  const channels = DB.channels.byProperty(propertyId);
  const master = channels.find(c=>c.type==='master');
  const otaChannels = channels.filter(c=>c.type!=='master');
  function channelAvgRateOnDate(channelId, dateKey){
    const rooms = DB.rooms.byChannel(channelId);
    let sum=0, count=0;
    rooms.forEach(room=>{ DB.ratePlans.byRoom(room.id).forEach(rp=>{
      const day = DB.rates.forPlan(rp.id)[dateKey];
      sum += day ? day.price : room.basePrice; count++;
    }); });
    return count ? Math.round(sum/count) : null;
  }
  if(otaChannels.length>=2){
    const channelRates = otaChannels.map(ch=>({ ch, rate:channelAvgRateOnDate(ch.id, today) })).filter(c=>c.rate!=null);
    if(channelRates.length>=2){
      const mean = channelRates.reduce((s,c)=>s+c.rate,0)/channelRates.length;
      const stdDev = Math.sqrt(channelRates.reduce((s,c)=>s+Math.pow(c.rate-mean,2),0)/channelRates.length);
      const outlier = channelRates.find(c=> stdDev>0 && Math.abs(c.rate-mean)>1.4*stdDev);
      if(outlier){
        const diffPct = ((outlier.rate-mean)/mean*100);
        push('channelAdjust', `${diffPct>0?'Reduce':'Increase'} ${outlier.ch.name} Rate`,
          `${outlier.ch.name} is priced ${Math.abs(diffPct).toFixed(1)}% ${diffPct>0?'above':'below'} your average OTA rate (${APP.fmtCurrency(Math.round(mean))}) — a pricing-competitiveness outlier worth reviewing on that channel specifically.`,
          { currentRate:outlier.rate, expectedRate:Math.round(mean), confidence:70, priority: Math.abs(diffPct)>=25?'High':'Medium',
            applyChannel:outlier.ch, affected:[outlier.ch.name] });
      }
    }
  }

  /* ---- 5. Fix Rate Parity Issues — an OTA undercutting your Direct rate (shared check used by
     the Dashboard KPI and Market Insight Cards' parity alert: PORTALDATA.firstParityViolation). ---- */
  const violation1 = PORTALDATA.firstParityViolation(propertyId, today);
  if(violation1){
    const gapPct = ((violation1.directPrice-violation1.otaPrice)/violation1.directPrice*100);
    push('parity', `Restore ${violation1.channel.name} Rate Parity`,
      `${violation1.channel.name} is listing ${violation1.room.name} at ${APP.fmtCurrency(violation1.otaPrice)} — ${gapPct.toFixed(1)}% below your Direct rate of ${APP.fmtCurrency(violation1.directPrice)}. This is the same parity check used by your Dashboard's Rate Parity Score.`,
      { currentRate:violation1.otaPrice, expectedRate:violation1.directPrice, confidence:88, priority:'High',
        applyPlan: violation1.plan, applyRoom: violation1.room,
        affected:[violation1.room.name, violation1.channel.name] });
  }

  /* ---- 6. Review Meal Plan Pricing — EP/CP/MAP/AP should get progressively more expensive as
     more is included; flag if the actual data doesn't follow that order. ---- */
  const mealOrder = ['EP','CP','MAP','AP'];
  const mealRates = mealOrder.map(p=>({ plan:p, rate:PORTALDATA.mealPlanRateOnDate(propertyId, p, today) })).filter(m=>m.rate!=null);
  for(let i=1;i<mealRates.length;i++){
    if(mealRates[i].rate < mealRates[i-1].rate*0.98){
      push('mealPlan', `Review ${DB.MEAL_LABELS[mealRates[i].plan]} Meal Plan Pricing`,
        `${DB.MEAL_LABELS[mealRates[i-1].plan]} (${APP.fmtCurrency(mealRates[i-1].rate)}) is priced higher than ${DB.MEAL_LABELS[mealRates[i].plan]} (${APP.fmtCurrency(mealRates[i].rate)}), despite including less — a pricing-ladder inconsistency worth re-checking.`,
        { currentRate:mealRates[i].rate, expectedRate:mealRates[i-1].rate, confidence:74, priority:'Medium',
          affected:[`${DB.MEAL_LABELS[mealRates[i].plan]} Meal Plan`] });
      break; // one clear example is enough — no need to list every step
    }
  }

  /* ---- 7. Review Room Positioning — within your own rooms, a higher-capacity/base-price room
     shouldn't be cheaper than a lower-capacity one; that's a self-inconsistent pricing ladder. ---- */
  if(master){
    const masterRooms = DB.rooms.byChannel(master.id);
    const sorted = [...masterRooms].sort((a,b)=>(a.capacity||0)-(b.capacity||0));
    for(let i=1;i<sorted.length;i++){
      if((sorted[i].capacity||0) > (sorted[i-1].capacity||0) && sorted[i].basePrice < sorted[i-1].basePrice*0.95){
        push('roomPositioning', `Reposition ${sorted[i].name} Pricing`,
          `${sorted[i].name} (${sorted[i].capacity} guests, ${APP.fmtCurrency(sorted[i].basePrice)}) is priced below ${sorted[i-1].name} (${sorted[i-1].capacity} guests, ${APP.fmtCurrency(sorted[i-1].basePrice)}) despite sleeping more guests — a self-inconsistent pricing ladder across your own room types.`,
          { currentRate:sorted[i].basePrice, expectedRate:sorted[i-1].basePrice, confidence:72, priority:'Medium',
            applyRoom:sorted[i], affected:[sorted[i].name] });
        break;
      }
    }
  }

  /* ---- 8. Room-to-Room Value Gap — a specific room type priced well below its matched
     equivalent room at your tracked comparison properties, averaged over the next 14 days. Same
     room-to-room matching Room Rate Comparison's Value Proposition Analysis uses, surfaced here
     as something actually actionable rather than just an insight to read. ---- */
  if(master && comps.length){
    function roomAvgRateOnDate(roomId, dateKey){
      const plans = DB.ratePlans.byRoom(roomId);
      if(!plans.length) return null;
      const room = DB.rooms.get(roomId);
      const prices = plans.map(p=>{ const day=DB.rates.forPlan(p.id)[dateKey]; return day ? day.price : room.basePrice; });
      return prices.reduce((a,b)=>a+b,0)/prices.length;
    }
    const valueGapHorizon = Array.from({length:14}).map((_,i)=>PORTALDATA.dateKeyOffset(i));
    let bestGap = null;
    DB.rooms.byChannel(master.id).forEach(room=>{
      const gaps = [];
      valueGapHorizon.forEach(dateKey=>{
        const myRoomRate = roomAvgRateOnDate(room.id, dateKey);
        if(myRoomRate==null) return;
        const matched = [];
        comps.forEach(c=>{
          const compMaster = DB.channels.byProperty(c.realPropertyId).find(ch=>ch.type==='master');
          if(!compMaster) return;
          const matchRoom = DB.rooms.byChannel(compMaster.id).find(r=>r.name===room.name);
          if(!matchRoom) return;
          const rate = roomAvgRateOnDate(matchRoom.id, dateKey);
          if(rate!=null) matched.push(rate);
        });
        if(!matched.length) return;
        const matchedAvg = matched.reduce((a,b)=>a+b,0)/matched.length;
        gaps.push(((matchedAvg-myRoomRate)/myRoomRate)*100);
      });
      if(!gaps.length) return;
      const avgGap = gaps.reduce((a,b)=>a+b,0)/gaps.length;
      if(avgGap>15 && (!bestGap || avgGap>bestGap.avgGap)) bestGap = { room, avgGap };
    });
    if(bestGap){
      const amount = Math.round(bestGap.room.basePrice*(bestGap.avgGap/100)*0.6/10)*10;
      push('roomValueGap', `Increase ${bestGap.room.name} ADR`,
        `Averaged over the next 14 days, ${bestGap.room.name} is priced ${Math.round(bestGap.avgGap)}% below comparable rooms across your tracked comparison properties. This recommendation is based on the same room-to-room matching used in Room Rate Comparison's Value Proposition Analysis.`,
        { currentRate:bestGap.room.basePrice, expectedRate:bestGap.room.basePrice+amount, confidence:80, priority: bestGap.avgGap>=30?'High':'Medium',
          effectiveDate:today, effectiveEnd:valueGapHorizon[valueGapHorizon.length-1],
          applyRoom:bestGap.room, affected:[bestGap.room.name] });
    }
  }

  /* ---- 9. Monitor Competitor Promotions — a competitor cut their rate sharply in the last
     7 days (possible promo push worth watching, distinct from a Direct-channel parity issue). ---- */
  if(comps.length){
    const mover = comps.map(c=>{
      const t = PORTALDATA.competitorRateOnDate(c, today);
      const y = PORTALDATA.competitorRateOnDate(c, PORTALDATA.dateKeyOffset(-7));
      return { c, pct: y ? ((t-y)/y*100) : 0 };
    }).sort((a,b)=>a.pct-b.pct)[0];
    if(mover && mover.pct <= -8){
      push('promotions', `Monitor ${mover.c.name} Promotion`,
        `${mover.c.name} cut their rate ${Math.abs(mover.pct).toFixed(1)}% over the last 7 days — likely running a promotion. Keep an eye on their booking pace before reacting.`,
        { confidence:68, priority: mover.pct<=-15?'High':'Medium', affected:[mover.c.name] });
    }
  }

  /* ---- 10. Capitalize on Market Opportunities — a weekend/holiday is coming up within the week,
     and you're not already priced at a premium — a chance to raise ahead of anticipated demand.
     Deliberately not event-driven for now. ---- */
  for(let d=1; d<=6; d++){
    const dk = PORTALDATA.dateKeyOffset(d);
    const isSpecial = PORTALDATA.isWeekend(dk) || PORTALDATA.isHoliday(dk);
    if(isSpecial && comps.length){
      const compRatesThen = comps.map(c=>PORTALDATA.competitorRateOnDate(c, dk));
      const marketAvgThen = Math.round(compRatesThen.reduce((a,b)=>a+b,0)/compRatesThen.length);
      const myRateThen = PORTALDATA.myRateOnDate(propertyId, dk);
      if(myRateThen <= marketAvgThen*1.02){
        const reason = PORTALDATA.isHoliday(dk) ? 'Upcoming Holiday' : 'Upcoming Weekend';
        push('opportunity', `Raise Rate Ahead of ${reason}`,
          `${reason} on ${APP.fmtDateReadable(dk)} — this market typically commands higher rates on this occupancy pattern, and you're not yet priced ahead of it.`,
          { currentRate:myRateThen, expectedRate:Math.round(myRateThen*1.08/10)*10, confidence:69, priority:'Medium',
            effectiveDate:dk, affected:['All Rooms'] });
      }
      break; // nearest opportunity only
    }
  }

  const priorityRank = { High:0, Medium:1, Low:2 };
  recs.sort((a,b)=> priorityRank[a.priority]-priorityRank[b.priority]);
  return recs;
}

/* ==========================================================================
   Action Center — closes the loop that Insight Generation leaves open: turns each
   recommendation into something the owner can actually apply. Reuses the same
   generatePricingRecommendations() data (no separate computation), the same
   .insight-card/.insight-priority-badge/.insight-confidence-badge visual language, and writes
   through DB.rates.setRange — the same mutation path property-details.js's "Set Price for Date
   Range" action already uses — so a rate change made here shows up everywhere My Rate is read
   from (Dashboard, Rate Shopper, Room Rate Comparison, Rate Matrix, property-details.html).
   ========================================================================== */
// A recommendation's identity for dismissal purposes — type + title is stable across re-renders
// of the same underlying condition (the data is deterministic), without needing a persisted id.
function acSignature(r){ return `${r.type}|${r.title}`; }
function acDismissedKey(propertyId){ return `hop_ac_dismissed_${propertyId}`; }
function acDismissedSet(propertyId){ return new Set(JSON.parse(localStorage.getItem(acDismissedKey(propertyId)) || '[]')); }

let acQueue = [];
function renderActionCenter(propertyId){
  const dismissed = acDismissedSet(propertyId);
  acQueue = generatePricingRecommendations(propertyId)
    .filter(r=>r.type!=='maintain' && r.currentRate!=null && r.expectedRate!=null && r.currentRate!==r.expectedRate)
    .filter(r=> !dismissed.has(acSignature(r)));

  document.getElementById('ac_countBadge').textContent = acQueue.length ? `${acQueue.length} pending` : '';

  document.getElementById('actionQueueGrid').innerHTML = acQueue.length ? acQueue.map((r,i)=>{
    const meta = REC_ACTION_TYPES[r.type];
    const delta = r.expectedRate - r.currentRate;
    const pctChange = r.currentRate ? (delta/r.currentRate*100) : 0;
    const effectiveLabel = r.effectiveEnd
      ? `${APP.fmtDateReadable(r.effectiveDate)} – ${APP.fmtDateReadable(r.effectiveEnd)}`
      : APP.fmtDateReadable(r.effectiveDate);
    return `<div class="col-md-6 col-xl-4">
      <div class="insight-card priority-${r.priority}">
        <div class="d-flex align-items-start gap-2 mb-2">
          <div class="insight-icon" style="background:${meta.bg};color:${meta.color}"><i class="bi ${meta.icon}"></i></div>
          <div class="flex-grow-1">
            <div class="fw-bold" style="font-size:.86rem;line-height:1.25">${r.title}</div>
            <div class="d-flex gap-1 mt-1 flex-wrap">
              <span class="insight-priority-badge ${r.priority}">${r.priority} Priority</span>
              <span class="insight-confidence-badge">Confidence: ${r.confidence}%</span>
            </div>
          </div>
        </div>
        <div class="text-muted mb-2" style="font-size:.68rem"><i class="bi bi-calendar-check me-1"></i>Effective: ${effectiveLabel}</div>
        ${r.affected && r.affected.length ? `<div class="d-flex flex-wrap gap-1 mb-2">${r.affected.map(a=>`<span class="badge bg-light text-dark border" style="font-size:.65rem">${a}</span>`).join('')}</div>` : ''}
        <div class="row g-2 mb-2">
          <div class="col-6"><div class="text-muted" style="font-size:.68rem">Current Rate</div><div class="fw-semibold">${APP.fmtCurrency(r.currentRate)}</div></div>
          <div class="col-6"><div class="text-muted" style="font-size:.68rem">Recommended Rate</div><div class="fw-semibold" style="color:${delta>0?'var(--fa-text-mod)':'var(--fa-text-mild)'}">${APP.fmtCurrency(r.expectedRate)} <span style="font-size:.68rem;font-weight:600">(${pctChange>=0?'+':''}${pctChange.toFixed(1)}%)</span></div></div>
        </div>
        <p class="text-muted small mb-2">${r.detail}</p>
        <div class="d-flex gap-2">
          <button class="btn btn-primary btn-sm flex-grow-1" onclick="openApplyModal(${i})"><i class="bi bi-lightning-charge-fill me-1"></i>Apply</button>
          <button class="btn btn-soft btn-sm" onclick="dismissRecommendation(${i})" title="Dismiss"><i class="bi bi-x-lg"></i></button>
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="col-12">${PWIDGETS.emptyState('bi-check2-circle','Nothing to act on right now','Every open recommendation has already been applied or dismissed, or your pricing is well aligned — check back after the market moves.')}</div>`;

  renderRecentlyApplied(propertyId);
}

function dismissRecommendation(index){
  const rec = acQueue[index];
  if(!rec) return;
  const me = RBAC.currentUser();
  const propertyId = PORTAL.activePropertyId(me);
  const dismissed = acDismissedSet(propertyId);
  dismissed.add(acSignature(rec));
  localStorage.setItem(acDismissedKey(propertyId), JSON.stringify([...dismissed]));
  APP.toast('Recommendation Dismissed', `"${rec.title}" won't show in the Action Queue again unless the underlying condition changes.`, 'success');
  renderActionCenter(propertyId);
}

function renderRecentlyApplied(propertyId){
  const applied = PORTALDATA.notifications(propertyId).filter(n=>n.type==='rateApplied').slice(0,6);
  document.getElementById('ac_recentList').innerHTML = applied.length ? applied.map(n=>`
    <div class="d-flex align-items-start gap-2 mb-2 pb-2" style="border-bottom:1px solid var(--border-2)">
      <i class="bi bi-check-circle-fill mt-1" style="color:var(--fa-text-mod);font-size:.85rem"></i>
      <div class="flex-grow-1">
        <div style="font-size:.8rem" class="fw-semibold">${n.title}</div>
        <div class="text-muted" style="font-size:.72rem">${n.message}</div>
      </div>
      <div class="text-muted" style="font-size:.68rem;white-space:nowrap">${new Date(n.createdAt).toLocaleString()}</div>
    </div>`).join('') : PWIDGETS.emptyState('bi-clock-history','No changes applied yet','Applied rate changes will show up here.');
}

function openApplyModal(index){
  const rec = acQueue[index];
  if(!rec) return;
  document.getElementById('acModalDetail').textContent = rec.detail;
  document.getElementById('acModalCurrent').textContent = APP.fmtCurrency(rec.currentRate);
  document.getElementById('acModalNew').textContent = APP.fmtCurrency(rec.expectedRate);
  const applyDate = rec.effectiveDate || PORTALDATA.dateKeyOffset(0);
  const applyDateLabel = rec.effectiveEnd ? `${APP.fmtDateReadable(applyDate)} – ${APP.fmtDateReadable(rec.effectiveEnd)}` : APP.fmtDateReadable(applyDate);
  const scope = rec.applyPlan ? `${rec.applyRoom.name}`
    : rec.applyRoom ? `${rec.applyRoom.name} (every rate plan)`
    : rec.applyChannel ? `${rec.applyChannel.name} (every room on that channel)`
    : 'every Direct (Master) room/rate plan, proportionally';
  document.getElementById('acModalScope').textContent = `Applies to ${scope} on ${applyDateLabel}.`;
  document.getElementById('acModalApplyBtn').onclick = ()=>{
    applyRecommendation(rec);
    bootstrap.Modal.getInstance(document.getElementById('acApplyModal')).hide();
  };
  new bootstrap.Modal(document.getElementById('acApplyModal')).show();
}

function applyRecommendation(rec){
  const me = RBAC.currentUser();
  const propertyId = PORTAL.activePropertyId(me);
  const date = rec.effectiveDate || PORTALDATA.dateKeyOffset(0);
  const ratio = rec.currentRate>0 ? rec.expectedRate/rec.currentRate : 1;

  // Applies at whatever scope the recommendation is actually about: one specific rate plan
  // (parity), every plan on one specific room (a room-level fix — value gap/positioning), every
  // room on one specific channel (a channel-level fix), or — the old default — proportionally
  // across every Direct/Master room+plan for property-wide recommendations only.
  let targets = [];
  if(rec.applyPlan){
    targets = [{ plan:rec.applyPlan, room:rec.applyRoom }];
  } else if(rec.applyRoom){
    DB.ratePlans.byRoom(rec.applyRoom.id).forEach(plan=> targets.push({ plan, room:rec.applyRoom }));
  } else if(rec.applyChannel){
    DB.rooms.byChannel(rec.applyChannel.id).forEach(room=>{
      DB.ratePlans.byRoom(room.id).forEach(plan=> targets.push({ plan, room }));
    });
  } else {
    const channels = DB.channels.byProperty(propertyId);
    const master = channels.find(c=>c.type==='master');
    if(master){
      DB.rooms.byChannel(master.id).forEach(room=>{
        DB.ratePlans.byRoom(room.id).forEach(plan=> targets.push({ plan, room }));
      });
    }
  }

  const dateEnd = rec.effectiveEnd || date;
  targets.forEach(({plan,room})=>{
    const day = DB.rates.forPlan(plan.id)[date];
    const price = day ? day.price : room.basePrice;
    const newPrice = Math.max(500, Math.round(price*ratio/10)*10);
    const maxOcc = Math.max(room.maxOccupancy||1, plan.baseOccupancy||1);
    DB.rates.setRange(plan.id, date, dateEnd, newPrice, plan.baseOccupancy, plan.extraAdultPrice, maxOcc);
  });

  const effectiveLabel = rec.effectiveEnd ? `${APP.fmtDateReadable(date)} – ${APP.fmtDateReadable(dateEnd)}` : APP.fmtDateReadable(date);
  PORTALDATA.addNotification(propertyId, {
    type:'rateApplied', icon:'bi-lightning-charge-fill', priority:'low',
    title:`${rec.title} applied`,
    message:`${APP.fmtCurrency(rec.currentRate)} → ${APP.fmtCurrency(rec.expectedRate)} for ${effectiveLabel}.`
  });

  APP.toast('Rate Change Applied', `${rec.title} — new rate takes effect for ${effectiveLabel}.`, 'success');
  PORTAL.refreshBell(me);
  renderActionCenter(propertyId);
  // Keep the Forecast tab (Top Forecasted Opportunities + Scenario Planner) in sync with the
  // price change that was just applied here in Action Center, rather than leaving it showing
  // whatever the rate was when the page first loaded.
  if(window.__refreshForecast) window.__refreshForecast();
}
