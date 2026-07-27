let rsPinnedOnly = false;
let rsChart = null;
let rsRangeDays = 30;
let rsHidden = new Set(); // series keys hidden from the chart

// Shared Chart.js animation preset — same helper as Dashboard/Market/Room Rate Comparison;
// each line draws in with a smooth ease, staggered slightly per series.
function chartAnim(isBar){
  return {
    duration: 850, easing: 'easeOutQuart',
    delay: (ctx)=> isBar
      ? (ctx.type==='data' ? ctx.dataIndex*30 + (ctx.datasetIndex||0)*80 : 0)
      : (ctx.datasetIndex||0) * 150
  };
}

// Muted/pastel palette for benchmark properties — each gets its own distinguishable color so
// lines don't blur together, but all are visually secondary to My Property's bold solid blue.
const OTHER_LINE_COLORS = ['#a9b0c9','#9fd6ca','#c3aee8','#f2c194','#e6a8c4','#a6d9a6','#e3a6a6','#a9c6e8'];

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Rate Shopper', subtitle:'Compare your rate against the properties selected by your Company Admin, channel by channel.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);

  document.getElementById('rs_date').value = PORTALDATA.dateKeyOffset(0);
  document.getElementById('rs_channel').innerHTML += PORTALDATA.CHANNELS.map(c=>`<option value="${c.key}">${c.label}</option>`).join('');

  ['rs_date','rs_channel','rs_status','rs_search'].forEach(id=> document.getElementById(id).addEventListener('input', renderAll));
  document.getElementById('rs_pinnedOnly').addEventListener('click', function(){
    rsPinnedOnly = !rsPinnedOnly;
    this.classList.toggle('btn-primary', rsPinnedOnly);
    this.classList.toggle('btn-soft', !rsPinnedOnly);
    renderAll();
  });
  document.getElementById('rs_export').addEventListener('click', ()=> APP.toast('Export Started', 'Your Rate Shopper comparison is being prepared for download.', 'success'));

  document.querySelectorAll('#rs_rangeGroup button').forEach(btn=>{
    btn.addEventListener('click', function(){
      rsRangeDays = Number(this.dataset.days);
      document.querySelectorAll('#rs_rangeGroup button').forEach(b=>{ b.classList.remove('btn-outline-primary'); b.classList.add('btn-soft'); });
      this.classList.remove('btn-soft'); this.classList.add('btn-outline-primary');
      renderChart();
    });
  });

  function seriesList(){
    const comps = PORTALDATA.comparisonRealProperties();
    return [{ key:'__me', label:'My Property', isMe:true }, ...comps.map(c=>({ key:c.id, label:c.name, comp:c }))];
  }

  function rateFor(series, dateKey){
    return series.isMe ? PORTALDATA.myRateOnDate(propertyId, dateKey) : PORTALDATA.competitorRateOnDate(series.comp, dateKey);
  }

  function prevDateKey(dateKey){
    const d = new Date(dateKey+'T00:00:00');
    d.setDate(d.getDate()-1);
    return DB.fmtDate(d);
  }

  // Tickers always reflect whichever date is picked in the "Rate Date" filter (defaulting to
  // today) so it's never ambiguous which stay date the top-of-page prices are for — they move
  // together with the table below rather than always showing "today" regardless of the filter.
  function renderTickers(){
    const dateKey = document.getElementById('rs_date').value || PORTALDATA.dateKeyOffset(0);
    const prev = prevDateKey(dateKey);
    const list = seriesList();

    document.getElementById('rs_tickerCaption').innerHTML =
      `<i class="bi bi-clock-history me-1"></i>Rates shown for <strong>${APP.fmtDateReadable(dateKey)}</strong> · Direct (Master) channel · vs. the day before`;

    document.getElementById('tickerRow').innerHTML = list.map(s=>{
      const price = rateFor(s, dateKey);
      const prevPrice = rateFor(s, prev);
      const chg = price - prevPrice;
      const chgPct = prevPrice ? (chg/prevPrice*100) : 0;
      const dir = chg>0 ? 'up' : chg<0 ? 'down' : 'flat';
      const arrow = dir==='up' ? 'bi-caret-up-fill' : dir==='down' ? 'bi-caret-down-fill' : 'bi-dash';
      return `<div class="col-6 col-md-4 col-xl-2">
        <div class="ticker-card ${s.isMe?'is-me':''}">
          <div class="ticker-name">${s.isMe?'<i class="bi bi-star-fill me-1" style="color:var(--brand-500)"></i>':''}${s.label}</div>
          <div class="ticker-price">${APP.fmtCurrency(price)}</div>
          <div class="ticker-change ticker-${dir}"><i class="bi ${arrow}"></i>${chg>=0?'+':''}${APP.fmtCurrency(chg)} (${chgPct>=0?'+':''}${chgPct.toFixed(1)}%)</div>
        </div>
      </div>`;
    }).join('');
  }

  // Stable color per property regardless of sort/filter order, so a given benchmark property
  // always shows the same muted color across the legend and the chart.
  function seriesColor(s){
    if(s.isMe) return '#3861fb';
    const others = seriesList().filter(x=>!x.isMe);
    const idx = others.findIndex(x=>x.key===s.key);
    return OTHER_LINE_COLORS[idx % OTHER_LINE_COLORS.length];
  }

  function renderLegend(){
    const list = seriesList();
    document.getElementById('rs_legendToggles').innerHTML = list.map((s)=>{
      const color = seriesColor(s);
      const off = rsHidden.has(s.key);
      return `<span class="legend-toggle ${off?'off':''}" onclick="rsToggleSeries('${s.key}')"><span class="dot" style="background:${color}"></span>${s.label}</span>`;
    }).join('');
  }

  window.rsToggleSeries = function(key){
    if(rsHidden.has(key)) rsHidden.delete(key); else rsHidden.add(key);
    renderLegend();
    renderChart();
  };

  function renderChart(){
    // My Property is the "index" line — bold, solid brand blue, drawn last (on top). Every
    // benchmark property still gets its own line and its own muted color (never hidden by
    // default) but rendered thin and pastel so My Property remains the one thing that pops.
    const list = seriesList().filter(s=>!rsHidden.has(s.key));
    list.sort((a,b)=> (a.isMe?1:0) - (b.isMe?1:0)); // isMe last => drawn on top
    const labels = [];
    for(let d=-rsRangeDays; d<=0; d++){ labels.push(PORTALDATA.dateKeyOffset(d).slice(5)); }

    const datasets = list.map((s)=>{
      const color = seriesColor(s);
      const data = [];
      for(let d=-rsRangeDays; d<=0; d++){ data.push(rateFor(s, PORTALDATA.dateKeyOffset(d))); }
      return {
        label: s.label, data, borderColor: color,
        backgroundColor: s.isMe ? 'rgba(56,97,251,.12)' : 'transparent',
        borderWidth: s.isMe ? 3.5 : 1.25, fill: s.isMe,
        pointRadius: 0, pointHoverRadius: s.isMe ? 5 : 3, tension: .3
      };
    });

    if(rsChart) rsChart.destroy();
    rsChart = new Chart(document.getElementById('rs_chart'), {
      type:'line',
      data:{ labels, datasets },
      options:{
        responsive:true, interaction:{mode:'index', intersect:false}, animation:chartAnim(false),
        plugins:{ legend:{display:false}, tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${APP.fmtCurrency(ctx.parsed.y)}`}} },
        scales:{ y:{ticks:{callback:v=>APP.fmtCurrency(v)}} }
      }
    });
  }

  function renderTable(){
    const dateKey = document.getElementById('rs_date').value || PORTALDATA.dateKeyOffset(0);
    const channelFilter = document.getElementById('rs_channel').value;
    const statusFilter = document.getElementById('rs_status').value;
    const search = document.getElementById('rs_search').value.trim().toLowerCase();

    const myRate = PORTALDATA.myRateOnDate(propertyId, dateKey);
    let comps = PORTALDATA.comparisonRealProperties();
    if(rsPinnedOnly) comps = comps.filter(c=>c.pinned);
    if(search) comps = comps.filter(c=>c.name.toLowerCase().includes(search));

    let rows = comps.map(c=>{
      const channel = channelFilter || c.primaryChannel;
      const baseRate = PORTALDATA.competitorRateOnDate(c, dateKey);
      const rate = PORTALDATA.channelRate(baseRate, channel, dateKey);
      const diff = rate - myRate;
      const diffPct = (diff/myRate)*100;
      const status = Math.abs(diffPct) < 2 ? 'parity' : diff>0 ? 'pricier' : 'cheaper';
      return { c, channel, rate, diff, diffPct, status, trend: PORTALDATA.competitorTrend(c, dateKey) };
    });
    if(statusFilter) rows = rows.filter(r=>r.status===statusFilter);
    rows.sort((a,b)=>a.rate-b.rate);

    document.getElementById('rs_summary').textContent = `Showing ${rows.length} of ${comps.length} benchmark properties for ${APP.fmtDateReadable(dateKey)} — My Rate (Direct channel): ${APP.fmtCurrency(myRate)}`;

    const bodyRows = rows.map((r,i)=>`
      <tr>
        <td>
          <div class="d-flex align-items-center gap-2">
            <img src="${r.c.image}" style="width:34px;height:34px;border-radius:8px;object-fit:cover">
            <div>
              <div class="fw-semibold" style="font-size:.82rem">${r.c.name} <span class="badge bg-primary-subtle text-primary" style="font-size:.6rem">Benchmark</span> ${r.c.pinned?'<i class="bi bi-pin-angle-fill text-warning" style="font-size:.7rem"></i>':''}</div>
              <div class="text-muted" style="font-size:.7rem">${r.c.city}, ${r.c.country}</div>
            </div>
          </div>
        </td>
        <td>${r.c.stars}★</td>
        <td>${r.c.roomType}</td>
        <td>${r.c.mealPlan}</td>
        <td>${PWIDGETS.channelChip(r.channel)}</td>
        <td class="fw-semibold">${APP.fmtCurrency(myRate)}</td>
        <td class="fw-semibold">${APP.fmtCurrency(r.rate)}</td>
        <td class="${r.diff>=0?'text-danger':'text-success'}">${r.diff>=0?'+':''}${APP.fmtCurrency(r.diff)}</td>
        <td class="${r.diff>=0?'text-danger':'text-success'}">${r.diff>=0?'+':''}${r.diffPct.toFixed(1)}%</td>
        <td>#${i+1}</td>
        <td style="font-size:.72rem">${r.c.cancellationPolicy}</td>
        <td>${PWIDGETS.trendIcon(r.trend)}</td>
        <td>${PWIDGETS.statusBadge(r.status)}</td>
        <td class="text-end">
          <button class="btn btn-sm-icon btn-soft" onclick="togglePin('${r.c.id}')" title="Pin"><i class="bi ${r.c.pinned?'bi-pin-angle-fill':'bi-pin-angle'}"></i></button>
          <a href="property-competitors.html?id=${r.c.id}" class="btn btn-sm-icon btn-soft" title="View"><i class="bi bi-eye"></i></a>
        </td>
      </tr>`).join('');

    document.getElementById('rateShopperTable').innerHTML = `
      <thead><tr>
        <th>Competitor</th><th>Stars</th><th>Room</th><th>Meal Plan</th><th>Channel</th>
        <th title="Your Direct (Master) channel rate for the selected date — always, regardless of the Channel filter above.">My Rate (Direct)</th>
        <th title="The competitor's rate on the channel shown in the Channel column, for the selected date.">Competitor Rate</th>
        <th>Difference</th><th>Diff %</th><th>Rank</th>
        <th>Cancellation</th><th>Trend</th><th>Status</th><th></th>
      </tr></thead>
      <tbody>${bodyRows || `<tr><td colspan="14" class="text-center text-muted py-4">${comps.length ? 'No competitors match these filters.' : "No comparison properties assigned yet — ask your Company Admin to select some."}</td></tr>`}</tbody>`;
  }

  window.togglePin = function(id){
    const c = PORTALDATA.competitor(propertyId, id);
    if(!c) return;
    c.pinned = !c.pinned;
    PORTALDATA.saveCompetitor(propertyId, c);
    renderAll();
  };

  function renderAll(){
    renderTickers();
    renderTable();
  }

  renderTickers();
  renderLegend();
  renderChart();
  renderTable();
});
