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

// Bright/saturated palette for benchmark properties — each gets its own vivid, distinguishable
// color so lines pop against the chart's light background instead of blurring into muted pastel
// gray-ish tones. My Property's solid brand blue is still the boldest line (thicker + filled),
// so it stays the visual anchor even against these more saturated competitor lines.
const OTHER_LINE_COLORS = ['#00c2a8','#a855f7','#ff8a00','#ff2d78','#00b2ef','#22c55e','#ff4d4d','#6366f1'];

// A ticker/stock-index style callout — a solid pill at the end of the "My Property" line
// showing its latest value, same idea as a live market index chart's current-price tag. Drawn
// as a Chart.js plugin (not a fixed DOM element) so it always lands exactly on the last point's
// real pixel position, however the chart is currently zoomed/ranged/resized.
const rsEndValuePlugin = {
  id: 'rsEndValueLabel',
  afterDatasetsDraw(chart){
    const dsIndex = chart.data.datasets.findIndex(d=>d.isMe);
    if(dsIndex===-1 || chart.getDatasetMeta(dsIndex).hidden) return;
    const points = chart.getDatasetMeta(dsIndex).data;
    if(!points || !points.length) return;
    const last = points[points.length-1];
    const rawValue = chart.data.datasets[dsIndex].data[chart.data.datasets[dsIndex].data.length-1];
    if(last==null || rawValue==null) return;

    const { ctx } = chart;
    const text = APP.fmtCurrency(rawValue);
    const font = `700 11px ${getComputedStyle(document.body).fontFamily}`;
    ctx.save();
    ctx.font = font;
    const padX = 7, h = 19, textW = ctx.measureText(text).width;
    const w = textW + padX*2;
    // Anchored so it hangs mostly to the left of the last point (only a small overhang past the
    // plot's right edge), matching how a live ticker's price tag sits right at the line's tip.
    const x = Math.min(last.x - w + 6, chart.chartArea.right - w + 10);
    const y = Math.max(chart.chartArea.top + h/2, Math.min(last.y, chart.chartArea.bottom - h/2));

    const r = 5;
    ctx.beginPath();
    ctx.moveTo(x+r, y-h/2);
    ctx.arcTo(x+w, y-h/2, x+w, y+h/2, r);
    ctx.arcTo(x+w, y+h/2, x, y+h/2, r);
    ctx.arcTo(x, y+h/2, x, y-h/2, r);
    ctx.arcTo(x, y-h/2, x+w, y-h/2, r);
    ctx.closePath();
    ctx.fillStyle = '#0041d9';
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x+padX, y+0.5);
    ctx.restore();
  }
};

// Full "MMM D, YYYY"-style date per chart point, keyed by index — the x-axis labels themselves
// are trimmed to "MM-DD" for space, so the custom tooltip needs its own lookup to show a real,
// unambiguous date in its header.
let rsFullDates = [];

// Crosshair + highlighted point markers, stock/trading-chart style: a dashed vertical guide at
// the hovered index plus a small ring around "My Property"'s point there, drawn straight on the
// canvas so it always lines up exactly with Chart.js's own hit-testing (chart.getActiveElements())
// regardless of zoom/range/resize.
const rsCrosshairPlugin = {
  id: 'rsCrosshair',
  afterDraw(chart){
    const active = chart.getActiveElements();
    if(!active || !active.length) return;
    const { ctx, chartArea } = chart;
    const x = active[0].element.x;
    const dataIndex = active[0].index;

    ctx.save();
    ctx.beginPath();
    ctx.setLineDash([4,4]);
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(120,130,160,.4)';
    ctx.stroke();
    ctx.restore();

    chart.data.datasets.forEach((ds, i)=>{
      const meta = chart.getDatasetMeta(i);
      if(meta.hidden) return;
      const pt = meta.data[dataIndex];
      if(!pt) return;
      ctx.save();
      if(ds.isMe){
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, 9, 0, Math.PI*2);
        ctx.strokeStyle = 'rgba(56,97,251,.22)';
        ctx.lineWidth = 4;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, ds.isMe?5:3.5, 0, Math.PI*2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.lineWidth = ds.isMe?2.5:2;
      ctx.strokeStyle = ds.borderColor;
      ctx.stroke();
      ctx.restore();
    });
  }
};

// Custom glass tooltip (Chart.js's built-in `enabled:false` + `external` hook) instead of the
// default boxy tooltip — positioned at the hovered point's exact pixel, sorted highest-to-lowest
// rate so the ranking is legible at a glance, with "My Property" bolded to stay the visual anchor.
function rsExternalTooltip(context){
  const el = document.getElementById('rs_tooltip');
  if(!el) return;
  const { tooltip } = context;
  if(!tooltip || tooltip.opacity === 0){ el.classList.remove('is-visible'); return; }

  const points = (tooltip.dataPoints||[]).slice().sort((a,b)=>b.parsed.y - a.parsed.y);
  if(!points.length){ el.classList.remove('is-visible'); return; }

  const dateLabel = rsFullDates[points[0].dataIndex] || tooltip.title[0] || '';
  el.innerHTML = `<div class="rs-tt-date">${dateLabel}</div>` + points.map(dp=>{
    const ds = dp.dataset;
    return `<div class="rs-tt-row ${ds.isMe?'is-me':''}">
      <span class="rs-tt-label"><span class="rs-tt-dot" style="background:${ds.borderColor}"></span>${ds.label}</span>
      <span class="rs-tt-value">${APP.fmtCurrency(dp.parsed.y)}</span>
    </div>`;
  }).join('');

  const wrap = context.chart.canvas.parentElement;
  const wrapWidth = wrap.clientWidth;
  const point = points[0].element;
  el.classList.add('is-visible');
  const ttWidth = el.offsetWidth || 160;
  let left = point.x + 16;
  if(left + ttWidth > wrapWidth) left = point.x - ttWidth - 16;
  const top = Math.max(4, point.y - 18);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Rate Shopper', subtitle:'Compare your rate against the properties selected by your Company Admin, channel by channel.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);

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
      document.querySelectorAll('#rs_rangeGroup button').forEach(b=>{
        b.classList.remove('btn-outline-primary'); b.classList.add('btn-soft'); b.setAttribute('aria-pressed', 'false');
      });
      this.classList.remove('btn-soft'); this.classList.add('btn-outline-primary'); this.setAttribute('aria-pressed', 'true');
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
    if(s.isMe) return '#0041d9';
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

  // High / Low / Avg quick-read chips for "My Property" over the currently selected range —
  // gives the chart an at-a-glance summary the way a stock ticker's day-range does, without
  // having to eyeball the line against the axis.
  function renderStatStrip(myData){
    const valid = myData.filter(v=>v!=null);
    const strip = document.getElementById('rs_statStrip');
    if(!strip || !valid.length){ if(strip) strip.innerHTML = ''; return; }
    const high = Math.max(...valid), low = Math.min(...valid);
    const avg = Math.round(valid.reduce((s,v)=>s+v,0)/valid.length);
    const first = valid[0], last = valid[valid.length-1];
    const chg = last - first;
    const chgPct = first ? (chg/first*100) : 0;
    strip.innerHTML = `
      <span class="rs-stat-chip is-high"><span class="k">High</span><span class="v">${APP.fmtCurrency(high)}</span></span>
      <span class="rs-stat-chip is-low"><span class="k">Low</span><span class="v">${APP.fmtCurrency(low)}</span></span>
      <span class="rs-stat-chip"><span class="k">Avg</span><span class="v">${APP.fmtCurrency(avg)}</span></span>
      <span class="rs-stat-chip"><span class="k">Change</span><span class="v ${chg>=0?'pos':'neg'}">${chg>=0?'+':''}${APP.fmtCurrency(chg)} (${chgPct>=0?'+':''}${chgPct.toFixed(1)}%)</span></span>
    `;
  }

  function renderChart(){
    // My Property is the "index" line — bold, solid brand blue, drawn last (on top). Every
    // benchmark property still gets its own line and its own muted color (never hidden by
    // default) but rendered thin and pastel so My Property remains the one thing that pops.
    const list = seriesList().filter(s=>!rsHidden.has(s.key));
    list.sort((a,b)=> (a.isMe?1:0) - (b.isMe?1:0)); // isMe last => drawn on top
    const labels = [];
    rsFullDates = [];
    for(let d=-rsRangeDays; d<=0; d++){
      const dk = PORTALDATA.dateKeyOffset(d);
      labels.push(dk.slice(5));
      rsFullDates.push(APP.fmtDateReadable(dk));
    }

    const datasets = list.map((s)=>{
      const color = seriesColor(s);
      const data = [];
      for(let d=-rsRangeDays; d<=0; d++){ data.push(rateFor(s, PORTALDATA.dateKeyOffset(d))); }
      return {
        label: s.label, isMe: !!s.isMe, data, borderColor: color,
        // Soft gradient fade under My Property's line (top color -> transparent), stock-index
        // style, instead of a flat semi-transparent fill — needs a scriptable function since the
        // gradient has to be built from the chart's own rendered area, which isn't known until
        // Chart.js actually lays the canvas out.
        backgroundColor: s.isMe ? (context)=>{
          const { ctx, chartArea } = context.chart;
          if(!chartArea) return 'rgba(56,97,251,.14)';
          const gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
          gradient.addColorStop(0, 'rgba(56,97,251,.16)');
          gradient.addColorStop(1, 'rgba(56,97,251,0)');
          return gradient;
        } : 'transparent',
        borderWidth: s.isMe ? 2.25 : 1.25, fill: s.isMe,
        pointRadius: 0, pointHoverRadius: s.isMe ? 5 : 3, pointHoverBorderWidth:2, pointHoverBackgroundColor:color, pointHoverBorderColor:'#fff',
        tension: .35
      };
    });

    const myDs = datasets.find(d=>d.isMe);
    renderStatStrip(myDs ? myDs.data : []);

    // Update in place — the range toggle (7D/30D/90D) and the legend's show/hide-a-competitor
    // toggles both land here; reassigning data/datasets and calling update() lets Chart.js tween
    // between old and new values instead of the chart blinking away and redrawing from scratch.
    if(rsChart){
      rsChart.data.labels = labels;
      rsChart.data.datasets = datasets;
      rsChart.update();
      return;
    }
    rsChart = new Chart(document.getElementById('rs_chart'), {
      type:'line',
      data:{ labels, datasets },
      plugins:[rsEndValuePlugin, rsCrosshairPlugin],
      options:{
        responsive:true, interaction:{mode:'index', intersect:false}, animation:chartAnim(false),
        // A little extra room on the right/top so the end-value pill (drawn past the last point,
        // and possibly near the plot's top edge) never gets clipped by the canvas bounds.
        layout:{ padding:{ top:22, right:14 } },
        plugins:{ legend:{display:false}, tooltip:{enabled:false, external:rsExternalTooltip} },
        scales:{
          // Right-aligned axis + minimal, borderless grid — the "live market index" look from the
          // reference chart, instead of a boxed-in, left-axis financial-report style.
          y:{
            position:'right', border:{display:false},
            grid:{ color:'rgba(120,130,160,.08)' },
            ticks:{ callback:v=>APP.fmtCurrency(v), maxTicksLimit:6 }
          },
          x:{
            border:{display:false}, grid:{display:false},
            // Canvas fillStyle can't resolve a raw `var(--text-3)` string — read the theme's
            // actual computed color once, at chart-build time, same trick used for the font family.
            ticks:{ color:getComputedStyle(document.body).getPropertyValue('--text-3').trim() || '#8a90a6', maxRotation:0, autoSkip:true, maxTicksLimit:8 }
          }
        }
      }
    });
  }

  renderTickers();
  renderLegend();
  renderChart();
});
