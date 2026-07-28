/* ==========================================================================
   Company Dashboard — portfolio administration for Company Admin. Deliberately
   has no occupancy/ADR/RevPAR/revenue widgets: those live in each property's
   own Rate Intelligence pages. This page is about the portfolio itself —
   properties, owners, competitor coverage, and setup completeness — built
   entirely from existing DB.* demo data (no new datasets).
   ========================================================================== */
document.addEventListener('DOMContentLoaded', ()=>{
  if(!RBAC.requireModuleAccess(RBAC.MODULES.DASHBOARD, 'view')) return;
  // Property Owner has their own dedicated dashboard — this admin dashboard is
  // company-wide portfolio administration, which doesn't apply to a single property.
  if(RBAC.currentRole() === RBAC.ROLES.PROPERTY_OWNER){ location.href = 'property-dashboard.html'; return; }

  const me = RBAC.currentUser();
  // One primary CTA for the whole page, in the header — the same convention Properties/Users
  // pages already use. Everything else on this page is secondary by comparison.
  const canCreateProperty = RBAC.can(RBAC.MODULES.PROPERTIES, 'create');
  APP.mount({
    title:'Company Dashboard',
    subtitle:`Welcome back, ${me.name.split(' ')[0]}! Here's the state of your property portfolio.`,
    breadcrumb:[{label:'Home',href:'dashboard.html'},{label:'Dashboard'}],
    actions: canCreateProperty ? `<a href="add-property.html" class="btn btn-primary"><i class="bi bi-plus-lg me-1"></i>Add Property</a>` : ''
  });

  const CHART_COLORS = ['#3861fb','#00c2a8','#ffb020','#ff4d5e','#12b76a','#8cadff','#b9791a','#5c86ff'];
  const COLOR_HEX = { success:'#12b76a', brand:'#3861fb', warn:'#b9791a', danger:'#ff4d5e' };

  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function timeAgo(dateStr){
    if(!dateStr) return '—';
    const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
    if(days<=0) return 'Today';
    if(days===1) return '1 day ago';
    if(days<30) return `${days} days ago`;
    const months = Math.floor(days/30);
    if(months<12) return `${months} month${months>1?'s':''} ago`;
    const years = Math.floor(months/12);
    return `${years} year${years>1?'s':''} ago`;
  }

  // ---- Source data (all pre-existing demo data — nothing new is generated) ----
  const properties = DB.properties.all();
  const users = DB.users.all();
  const channels = DB.channels.all();
  const rooms = DB.rooms.all();
  const ratePlans = DB.ratePlans.all();
  const owners = users.filter(u=>u.role===RBAC.ROLES.PROPERTY_OWNER);
  const admins = users.filter(u=>u.role===RBAC.ROLES.COMPANY_ADMIN);

  const ownerByPropertyId = {};
  owners.forEach(u=>{ if(u.parentPropertyId) ownerByPropertyId[u.parentPropertyId] = u; });

  // ---- Per-property health computation (owner, competitor coverage, config completeness) ----
  const healthRows = properties.map(p=>{
    const owner = ownerByPropertyId[p.id] || null;
    const competitorCount = owner ? (owner.assignedProperties||[]).length : 0;
    const propChannels = channels.filter(c=>c.propertyId===p.id);
    const activeChannels = propChannels.filter(c=>c.status==='active');
    const activeOtaChannels = activeChannels.filter(c=>c.type!=='master');
    const propRooms = rooms.filter(r=>r.propertyId===p.id);
    const propRatePlans = ratePlans.filter(rp=>rp.propertyId===p.id);

    const checks = [!!owner, activeOtaChannels.length>0, propRooms.length>0, propRatePlans.length>0, competitorCount>0];
    const progress = Math.round(checks.filter(Boolean).length / checks.length * 100);
    const status = progress===100 ? 'healthy' : progress>=40 ? 'attention' : 'incomplete';

    return {
      p, owner, competitorCount,
      channelsActive: activeChannels.length, channelsTotal: propChannels.length,
      roomsCount: propRooms.length, ratePlansCount: propRatePlans.length,
      progress, status
    };
  });

  /* =========================== KPI Cards =========================== */
  const activeProperties = properties.filter(p=>p.status==='active');
  const pendingSetup = healthRows.filter(r=>r.progress<100);
  const assignedProperties = properties.filter(p=>ownerByPropertyId[p.id]);
  const thirtyDaysAgo = Date.now() - 30*86400000;
  const recentlyAdded = properties.filter(p=> new Date(p.createdAt).getTime() >= thirtyDaysAgo);

  // `accent` puts a colored left edge on a KPI card when its number represents a problem —
  // so the eye lands on "this needs action" cards first, instead of every KPI reading as equally neutral.
  const kpis = [
    {icon:'bi-building', color:'#3861fb', bg:'#eef4ff', label:'Total Properties', value:properties.length},
    {icon:'bi-building-check', color:'#12b76a', bg:'#e7faf1', label:'Active Properties', value:activeProperties.length, sub:`of ${properties.length} total`},
    {icon:'bi-people', color:'#00c2a8', bg:'#e6faf7', label:'Total Users', value:users.length},
    {icon:'bi-person-badge', color:'#8cadff', bg:'#eef4ff', label:'Property Owners', value:owners.length},
    {icon:'bi-shield-lock', color:'#1e37b0', bg:'#eef4ff', label:'Company Admins', value:admins.length},
    {icon:'bi-tools', color:'#b9791a', bg:'#fff8e6', label:'Pending Setup', value:pendingSetup.length, sub:'properties incomplete', accent: pendingSetup.length>0 ? 'warn' : null},
    {icon:'bi-diagram-3', color:'#ffb020', bg:'#fff8e6', label:'Property Assignments', value:`${assignedProperties.length}/${properties.length}`, sub:'assigned to an owner', accent: assignedProperties.length<properties.length ? 'danger' : null},
    {icon:'bi-clock-history', color:'#ff4d5e', bg:'#fff0f1', label:'Recently Added', value:recentlyAdded.length, sub:'in the last 30 days'},
  ];
  document.getElementById('kpiCards').innerHTML = kpis.map(k=>`
    <div class="col-6 col-md-4 col-xl-3">
      <div class="kpi-card ${k.accent?`kpi-card-accent-${k.accent}`:''}">
        <div class="kpi-icon" style="background:${k.bg};color:${k.color}"><i class="bi ${k.icon}"></i></div>
        <div>
          <div class="kpi-label">${k.label}</div>
          <h4>${k.value}</h4>
          ${k.sub?`<div class="kpi-sub">${k.sub}</div>`:''}
        </div>
      </div>
    </div>`).join('');

  /* ======================= Portfolio Overview ======================= */
  // Geographic Distribution — grouped by country, click-to-filter into Property Health below.
  function renderGeoDistribution(){
    const groups = {};
    properties.forEach(p=>{ const key = p.country || 'Unknown'; groups[key] = (groups[key]||0)+1; });
    const entries = Object.entries(groups).sort((a,b)=>b[1]-a[1]);
    const max = entries.length ? entries[0][1] : 1;
    document.getElementById('geoDistribution').innerHTML = entries.map(([country,count])=>`
      <div class="mini-bar-row clickable" data-country="${escapeHtml(country)}">
        <div class="mbr-top"><span class="mbr-label"><i class="bi bi-geo-alt-fill" style="color:var(--brand-500)"></i>${escapeHtml(country)}</span><span class="mbr-count">${count} propert${count===1?'y':'ies'}</span></div>
        <div class="progress progress-thin"><div class="progress-bar" style="width:${count/max*100}%;background:var(--brand-500)"></div></div>
      </div>`).join('') || `<div class="text-muted small">No properties yet.</div>`;

    document.querySelectorAll('#geoDistribution .mini-bar-row').forEach(row=>{
      row.addEventListener('click', ()=>{
        document.getElementById('ph_search').value = row.dataset.country;
        document.getElementById('geoResetBtn').classList.remove('d-none');
        renderPropertyHealth();
        document.getElementById('propertyHealthBody').closest('.section-card').scrollIntoView({behavior:'smooth', block:'nearest'});
      });
    });
  }
  document.getElementById('geoResetBtn').addEventListener('click', ()=>{
    document.getElementById('ph_search').value = '';
    document.getElementById('geoResetBtn').classList.add('d-none');
    renderPropertyHealth();
  });
  renderGeoDistribution();

  // Property Type doughnut
  const typeGroups = {};
  properties.forEach(p=>{ const t = p.type||'Other'; typeGroups[t]=(typeGroups[t]||0)+1; });
  const typeLabels = Object.keys(typeGroups);
  new Chart(document.getElementById('typeChart'), {
    type:'doughnut',
    data:{ labels:typeLabels, datasets:[{ data:typeLabels.map(t=>typeGroups[t]), backgroundColor:typeLabels.map((_,i)=>CHART_COLORS[i%CHART_COLORS.length]), borderWidth:0 }]},
    options:{ cutout:'68%', plugins:{ legend:{display:false} } }
  });

  // Active vs Archived doughnut
  const inactiveCount = properties.length - activeProperties.length;
  new Chart(document.getElementById('statusChart'), {
    type:'doughnut',
    data:{ labels:['Active','Archived'], datasets:[{ data:[activeProperties.length, inactiveCount], backgroundColor:[COLOR_HEX.success, COLOR_HEX.danger], borderWidth:0 }]},
    options:{ cutout:'68%', plugins:{ legend:{display:false} } }
  });

  document.getElementById('typeStatusLegend').innerHTML = `
    ${typeLabels.map((t,i)=>`<span class="d-inline-flex align-items-center gap-1" style="font-size:.72rem;color:var(--text-2)"><span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${CHART_COLORS[i%CHART_COLORS.length]}"></span>${escapeHtml(t)} (${typeGroups[t]})</span>`).join('')}
    <span style="width:100%;height:0"></span>
    <span class="d-inline-flex align-items-center gap-1" style="font-size:.72rem;color:var(--text-2)"><span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${COLOR_HEX.success}"></span>Active (${activeProperties.length})</span>
    <span class="d-inline-flex align-items-center gap-1" style="font-size:.72rem;color:var(--text-2)"><span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${COLOR_HEX.danger}"></span>Archived (${inactiveCount})</span>
  `;

  // Brand Breakdown
  const brandGroups = {};
  properties.forEach(p=>{ const b = p.brand||'Independent'; brandGroups[b]=(brandGroups[b]||0)+1; });
  const brandEntries = Object.entries(brandGroups).sort((a,b)=>b[1]-a[1]);
  const brandMax = brandEntries.length ? brandEntries[0][1] : 1;
  document.getElementById('brandBreakdown').innerHTML = brandEntries.map(([brand,count],i)=>`
    <div class="mini-bar-row">
      <div class="mbr-top"><span class="mbr-label">${escapeHtml(brand)}</span><span class="mbr-count">${count}</span></div>
      <div class="progress progress-thin"><div class="progress-bar" style="width:${count/brandMax*100}%;background:${CHART_COLORS[i%CHART_COLORS.length]}"></div></div>
    </div>`).join('') || `<div class="text-muted small">No brand data yet.</div>`;

  /* ========================= Property Health ========================= */
  function renderPropertyHealth(){
    const q = document.getElementById('ph_search').value.trim().toLowerCase();
    const statusF = document.getElementById('ph_status').value;
    const ownerF = document.getElementById('ph_owner').value;

    const rows = healthRows.filter(r=>{
      if(q){
        const hay = `${r.p.name} ${r.p.city} ${r.p.country}`.toLowerCase();
        if(!hay.includes(q)) return false;
      }
      if(statusF && r.status !== statusF) return false;
      if(ownerF==='assigned' && !r.owner) return false;
      if(ownerF==='unassigned' && r.owner) return false;
      return true;
    });

    document.getElementById('ph_count').textContent = `${rows.length} of ${healthRows.length} properties`;
    const tbody = document.getElementById('propertyHealthBody');
    const empty = document.getElementById('ph_empty');

    if(!rows.length){
      tbody.innerHTML = '';
      empty.classList.remove('d-none');
      empty.innerHTML = `<div class="empty-state"><i class="bi bi-building"></i><h5>No properties found</h5><p class="mb-0">Try adjusting your filters.</p></div>`;
      return;
    }
    empty.classList.add('d-none');

    const statusMeta = {
      healthy:   { cls:'badge-active',   label:'Healthy' },
      attention: { cls:'badge-pending',  label:'Needs Attention' },
      incomplete:{ cls:'badge-inactive', label:'Incomplete' }
    };
    const barColor = r => r.progress===100 ? 'var(--success)' : r.progress>=40 ? 'var(--warn)' : 'var(--danger)';

    tbody.innerHTML = rows.map(r=>{
      const sm = statusMeta[r.status];
      return `<tr>
        <td>
          <div class="d-flex align-items-center gap-2">
            <img src="${r.p.logo}" class="avatar-thumb" style="width:38px;height:38px">
            <div>
              <div class="fw-semibold" style="font-size:.85rem">${escapeHtml(r.p.name)}</div>
              <div class="text-muted" style="font-size:.72rem">${escapeHtml(r.p.city)}, ${escapeHtml(r.p.country)}</div>
            </div>
          </div>
        </td>
        <td>${r.owner ? `<div style="font-size:.83rem">${escapeHtml(r.owner.name)}</div>` : `<a href="add-user.html" class="d-inline-flex align-items-center gap-1 text-decoration-none" style="font-size:.78rem;color:var(--warn,#b9791a);font-weight:600"><i class="bi bi-person-plus"></i>Assign owner</a>`}</td>
        <td class="text-center">${r.competitorCount}</td>
        <td class="text-center">${r.channelsActive}/${r.channelsTotal}</td>
        <td class="text-center">${r.roomsCount}</td>
        <td class="text-center">${r.ratePlansCount}</td>
        <td>
          <div class="setup-progress-cell">
            <div class="progress progress-thin"><div class="progress-bar" style="width:${r.progress}%;background:${barColor(r)}"></div></div>
            <span class="spc-pct">${r.progress}%</span>
          </div>
        </td>
        <td><span class="badge-status ${sm.cls}">${sm.label}</span></td>
      </tr>`;
    }).join('');
  }
  ['ph_search','ph_status','ph_owner'].forEach(id=>{
    const el = document.getElementById(id);
    el.addEventListener(id==='ph_search' ? 'input' : 'change', renderPropertyHealth);
  });
  renderPropertyHealth();

  /* ===================== Recent Activity (derived) ===================== */
  // No dedicated admin activity log exists in the demo data, so this is derived directly from
  // real property/user records (createdAt, parentPropertyId, assignedProperties, status) —
  // no fabricated dataset, just administrative framing of data that's already there.
  const events = [];
  properties.forEach(p=>{
    events.push({ icon:'bi-building-add', color:'success', text:`${p.name} was added to the portfolio`, time:p.createdAt });
    if(p.status==='inactive') events.push({ icon:'bi-archive', color:'danger', text:`${p.name} was archived`, time:p.createdAt });
  });
  users.forEach(u=>{
    events.push({ icon:'bi-person-plus', color:'brand', text:`${u.name} was created as ${RBAC.ROLE_LABELS[u.role]}`, time:u.createdAt });
    if(u.role===RBAC.ROLES.PROPERTY_OWNER && u.parentPropertyId){
      const p = DB.properties.get(u.parentPropertyId);
      if(p) events.push({ icon:'bi-person-check', color:'brand', text:`${u.name} was assigned as Property Owner of ${p.name}`, time:u.createdAt });
      const compCount = (u.assignedProperties||[]).length;
      if(p && compCount>0) events.push({ icon:'bi-signpost-split', color:'warn', text:`Competitor set updated for ${p.name} — ${compCount} competitor propert${compCount===1?'y':'ies'} tracked`, time:u.createdAt });
    }
  });
  events.sort((a,b)=> new Date(b.time)-new Date(a.time));
  document.getElementById('activityTimeline').innerHTML = events.slice(0,18).map(e=>`
    <div class="activity-item">
      <div class="activity-ico" style="background:${COLOR_HEX[e.color]}1a;color:${COLOR_HEX[e.color]}"><i class="bi ${e.icon}"></i></div>
      <div class="flex-grow-1">
        <div style="font-size:.84rem">${e.text}</div>
        <div class="text-muted" style="font-size:.74rem">${timeAgo(e.time)}</div>
      </div>
    </div>`).join('') || `<div class="empty-state py-3"><i class="bi bi-clock-history"></i><p class="mb-0 small">No recent activity</p></div>`;

  /* ============================== Alerts ============================== */
  // Every alert carries a `fix` — clicking it jumps straight to where the problem gets solved
  // (deep-filter the table below, or navigate to the right admin screen) instead of just naming
  // the problem and leaving the admin to go find the fix themselves.
  const alerts = [];
  const noOwner = properties.filter(p=>!ownerByPropertyId[p.id]);
  if(noOwner.length) alerts.push({ icon:'bi-person-x', color:'danger', title:'Properties without an Owner', desc:`${noOwner.length} propert${noOwner.length===1?'y has':'ies have'} no Property Owner assigned.`, count:noOwner.length,
    fix:()=>{ setPropertyHealthFilter({ owner:'unassigned' }); } });

  const noCompetitors = owners.filter(u=>u.parentPropertyId && (u.assignedProperties||[]).length===0);
  if(noCompetitors.length) alerts.push({ icon:'bi-signpost', color:'warn', title:'Missing Competitor Assignments', desc:`${noCompetitors.length} Property Owner${noCompetitors.length===1?'':'s'} have no competitor properties assigned.`, count:noCompetitors.length,
    fix:()=>{ location.href = 'users.html'; } });

  const incomplete = healthRows.filter(r=>r.status!=='healthy');
  if(incomplete.length) alerts.push({ icon:'bi-exclamation-triangle', color:'warn', title:'Incomplete Setup', desc:`${incomplete.length} propert${incomplete.length===1?'y is':'ies are'} missing an owner, rooms, rate plans, channels, or competitors.`, count:incomplete.length,
    fix:()=>{ setPropertyHealthFilter({ status:'attention' }); } });

  const nameGroups = {};
  properties.forEach(p=>{ const k = p.name.trim().toLowerCase(); (nameGroups[k] = nameGroups[k]||[]).push(p); });
  const dupeGroups = Object.values(nameGroups).filter(g=>g.length>1);
  if(dupeGroups.length){
    const dupeCount = dupeGroups.reduce((s,g)=>s+g.length,0);
    alerts.push({ icon:'bi-files', color:'danger', title:'Duplicate Properties Detected', desc:`${dupeGroups.length} property name${dupeGroups.length===1?'':'s'} appear more than once in the portfolio (${dupeCount} records).`, count:dupeCount,
      fix:()=>{ setPropertyHealthFilter({ search:dupeGroups[0][0].name }); } });
  }

  const inactiveUsers = users.filter(u=>u.status==='inactive');
  if(inactiveUsers.length) alerts.push({ icon:'bi-person-dash', color:'danger', title:'Inactive Users', desc:`${inactiveUsers.length} user account${inactiveUsers.length===1?'':'s'} ${inactiveUsers.length===1?'is':'are'} marked inactive.`, count:inactiveUsers.length,
    fix:()=>{ location.href = 'users.html'; } });

  function setPropertyHealthFilter({ search, status, owner }){
    document.getElementById('ph_search').value = search || '';
    document.getElementById('ph_status').value = status || '';
    document.getElementById('ph_owner').value = owner || '';
    renderPropertyHealth();
    document.getElementById('propertyHealthBody').closest('.section-card').scrollIntoView({behavior:'smooth', block:'start'});
  }

  const totalAlerts = alerts.reduce((s,a)=>s+a.count,0);
  const badgeEl = document.getElementById('alertsTotalBadge');
  if(totalAlerts){ badgeEl.textContent = `${totalAlerts} issue${totalAlerts===1?'':'s'}`; } else { badgeEl.classList.add('d-none'); }

  const alertsPanel = document.getElementById('alertsPanel');
  if(!alerts.length){
    document.getElementById('alertsCard').classList.add('d-none');
  } else {
    alertsPanel.innerHTML = alerts.map((a,i)=>`
      <div class="col-md-6 col-xl-4">
        <div class="alert-tile alert-tile-${a.color}" data-alert="${i}" tabindex="0" role="button">
          <div class="alert-ico" style="background:${COLOR_HEX[a.color]}1a;color:${COLOR_HEX[a.color]}"><i class="bi ${a.icon}"></i></div>
          <div class="flex-grow-1">
            <div class="d-flex align-items-center gap-2">
              <div class="fw-semibold" style="font-size:.84rem">${a.title}</div>
              <span class="alert-count" style="background:${COLOR_HEX[a.color]}1a;color:${COLOR_HEX[a.color]}">${a.count}</span>
            </div>
            <div class="text-muted" style="font-size:.75rem;margin-top:2px">${a.desc}</div>
            <div class="alert-fix-link" style="color:${COLOR_HEX[a.color]}">Fix now <i class="bi bi-arrow-right"></i></div>
          </div>
        </div>
      </div>`).join('');
    alertsPanel.querySelectorAll('[data-alert]').forEach(tile=>{
      const alert = alerts[Number(tile.dataset.alert)];
      tile.addEventListener('click', alert.fix);
      tile.addEventListener('keydown', e=>{ if(e.key==='Enter' || e.key===' '){ e.preventDefault(); alert.fix(); } });
    });
  }

  /* ============================ User Overview ============================ */
  new Chart(document.getElementById('roleChart'), {
    type:'doughnut',
    data:{ labels:['Company Admin','Property Owner'], datasets:[{ data:[admins.length, owners.length], backgroundColor:[COLOR_HEX.brand, CHART_COLORS[1]], borderWidth:0 }]},
    options:{ cutout:'68%', plugins:{ legend:{display:false} } }
  });
  document.getElementById('roleLegend').innerHTML = `
    <span class="d-inline-flex align-items-center gap-1" style="font-size:.72rem;color:var(--text-2)"><span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${COLOR_HEX.brand}"></span>Company Admin (${admins.length})</span>
    <span class="d-inline-flex align-items-center gap-1" style="font-size:.72rem;color:var(--text-2)"><span style="width:8px;height:8px;border-radius:50%;display:inline-block;background:${CHART_COLORS[1]}"></span>Property Owner (${owners.length})</span>
  `;

  // Properties per Property Owner — an owner's "portfolio" = their Primary Property plus any
  // additional properties they created themselves (same scope RBAC.assignedPropertyIds() uses).
  const ownerPortfolio = owners.map(u=>{
    const ids = new Set([u.parentPropertyId, ...properties.filter(p=>p.ownerId===u.id).map(p=>p.id)].filter(Boolean));
    return { name:u.name, count:ids.size };
  }).filter(o=>o.count>0).sort((a,b)=>b.count-a.count).slice(0,8);
  new Chart(document.getElementById('ownerChart'), {
    type:'bar',
    data:{ labels:ownerPortfolio.map(o=>o.name), datasets:[{ data:ownerPortfolio.map(o=>o.count), backgroundColor:COLOR_HEX.brand, borderRadius:6, maxBarThickness:22 }]},
    options:{ indexAxis:'y', plugins:{legend:{display:false}}, scales:{ x:{ ticks:{precision:0}, grid:{color:'rgba(120,130,180,.1)'} }, y:{ grid:{display:false} } } }
  });

  // Recent Logins — reuses the existing "New Sign-In" notification feed (already-seeded demo data).
  const recentLogins = DB.notifications.all()
    .filter(n=>n.icon==='bi-box-arrow-in-right')
    .sort((a,b)=> new Date(b.time)-new Date(a.time))
    .slice(0,6);
  document.getElementById('recentLogins').innerHTML = recentLogins.length ? recentLogins.map(n=>`
    <div class="activity-item">
      <div class="activity-ico" style="background:${COLOR_HEX.success}1a;color:${COLOR_HEX.success}"><i class="bi bi-box-arrow-in-right"></i></div>
      <div class="flex-grow-1">
        <div class="fw-semibold" style="font-size:.82rem">${n.msg}</div>
        <div class="text-muted" style="font-size:.72rem">${timeAgo(n.time)}</div>
      </div>
    </div>`).join('') : `<div class="empty-state py-3"><i class="bi bi-box-arrow-in-right"></i><p class="mb-0 small">No recent sign-ins</p></div>`;

  /* ============================ Quick Actions ============================ */
  if(!RBAC.can(RBAC.MODULES.USERS, 'create')){
    document.getElementById('qaAddUser').classList.add('d-none');
    document.getElementById('qaAssignOwner').classList.add('d-none');
    document.getElementById('qaAssignCompetitors').classList.add('d-none');
  }

  document.getElementById('qaImport').addEventListener('click', ()=>{
    APP.toast('Import Properties', 'Bulk property import will be available in a future release.', 'info');
  });
  document.getElementById('qaExport').addEventListener('click', ()=>{
    const headers = ['Name','Type','Brand','Property Code','City','State','Country','Stars','Status','Assigned Owner','Created At'];
    const lines = [headers.map(h=>`"${h}"`).join(',')];
    properties.forEach(p=>{
      const owner = ownerByPropertyId[p.id];
      const row = [p.name, p.type, p.brand||'', p.code||'', p.city, p.state||'', p.country, p.stars, p.status, owner?owner.name:'Unassigned', p.createdAt];
      lines.push(row.map(v=>`"${String(v==null?'':v).replace(/"/g,'""')}"`).join(','));
    });
    const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `properties-export-${DB.fmtDate(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    APP.toast('Export Complete', 'Your properties CSV has been downloaded.', 'success');
  });
});
