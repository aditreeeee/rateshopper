function seededPct(seed){ let h=0; for(let i=0;i<seed.length;i++){h=(h*31+seed.charCodeAt(i))|0;} return (Math.abs(h)%1000)/1000; }

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Channel Analysis', subtitle:'Compare performance across Direct and every OTA you sell on.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  const today = PORTALDATA.dateKeyOffset(0);
  const myRate = PORTALDATA.myRateOnDate(propertyId, today);

  const channelStats = PORTALDATA.CHANNELS.map(ch=>{
    const adr = PORTALDATA.channelRate(myRate, ch.key, today);
    const bookings = 8 + Math.round(seededPct(ch.key+'bk')*60);
    const revenue = adr*bookings;
    const cancelPct = Math.round(seededPct(ch.key+'cx')*22);
    const avgStay = (1.4 + seededPct(ch.key+'stay')*2.6).toFixed(1);
    const conversion = (1 + seededPct(ch.key+'cv')*6).toFixed(1);
    const marketShare = 4 + Math.round(seededPct(ch.key+'ms')*30);
    const priceDiff = ((adr-myRate)/myRate*100).toFixed(1);
    return {ch, adr, bookings, revenue, cancelPct, avgStay, conversion, marketShare, priceDiff};
  });
  const totalRevenue = channelStats.reduce((s,c)=>s+c.revenue,0);
  channelStats.forEach(c=> c.share = Math.round(c.revenue/totalRevenue*100));

  document.getElementById('channelCards').innerHTML = channelStats.map(c=>`
    <div class="col-md-6 col-xl-3">
      <div class="channel-perf-card">
        <div class="d-flex justify-content-between align-items-center mb-2">
          ${PWIDGETS.channelChip(c.ch.key)}
          <span class="fw-bold" style="font-size:.9rem">${c.share}%</span>
        </div>
        <div class="kv-row"><span class="k">ADR</span><span class="v">${APP.fmtCurrency(c.adr)}</span></div>
        <div class="kv-row"><span class="k">Bookings</span><span class="v">${c.bookings}</span></div>
        <div class="kv-row"><span class="k">Revenue</span><span class="v">${APP.fmtCurrency(c.revenue)}</span></div>
        <div class="kv-row"><span class="k">Cancellation %</span><span class="v">${c.cancelPct}%</span></div>
        <div class="kv-row"><span class="k">Avg. Stay</span><span class="v">${c.avgStay}n</span></div>
        <div class="kv-row"><span class="k">Conversion</span><span class="v">${c.conversion}%</span></div>
      </div>
    </div>`).join('');

  new Chart(document.getElementById('channelRevenueChart'), {
    type:'doughnut',
    data:{ labels:channelStats.map(c=>c.ch.label), datasets:[{data:channelStats.map(c=>c.revenue), backgroundColor:channelStats.map(c=>c.ch.color)}] },
    options:{ responsive:true, plugins:{legend:{position:'right'}} }
  });

  document.getElementById('channelTable').innerHTML = `
    <thead><tr><th>Channel</th><th>Market Share</th><th>Price Diff</th><th>Conversion</th></tr></thead>
    <tbody>${channelStats.sort((a,b)=>b.revenue-a.revenue).map(c=>`<tr>
      <td>${PWIDGETS.channelChip(c.ch.key)}</td>
      <td>${c.marketShare}%</td>
      <td class="${c.priceDiff>=0?'text-danger':'text-success'}">${c.priceDiff>=0?'+':''}${c.priceDiff}%</td>
      <td>${c.conversion}%</td>
    </tr>`).join('')}</tbody>`;
});
