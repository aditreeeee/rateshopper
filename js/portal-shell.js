/* ==========================================================================
   Property Owner Portal — App Shell (separate sidebar/topbar/nav from the
   Company/Admin experience in js/main.js, which this file never touches).
   Reuses APP.requireAuth()/toast()/fmtCurrency()/etc from js/main.js and
   DB/RBAC as-is — only the navigation chrome is portal-specific.
   ========================================================================== */
const PORTAL = (() => {

  const NAV = [
    {section:'Revenue Management'},
    {href:'property-dashboard.html', icon:'bi-speedometer2', label:'Dashboard'},
    {href:'property-rate-shopper.html', icon:'bi-search', label:'Rate Shopper'},
    {href:'property-competitors.html', icon:'bi-building', label:'Competitors'},
    {href:'property-market.html', icon:'bi-globe-americas', label:'Market Intelligence'},
    {section:'Pricing'},
    {href:'property-rate-calendar.html', icon:'bi-calendar3', label:'Rate Calendar'},
    {href:'property-price-recommendations.html', icon:'bi-lightbulb-fill', label:'Pricing Recommendations'},
    {href:'property-channel-analysis.html', icon:'bi-diagram-3', label:'Channel Analysis'},
    {section:'Insights'},
    {href:'property-reports.html', icon:'bi-file-earmark-bar-graph', label:'Reports'},
    {section:'Account'},
    {href:'profile.html', icon:'bi-person-circle', label:'Profile'},
    {href:'property-settings.html', icon:'bi-gear', label:'Settings'},
  ];

  function currentPage(){ return location.pathname.split('/').pop() || 'index.html'; }

  // The exact set of properties this Property Owner was given access to by their Company
  // Owner/Admin (their own Parent Property + any Additional Properties granted at creation
  // time, or since) — never anything outside that set.
  function myProperties(){
    return RBAC.assignedPropertyIds().map(id=>DB.properties.get(id)).filter(Boolean);
  }

  function activePropertyId(me){
    const allowed = RBAC.assignedPropertyIds();
    if(!allowed.length) return null;
    const key = 'hop_portal_active_property_'+me.id;
    let stored = localStorage.getItem(key);
    if(!stored || !allowed.includes(stored)) stored = me.parentPropertyId && allowed.includes(me.parentPropertyId) ? me.parentPropertyId : allowed[0];
    return stored;
  }

  function setActiveProperty(propertyId){
    const me = RBAC.currentUser();
    if(!me || !RBAC.assignedPropertyIds().includes(propertyId)) return;
    localStorage.setItem('hop_portal_active_property_'+me.id, propertyId);
    location.href = 'property-dashboard.html';
  }

  function guard(){
    APP.requireAuth();
    const me = RBAC.currentUser();
    if(!me){ return null; }
    if(me.role !== RBAC.ROLES.PROPERTY_OWNER){
      location.href = 'dashboard.html';
      return null;
    }
    const activeId = activePropertyId(me);
    if(!activeId){
      location.href = 'dashboard.html';
      return null;
    }
    PORTALDATA.init(activeId);
    return me;
  }

  function sidebarHtml(me){
    const properties = myProperties();
    const activeId = activePropertyId(me);
    const property = DB.properties.get(activeId);
    const switcher = properties.length > 1 ? `
      <div class="px-3 pb-2">
        <select class="form-select form-select-sm" onchange="PORTAL.setActiveProperty(this.value)" style="background:var(--bg-sidebar-hover);color:#dfe2f5;border-color:rgba(255,255,255,.12)">
          ${properties.map(p=>`<option value="${p.id}" ${p.id===activeId?'selected':''}>${p.name}</option>`).join('')}
        </select>
      </div>` : '';
    let items = NAV.filter((item,i)=>{
      if(!item.section) return true;
      const next = NAV[i+1];
      return next && !next.section;
    }).map(item=>{
      if(item.section) return `<div class="nav-section">${item.section}</div>`;
      const active = item.href === currentPage();
      return `<a href="${item.href}" class="nav-link ${active?'active':''}"><i class="bi ${item.icon}"></i><span>${item.label}</span></a>`;
    }).join('');

    return `
    <aside class="sidebar portal-sidebar">
      <div class="brand">
        <div class="logo-badge portal-logo-badge"><i class="bi bi-graph-up-arrow"></i></div>
        <div class="brand-text"><strong>Rate Shopper IQ</strong><span>${property ? property.name : 'Revenue Management'}</span></div>
      </div>
      ${switcher}
      <nav class="sidebar-nav">${items}</nav>
      <div class="sidebar-foot">
        <a href="profile.html" class="sidebar-user text-decoration-none">
          <img src="${me.avatar}" alt="">
          <div><div class="u-name">${me.name}</div><div class="u-role">Property Owner</div></div>
        </a>
        <button class="btn btn-light-danger w-100 mt-3 btn-sm" onclick="APP.logout()"><i class="bi bi-box-arrow-right me-1"></i> Logout</button>
      </div>
    </aside>
    <div class="backdrop-mobile" onclick="APP.toggleSidebarMobile()"></div>`;
  }

  function topbarHtml(me){
    return `
    <header class="topbar">
      <div class="d-flex align-items-center gap-3">
        <button class="icon-btn d-lg-none" onclick="APP.toggleSidebarMobile()"><i class="bi bi-list"></i></button>
        <div class="search-box">
          <i class="bi bi-search"></i>
          <input type="text" class="form-control" placeholder="Search competitors, channels, dates...">
        </div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <div class="theme-toggle-switch d-none d-md-block" onclick="APP.toggleTheme()" title="Toggle theme"><div class="knob"></div></div>
        <a href="property-settings.html" class="icon-btn d-none d-sm-flex" title="Settings"><i class="bi bi-gear"></i></a>
        <a href="profile.html" class="d-flex align-items-center gap-2 text-decoration-none ms-1">
          <img src="${me.avatar}" class="avatar-thumb" style="width:38px;height:38px">
        </a>
      </div>
    </header>`;
  }

  function mount(opts){
    const me = guard();
    if(!me) return null;
    APP.initTheme();
    const shell = document.getElementById('app-shell');
    if(!shell) return me;
    shell.classList.add('app-shell', 'portal-shell');
    const content = shell.innerHTML;
    shell.innerHTML = sidebarHtml(me) + `
      <div class="main-wrap">
        ${topbarHtml(me)}
        <div class="page-body">
          <div class="page-header">
            <div>
              <div class="breadcrumb-custom mb-1"><span class="text-muted small"><i class="bi bi-graph-up-arrow me-1"></i>Rate Shopper IQ</span></div>
              <h1>${opts.title}</h1>
              ${opts.subtitle ? `<div class="page-subtitle">${opts.subtitle}</div>` : ''}
            </div>
            <div id="page-header-actions">${opts.actions||''}</div>
          </div>
          <div id="page-content">${content}</div>
        </div>
      </div>
      <div class="toast-stack" id="toast-stack"></div>
    `;
    return me;
  }

  return { mount, guard, myProperties, activePropertyId, setActiveProperty };
})();
