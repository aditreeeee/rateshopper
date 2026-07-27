let rpType = 'daily';
let rpTrendChart = null;

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Reports', subtitle:'Revenue and rate performance reports, ready to export.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);

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

  function demandClass(d){ return d>=70 ? 'hot' : d>=40 ? 'warm' : 'cool'; }

  function render(){
    const {days, label} = rangeForType();
    document.getElementById('rp_reportTitle').textContent = label;

    const data = Array.from({length:Math.min(days,31)}).map((_,d)=>{
      const dk = PORTALDATA.dateKeyOffset(d);
      const rate = PORTALDATA.myRateOnDate(propertyId, dk);
      const occ = PORTALDATA.expectedOccupancy(propertyId, dk);
      const revpar = Math.round(rate*occ/100);
      const demand = PORTALDATA.demandIndex(propertyId, dk);
      return { dk, rate, occ, revpar, demand };
    });

    document.getElementById('rp_reportRange').textContent = data.length>1
      ? `${APP.fmtDateReadable(data[0].dk)} — ${APP.fmtDateReadable(data[data.length-1].dk)} · ${data.length} days`
      : APP.fmtDateReadable(data[0].dk);

    // ---- KPIs ----
    const avgAdr = Math.round(data.reduce((s,r)=>s+r.rate,0)/data.length);
    const avgOcc = Math.round(data.reduce((s,r)=>s+r.occ,0)/data.length);
    const totalRevpar = data.reduce((s,r)=>s+r.revpar,0);
    const peakDay = data.reduce((max,r)=> r.demand>max.demand?r:max, data[0]);
    const firstHalf = data.slice(0, Math.ceil(data.length/2));
    const secondHalf = data.slice(Math.ceil(data.length/2));
    const avgFirst = firstHalf.reduce((s,r)=>s+r.rate,0)/firstHalf.length;
    const avgSecond = secondHalf.length ? secondHalf.reduce((s,r)=>s+r.rate,0)/secondHalf.length : avgFirst;
    const trendPct = avgFirst ? Math.round(((avgSecond-avgFirst)/avgFirst)*1000)/10 : 0;

    document.getElementById('rp_kpis').innerHTML = [
      PWIDGETS.kpiCard({icon:'bi-cash-coin', color:'#3861fb', bg:'#eef4ff', label:'Average ADR', value:APP.fmtCurrency(avgAdr), sub:`${trendPct>=0?'+':''}${trendPct}% over period`, subDir:trendPct>=0?'up':'down',
        desc:'Your average daily rate across the selected report period.'}),
      PWIDGETS.kpiCard({icon:'bi-person-check', color:'#8c5cf7', bg:'#f3eeff', label:'Average Occupancy', value:`${avgOcc}%`,
        desc:'Expected occupancy averaged across the selected report period.'}),
      PWIDGETS.kpiCard({icon:'bi-graph-up', color:'#00c2a8', bg:'#e6fbf8', label:'Total RevPAR', value:APP.fmtCurrency(totalRevpar),
        desc:'Revenue per available room, summed across every day in the report.'}),
      PWIDGETS.kpiCard({icon:'bi-fire', color:'#ff4d5e', bg:'#fff0f1', label:'Peak Demand Day', value:APP.fmtDateReadable(peakDay.dk), sub:`${peakDay.demand}/100 demand`,
        desc:'The single highest-demand day found in this report period.'}),
    ].join('');

    // ---- Trend chart ----
    document.getElementById('rp_trendCaption').textContent = `${label} · ${data.length} day(s)`;
    if(rpTrendChart) rpTrendChart.destroy();
    rpTrendChart = new Chart(document.getElementById('rp_trendChart'), {
      type:'line',
      data:{
        labels: data.map(r=>APP.fmtDateReadable(r.dk).slice(0,6)),
        datasets:[{ label:'ADR', data:data.map(r=>r.rate), borderColor:'#3861fb', backgroundColor:'rgba(56,97,251,.1)', tension:.35, fill:true, pointRadius:data.length>1?2:4 }]
      },
      options:{ responsive:true, plugins:{legend:{display:false}}, scales:{y:{ticks:{callback:v=>APP.fmtCurrency(v)}}} }
    });

    // ---- Highlights ----
    const highlights = [];
    highlights.push({ icon:'bi-graph-up-arrow', color:trendPct>=0?'#12b76a':'#ff4d5e', bg:trendPct>=0?'#e7faf1':'#fff0f1',
      text:`Your ADR ${trendPct>=0?'rose':'fell'} <b>${Math.abs(trendPct)}%</b> from the first half to the second half of this period.` });
    highlights.push({ icon:'bi-fire', color:'#ff4d5e', bg:'#fff0f1',
      text:`<b>${APP.fmtDateReadable(peakDay.dk)}</b> is your highest-demand day at <b>${peakDay.demand}/100</b>.` });
    const lowOcc = data.filter(r=>r.occ<40).length;
    if(lowOcc>0) highlights.push({ icon:'bi-exclamation-triangle', color:'#b9791a', bg:'#fff8e6',
      text:`<b>${lowOcc}</b> day(s) in this report have occupancy below 40% — consider a rate review.` });
    highlights.push({ icon:'bi-cash-stack', color:'#3861fb', bg:'#eef4ff',
      text:`Total RevPAR for this period is <b>${APP.fmtCurrency(totalRevpar)}</b>.` });

    document.getElementById('rp_highlights').innerHTML = highlights.map(h=>`
      <div class="rp-highlight-row">
        <div class="rp-highlight-icon" style="background:${h.bg};color:${h.color}"><i class="bi ${h.icon}"></i></div>
        <div class="rp-highlight-text">${h.text}</div>
      </div>`).join('');

    // ---- Demand heatmap ----
    document.getElementById('rp_heatmap').innerHTML = data.map(r=>
      `<div class="heatmap-cell" style="background:${PWIDGETS.heatCellColor(r.demand)}" title="${APP.fmtDateReadable(r.dk)}: demand ${r.demand}">${new Date(r.dk+'T00:00:00').getDate()}</div>`
    ).join('');

    // ---- Table ----
    const rows = data.map(r=>`<tr>
      <td class="fw-semibold">${APP.fmtDateReadable(r.dk)}</td>
      <td>${APP.fmtCurrency(r.rate)}</td>
      <td><div class="rp-occ-cell"><div class="rp-occ-track"><div class="rp-occ-fill" style="width:${r.occ}%"></div></div><span style="font-size:.78rem">${r.occ}%</span></div></td>
      <td>${APP.fmtCurrency(r.revpar)}</td>
      <td><span class="rp-demand-badge ${demandClass(r.demand)}">${r.demand}/100</span></td>
    </tr>`).join('');

    document.getElementById('rp_table').innerHTML = `
      <thead><tr><th>Date</th><th>ADR</th><th>Occupancy</th><th>RevPAR</th><th>Demand</th></tr></thead>
      <tbody>${rows}</tbody>`;
  }

  render();
});
