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

// Chart.js renders its own canvas text and otherwise defaults to the browser's generic
// sans-serif stack, not the page's actual font — make every chart on this page use the same
// Inter/system-ui stack as the surrounding UI instead of visibly mismatched axis/legend text.
if(window.Chart) Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Market Intelligence', subtitle:'An executive overview of the competitive market around your property.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  // Only the competitors your Company Admin actually mapped to you — same set as Competitors/Rate Shopper.
  const comps = PORTALDATA.comparisonRealProperties();
  const today = PORTALDATA.dateKeyOffset(0);

  document.querySelectorAll('#mi_tabs .nav-link').forEach(btn=>{
    btn.addEventListener('click', function(){
      document.querySelectorAll('#mi_tabs .nav-link').forEach(b=>b.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('mi_tabOverview').classList.toggle('d-none', this.dataset.tab!=='overview');
      document.getElementById('mi_tabRecommendations').classList.toggle('d-none', this.dataset.tab!=='recommendations');
      document.getElementById('mi_tabAction').classList.toggle('d-none', this.dataset.tab!=='action');
      if(this.dataset.tab==='action') renderActionCenter(propertyId);
    });
  });
  renderMarketInsights(propertyId);
  renderActionCenter(propertyId);
  document.getElementById('mi_staleBadge').innerHTML = PWIDGETS.staleBadge(PORTALDATA.lastScrapedAt(propertyId));

  // Deep-link support (?tab=overview|recommendations|action) — lets a link from elsewhere in
  // the app land directly on the right tab instead of always Overview.
  const deepTab = APP.qs('tab');
  if(deepTab){
    const btn = document.querySelector(`#mi_tabs [data-tab="${deepTab}"]`);
    if(btn) btn.click();
  }

  if(!comps.length){
    document.getElementById('marketKpis').innerHTML = `<div class="col-12">${PWIDGETS.emptyState('bi-globe-americas','No comparison properties assigned yet','Your Company Admin hasn\'t selected any benchmark properties for you yet.')}</div>`;
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

  document.getElementById('marketKpis').innerHTML = [
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
      color: higher ? '#ff4d5e' : '#12b76a', bg: higher ? '#fff0f1' : '#e7faf1',
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
      color: over ? '#ff4d5e' : '#b9791a', bg: over ? '#fff0f1' : '#fff8e6',
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
      icon:'bi-exclamation-octagon-fill', color:'#ff4d5e', bg:'#fff0f1',
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
        ${ins.supporting.length ? `<ul class="insight-supporting mb-2">${ins.supporting.map(s=>`<li>${s}</li>`).join('')}</ul>` : ''}
        <div class="insight-action"><i class="bi bi-lightbulb-fill"></i>${ins.action}</div>
      </div>
    </div>`).join('') : `<div class="col-12">${PWIDGETS.emptyState('bi-stars','No standout insights right now','Your pricing looks well aligned with the market — nothing significant to flag today.')}</div>`;
}

/* ==========================================================================
   Pricing Recommendations — nine concrete recommended-action types, each with
   its own real, deterministic trigger condition against live rate/channel/
   room/market data (never random). A type only produces a card when its
   condition is actually met on this property today — never fabricated to
   fill space.
   ========================================================================== */
const REC_ACTION_TYPES = {
  increase:        { label:'Increase Price',                  icon:'bi-arrow-up-circle-fill',   color:'#12b76a', bg:'#e7faf1' },
  decrease:        { label:'Decrease Price',                  icon:'bi-arrow-down-circle-fill',  color:'#ff4d5e', bg:'#fff0f1' },
  maintain:        { label:'Maintain Current Price',          icon:'bi-dash-circle-fill',        color:'#3861fb', bg:'#eef4ff' },
  channelAdjust:   { label:'Adjust Channel-Specific Rates',   icon:'bi-sliders',                 color:'#8c5cf7', bg:'#f3eeff' },
  parity:          { label:'Fix Rate Parity Issues',          icon:'bi-exclamation-octagon-fill',color:'#ff4d5e', bg:'#fff0f1' },
  mealPlan:        { label:'Review Meal Plan Pricing',        icon:'bi-cup-hot-fill',            color:'#b9791a', bg:'#fff8e6' },
  roomPositioning: { label:'Review Room Positioning',         icon:'bi-door-open-fill',          color:'#00c2a8', bg:'#e6fbf8' },
  promotions:      { label:'Monitor Competitor Promotions',   icon:'bi-megaphone-fill',          color:'#b9791a', bg:'#fff8e6' },
  opportunity:     { label:'Capitalize on Market Opportunities', icon:'bi-graph-up-arrow',        color:'#12b76a', bg:'#e7faf1' },
};

function generatePricingRecommendations(propertyId){
  const today = PORTALDATA.dateKeyOffset(0);
  const myRate = PORTALDATA.myRateOnDate(propertyId, today);
  const comps = PORTALDATA.comparisonRealProperties();
  const recs = [];
  if(!myRate) return recs;

  function push(type, detail, opts){
    recs.push({ type, detail, ...opts });
  }

  /* ---- 1/2/3. Increase / Decrease / Maintain — my rate vs. the tracked market average ---- */
  if(comps.length){
    const compRates = comps.map(c=>PORTALDATA.competitorRateOnDate(c, today));
    const marketAvg = Math.round(compRates.reduce((a,b)=>a+b,0)/compRates.length);
    const gapPct = ((marketAvg-myRate)/myRate*100);
    if(gapPct > 6){
      const amount = Math.round((marketAvg-myRate)*0.6/10)*10;
      push('increase', `Market average (${APP.fmtCurrency(marketAvg)}) is running ${gapPct.toFixed(1)}% above your rate — room to raise without losing competitiveness.`,
        { currentRate:myRate, expectedRate:myRate+amount, confidence:82, priority: gapPct>=15?'High':'Medium' });
    } else if(gapPct < -6){
      const amount = Math.round((myRate-marketAvg)*0.5/10)*10;
      push('decrease', `You're priced ${Math.abs(gapPct).toFixed(1)}% above the market average (${APP.fmtCurrency(marketAvg)}) — risk of losing share to competitors.`,
        { currentRate:myRate, expectedRate:myRate-amount, confidence:76, priority: Math.abs(gapPct)>=15?'High':'Medium' });
    } else {
      push('maintain', `Your rate is within ${Math.abs(gapPct).toFixed(1)}% of the ${comps.length}-property market average (${APP.fmtCurrency(marketAvg)}) — well aligned.`,
        { currentRate:myRate, expectedRate:myRate, confidence:90, priority:'Low' });
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
        push('channelAdjust', `${outlier.ch.name} is priced ${Math.abs(diffPct).toFixed(1)}% ${diffPct>0?'above':'below'} your average OTA rate (${APP.fmtCurrency(Math.round(mean))}) — worth reviewing that channel's specific pricing.`,
          { currentRate:outlier.rate, expectedRate:Math.round(mean), confidence:70, priority: Math.abs(diffPct)>=25?'High':'Medium' });
      }
    }
  }

  /* ---- 5. Fix Rate Parity Issues — an OTA undercutting your Direct rate (shared check used by
     the Dashboard KPI and Market Insight Cards' parity alert: PORTALDATA.firstParityViolation). ---- */
  const violation1 = PORTALDATA.firstParityViolation(propertyId, today);
  if(violation1){
    const gapPct = ((violation1.directPrice-violation1.otaPrice)/violation1.directPrice*100);
    push('parity', `${violation1.channel.name} is listing ${violation1.room.name} at ${APP.fmtCurrency(violation1.otaPrice)} — ${gapPct.toFixed(1)}% below your Direct rate of ${APP.fmtCurrency(violation1.directPrice)}.`,
      { currentRate:violation1.otaPrice, expectedRate:violation1.directPrice, confidence:88, priority:'High',
        applyPlan: violation1.plan, applyRoom: violation1.room });
  }

  /* ---- 6. Review Meal Plan Pricing — EP/CP/MAP/AP should get progressively more expensive as
     more is included; flag if the actual data doesn't follow that order. ---- */
  const mealOrder = ['EP','CP','MAP','AP'];
  const mealRates = mealOrder.map(p=>({ plan:p, rate:PORTALDATA.mealPlanRateOnDate(propertyId, p, today) })).filter(m=>m.rate!=null);
  for(let i=1;i<mealRates.length;i++){
    if(mealRates[i].rate < mealRates[i-1].rate*0.98){
      push('mealPlan', `${DB.MEAL_LABELS[mealRates[i-1].plan]} (${APP.fmtCurrency(mealRates[i-1].rate)}) is priced higher than ${DB.MEAL_LABELS[mealRates[i].plan]} (${APP.fmtCurrency(mealRates[i].rate)}), despite including less — worth re-checking the pricing ladder.`,
        { currentRate:mealRates[i].rate, expectedRate:mealRates[i-1].rate, confidence:74, priority:'Medium' });
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
        push('roomPositioning', `${sorted[i].name} (${sorted[i].capacity} guests, ${APP.fmtCurrency(sorted[i].basePrice)}) is priced below ${sorted[i-1].name} (${sorted[i-1].capacity} guests, ${APP.fmtCurrency(sorted[i-1].basePrice)}) despite sleeping more guests.`,
          { currentRate:sorted[i].basePrice, expectedRate:sorted[i-1].basePrice, confidence:72, priority:'Medium' });
        break;
      }
    }
  }

  /* ---- 8. Monitor Competitor Promotions — a competitor cut their rate sharply in the last
     7 days (possible promo push worth watching, distinct from a Direct-channel parity issue). ---- */
  if(comps.length){
    const mover = comps.map(c=>{
      const t = PORTALDATA.competitorRateOnDate(c, today);
      const y = PORTALDATA.competitorRateOnDate(c, PORTALDATA.dateKeyOffset(-7));
      return { c, pct: y ? ((t-y)/y*100) : 0 };
    }).sort((a,b)=>a.pct-b.pct)[0];
    if(mover && mover.pct <= -8){
      push('promotions', `${mover.c.name} cut their rate ${Math.abs(mover.pct).toFixed(1)}% over the last 7 days — likely running a promotion. Keep an eye on their booking pace.`,
        { confidence:68, priority: mover.pct<=-15?'High':'Medium' });
    }
  }

  /* ---- 9. Capitalize on Market Opportunities — a weekend/holiday or local event is coming up
     within the week, and you're not already priced at a premium — a chance to raise ahead of
     anticipated demand. ---- */
  for(let d=1; d<=6; d++){
    const dk = PORTALDATA.dateKeyOffset(d);
    const isSpecial = PORTALDATA.isWeekend(dk) || PORTALDATA.isHoliday(dk);
    const evt = PORTALDATA.localEventOn(dk);
    if((isSpecial || evt) && comps.length){
      const compRatesThen = comps.map(c=>PORTALDATA.competitorRateOnDate(c, dk));
      const marketAvgThen = Math.round(compRatesThen.reduce((a,b)=>a+b,0)/compRatesThen.length);
      const myRateThen = PORTALDATA.myRateOnDate(propertyId, dk);
      if(myRateThen <= marketAvgThen*1.02){
        const reason = evt ? `Local event detected: ${evt}` : PORTALDATA.isHoliday(dk) ? 'Upcoming holiday' : 'Upcoming weekend';
        push('opportunity', `${reason} on ${APP.fmtDateReadable(dk)} — this market typically commands higher rates and you're not yet priced ahead of it.`,
          { currentRate:myRateThen, expectedRate:Math.round(myRateThen*1.08/10)*10, confidence:69, priority:'Medium' });
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
let acQueue = [];
function renderActionCenter(propertyId){
  const today = PORTALDATA.dateKeyOffset(0);
  acQueue = generatePricingRecommendations(propertyId).filter(r=>r.type!=='maintain' && r.currentRate!=null && r.expectedRate!=null && r.currentRate!==r.expectedRate);

  document.getElementById('ac_countBadge').textContent = acQueue.length ? `${acQueue.length} pending` : '';

  document.getElementById('actionQueueGrid').innerHTML = acQueue.length ? acQueue.map((r,i)=>{
    const meta = REC_ACTION_TYPES[r.type];
    const delta = r.expectedRate - r.currentRate;
    return `<div class="col-md-6 col-xl-4">
      <div class="insight-card priority-${r.priority}">
        <div class="d-flex align-items-start gap-2 mb-2">
          <div class="insight-icon" style="background:${meta.bg};color:${meta.color}"><i class="bi ${meta.icon}"></i></div>
          <div class="flex-grow-1">
            <div class="fw-bold" style="font-size:.86rem;line-height:1.25">${meta.label}</div>
            <div class="d-flex gap-1 mt-1">
              <span class="insight-priority-badge ${r.priority}">${r.priority} Priority</span>
              <span class="insight-confidence-badge">Confidence: ${r.confidence}%</span>
            </div>
          </div>
        </div>
        <p class="text-muted small mb-2">${r.detail}</p>
        <div class="row g-2 mb-2">
          <div class="col-6"><div class="text-muted" style="font-size:.68rem">Current Rate</div><div class="fw-semibold">${APP.fmtCurrency(r.currentRate)}</div></div>
          <div class="col-6"><div class="text-muted" style="font-size:.68rem">New Rate</div><div class="fw-semibold ${delta>0?'text-danger':'text-success'}">${APP.fmtCurrency(r.expectedRate)}</div></div>
        </div>
        <button class="btn btn-primary btn-sm w-100" onclick="openApplyModal(${i})"><i class="bi bi-lightning-charge-fill me-1"></i>Apply Rate Change</button>
      </div>
    </div>`;
  }).join('') : `<div class="col-12">${PWIDGETS.emptyState('bi-check2-circle','Nothing to act on right now','Every open recommendation has already been applied or your pricing is well aligned — check back after the market moves.')}</div>`;

  renderRecentlyApplied(propertyId);
}

function renderRecentlyApplied(propertyId){
  const applied = PORTALDATA.notifications(propertyId).filter(n=>n.type==='rateApplied').slice(0,6);
  document.getElementById('ac_recentList').innerHTML = applied.length ? applied.map(n=>`
    <div class="d-flex align-items-start gap-2 mb-2 pb-2" style="border-bottom:1px solid var(--border-2)">
      <i class="bi bi-check-circle-fill mt-1" style="color:#12b76a;font-size:.85rem"></i>
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
  const meta = REC_ACTION_TYPES[rec.type];
  document.getElementById('acModalDetail').textContent = rec.detail;
  document.getElementById('acModalCurrent').textContent = APP.fmtCurrency(rec.currentRate);
  document.getElementById('acModalNew').textContent = APP.fmtCurrency(rec.expectedRate);
  document.getElementById('acModalScope').textContent = rec.applyPlan
    ? `Applies to ${rec.applyRoom.name} on ${APP.fmtDateReadable(rec.date || PORTALDATA.dateKeyOffset(0))}.`
    : `Applies proportionally across every Direct (Master) room/rate plan on ${APP.fmtDateReadable(rec.date || PORTALDATA.dateKeyOffset(0))}.`;
  document.getElementById('acModalApplyBtn').onclick = ()=>{
    applyRecommendation(rec, meta);
    bootstrap.Modal.getInstance(document.getElementById('acApplyModal')).hide();
  };
  new bootstrap.Modal(document.getElementById('acApplyModal')).show();
}

function applyRecommendation(rec, meta){
  const me = RBAC.currentUser();
  const propertyId = PORTAL.activePropertyId(me);
  const date = rec.date || PORTALDATA.dateKeyOffset(0);
  const ratio = rec.currentRate>0 ? rec.expectedRate/rec.currentRate : 1;

  let targets = [];
  if(rec.applyPlan){
    targets = [{ plan:rec.applyPlan, room:rec.applyRoom }];
  } else {
    const channels = DB.channels.byProperty(propertyId);
    const master = channels.find(c=>c.type==='master');
    if(master){
      DB.rooms.byChannel(master.id).forEach(room=>{
        DB.ratePlans.byRoom(room.id).forEach(plan=> targets.push({ plan, room }));
      });
    }
  }

  targets.forEach(({plan,room})=>{
    const day = DB.rates.forPlan(plan.id)[date];
    const price = day ? day.price : room.basePrice;
    const newPrice = Math.max(500, Math.round(price*ratio/10)*10);
    const maxOcc = Math.max(room.maxOccupancy||1, plan.baseOccupancy||1);
    DB.rates.setRange(plan.id, date, date, newPrice, plan.baseOccupancy, plan.extraAdultPrice, maxOcc);
  });

  PORTALDATA.addNotification(propertyId, {
    type:'rateApplied', icon:'bi-lightning-charge-fill', priority:'low',
    title:`${meta.label} applied`,
    message:`${APP.fmtCurrency(rec.currentRate)} → ${APP.fmtCurrency(rec.expectedRate)} for ${APP.fmtDateReadable(date)}.`
  });

  APP.toast('Rate Change Applied', `${meta.label} — new rate takes effect for ${APP.fmtDateReadable(date)}.`, 'success');
  PORTAL.refreshBell(me);
  renderActionCenter(propertyId);
}
