/* ==========================================================================
   Property Owner Portal — App Shell (separate sidebar/topbar/nav from the
   Company/Admin experience in js/main.js, which this file never touches).
   Reuses APP.requireAuth()/toast()/fmtCurrency()/etc from js/main.js and
   DB/RBAC as-is — only the navigation chrome is portal-specific.
   ========================================================================== */
const PORTAL = (() => {

  const NAV = [
    {section:'Rate Intelligence'},
    {href:'property-dashboard.html', icon:'bi-speedometer2', label:'Dashboard'},
    {href:'property-rate-shopper.html', icon:'bi-search', label:'Rate Shopper'},
    {href:'property-room-comparison.html', icon:'bi-columns-gap', label:'Comparison'},
    {href:'property-market.html', icon:'bi-globe-americas', label:'Market Intelligence'},
    {section:'Property'},
    {href:'property-details.html', icon:'bi-building-gear', label:'My Property', dynamicId:true},
    {href:'property-competitors.html', icon:'bi-building', label:'Competitors'},
    {section:'Insights'},
    {href:'property-reports.html', icon:'bi-file-earmark-bar-graph', label:'Reports'},
    {section:'Account'},
    {href:'profile.html', icon:'bi-person-circle', label:'Profile'},
    {href:'property-settings.html', icon:'bi-gear', label:'Settings'},
  ];

  function currentPage(){ return location.pathname.split('/').pop() || 'index.html'; }

  // The portal is scoped to exactly one property — this owner's own Parent Property.
  // There is no property switcher; comparison properties are benchmark targets, not
  // alternate properties to operate the portal against.
  function activePropertyId(me){
    return me.parentPropertyId || null;
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

  // Groups the flat NAV array into collapsible sections. A section auto-expands whenever it
  // contains the current page, regardless of any previously saved collapsed state — collapsing
  // is a declutter convenience, it should never be able to hide where you actually are.
  function navGroups(){
    const groups = [];
    NAV.forEach(item=>{
      if(item.section){ groups.push({ label:item.section, items:[] }); }
      else if(groups.length){ groups[groups.length-1].items.push(item); }
    });
    return groups.filter(g=>g.items.length);
  }

  function sidebarHtml(me){
    const activeId = activePropertyId(me);
    const property = DB.properties.get(activeId);
    const items = navGroups().map(g=>{
      const hasActive = g.items.some(item=> item.href === currentPage());
      const storedCollapsed = localStorage.getItem('rsiq_navsec_'+g.label) === '1';
      const collapsed = !hasActive && storedCollapsed;
      const linksHtml = g.items.map(item=>{
        const active = item.href === currentPage();
        const href = item.dynamicId ? `${item.href}?id=${activeId}` : item.href;
        return `<a href="${href}" class="nav-link ${active?'active':''}"><i class="bi ${item.icon}"></i><span>${item.label}</span></a>`;
      }).join('');
      return `<div class="nav-section-group ${collapsed?'collapsed':''}">
        <button type="button" class="nav-section" onclick="PORTAL.toggleNavSection(this,'${g.label}')" aria-expanded="${!collapsed}">
          <span>${g.label}</span><i class="bi bi-chevron-down nav-section-chevron"></i>
        </button>
        <div class="nav-section-links"><div class="nav-section-inner">${linksHtml}</div></div>
      </div>`;
    }).join('');

    return `
    <aside class="sidebar portal-sidebar">
      <div class="brand">
        <div class="logo-badge portal-logo-badge"><i class="bi bi-graph-up-arrow"></i></div>
        <div class="brand-text"><strong>Rate Shopper IQ</strong><span>${property ? property.name : 'Revenue Management'}</span></div>
      </div>
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
        <div class="dropdown">
          <button class="icon-btn" id="portalBellBtn" type="button" data-bs-toggle="dropdown" data-bs-auto-close="outside" title="Rate Alerts">
            <i class="bi bi-bell"></i><span id="portalBellDot"></span>
          </button>
          <div class="dropdown-menu dropdown-menu-end p-0" id="portalBellMenu" style="width:340px;border-radius:14px;overflow:hidden;border:1px solid var(--border-1)"></div>
        </div>
        <a href="property-settings.html" class="icon-btn d-none d-sm-flex" title="Settings"><i class="bi bi-gear"></i></a>
        <a href="profile.html" class="d-flex align-items-center gap-2 text-decoration-none ms-1">
          <img src="${me.avatar}" class="avatar-thumb" style="width:38px;height:38px">
        </a>
      </div>
    </header>`;
  }

  function refreshBell(me){
    const propertyId = activePropertyId(me);
    const unread = PORTALDATA.unreadNotificationCount(propertyId);
    const dot = document.getElementById('portalBellDot');
    if(dot) dot.className = unread>0 ? 'dot' : '';

    const list = PORTALDATA.notifications(propertyId).slice(0,8);
    const menu = document.getElementById('portalBellMenu');
    if(!menu) return;
    const priorityColor = {high:'var(--danger)', medium:'var(--warn)', low:'var(--brand-400)'};
    menu.innerHTML = `
      <div class="d-flex justify-content-between align-items-center px-3 py-2" style="border-bottom:1px solid var(--border-1)">
        <span class="fw-bold" style="font-size:.85rem">Rate Alerts</span>
        <button type="button" class="btn btn-link btn-sm p-0" style="font-size:.72rem" onclick="PORTAL.markAllAlertsRead()">Mark all read</button>
      </div>
      <div style="max-height:340px;overflow-y:auto">
        ${list.length ? list.map(n=>`
          <div class="d-flex align-items-start gap-2 px-3 py-2 ${n.read?'':'fw-semibold'}" style="cursor:pointer;border-bottom:1px solid var(--border-2)" onclick="PORTAL.markAlertRead('${n.id}')">
            <i class="bi ${n.icon} mt-1" style="color:${priorityColor[n.priority]||'var(--brand-500)'};font-size:.85rem"></i>
            <div class="flex-grow-1">
              <div style="font-size:.78rem">${n.title}${!n.read?' <span class="badge rounded-pill bg-danger ms-1" style="font-size:.55rem">NEW</span>':''}</div>
              <div class="text-muted fw-normal" style="font-size:.7rem">${n.message}</div>
            </div>
          </div>`).join('') : `<div class="text-muted text-center py-4" style="font-size:.8rem">No alerts yet</div>`}
      </div>
      <a href="property-settings.html" class="d-block text-center py-2" style="font-size:.75rem;border-top:1px solid var(--border-1)">Manage Alert Preferences</a>
    `;
  }

  function toggleNavSection(btn, label){
    const group = btn.closest('.nav-section-group');
    const collapsed = group.classList.toggle('collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    localStorage.setItem('rsiq_navsec_'+label, collapsed ? '1' : '0');
  }

  function markAlertRead(id){
    const me = RBAC.currentUser();
    if(!me) return;
    PORTALDATA.markNotificationRead(activePropertyId(me), id);
    refreshBell(me);
  }
  function markAllAlertsRead(){
    const me = RBAC.currentUser();
    if(!me) return;
    PORTALDATA.markAllNotificationsRead(activePropertyId(me));
    refreshBell(me);
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
    refreshBell(me);
    return me;
  }

  // For pages shared between the Company/Admin system and the Property Owner (properties.html,
  // property-details.html, add-room/channel/rate-plan.html — there's no portal-native rebuild
  // of Rooms/Rate Plans/Channels management yet). A Property Owner viewing their own property
  // should see the Rate Shopper IQ portal chrome, not the Company/Admin sidebar — otherwise
  // "looking at their property's profile" incorrectly switches them into the company layout.
  function mountForRole(opts){
    if(RBAC.currentRole() === RBAC.ROLES.PROPERTY_OWNER) return mount(opts);
    APP.mount(opts);
    return null;
  }

  return { mount, mountForRole, guard, activePropertyId, markAlertRead, markAllAlertsRead, refreshBell, toggleNavSection };
})();
