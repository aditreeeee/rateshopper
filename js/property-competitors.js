let profileChart = null;

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Competitors', subtitle:'The properties selected by your Company Admin to benchmark against.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);

  ['cp_search','cp_sort','cp_filter'].forEach(id=> document.getElementById(id).addEventListener('input', render));

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

    document.getElementById('competitorGrid').innerHTML = comps.length ? comps.map(c=>{
      const diffPct = ((c.rate-myRate)/myRate)*100;
      return `<div class="col-md-6 col-xl-4 col-xxl-3">
        <div class="competitor-card">
          <div class="comp-img" style="background-image:url('${c.image}')">
            <div class="comp-pin" onclick="toggleFavorite('${c.id}')" title="Favorite"><i class="bi ${c.favorite?'bi-star-fill text-warning':'bi-star'}"></i></div>
          </div>
          <div class="comp-body">
            <div class="d-flex justify-content-between align-items-start">
              <div class="fw-bold" style="font-size:.9rem">${c.name} ${c.isReal?'<span class="badge bg-primary-subtle text-primary ms-1" style="font-size:.6rem" title="Selected by your Company Admin as a benchmark property">Benchmark</span>':''}</div>
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
            <div class="d-flex gap-1 mt-2">
              <button class="btn btn-soft btn-sm flex-fill" onclick="openProfile('${c.id}')"><i class="bi bi-eye me-1"></i>Details</button>
              <button class="btn btn-sm-icon ${c.pinned?'btn-primary':'btn-soft'}" onclick="togglePinC('${c.id}')" title="Pin for comparison"><i class="bi bi-pin-angle${c.pinned?'-fill':''}"></i></button>
            </div>
          </div>
        </div>
      </div>`;
    }).join('') : `<div class="col-12">${
      PORTALDATA.comparisonRealProperties().length
        ? PWIDGETS.emptyState('bi-building','No competitors found','Try adjusting your search or filters.')
        : PWIDGETS.emptyState('bi-building','No comparison properties assigned yet','Your Company Admin hasn\'t selected any benchmark properties for you yet.')
    }</div>`;
  }

  window.toggleFavorite = function(id){ const c=PORTALDATA.competitor(propertyId,id); c.favorite=!c.favorite; PORTALDATA.saveCompetitor(propertyId,c); render(); };
  window.togglePinC = function(id){ const c=PORTALDATA.competitor(propertyId,id); c.pinned=!c.pinned; PORTALDATA.saveCompetitor(propertyId,c); render(); };

  window.openProfile = function(id){
    const c = PORTALDATA.competitor(propertyId, id);
    if(!c) return;
    const today = PORTALDATA.dateKeyOffset(0);
    const series = [];
    for(let d=-30; d<=30; d+=2){ series.push(PORTALDATA.competitorRateOnDate(c, PORTALDATA.dateKeyOffset(d))); }
    const lowest = Math.min(...series), highest = Math.max(...series), avg = Math.round(series.reduce((a,b)=>a+b,0)/series.length);
    const freq = {}; series.forEach(r=>{ const b=Math.round(r/500)*500; freq[b]=(freq[b]||0)+1; });
    const mostCommon = Object.keys(freq).sort((a,b)=>freq[b]-freq[a])[0];
    const otaSplit = PORTALDATA.CHANNELS.map(ch=>({ch, pct: 5+Math.round(seededPct(c.id+ch.key)*95)}));
    const total = otaSplit.reduce((s,o)=>s+o.pct,0);

    document.getElementById('cprof_title').innerHTML = `<i class="bi bi-building me-2"></i>${c.name}`;
    document.getElementById('cprof_body').innerHTML = `
      <div class="row g-3">
        <div class="col-lg-5">
          <img src="${c.image}" class="w-100 mb-3" style="border-radius:14px;height:180px;object-fit:cover">
          <div class="kv-row"><span class="k">Location</span><span class="v">${c.city}, ${c.country}</span></div>
          ${!c.isReal ? `<div class="kv-row"><span class="k">Distance</span><span class="v">${c.distanceKm} km</span></div>` : ''}
          <div class="kv-row"><span class="k">Star Rating</span><span class="v">${c.stars}★</span></div>
          <div class="kv-row"><span class="k">Cancellation Policy</span><span class="v">${c.cancellationPolicy}</span></div>
          <div class="mt-2 mb-1 fw-semibold small">Amenities</div>
          <div>${(c.amenities||[]).map(a=>`<span class="badge bg-light text-dark border me-1 mb-1">${a}</span>`).join('') || '<span class="text-muted small">Not listed</span>'}</div>
          <div class="mt-3 mb-1 fw-semibold small">Mapped Room / Rate Plan</div>
          <div class="text-muted small">${c.roomType} — ${c.mealPlan}</div>
        </div>
        <div class="col-lg-7">
          <div class="row g-2 mb-3">
            <div class="col-6 col-md-3"><div class="stat-card h-100"><div class="stat-label">Lowest</div><h3 style="font-size:1rem">${APP.fmtCurrency(lowest)}</h3></div></div>
            <div class="col-6 col-md-3"><div class="stat-card h-100"><div class="stat-label">Highest</div><h3 style="font-size:1rem">${APP.fmtCurrency(highest)}</h3></div></div>
            <div class="col-6 col-md-3"><div class="stat-card h-100"><div class="stat-label">Average</div><h3 style="font-size:1rem">${APP.fmtCurrency(avg)}</h3></div></div>
            <div class="col-6 col-md-3"><div class="stat-card h-100"><div class="stat-label">Most Common</div><h3 style="font-size:1rem">${APP.fmtCurrency(mostCommon)}</h3></div></div>
          </div>
          <div class="fw-semibold small mb-1">Historical & Future Rate Trend (60 days)</div>
          <canvas id="cprof_chart" height="90"></canvas>
          <div class="fw-semibold small mt-3 mb-1">OTA Distribution</div>
          ${otaSplit.map(o=>`
            <div class="dist-bar-row">
              <span style="width:110px;font-size:.72rem">${o.ch.label}</span>
              <div class="dist-bar-track"><div class="dist-bar-fill" style="width:${Math.round(o.pct/total*100)}%"></div></div>
              <span style="width:36px;font-size:.72rem" class="text-end">${Math.round(o.pct/total*100)}%</span>
            </div>`).join('')}
        </div>
      </div>`;

    new bootstrap.Modal(document.getElementById('competitorProfileModal')).show();
    setTimeout(()=>{
      if(profileChart) profileChart.destroy();
      const labels = []; const data = [];
      for(let d=-30; d<=30; d+=2){ const dk=PORTALDATA.dateKeyOffset(d); labels.push(dk.slice(5)); data.push(PORTALDATA.competitorRateOnDate(c,dk)); }
      profileChart = new Chart(document.getElementById('cprof_chart'), {
        type:'line',
        data:{ labels, datasets:[{label:c.name, data, borderColor:'#3861fb', backgroundColor:'rgba(56,97,251,.08)', tension:.35, fill:true}] },
        options:{ responsive:true, plugins:{legend:{display:false}} }
      });
    }, 150);
  };

  function seededPct(seed){ let h=0; for(let i=0;i<seed.length;i++){h=(h*31+seed.charCodeAt(i))|0;} return (Math.abs(h)%1000)/1000; }

  render();
  const openId = APP.qs('id');
  if(openId) window.openProfile(openId);
});
