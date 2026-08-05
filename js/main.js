/* ==========================================================================
   Hotel Owner Panel — App Shell (sidebar, topbar, theme, toasts, auth guard)
   ========================================================================== */
const APP = (() => {

  // Nav items are filtered per-request by RBAC.can()/role — see sidebarHtml(). Anything
  // specific to a single property (rooms, rate plans, rate calendar) lives inside that
  // property's own detail page, since one account can be assigned to many properties.
  const NAV = [
    {section:'Overview'},
    {href:'dashboard.html', icon:'bi-grid-1x2-fill', label:'Dashboard', module:'dashboard'},
    {href:'properties.html', icon:'bi-building', label:'Properties', module:'properties', match:['properties.html','property-details.html','add-property.html','add-channel.html','add-room.html','add-rate-plan.html']},
    {href:'users.html', icon:'bi-people', label:'Users', module:'users', match:['users.html','add-user.html']},
    {section:'Account'},
    {href:'notifications.html', icon:'bi-bell', label:'Notifications', showCount:true},
    {href:'profile.html', icon:'bi-person-circle', label:'Profile'},
    {href:'settings.html', icon:'bi-gear', label:'Settings', companyOnly:true},
  ];

  function currentPage(){ return location.pathname.split('/').pop() || 'index.html'; }

  function requireAuth(){
    if(currentPage()==='index.html') return;
    const session = JSON.parse(sessionStorage.getItem('hop_session') || localStorage.getItem('hop_session') || 'null');
    if(!session || !session.userId){ location.href='index.html'; return; }
    // Session points at a user record that no longer exists or was deactivated — bounce back to login.
    if(!RBAC.currentUser()){
      sessionStorage.removeItem('hop_session'); localStorage.removeItem('hop_session');
      location.href='index.html';
    }
  }

  function getTheme(){ return localStorage.getItem('hop_theme') || 'light'; }
  function setTheme(t){
    localStorage.setItem('hop_theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }
  function initTheme(){ setTheme(getTheme()); }

  function sidebarHtml(){
    const user = RBAC.currentUser();
    const unread = DB.notifications.unreadCount();
    const visibleNav = NAV.filter(item=>{
      if(item.section) return true;
      if(item.module) return RBAC.can(item.module, 'view');
      if(item.companyOnly) return RBAC.isCompanyLevel();
      return true;
    });
    // Group into collapsible sections (dropping any section with nothing under it after the
    // role filter). A section auto-expands whenever it contains the current page, regardless of
    // any previously saved collapsed state — collapsing is a declutter convenience, it should
    // never be able to hide where you actually are.
    const groups = [];
    visibleNav.forEach(item=>{
      if(item.section){ groups.push({ label:item.section, items:[] }); }
      else if(groups.length){ groups[groups.length-1].items.push(item); }
    });
    let items = groups.filter(g=>g.items.length).map(g=>{
      const hasActive = g.items.some(item=> (item.match||[item.href]).includes(currentPage()));
      const storedCollapsed = localStorage.getItem('hop_navsec_'+g.label) === '1';
      const collapsed = !hasActive && storedCollapsed;
      const linksHtml = g.items.map(item=>{
        const matches = item.match || [item.href];
        const active = matches.includes(currentPage());
        const badge = item.badge ? `<span class="badge bg-warning-subtle text-warning-emphasis ms-auto" style="font-size:.6rem">${item.badge}</span>` : '';
        const count = item.showCount && unread>0 ? `<span class="badge rounded-pill bg-danger ms-auto">${unread}</span>` : '';
        return `<a href="${item.href}" class="nav-link ${active?'active':''}"><i class="bi ${item.icon}"></i><span>${item.label}</span>${badge}${count}</a>`;
      }).join('');
      return `<div class="nav-section-group ${collapsed?'collapsed':''}">
        <button type="button" class="nav-section" onclick="APP.toggleNavSection(this,'${g.label}')" aria-expanded="${!collapsed}">
          <span>${g.label}</span><i class="bi bi-chevron-down nav-section-chevron"></i>
        </button>
        <div class="nav-section-links"><div class="nav-section-inner">${linksHtml}</div></div>
      </div>`;
    }).join('');

    return `
    <aside class="sidebar">
      <div class="brand">
        <div class="logo-badge"><i class="bi bi-building-fill-check"></i></div>
        <div class="brand-text"><strong>Hotel Owner Panel</strong><span>Revenue Management</span></div>
      </div>
      <nav class="sidebar-nav">${items}</nav>
      <div class="sidebar-foot">
        <a href="profile.html" class="sidebar-user text-decoration-none">
          <img src="${user ? user.avatar : 'https://ui-avatars.com/api/?name=User'}" alt="">
          <div><div class="u-name">${user ? user.name : 'Guest'}</div><div class="u-role">${user ? RBAC.ROLE_LABELS[user.role] : ''}</div></div>
        </a>
        <button class="btn btn-light-danger w-100 mt-3 btn-sm" onclick="APP.logout()"><i class="bi bi-box-arrow-right me-1"></i> Logout</button>
      </div>
    </aside>
    <div class="backdrop-mobile" onclick="APP.toggleSidebarMobile()"></div>`;
  }

  function topbarHtml(title, breadcrumb){
    const unread = DB.notifications.unreadCount();
    const user = RBAC.currentUser();
    const crumbs = (breadcrumb||[]).map((c,i)=> i===breadcrumb.length-1 ? `<span>${c.label}</span>` : `<a href="${c.href}">${c.label}</a> <i class="bi bi-chevron-right mx-1" style="font-size:.6rem"></i>`).join('');
    return `
    <header class="topbar">
      <div class="d-flex align-items-center gap-3">
        <button class="icon-btn d-lg-none" onclick="APP.toggleSidebarMobile()"><i class="bi bi-list"></i></button>
        <div class="search-box">
          <i class="bi bi-search"></i>
          <input type="text" class="form-control" placeholder="Search properties, rooms, rate plans...">
        </div>
      </div>
      <div class="d-flex align-items-center gap-2">
        <div class="theme-toggle-switch d-none d-md-block" onclick="APP.toggleTheme()" title="Toggle theme"><div class="knob"></div></div>
        <a href="notifications.html" class="icon-btn" title="Notifications"><i class="bi bi-bell"></i>${unread>0?'<span class="dot"></span>':''}</a>
        ${RBAC.isCompanyLevel() ? `<a href="settings.html" class="icon-btn d-none d-sm-flex" title="Settings"><i class="bi bi-gear"></i></a>` : ''}
        <a href="profile.html" class="d-flex align-items-center gap-2 text-decoration-none ms-1">
          <img src="${user ? user.avatar : 'https://ui-avatars.com/api/?name=User'}" class="avatar-thumb" style="width:38px;height:38px">
        </a>
      </div>
    </header>`;
  }

  function mount(opts){
    // opts: {title, breadcrumb:[{label,href}]}
    requireAuth();
    if(currentPage()==='index.html') return;
    initTheme();
    const shell = document.getElementById('app-shell');
    if(!shell) return;
    shell.classList.add('app-shell');
    const content = shell.innerHTML;
    shell.innerHTML = sidebarHtml() + `
      <div class="main-wrap">
        ${topbarHtml(opts.title, opts.breadcrumb)}
        <div class="page-body">
          <div class="page-header">
            <div>
              <div class="breadcrumb-custom mb-1" id="pageBreadcrumb">${(opts.breadcrumb||[]).map((c,i)=> i===opts.breadcrumb.length-1 ? `<span>${c.label}</span>` : `<a href="${c.href}">${c.label}</a> <i class="bi bi-chevron-right mx-1" style="font-size:.55rem"></i>`).join('')}</div>
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
  }

  function setBreadcrumb(crumbs){
    const el = document.getElementById('pageBreadcrumb');
    if(!el) return;
    el.innerHTML = crumbs.map((c,i)=> i===crumbs.length-1 ? `<span>${c.label}</span>` : `<a href="${c.href}">${c.label}</a> <i class="bi bi-chevron-right mx-1" style="font-size:.55rem"></i>`).join('');
  }

  function toggleSidebarMobile(){ document.getElementById('app-shell').classList.toggle('sidebar-open'); }
  function toggleNavSection(btn, label){
    const group = btn.closest('.nav-section-group');
    const collapsed = group.classList.toggle('collapsed');
    btn.setAttribute('aria-expanded', String(!collapsed));
    localStorage.setItem('hop_navsec_'+label, collapsed ? '1' : '0');
  }
  function toggleTheme(){ setTheme(getTheme()==='light'?'dark':'light'); }

  function logout(){
    sessionStorage.removeItem('hop_session');
    localStorage.removeItem('hop_session');
    location.href = 'index.html';
  }

  function toast(title, msg, type='success'){
    const stack = document.getElementById('toast-stack');
    if(!stack) return;
    const icons = {success:'bi-check-circle-fill', danger:'bi-x-circle-fill', warn:'bi-exclamation-triangle-fill', info:'bi-info-circle-fill'};
    const colors = {success:'var(--success)', danger:'var(--danger)', warn:'var(--warn)', info:'var(--brand-500)'};
    const el = document.createElement('div');
    el.className = `toast-custom ${type}`;
    el.innerHTML = `<i class="bi ${icons[type]||icons.info}" style="color:${colors[type]||colors.info}"></i>
      <div><div class="t-title">${title}</div><div class="t-msg">${msg}</div></div>
      <button class="btn-close ms-auto" style="font-size:.65rem" onclick="this.closest('.toast-custom').remove()"></button>`;
    stack.appendChild(el);
    setTimeout(()=>{ el.style.transition='opacity .3s ease, transform .3s ease'; el.style.opacity='0'; el.style.transform='translateX(30px)'; setTimeout(()=>el.remove(),300); }, 4000);
  }

  function confirmModal(opts){
    // opts: {title, message, confirmText, danger, onConfirm}
    let modalEl = document.getElementById('globalConfirmModal');
    if(modalEl) modalEl.remove();
    const div = document.createElement('div');
    div.innerHTML = `
    <div class="modal fade" id="globalConfirmModal" tabindex="-1">
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content" style="border-radius:18px;border:none">
          <div class="modal-body p-4 text-center">
            <div class="mx-auto mb-3 d-flex align-items-center justify-content-center" style="width:60px;height:60px;border-radius:16px;background:${opts.danger?'#fff0f1':'#eef4ff'}">
              <i class="bi ${opts.danger?'bi-trash3':'bi-question-circle'}" style="font-size:1.6rem;color:${opts.danger?'var(--danger)':'var(--brand-500)'}"></i>
            </div>
            <h5 class="fw-bold mb-2">${opts.title}</h5>
            <p class="text-muted small mb-4">${opts.message}</p>
            <div class="d-flex gap-2 justify-content-center">
              <button class="btn btn-light px-4" data-bs-dismiss="modal">Cancel</button>
              <button class="btn ${opts.danger?'btn-danger':'btn-primary'} px-4" id="confirmModalBtn">${opts.confirmText||'Confirm'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    document.body.appendChild(div);
    const modal = new bootstrap.Modal(document.getElementById('globalConfirmModal'));
    document.getElementById('confirmModalBtn').onclick = ()=>{ opts.onConfirm && opts.onConfirm(); modal.hide(); };
    modal.show();
  }

  function fmtCurrency(n){
    const s = DB.settings.get();
    return (s.currencySymbol||'₹') + Number(n||0).toLocaleString('en-IN');
  }
  function fmtDateReadable(dateStr){
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'});
  }
  function qs(name){ return new URLSearchParams(location.search).get(name); }

  return { mount, setBreadcrumb, toggleSidebarMobile, toggleNavSection, toggleTheme, logout, toast, confirmModal, fmtCurrency, fmtDateReadable, qs, requireAuth, initTheme, getTheme, setTheme };
})();

// apply theme ASAP even before DOM mount to avoid flash
document.documentElement.setAttribute('data-theme', localStorage.getItem('hop_theme') || 'light');
