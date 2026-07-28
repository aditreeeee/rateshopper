let profileChart = null;
let profileTrendChart = null;

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Competitors', subtitle:'The properties selected by your Company Admin to compare against.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);

  ['cp_search','cp_sort','cp_filter'].forEach(id=> document.getElementById(id).addEventListener('input', render));

  // ---- Grid / List view toggle — persisted per-browser so it sticks across visits ----
  let cpView = localStorage.getItem('hop_cp_view') === 'list' ? 'list' : 'grid';
  function setView(view){
    cpView = view;
    localStorage.setItem('hop_cp_view', view);
    document.getElementById('cp_viewGrid').classList.toggle('btn-primary', view==='grid');
    document.getElementById('cp_viewGrid').classList.toggle('btn-soft', view!=='grid');
    document.getElementById('cp_viewList').classList.toggle('btn-primary', view==='list');
    document.getElementById('cp_viewList').classList.toggle('btn-soft', view!=='list');
    document.getElementById('competitorGrid').classList.toggle('d-none', view!=='grid');
    document.getElementById('competitorListWrap').classList.toggle('d-none', view!=='list');
  }
  document.getElementById('cp_viewGrid').addEventListener('click', ()=>{ setView('grid'); });
  document.getElementById('cp_viewList').addEventListener('click', ()=>{ setView('list'); });
  setView(cpView);

  function render(){
    const search = document.getElementById('cp_search').value.trim().toLowerCase();
    const sort = document.getElementById('cp_sort').value;
    const filter = document.getElementById('cp_filter').value;
    const today = PORTALDATA.dateKeyOffset(0);

    let comps = PORTALDATA.comparisonRealProperties().map(c=>({...c, rate:PORTALDATA.competitorRateOnDate(c,today), trend:PORTALDATA.competitorTrend(c,today)}));
    if(search) comps = comps.filter(c=>c.name.toLowerCase().includes(search));
    if(filter==='favorite') comps = comps.filter(c=>c.favorite);
    if(filter==='pinned') comps = comps.filter(c=>c.pinned);

    const myRate = PORTALDATA.myRateOnDate(propertyId, today);
    comps.sort((a,b)=>{
      if(sort==='rate_asc') return a.rate-b.rate;
      if(sort==='rate_desc') return b.rate-a.rate;
      if(sort==='distance') return a.distanceKm-b.distanceKm;
      if(sort==='stars') return b.stars-a.stars;
      return 0;
    });

    // Rooms/rate plans are auto-matched the moment this property and competitor are first seen
    // together (and self-healed on every load) — a human only needs the Review Mapping action
    // when something couldn't be confidently resolved automatically. Computed once and shared
    // by both the grid and list views below.
    const enriched = comps.map(c=>{
      const diffPct = ((c.rate-myRate)/myRate)*100;
      let mappingBadge = '', mappingCount = 0;
      if(c.isReal){
        MAPPING.ensureAutoMapped(propertyId, c.realPropertyId);
        const ev = MAPPING.evaluate(propertyId, c.realPropertyId);
        const nRooms = ev.flaggedRooms.length, nPlans = ev.flaggedPlans.length;
        mappingCount = nRooms + nPlans;
        if(mappingCount>0){
          const parts = [];
          if(nRooms) parts.push(`${nRooms} room${nRooms>1?'s':''}`);
          if(nPlans) parts.push(`${nPlans} rate plan${nPlans>1?'s':''}`);
          mappingBadge = `<button type="button" class="rm-review-badge" onclick="reviewMapping('${c.id}')" title="Open Mapping Review">
            <i class="bi bi-exclamation-triangle-fill"></i>${parts.join(' & ')} ${mappingCount===1?'needs':'need'} mapping review</button>`;
        }
      }
      return { c, diffPct, mappingBadge, mappingCount };
    });

    document.getElementById('competitorGrid').innerHTML = enriched.length ? enriched.map(({c, diffPct, mappingBadge})=>{
      return `<div class="col-md-6 col-xl-4 col-xxl-3">
        <div class="competitor-card">
          <div class="comp-img" style="background-image:url('${c.image}')">
            <div class="comp-pin" onclick="toggleFavorite('${c.id}')" title="Favorite"><i class="bi ${c.favorite?'bi-star-fill text-warning':'bi-star'}"></i></div>
          </div>
          <div class="comp-body">
            <div class="d-flex justify-content-between align-items-start">
              <div class="fw-bold" style="font-size:.9rem">${c.name}</div>
              ${c.pinned?'<i class="bi bi-pin-angle-fill text-primary"></i>':''}
            </div>
            <div class="text-muted small"><i class="bi bi-geo-alt me-1"></i>${c.isReal ? `${c.city}, ${c.country}` : `${c.distanceKm} km • ${c.stars}★`}</div>
            <div class="d-flex justify-content-between align-items-end mt-1">
              <div>
                <div class="text-muted" style="font-size:.68rem">Current Rate</div>
                <div class="fw-bold">${APP.fmtCurrency(c.rate)}</div>
              </div>
              <div class="${diffPct>=0?'text-danger':'text-success'} small fw-semibold">${diffPct>=0?'+':''}${diffPct.toFixed(1)}% ${PWIDGETS.trendIcon(c.trend)}</div>
            </div>
            ${mappingBadge ? `<div class="mt-2">${mappingBadge}</div>` : ''}
            <div class="d-flex gap-1 mt-2">
              <button class="btn btn-soft btn-sm flex-fill" onclick="openProfile('${c.id}')"><i class="bi bi-eye me-1"></i>Details</button>
              ${c.isReal ? `<button class="btn btn-sm-icon btn-soft" onclick="reviewMapping('${c.id}')" title="Review Mapping"><i class="bi bi-signpost-split"></i></button>` : ''}
              <button class="btn btn-sm-icon ${c.pinned?'btn-primary':'btn-soft'}" onclick="togglePinC('${c.id}')" title="Pin for comparison"><i class="bi bi-pin-angle${c.pinned?'-fill':''}"></i></button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('') : `<div class="col-12">${
      PORTALDATA.comparisonRealProperties().length
        ? PWIDGETS.emptyState('bi-building','No competitors found','Try adjusting your search or filters.')
        : PWIDGETS.emptyState('bi-building','No comparison properties assigned yet','Your Company Admin hasn\'t selected any comparison properties for you yet.')
    }</div>`;

    // ---- List view: same dataset, denser row-per-competitor layout for scanning many at once ----
    const listEmpty = document.getElementById('competitorListEmpty');
    if(!enriched.length){
      document.getElementById('competitorList').innerHTML = '';
      listEmpty.classList.remove('d-none');
      listEmpty.innerHTML = PORTALDATA.comparisonRealProperties().length
        ? PWIDGETS.emptyState('bi-building','No competitors found','Try adjusting your search or filters.')
        : PWIDGETS.emptyState('bi-building','No comparison properties assigned yet','Your Company Admin hasn\'t selected any comparison properties for you yet.');
    } else {
      listEmpty.classList.add('d-none');
      document.getElementById('competitorList').innerHTML = enriched.map(({c, diffPct, mappingBadge, mappingCount})=>`
        <tr>
          <td>
            <div class="d-flex align-items-center gap-2">
              <div class="comp-list-thumb" style="background-image:url('${c.image}')"></div>
              <div>
                <div class="fw-semibold" style="font-size:.85rem">${c.name}${c.pinned?' <i class="bi bi-pin-angle-fill text-primary" style="font-size:.7rem"></i>':''}</div>
                ${mappingBadge ? `<div class="mt-1">${mappingBadge}</div>` : ''}
              </div>
            </div>
          </td>
          <td class="text-muted" style="font-size:.82rem">${c.isReal ? `${c.city}, ${c.country}` : `${c.distanceKm} km away`}</td>
          <td class="text-center">${c.stars ? `${c.stars}★` : '—'}</td>
          <td class="text-end fw-semibold">${APP.fmtCurrency(c.rate)}</td>
          <td class="text-end ${diffPct>=0?'text-danger':'text-success'} fw-semibold" style="font-size:.85rem">${diffPct>=0?'+':''}${diffPct.toFixed(1)}%</td>
          <td class="text-center">${PWIDGETS.trendIcon(c.trend)}</td>
          <td>${c.favorite?'<i class="bi bi-star-fill text-warning" title="Favorite"></i>':''}</td>
          <td class="text-end">
            <div class="d-flex gap-1 justify-content-end">
              <button class="btn btn-sm-icon btn-soft" onclick="openProfile('${c.id}')" title="Details"><i class="bi bi-eye"></i></button>
              ${c.isReal ? `<button class="btn btn-sm-icon btn-soft" onclick="reviewMapping('${c.id}')" title="Review Mapping"><i class="bi bi-signpost-split"></i></button>` : ''}
              <button class="btn btn-sm-icon ${c.favorite?'btn-primary':'btn-soft'}" onclick="toggleFavorite('${c.id}')" title="Favorite"><i class="bi ${c.favorite?'bi-star-fill':'bi-star'}"></i></button>
              <button class="btn btn-sm-icon ${c.pinned?'btn-primary':'btn-soft'}" onclick="togglePinC('${c.id}')" title="Pin for comparison"><i class="bi bi-pin-angle${c.pinned?'-fill':''}"></i></button>
            </div>
          </td>
        </tr>`).join('');
    }
  }

  window.toggleFavorite = function(id){ const c=PORTALDATA.competitor(propertyId,id); c.favorite=!c.favorite; PORTALDATA.saveCompetitor(propertyId,c); render(); };
  window.togglePinC = function(id){ const c=PORTALDATA.competitor(propertyId,id); c.pinned=!c.pinned; PORTALDATA.saveCompetitor(propertyId,c); render(); };
  window.reviewMapping = function(id){
    const c = PORTALDATA.competitor(propertyId, id);
    if(!c || !c.isReal) return;
    MAPPING.review(propertyId, c.realPropertyId, c.name);
  };

  // Average base-occupancy rate across every room/rate plan on a channel, for one date.
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
  function dk(offset){ return new Date(Date.now()+offset*86400000).toISOString().slice(0,10); }

  window.openProfile = function(id){
    const c = PORTALDATA.competitor(propertyId, id);
    if(!c || !c.isReal) return;
    const hotel = DB.properties.get(c.realPropertyId);
    if(!hotel) return;

    const channels = DB.channels.byProperty(hotel.id);
    const master = channels.find(ch=>ch.type==='master');
    const rooms = master ? DB.rooms.byChannel(master.id) : [];

    // Historical (past 30 days) + trend (next 30 days), both off the Master (Direct) channel.
    const histLabels=[], histData=[], trendLabels=[], trendData=[];
    for(let d=-30; d<=0; d++){ histLabels.push(dk(d).slice(5)); histData.push(master?channelAvgRateOnDate(master.id,dk(d)):null); }
    for(let d=0; d<=30; d++){ trendLabels.push(dk(d).slice(5)); trendData.push(master?channelAvgRateOnDate(master.id,dk(d)):null); }
    const validHist = histData.filter(v=>v!=null);
    const lowest = validHist.length?Math.min(...validHist):null, highest = validHist.length?Math.max(...validHist):null;
    const avg = validHist.length?Math.round(validHist.reduce((a,b)=>a+b,0)/validHist.length):null;
    const trendPct = (validHist.length && trendData.filter(v=>v!=null).length)
      ? Math.round(((trendData.filter(v=>v!=null).slice(-1)[0] - validHist[0]) / validHist[0]) * 1000)/10 : null;

    document.getElementById('cprof_title').innerHTML = `<i class="bi bi-building me-2"></i>${hotel.name}`;
    document.getElementById('cprof_body').innerHTML = `
      <div class="row g-3">
        <div class="col-lg-5">
          <div class="fw-semibold small mb-1">Images</div>
          <img src="${hotel.logo}" class="w-100 mb-3" style="border-radius:14px;height:180px;object-fit:cover">

          <div class="fw-semibold small mb-1">Hotel Information</div>
          <div class="kv-row"><span class="k">Type</span><span class="v">${hotel.type||'—'}</span></div>
          <div class="kv-row"><span class="k">Star Rating</span><span class="v">${hotel.stars||c.stars||'—'}★</span></div>
          <div class="kv-row"><span class="k">Address</span><span class="v" style="max-width:60%;text-align:right">${hotel.address || `${hotel.city}, ${hotel.country}`}</span></div>
          <div class="kv-row"><span class="k">Phone</span><span class="v">${hotel.phone||'—'}</span></div>
          ${hotel.description ? `<div class="text-muted mt-2" style="font-size:.78rem">${hotel.description}</div>` : ''}

          <div class="fw-semibold small mt-3 mb-1">Channel Availability</div>
          ${channels.map(ch=>{
            const meta = DB.CHANNEL_TYPES[ch.type]||DB.CHANNEL_TYPES.custom;
            return `<span class="badge ${ch.status==='active'?'bg-light text-dark border':'bg-secondary-subtle text-muted'} me-1 mb-1"><i class="bi ${meta.icon} me-1" style="color:${meta.color}"></i>${ch.name}${ch.status!=='active'?' (inactive)':''}</span>`;
          }).join('') || '<span class="text-muted small">No channels found</span>'}
        </div>

        <div class="col-lg-7">
          <div class="fw-semibold small mb-1">Room Types & Rate Plans</div>
          <div class="mb-3" style="max-height:180px;overflow-y:auto">
            ${rooms.length ? rooms.map(room=>{
              const plans = DB.ratePlans.byRoom(room.id);
              return `<div class="d-flex justify-content-between align-items-start py-1 border-bottom" style="border-color:var(--border-2) !important">
                <div>
                  <div class="fw-semibold" style="font-size:.8rem">${room.name} <span class="text-muted fw-normal">(${room.bedType}, ${room.capacity} guests)</span></div>
                  <div class="text-muted" style="font-size:.7rem">${plans.map(p=>`${p.mealPlan} ${p.refundable?'Flexible':'Non-Refundable'}`).join(' • ') || 'No rate plans'}</div>
                </div>
                <div class="fw-semibold" style="font-size:.78rem">${APP.fmtCurrency(room.basePrice)}</div>
              </div>`;
            }).join('') : '<div class="text-muted small">No rooms found for this property.</div>'}
          </div>

          <div class="row g-2 mb-3">
            <div class="col-4"><div class="stat-card h-100"><div class="stat-label">Lowest</div><h3 style="font-size:1rem">${lowest!=null?APP.fmtCurrency(lowest):'—'}</h3></div></div>
            <div class="col-4"><div class="stat-card h-100"><div class="stat-label">Highest</div><h3 style="font-size:1rem">${highest!=null?APP.fmtCurrency(highest):'—'}</h3></div></div>
            <div class="col-4"><div class="stat-card h-100"><div class="stat-label">Average</div><h3 style="font-size:1rem">${avg!=null?APP.fmtCurrency(avg):'—'}</h3></div></div>
          </div>

          <div class="fw-semibold small mb-1">Historical Pricing (30 days)</div>
          <canvas id="cprof_histChart" height="70"></canvas>

          <div class="d-flex justify-content-between align-items-center mt-3 mb-1">
            <div class="fw-semibold small mb-0">Pricing Trends (next 30 days)</div>
            ${trendPct!=null ? `<span class="small fw-semibold ${trendPct>=0?'text-danger':'text-success'}"><i class="bi ${trendPct>=0?'bi-arrow-up-short':'bi-arrow-down-short'}"></i>${trendPct>=0?'+':''}${trendPct}%</span>` : ''}
          </div>
          <canvas id="cprof_trendChart" height="70"></canvas>
        </div>
      </div>`;

    new bootstrap.Modal(document.getElementById('competitorProfileModal')).show();
    setTimeout(()=>{
      if(profileChart) profileChart.destroy();
      if(profileTrendChart) profileTrendChart.destroy();
      profileChart = new Chart(document.getElementById('cprof_histChart'), {
        type:'line',
        data:{ labels:histLabels, datasets:[{label:hotel.name, data:histData, borderColor:'#3861fb', backgroundColor:'rgba(56,97,251,.08)', tension:.35, fill:true, spanGaps:true}] },
        options:{ responsive:true, plugins:{legend:{display:false}} }
      });
      profileTrendChart = new Chart(document.getElementById('cprof_trendChart'), {
        type:'line',
        data:{ labels:trendLabels, datasets:[{label:hotel.name, data:trendData, borderColor:'#00c2a8', backgroundColor:'rgba(0,194,168,.08)', tension:.35, fill:true, spanGaps:true}] },
        options:{ responsive:true, plugins:{legend:{display:false}} }
      });
    }, 150);
  };

  render();
  const openId = APP.qs('id');
  if(openId) window.openProfile(openId);
});
