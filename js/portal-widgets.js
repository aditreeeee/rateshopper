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

  return { kpiCard, trendIcon, channelChip, statusBadge, scoreRing, heatCellColor, skeletonRows, emptyState };
})();
