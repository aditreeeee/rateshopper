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
      document.getElementById('mi_tabChannels').classList.toggle('d-none', this.dataset.tab!=='channels');
      // Chart.js can't size a canvas that was hidden (display:none) at creation time — force a
      // resize once its tab actually becomes visible.
      if(this.dataset.tab==='channels' && caChart) caChart.resize();
    });
  });
  renderMarketInsights(propertyId);
  renderRecommendations(propertyId);
  renderChannelAnalysis(propertyId);
  document.getElementById('mi_staleBadge').innerHTML = PWIDGETS.staleBadge(PORTALDATA.lastScrapedAt(propertyId));

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

  const labels=[], data=[];
  for(let d=-30; d<=30; d+=2){ const dk=PORTALDATA.dateKeyOffset(d); labels.push(dk.slice(5)); data.push(avgRateOn(dk)); }
  new Chart(document.getElementById('marketTrendChart'), {
    type:'line',
    data:{ labels, datasets:[{label:'Market Average', data, borderColor:'#8c5cf7', backgroundColor:'rgba(140,92,247,.08)', tension:.35, fill:true}] },
    options:{ responsive:true, animation:chartAnim(false), plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
  });

  // ---- Competitor Pricing Matrix: My Property (pinned reference row) + every competitor,
  // day by day for the next 7 days, each cell colored relative to my own rate that day, plus a
  // 7-day average column so you can see who's cheaper/pricier at a glance without doing the math. ----
  const matrixDays = Array.from({length:7}).map((_,d)=> PORTALDATA.dateKeyOffset(d));
  const myMatrixRates = matrixDays.map(dk=> PORTALDATA.myRateOnDate(propertyId, dk));
  const myMatrixAvg = Math.round(myMatrixRates.reduce((a,b)=>a+b,0)/myMatrixRates.length);

  const myRowHtml = `<tr class="rc-frozen-row">
    <td class="fw-semibold" style="white-space:nowrap"><i class="bi bi-star-fill me-1" style="color:var(--brand-500)"></i>My Property</td>
    ${myMatrixRates.map(r=>`<td class="fw-bold">${APP.fmtCurrency(r)}</td>`).join('')}
    <td class="fw-bold">${APP.fmtCurrency(myMatrixAvg)}</td>
  </tr>`;
  const compRowsHtml = comps.map(c=>{
    const compRates = matrixDays.map(dk=> PORTALDATA.competitorRateOnDate(c,dk));
    const compAvg = Math.round(compRates.reduce((a,b)=>a+b,0)/compRates.length);
    return `<tr>
      <td class="fw-semibold" style="white-space:nowrap">${c.name}</td>
      ${compRates.map((r,i)=>{
        const cls = r < myMatrixRates[i] ? 'text-success' : r > myMatrixRates[i] ? 'text-danger' : '';
        return `<td class="${cls}">${APP.fmtCurrency(r)}</td>`;
      }).join('')}
      <td class="fw-semibold ${compAvg<myMatrixAvg?'text-success':compAvg>myMatrixAvg?'text-danger':''}">${APP.fmtCurrency(compAvg)}</td>
    </tr>`;
  }).join('');

  document.getElementById('pricingMatrixTable').innerHTML = `
    <thead><tr><th style="white-space:nowrap">Competitor</th>${matrixDays.map(dk=>`<th style="white-space:nowrap">${new Date(dk+'T00:00:00').toLocaleDateString('en-IN',{weekday:'short',day:'2-digit',month:'short'})}</th>`).join('')}<th style="white-space:nowrap">7-Day Avg</th></tr></thead>
    <tbody>${myRowHtml}${compRowsHtml}</tbody>`;

  // ---- Competitor Movement: biggest 7-day movers, plus where each now sits vs. my rate today
  // (not just how much they moved) — the movement alone doesn't say whether that's something to
  // react to; "vs. My Rate Today" does. ----
  const myRateToday = PORTALDATA.myRateOnDate(propertyId, today);
  const movement = [...comps].map(c=>{
    const t = PORTALDATA.competitorRateOnDate(c,today), y = PORTALDATA.competitorRateOnDate(c, PORTALDATA.dateKeyOffset(-7));
    const vsMine = ((t-myRateToday)/myRateToday*100);
    return {c, chg:((t-y)/y*100), today:t, vsMine};
  }).sort((a,b)=>Math.abs(b.chg)-Math.abs(a.chg)).slice(0,10);
  document.getElementById('movementTable').innerHTML = `
    <thead><tr><th>Competitor</th><th>7 Days Ago</th><th>Today</th><th>7-Day Change</th><th>vs. My Rate Today</th></tr></thead>
    <tbody>${movement.map(m=>`<tr>
      <td>${m.c.name}</td>
      <td>${APP.fmtCurrency(PORTALDATA.competitorRateOnDate(m.c, PORTALDATA.dateKeyOffset(-7)))}</td>
      <td class="fw-semibold">${APP.fmtCurrency(m.today)}</td>
      <td class="${m.chg>=0?'text-danger':'text-success'} fw-semibold">${PWIDGETS.trendIcon(m.chg>0?'up':m.chg<0?'down':'flat')} ${m.chg>=0?'+':''}${m.chg.toFixed(1)}%</td>
      <td class="${m.vsMine<=0?'text-success':'text-danger'} fw-semibold">${m.vsMine>=0?'+':''}${m.vsMine.toFixed(1)}%</td>
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
  const channels = DB.channels.byProperty(propertyId);
  const master = channels.find(c=>c.type==='master');
  if(master){
    const otaChannels = channels.filter(c=>c.type!=='master');
    const masterRooms = DB.rooms.byChannel(master.id);
    let violation = null;
    otaChannels.forEach(ch=>{
      if(violation) return;
      masterRooms.forEach(room=>{
        if(violation) return;
        DB.ratePlans.byRoom(room.id).forEach(plan=>{
          if(violation) return;
          const dayData = DB.rates.forPlan(plan.id)[today];
          const directPrice = dayData ? dayData.price : room.basePrice;
          const otaRoom = DB.rooms.byChannel(ch.id).find(r=>r.name===room.name);
          if(!otaRoom) return;
          const otaPlan = DB.ratePlans.byRoom(otaRoom.id).find(p=>p.mealPlan===plan.mealPlan);
          if(!otaPlan) return;
          const otaDay = DB.rates.forPlan(otaPlan.id)[today];
          const otaPrice = otaDay ? otaDay.price : otaRoom.basePrice;
          if(otaPrice < directPrice*0.97){
            violation = { channel:ch, room, directPrice, otaPrice };
          }
        });
      });
    });
    if(violation){
      const gapPct = ((violation.directPrice-violation.otaPrice)/violation.directPrice*100);
      insights.push({
        icon:'bi-exclamation-octagon-fill', color:'#ff4d5e', bg:'#fff0f1',
        title:'Rate parity issue detected across channels',
        detail:`${violation.channel.name} is listing ${violation.room.name} at ${APP.fmtCurrency(violation.otaPrice)} — ${gapPct.toFixed(1)}% below your Direct rate of ${APP.fmtCurrency(violation.directPrice)}.`,
        supporting: [], action:'Recommended: Review channel parity settings',
        priority:'High', confidence:'High', impact: gapPct+10 // parity issues surface near the top
      });
    }
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

function renderRecommendations(propertyId){
  const recs = PORTALDATA.recommendations(propertyId);
  document.getElementById('recGrid').innerHTML = recs.map(r=>{
    const actionLabel = r.action==='increase' ? `Increase by ${APP.fmtCurrency(r.amount)}` : r.action==='decrease' ? `Decrease by ${APP.fmtCurrency(r.amount)}` : 'Keep Current Price';
    const icon = r.action==='increase' ? 'bi-arrow-up' : r.action==='decrease' ? 'bi-arrow-down' : 'bi-dash';
    return `<div class="col-md-6 col-xl-4">
      <div class="rec-card">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <span class="rec-badge ${r.action}"><i class="bi ${icon}"></i>${actionLabel}</span>
          <span class="text-muted small">${APP.fmtDateReadable(r.date)}</span>
        </div>
        <p class="text-muted small mb-3">${r.reason}</p>
        <div class="row g-2 mb-3">
          <div class="col-6"><div class="text-muted" style="font-size:.68rem">Current Rate</div><div class="fw-semibold">${APP.fmtCurrency(r.currentRate)}</div></div>
          <div class="col-6"><div class="text-muted" style="font-size:.68rem">Expected Rate</div><div class="fw-semibold">${APP.fmtCurrency(r.expectedRate)}</div></div>
        </div>
        <div class="d-flex justify-content-between align-items-center mb-1">
          <span class="text-muted small">Confidence</span><span class="fw-semibold small">${r.confidence}%</span>
        </div>
        <div class="confidence-track mb-3"><div class="confidence-fill" style="width:${r.confidence}%"></div></div>
        <div class="d-flex gap-2 mt-3">
          <button class="btn btn-primary btn-sm flex-fill" onclick="APP.toast('Recommendation Applied','${actionLabel.replace(/'/g,"")} has been applied to your Rate Calendar (demo only).','success')">Apply</button>
          <button class="btn btn-light btn-sm flex-fill" onclick="APP.toast('Dismissed','Recommendation dismissed.','info')">Dismiss</button>
        </div>
      </div>
    </div>`;
  }).join('') || `<div class="col-12">${PWIDGETS.emptyState('bi-lightbulb','No recommendations right now','Check back soon — your pricing looks well optimized.')}</div>`;
}

// ---- Channel Analysis (merged in from the standalone Channel Analysis page) ----
let caChart = null;
function renderChannelAnalysis(propertyId){
  const todayKey = DB.fmtDate(new Date());
  const channels = DB.channels.byProperty(propertyId);
  const master = channels.find(c=>c.type==='master');

  function channelAvgRateOnDate(channelId, dateKey){
    const rooms = DB.rooms.byChannel(channelId);
    let sum = 0, count = 0;
    rooms.forEach(room=>{
      DB.ratePlans.byRoom(room.id).forEach(rp=>{
        const day = DB.rates.forPlan(rp.id)[dateKey];
        sum += day ? day.price : room.basePrice;
        count++;
      });
    });
    return count ? Math.round(sum/count) : null;
  }

  const WINDOW_DAYS = 30;
  const directCurrent = master ? channelAvgRateOnDate(master.id, todayKey) : null;

  const channelMetrics = channels.map(ch=>{
    const series = [];
    for(let d=0; d<WINDOW_DAYS; d++){
      const dk = DB.fmtDate(new Date(Date.now()+d*86400000));
      const rate = channelAvgRateOnDate(ch.id, dk);
      if(rate!=null) series.push(rate);
    }
    const current = channelAvgRateOnDate(ch.id, todayKey);
    const lowest = series.length ? Math.min(...series) : null;
    const highest = series.length ? Math.max(...series) : null;
    const average = series.length ? Math.round(series.reduce((a,b)=>a+b,0)/series.length) : null;
    const diff = (current!=null && directCurrent!=null) ? current-directCurrent : null;
    return { channel: ch, current, lowest, highest, average, diff };
  });

  document.getElementById('channelCards').innerHTML = channelMetrics.map(m=>{
    const meta = DB.CHANNEL_TYPES[m.channel.type] || DB.CHANNEL_TYPES.custom;
    return `<div class="col-md-6 col-xl-4">
      <div class="channel-perf-card">
        <div class="d-flex align-items-center gap-2 mb-2">
          <i class="bi ${meta.icon}" style="color:${meta.color}"></i>
          <span class="fw-bold" style="font-size:.9rem">${m.channel.name}</span>
          <span class="text-muted" style="font-size:.68rem">#${m.channel.channelCode}</span>
          ${m.channel.id===(master&&master.id) ? '<span class="badge bg-primary-subtle text-primary ms-auto" style="font-size:.6rem">Direct</span>' : ''}
        </div>
        <div class="kv-row"><span class="k">Current Rate</span><span class="v fw-semibold">${m.current!=null?APP.fmtCurrency(m.current):'—'}</span></div>
        <div class="kv-row"><span class="k">Lowest Rate</span><span class="v">${m.lowest!=null?APP.fmtCurrency(m.lowest):'—'}</span></div>
        <div class="kv-row"><span class="k">Highest Rate</span><span class="v">${m.highest!=null?APP.fmtCurrency(m.highest):'—'}</span></div>
        <div class="kv-row"><span class="k">Average Rate</span><span class="v">${m.average!=null?APP.fmtCurrency(m.average):'—'}</span></div>
        <div class="kv-row"><span class="k">Rate Difference</span><span class="v ${m.diff==null?'':m.diff>0?'text-danger':m.diff<0?'text-success':''}">${m.diff==null?'—':`${m.diff>=0?'+':''}${APP.fmtCurrency(m.diff)}`}</span></div>
        <div class="kpi-desc">Current/Lowest/Highest/Average are this channel's rate today vs. over the next 30 days. Difference compares it to your Direct rate today.</div>
      </div>
    </div>`;
  }).join('');

  if(caChart) caChart.destroy();
  caChart = new Chart(document.getElementById('channelRateChart'), {
    type:'bar',
    data:{
      labels: channelMetrics.map(m=>m.channel.name),
      datasets:[{label:'Current Rate', data: channelMetrics.map(m=>m.current||0), backgroundColor: channelMetrics.map(m=>(DB.CHANNEL_TYPES[m.channel.type]||DB.CHANNEL_TYPES.custom).color), borderRadius:6}]
    },
    options:{ responsive:true, plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
  });

  const otaChannelsAll = channels.filter(c=>c.id !== (master && master.id));
  const myRoomsAll = master ? DB.rooms.byChannel(master.id) : [];

  document.getElementById('ca_room').innerHTML = `<option value="">All Rooms</option>` + myRoomsAll.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  document.getElementById('ca_channel').innerHTML = `<option value="">All Channels (OTA Avg.)</option>` + otaChannelsAll.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');

  function renderParityTable(){
    const roomFilter = document.getElementById('ca_room').value;
    const channelFilter = document.getElementById('ca_channel').value;
    const otaChannels = channelFilter ? otaChannelsAll.filter(c=>c.id===channelFilter) : otaChannelsAll;
    const rows = [];

    if(master){
      myRoomsAll.filter(room=> !roomFilter || room.id===roomFilter).forEach(room=>{
        DB.ratePlans.byRoom(room.id).forEach(rp=>{
          const directData = DB.rates.forPlan(rp.id)[todayKey];
          const directRate = directData ? directData.price : room.basePrice;

          const channelRates = [{ label: master.name, rate: directRate }];
          otaChannels.forEach(chan=>{
            const matchRoom = DB.rooms.byChannel(chan.id).find(r=> r.name===room.name);
            if(!matchRoom) return;
            const plans = DB.ratePlans.byRoom(matchRoom.id);
            const matchPlan = plans.find(p=> p.mealPlan===rp.mealPlan) || plans[0];
            if(!matchPlan) return;
            const dayData = DB.rates.forPlan(matchPlan.id)[todayKey];
            channelRates.push({ label: chan.name, rate: dayData ? dayData.price : matchRoom.basePrice });
          });

          const otaRates = channelRates.filter(c=>c.label!==master.name);
          const otaAvg = otaRates.length ? Math.round(otaRates.reduce((s,c)=>s+c.rate,0)/otaRates.length) : null;
          const diff = otaAvg!=null ? otaAvg-directRate : null;
          const cheapest = channelRates.reduce((min,c)=> c.rate<min.rate?c:min, channelRates[0]);
          const priciest = channelRates.reduce((max,c)=> c.rate>max.rate?c:max, channelRates[0]);

          let status, statusClass;
          if(!otaRates.length){ status='No OTA Data'; statusClass='badge-inactive'; }
          else if(cheapest.label===master.name){ status='At Parity'; statusClass='badge-active'; }
          else { status='Undercut'; statusClass='badge-inactive'; }

          rows.push({ room, rp, directRate, otaAvg, diff, cheapest, priciest, status, statusClass });
        });
      });
    }

    const otaRateLabel = channelFilter ? (otaChannelsAll.find(c=>c.id===channelFilter)||{}).name+' Rate' : 'OTA Rate (Avg.)';
    document.getElementById('parityTable').innerHTML = `
      <thead><tr><th>Room</th><th>Rate Plan</th><th>Direct Rate</th><th>${otaRateLabel}</th><th>Difference</th><th>Cheapest Channel</th><th>Most Expensive Channel</th><th>Parity Status</th></tr></thead>
      <tbody>${rows.map(r=>`<tr>
        <td class="fw-semibold">${r.room.name}</td>
        <td>${r.rp.name}</td>
        <td class="fw-semibold">${APP.fmtCurrency(r.directRate)}</td>
        <td>${r.otaAvg!=null?APP.fmtCurrency(r.otaAvg):'—'}</td>
        <td class="${r.diff==null?'':r.diff<0?'text-danger':'text-success'}">${r.diff==null?'—':`${r.diff>=0?'+':''}${APP.fmtCurrency(r.diff)}`}</td>
        <td>${r.cheapest.label}</td>
        <td>${r.priciest.label}</td>
        <td><span class="badge-status ${r.statusClass}">${r.status}</span></td>
      </tr>`).join('') || `<tr><td colspan="8" class="text-center text-muted py-4">No rooms found for these filters.</td></tr>`}</tbody>`;
  }

  document.getElementById('ca_room').addEventListener('change', renderParityTable);
  document.getElementById('ca_channel').addEventListener('change', renderParityTable);
  renderParityTable();
}
