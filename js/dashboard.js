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
  const kpis = [
    {icon:'bi-building', color:'#3861fb', bg:'#eef4ff', label:'Total Properties', value:properties.length},
    {icon:'bi-people', color:'#00c2a8', bg:'#e6faf7', label:'Total Users', value:users.length},
    {icon:'bi-person-badge', color:'#8cadff', bg:'#eef4ff', label:'Property Owners', value:owners.length},
    {icon:'bi-shield-lock', color:'#1e37b0', bg:'#eef4ff', label:'Company Admins', value:admins.length},
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
