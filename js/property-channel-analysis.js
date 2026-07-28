let caChart = null;

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Channel Analysis', subtitle:'Rate comparison across Direct and every OTA you sell on.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  const todayKey = keyOfDate(new Date());

  const channels = DB.channels.byProperty(propertyId);
  const master = channels.find(c=>c.type==='master');

  function keyOfDate(d){ return d.toISOString().slice(0,10); }

  // Average base-occupancy rate across every room/rate plan on a channel, for one date —
  // the channel-level "rate" this whole page reasons about.
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

  // ---- Metrics for each channel: Current / Lowest / Highest / Average / Rate Difference ----
  const WINDOW_DAYS = 30;
  const directCurrent = master ? channelAvgRateOnDate(master.id, todayKey) : null;

  const channelMetrics = channels.map(ch=>{
    const series = [];
    for(let d=0; d<WINDOW_DAYS; d++){
      const dk = keyOfDate(new Date(Date.now()+d*86400000));
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

  // ---- Channels Display: Room / Rate Plan parity table, property-wide, for today ----
  // Room + Channel filters: Room narrows which rows show; Channel narrows the OTA comparison
  // down to one specific channel instead of averaging across all of them (so "OTA Rate" becomes
  // "that channel's rate" and Difference/Cheapest/Priciest are computed against just that channel).
  const otaChannelsAll = channels.filter(c=>c.id !== (master && master.id));
  const myRoomsAll = master ? DB.rooms.byChannel(master.id) : [];

  document.getElementById('ca_room').innerHTML += myRoomsAll.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  document.getElementById('ca_channel').innerHTML += otaChannelsAll.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');

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
});
