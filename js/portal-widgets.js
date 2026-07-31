/* ==========================================================================
   Property Owner Portal — small shared render helpers used across the
   property-*.js pages, so KPI cards / trend badges / leaderboards / channel
   chips look and behave identically everywhere without copy-pasting markup.
   ========================================================================== */
const PWIDGETS = (() => {

  function kpiCard({icon, color, bg, label, value, sub, subDir, desc}){
    return `<div class="col-md-6 col-xl-3">
      <div class="kpi-card">
        <div class="kpi-icon" style="background:${bg};color:${color}"><i class="bi ${icon}"></i></div>
        <div class="kpi-label">${label}</div>
        <div class="kpi-value">${value}</div>
        ${sub ? `<div class="kpi-sub ${subDir||'flat'}"><i class="bi ${subDir==='up'?'bi-arrow-up-short':subDir==='down'?'bi-arrow-down-short':'bi-dash'}"></i>${sub}</div>` : ''}
        ${desc ? `<div class="kpi-desc">${desc}</div>` : ''}
      </div>
    </div>`;
  }

  function trendIcon(trend){
    if(trend==='up') return '<i class="bi bi-arrow-up-short trend-up"></i>';
    if(trend==='down') return '<i class="bi bi-arrow-down-short trend-down"></i>';
    return '<i class="bi bi-dash trend-flat"></i>';
  }

  function channelChip(channelKey){
    const c = PORTALDATA.CHANNELS.find(x=>x.key===channelKey) || {label:channelKey, color:'#8a90a6', icon:'bi-globe2'};
    return `<span class="badge bg-light text-dark border me-1" style="font-size:.68rem"><i class="bi ${c.icon}" style="color:${c.color}"></i> ${c.label}</span>`;
  }

  function statusBadge(status){
    const map = { cheaper:['badge-active','Cheaper'], pricier:['badge-inactive','Pricier'], parity:['badge-active','At Parity'] };
    const [cls,label] = map[status] || ['badge-inactive', status];
    return `<span class="badge-status ${cls}">${label}</span>`;
  }

  function scoreRing(score, size=88){
    const r = (size/2)-8, c = 2*Math.PI*r;
    const pct = Math.max(0,Math.min(100,score));
    const color = pct>=80?'#12b76a':pct>=55?'#ffb020':'#ff4d5e';
    return `<div class="score-ring" style="width:${size}px;height:${size}px">
      <svg width="${size}" height="${size}">
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--border-1)" stroke-width="8"/>
        <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="8"
          stroke-dasharray="${c}" stroke-dashoffset="${c - (pct/100)*c}" stroke-linecap="round"/>
      </svg>
      <div class="score-value">${Math.round(pct)}</div>
    </div>`;
  }

  function heatCellColor(intensity){ // 0..100
    const t = Math.max(0,Math.min(100,intensity))/100;
    // interpolate brand-100 -> brand-700 ish
    const from = [219,231,255], to = [30,55,176];
    const rgb = from.map((f,i)=> Math.round(f + (to[i]-f)*t));
    return `rgb(${rgb.join(',')})`;
  }

  function skeletonRows(n=4, h=42){
    return Array(n).fill(0).map(()=>`<div class="portal-skeleton mb-2" style="height:${h}px"></div>`).join('');
  }

  function emptyState(icon, title, msg){
    return `<div class="empty-state"><i class="bi ${icon}"></i><h5>${title}</h5><p class="mb-0">${msg}</p></div>`;
  }

  function timeAgoShort(date){
    const mins = Math.max(0, Math.round((Date.now()-date.getTime())/60000));
    if(mins<1) return 'just now';
    if(mins<60) return `${mins}m ago`;
    const hrs = Math.floor(mins/60);
    if(hrs<24) return `${hrs}h ${mins%60}m ago`;
    return `${Math.floor(hrs/24)}d ago`;
  }

  // Small "data as of Xm ago" badge, red-ish once data is stale (default >2hrs) so it's obvious
  // at a glance whether the rates on screen are fresh enough to act on.
  function staleBadge(date, staleAfterMins=120){
    const mins = Math.round((Date.now()-date.getTime())/60000);
    const stale = mins > staleAfterMins;
    return `<span class="badge ${stale?'bg-warning-subtle text-warning':'bg-light text-muted border'}" style="font-size:.68rem" title="Rates last refreshed ${date.toLocaleString()}">
      <i class="bi ${stale?'bi-exclamation-triangle':'bi-check2-circle'} me-1"></i>Data as of ${timeAgoShort(date)}
    </span>`;
  }

  // Premium sticky tab bar (Room Rate Comparison, Forecast & Actions) — adds a sliding underline
  // indicator beneath whichever .nav-link is .active and keeps it correctly positioned on every
  // click and window resize. Purely visual: it doesn't touch whatever click handler the page
  // already has wired up to show/hide the actual tab content, so it's safe to bolt on after the
  // fact. Call once per tab bar after its buttons exist in the DOM.
  function initTabbar(containerId){
    const nav = document.getElementById(containerId);
    if(!nav) return null;
    nav.classList.add('rsiq-tabbar');
    let indicator = nav.querySelector('.rsiq-tab-indicator');
    if(!indicator){
      indicator = document.createElement('span');
      indicator.className = 'rsiq-tab-indicator';
      nav.appendChild(indicator);
    }
    function reposition(){
      const active = nav.querySelector('.nav-link.active');
      if(!active) return;
      indicator.style.width = active.offsetWidth + 'px';
      indicator.style.transform = `translateX(${active.offsetLeft}px)`;
    }
    nav.querySelectorAll('.nav-link').forEach(btn=>{
      btn.addEventListener('click', ()=> requestAnimationFrame(reposition));
    });
    window.addEventListener('resize', reposition);
    requestAnimationFrame(reposition);
    return { reposition };
  }

  return { kpiCard, trendIcon, channelChip, statusBadge, scoreRing, heatCellColor, skeletonRows, emptyState, timeAgoShort, staleBadge, initTabbar };
})();
