let rpType = 'daily';

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Reports', subtitle:'Revenue and rate performance reports, ready to export.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);

  document.querySelectorAll('#rp_typeGroup button').forEach(btn=>{
    btn.addEventListener('click', function(){
      rpType = this.dataset.type;
      document.querySelectorAll('#rp_typeGroup button').forEach(b=>{ b.classList.remove('btn-outline-primary'); b.classList.add('btn-soft'); });
      this.classList.remove('btn-soft'); this.classList.add('btn-outline-primary');
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

  function render(){
    const {days, label} = rangeForType();
    document.getElementById('rp_reportTitle').textContent = label;

    const rows = Array.from({length:Math.min(days,31)}).map((_,d)=>{
      const dk = PORTALDATA.dateKeyOffset(d);
      const rate = PORTALDATA.myRateOnDate(propertyId, dk);
      const occ = PORTALDATA.expectedOccupancy(propertyId, dk);
      const revpar = Math.round(rate*occ/100);
      const demand = PORTALDATA.demandIndex(propertyId, dk);
      return `<tr><td>${APP.fmtDateReadable(dk)}</td><td>${APP.fmtCurrency(rate)}</td><td>${occ}%</td><td>${APP.fmtCurrency(revpar)}</td><td>${demand}/100</td></tr>`;
    }).join('');

    document.getElementById('rp_table').innerHTML = `
      <thead><tr><th>Date</th><th>ADR</th><th>Occupancy</th><th>RevPAR</th><th>Demand</th></tr></thead>
      <tbody>${rows}</tbody>`;
  }

  render();
});
