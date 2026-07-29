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

  document.getElementById('rs_matrixFrame').src = 'property-rate-matrix.html?embed=1';

  // No comparison properties assigned yet — nothing to chart or ticker, so swap the whole
  // data area for an explanatory empty state instead of showing a lone "My Property" line.
  const hasComps = PORTALDATA.comparisonRealProperties().length > 0;
  document.getElementById('rs_dataSections').classList.toggle('d-none', !hasComps);
  document.getElementById('tickerRow').classList.toggle('d-none', !hasComps);
  const rsEmpty = document.getElementById('rs_emptyState');
  rsEmpty.classList.toggle('d-none', hasComps);
  if(!hasComps){
    rsEmpty.innerHTML = PWIDGETS.emptyState('bi-graph-up','No comparison properties assigned yet','Your Company Admin hasn\'t selected any benchmark properties for you yet — there\'s nothing to rate-shop against.');
    document.getElementById('rs_tickerCaption').textContent = '';
    return;
  }

  document.getElementById('rs_staleBadge').innerHTML = PWIDGETS.staleBadge(PORTALDATA.lastScrapedAt(propertyId));

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
    const dateKey = PORTALDATA.dateKeyOffset(0);
    const prev = prevDateKey(dateKey);
    const list = seriesList();

    document.getElementById('rs_tickerCaption').innerHTML =
      `<i class="bi bi-clock-history me-1"></i>Rates shown for <strong>${APP.fmtDateReadable(dateKey)}</strong> · Direct (Master) channel · vs. the day before`;

    document.getElementById('tickerRow').innerHTML = list.map((s,i)=>{
      const price = rateFor(s, dateKey);
      const prevPrice = rateFor(s, prev);
      const chg = price - prevPrice;
      const chgPct = prevPrice ? (chg/prevPrice*100) : 0;
      const dir = chg>0 ? 'up' : chg<0 ? 'down' : 'flat';
      const arrow = dir==='up' ? 'bi-arrow-up-short' : dir==='down' ? 'bi-arrow-down-short' : 'bi-dash-lg';
      const dirBg = dir==='up' ? '#fff0f1' : dir==='down' ? '#e7faf1' : 'var(--bg-surface-2)';
      const dirColor = dir==='up' ? '#ff4d5e' : dir==='down' ? '#12b76a' : 'var(--text-3)';
      const color = seriesColor(s);
      return `<div class="col-6 col-md-4 col-xl-2">
        <div class="ticker-card ${s.isMe?'is-me':''}" style="${s.isMe?'':`border-left-color:${color}`};animation-delay:${i*40}ms">
          <div class="d-flex align-items-start justify-content-between gap-2">
            <div class="ticker-name">${s.isMe?'<i class="bi bi-star-fill me-1" style="color:var(--brand-500)"></i>':`<span class="ticker-dot" style="background:${color}"></span>`}${s.label}</div>
            <span class="ticker-trend-badge" style="background:${dirBg};color:${dirColor}"><i class="bi ${arrow}"></i></span>
          </div>
          <div class="ticker-price">${APP.fmtCurrency(price)}</div>
          <div class="ticker-change ticker-${dir}">${chg>=0?'+':''}${APP.fmtCurrency(chg)} (${chgPct>=0?'+':''}${chgPct.toFixed(1)}%)</div>
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

  renderTickers();
  renderLegend();
  renderChart();
});
