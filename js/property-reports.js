let rpType = 'daily';
let rpTrendChart = null;

// Shared Chart.js animation preset — see js/property-dashboard.js for the same helper.
function chartAnim(isBar){
  return {
    duration: 850, easing: 'easeOutQuart',
    delay: (ctx)=> isBar
      ? (ctx.type==='data' ? ctx.dataIndex*30 + (ctx.datasetIndex||0)*80 : 0)
      : (ctx.datasetIndex||0) * 150
  };
}

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Reports', subtitle:'Rate performance reports, ready to export.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  // Only the real properties your Company Admin assigned to you — same set as every other
  // Rate Intelligence page (Dashboard, Rate Shopper, Market Intelligence).
  const comps = PORTALDATA.comparisonRealProperties();

  document.querySelectorAll('#rp_typeGroup .rp-type-chip').forEach(btn=>{
    btn.addEventListener('click', function(){
      rpType = this.dataset.type;
      document.querySelectorAll('#rp_typeGroup .rp-type-chip').forEach(b=>b.classList.remove('active'));
      this.classList.add('active');
      document.getElementById('rp_customWrap').classList.toggle('d-none', rpType!=='custom');
      render();
    });
  });
  document.getElementById('rp_from').addEventListener('input', render);
  document.getElementById('rp_to').addEventListener('input', render);

  ['rp_pdf','rp_excel','rp_csv'].forEach(id=>{
    document.getElementById(id).addEventListener('click', ()=> APP.toast('Export Started', `Your ${rpType} report is being prepared for download.`, 'success'));
  });
  document.getElementById('rp_print').addEventListener('click', ()=> window.print());

  function rangeForType(){
    if(rpType==='daily') return {days:1, label:'Daily Report'};
    if(rpType==='weekly') return {days:7, label:'Weekly Report'};
    if(rpType==='monthly') return {days:30, label:'Monthly Report'};
    if(rpType==='quarterly') return {days:90, label:'Quarterly Report'};
    const from = document.getElementById('rp_from').value, to = document.getElementById('rp_to').value;
    const days = (from && to) ? Math.max(1, Math.round((new Date(to)-new Date(from))/86400000)+1) : 7;
    return {days, label:'Custom Report', from};
  }

  function marketAvgOn(dk){
    if(!comps.length) return null;
    return Math.round(comps.reduce((s,c)=>s+PORTALDATA.competitorRateOnDate(c,dk),0)/comps.length);
  }

  function volatilityClass(pct){ return pct>=8 ? 'hot' : pct>=3 ? 'warm' : 'cool'; }

  function render(){
    const {days, label} = rangeForType();
    document.getElementById('rp_reportTitle').textContent = label;

    const data = Array.from({length:Math.min(days,31)}).map((_,d)=>{
      const dk = PORTALDATA.dateKeyOffset(d);
      const rate = PORTALDATA.myRateOnDate(propertyId, dk);
      const market = marketAvgOn(dk);
      const prevRate = PORTALDATA.myRateOnDate(propertyId, PORTALDATA.dateKeyOffset(d-1));
      const changePct = prevRate ? Math.abs((rate-prevRate)/prevRate*100) : 0;
      return { dk, rate, market, diff: market!=null ? rate-market : null, changePct };
    });

    document.getElementById('rp_reportRange').textContent = data.length>1
      ? `${APP.fmtDateReadable(data[0].dk)} — ${APP.fmtDateReadable(data[data.length-1].dk)} · ${data.length} days`
      : APP.fmtDateReadable(data[0].dk);

    // ---- KPIs (rate-only — no occupancy/RevPAR/demand) ----
    const avgAdr = Math.round(data.reduce((s,r)=>s+r.rate,0)/data.length);
    const rates = data.map(r=>r.rate);
    const highestDay = data.reduce((max,r)=> r.rate>max.rate?r:max, data[0]);
    const lowestDay = data.reduce((min,r)=> r.rate<min.rate?r:min, data[0]);
    const validDiffs = data.filter(r=>r.diff!=null);
    const avgDiffPct = validDiffs.length ? (validDiffs.reduce((s,r)=>s+(r.diff/r.market*100),0)/validDiffs.length) : null;
    const firstHalf = data.slice(0, Math.ceil(data.length/2));
    const secondHalf = data.slice(Math.ceil(data.length/2));
    const avgFirst = firstHalf.reduce((s,r)=>s+r.rate,0)/firstHalf.length;
    const avgSecond = secondHalf.length ? secondHalf.reduce((s,r)=>s+r.rate,0)/secondHalf.length : avgFirst;
    const trendPct = avgFirst ? Math.round(((avgSecond-avgFirst)/avgFirst)*1000)/10 : 0;

    document.getElementById('rp_kpis').innerHTML = [
      PWIDGETS.kpiCard({icon:'bi-cash-coin', color:'#3861fb', bg:'#eef4ff', label:'Average ADR', value:APP.fmtCurrency(avgAdr), sub:`${trendPct>=0?'+':''}${trendPct}% over period`, subDir:trendPct>=0?'up':'down',
        desc:'Your average daily rate across the selected report period.'}),
      PWIDGETS.kpiCard({icon:'bi-arrow-up-circle', color:'#12b76a', bg:'#e7faf1', label:'Highest Rate Day', value:APP.fmtDateReadable(highestDay.dk), sub:APP.fmtCurrency(highestDay.rate),
        desc:'The day with your highest rate in this report period.'}),
      PWIDGETS.kpiCard({icon:'bi-arrow-down-circle', color:'#ff4d5e', bg:'#fff0f1', label:'Lowest Rate Day', value:APP.fmtDateReadable(lowestDay.dk), sub:APP.fmtCurrency(lowestDay.rate),
        desc:'The day with your lowest rate in this report period.'}),
      PWIDGETS.kpiCard({icon:'bi-bar-chart', color:'#8c5cf7', bg:'#f3eeff', label:'Vs. Market Average', value: avgDiffPct!=null ? `${avgDiffPct>=0?'+':''}${avgDiffPct.toFixed(1)}%` : '—',
        desc:'How your rate compares to the average of your assigned comparison properties over this period.'}),
    ].join('');

    // ---- ADR trend chart (mine vs. market average) ----
    document.getElementById('rp_trendCaption').textContent = `${label} · ${data.length} day(s)`;
    if(rpTrendChart) rpTrendChart.destroy();
    const datasets = [{ label:'My ADR', data:data.map(r=>r.rate), borderColor:'#3861fb', backgroundColor:'rgba(56,97,251,.1)', tension:.35, fill:true, pointRadius:data.length>1?2:4 }];
    if(comps.length) datasets.push({ label:'Market Average', data:data.map(r=>r.market), borderColor:'#8c5cf7', backgroundColor:'transparent', borderDash:[5,4], tension:.35, pointRadius:0 });
    rpTrendChart = new Chart(document.getElementById('rp_trendChart'), {
      type:'line',
      data:{ labels: data.map(r=>APP.fmtDateReadable(r.dk).slice(0,6)), datasets },
      options:{ responsive:true, animation:chartAnim(false), plugins:{legend:{display:comps.length>0, position:'bottom'}}, scales:{y:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
    });

    // ---- Highlights (rate-only) ----
    const highlights = [];
    highlights.push({ icon:'bi-graph-up-arrow', color:trendPct>=0?'#12b76a':'#ff4d5e', bg:trendPct>=0?'#e7faf1':'#fff0f1',
      text:`Your ADR ${trendPct>=0?'rose':'fell'} <b>${Math.abs(trendPct)}%</b> from the first half to the second half of this period.` });
    highlights.push({ icon:'bi-arrow-up-circle', color:'#12b76a', bg:'#e7faf1',
      text:`<b>${APP.fmtDateReadable(highestDay.dk)}</b> was your highest rate day at <b>${APP.fmtCurrency(highestDay.rate)}</b>.` });
    if(avgDiffPct!=null){
      highlights.push({ icon:'bi-bar-chart', color:avgDiffPct>=0?'#ff4d5e':'#12b76a', bg:avgDiffPct>=0?'#fff0f1':'#e7faf1',
        text:`You were priced <b>${Math.abs(avgDiffPct).toFixed(1)}% ${avgDiffPct>=0?'above':'below'}</b> the market average across this period.` });
    }
    const volatileDays = data.filter(r=>r.changePct>=8).length;
    if(volatileDays>0) highlights.push({ icon:'bi-activity', color:'#b9791a', bg:'#fff8e6',
      text:`<b>${volatileDays}</b> day(s) in this report had a rate change of 8%+ from the day before.` });

    document.getElementById('rp_highlights').innerHTML = highlights.map(h=>`
      <div class="rp-highlight-row">
        <div class="rp-highlight-icon" style="background:${h.bg};color:${h.color}"><i class="bi ${h.icon}"></i></div>
        <div class="rp-highlight-text">${h.text}</div>
      </div>`).join('');

    // ---- Rate volatility heatmap (day-over-day % change, not demand) ----
    document.getElementById('rp_heatmap').innerHTML = data.map(r=>
      `<div class="heatmap-cell" style="background:${PWIDGETS.heatCellColor(Math.min(100, r.changePct*8))}" title="${APP.fmtDateReadable(r.dk)}: ${r.changePct.toFixed(1)}% change vs. prior day">${new Date(r.dk+'T00:00:00').getDate()}</div>`
    ).join('');

    // ---- Table (rate-only columns) ----
    const rows = data.map(r=>`<tr>
      <td class="fw-semibold">${APP.fmtDateReadable(r.dk)}</td>
      <td>${APP.fmtCurrency(r.rate)}</td>
      <td>${r.market!=null ? APP.fmtCurrency(r.market) : '—'}</td>
      <td class="${r.diff!=null && r.diff>=0 ? 'text-danger' : r.diff!=null ? 'text-success' : ''}">${r.diff!=null ? `${r.diff>=0?'+':''}${APP.fmtCurrency(r.diff)}` : '—'}</td>
      <td><span class="rp-demand-badge ${volatilityClass(r.changePct)}">${r.changePct.toFixed(1)}%</span></td>
    </tr>`).join('');

    document.getElementById('rp_table').innerHTML = `
      <thead><tr><th>Date</th><th>My ADR</th><th>Market Average</th><th>Difference</th><th>Day-over-Day Change</th></tr></thead>
      <tbody>${rows}</tbody>`;
  }

  render();
});
