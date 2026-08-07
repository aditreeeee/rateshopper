/* ==========================================================================
   Universal Search — the topbar search box on both portals now actually
   searches, instead of being a decorative input with no wiring at all.

   Company portal: Properties, Cities, Users, Rooms, Rate Plans, Channels,
   and a "Pages" group (typing a feature name like "reports" or "settings"
   jumps straight there) — everything scoped through RBAC.filterProperties()/
   visibleUsers() so a Property Owner viewing this chrome (see mountForRole)
   only ever sees what they're already allowed to see elsewhere in the app.

   Property portal: the active property itself ("Hotel"), its Rooms, Rate
   Plans, Channels, Competitors, and the same kind of "Pages" shortcut group
   (Reports, Forecast & Actions, Comparison, etc.) — scoped to just this one
   property, since the portal itself only ever operates on one.
   ========================================================================== */
const GLOBAL_SEARCH = (() => {
  const RESULT_CAP_PER_GROUP = 5;
  // Fixed display order — independent of which group happened to find matches first, so the
  // dropdown never reshuffles from one keystroke to the next.
  const GROUP_ORDER = ['Hotel','Properties','Rooms','Rate Plans','Channels','Competitors','Users','Cities','Pages'];

  function norm(s){ return String(s||'').toLowerCase(); }
  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function push(results, group, cap, item){
    if(results.filter(r=>r.group===group).length >= cap) return;
    results.push({ group, ...item });
  }
  function sortByGroupOrder(results){
    return [...results].sort((a,b)=> GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
  }

  const COMPANY_PAGES = [
    { label:'Dashboard', icon:'bi-grid-1x2-fill', href:'dashboard.html', keywords:'dashboard home overview portfolio' },
    { label:'Properties', icon:'bi-building', href:'properties.html', keywords:'properties hotels portfolio list' },
    { label:'Users', icon:'bi-people', href:'users.html', keywords:'users accounts staff team roles' },
    { label:'Settings', icon:'bi-gear', href:'settings.html', keywords:'settings preferences company currency notifications' },
    { label:'Activity Log', icon:'bi-clock-history', href:'notifications.html', keywords:'notifications alerts activity log' },
    { label:'My Profile', icon:'bi-person-circle', href:'profile.html', keywords:'profile account password' }
  ];
  const PROPERTY_PAGES = [
    { label:'Rate Intelligence Dashboard', icon:'bi-speedometer2', href:'property-dashboard.html', keywords:'dashboard home overview rate intelligence health' },
    { label:'Rate Shopper', icon:'bi-search', href:'property-rate-shopper.html', keywords:'rate shopper shopping channel price trend' },
    { label:'Comparison', icon:'bi-columns-gap', href:'property-room-comparison.html', keywords:'comparison room rate plan trend value proposition channel analysis' },
    { label:'Forecast & Actions', icon:'bi-globe-americas', href:'property-market.html', keywords:'forecast actions market intelligence recommendations pricing action center' },
    { label:'Reports', icon:'bi-file-earmark-bar-graph', href:'property-reports.html', keywords:'reports export competitor rate comparison historical trend parity market summary' },
    { label:'My Property', icon:'bi-building-gear', href:'property-details.html', keywords:'my property details rooms channels rate plans contact overview', dynamicId:true },
    { label:'Competitors', icon:'bi-building', href:'property-competitors.html', keywords:'competitors comparison mapping tracked properties' },
    { label:'Settings', icon:'bi-gear', href:'property-settings.html', keywords:'settings preferences alerts' },
    { label:'My Profile', icon:'bi-person-circle', href:'profile.html', keywords:'profile account password' }
  ];

  // ---- Company portal ----
  function searchCompany(query){
    const q = norm(query).trim();
    if(!q) return [];
    const results = [];
    const props = RBAC.filterProperties(DB.properties.all());

    props.forEach(p=>{
      const hay = norm([p.name, p.city, p.country, p.type, p.brand, p.code, p.hmsPropertyId].join(' '));
      if(hay.includes(q)){
        push(results, 'Properties', RESULT_CAP_PER_GROUP, {
          icon:'bi-building', label:p.name, sub:`${p.city||''}${p.country?', '+p.country:''}`,
          href:`property-details.html?id=${p.id}`
        });
      }
    });

    [...new Set(props.map(p=>p.city).filter(Boolean))].forEach(city=>{
      if(norm(city).includes(q)){
        push(results, 'Cities', RESULT_CAP_PER_GROUP, {
          icon:'bi-geo-alt', label:city, sub:'View properties in this city',
          href:`properties.html?city=${encodeURIComponent(city)}`
        });
      }
    });

    RBAC.visibleUsers().forEach(u=>{
      const hay = norm([u.name, u.email, u.hmsUserId].join(' '));
      if(hay.includes(q)){
        push(results, 'Users', RESULT_CAP_PER_GROUP, {
          icon:'bi-person', label:u.name, sub:u.email,
          href:`users.html?q=${encodeURIComponent(u.name)}`
        });
      }
    });

    props.forEach(p=>{
      DB.rooms.byProperty(p.id).forEach(r=>{
        if(norm(r.name).includes(q)){
          push(results, 'Rooms', RESULT_CAP_PER_GROUP, {
            icon:'bi-door-open', label:r.name, sub:p.name, href:`property-details.html?id=${p.id}&tab=rooms`
          });
        }
      });
      DB.ratePlans.byProperty(p.id).forEach(rp=>{
        if(norm(rp.name).includes(q)){
          push(results, 'Rate Plans', RESULT_CAP_PER_GROUP, {
            icon:'bi-tags', label:rp.name, sub:p.name, href:`property-details.html?id=${p.id}&tab=rateplans`
          });
        }
      });
      DB.channels.byProperty(p.id).forEach(c=>{
        if(norm(c.name).includes(q)){
          push(results, 'Channels', RESULT_CAP_PER_GROUP, {
            icon:'bi-diagram-3', label:c.name, sub:p.name, href:`property-details.html?id=${p.id}&tab=channels`
          });
        }
      });
    });

    COMPANY_PAGES.forEach(pg=>{
      if(norm(pg.label+' '+pg.keywords).includes(q)){
        push(results, 'Pages', RESULT_CAP_PER_GROUP, { icon:pg.icon, label:pg.label, sub:'Go to page', href:pg.href });
      }
    });

    return sortByGroupOrder(results);
  }

  // ---- Property portal — scoped to the one active property ----
  function searchProperty(query, propertyId){
    const q = norm(query).trim();
    if(!q) return [];
    const results = [];
    const p = DB.properties.get(propertyId);
    if(!p) return [];

    if(norm([p.name, p.city, p.country, p.hmsPropertyId].join(' ')).includes(q)){
      push(results, 'Hotel', 1, { icon:'bi-building', label:p.name, sub:`${p.city||''}${p.country?', '+p.country:''}`, href:`property-details.html?id=${p.id}` });
    }
    DB.rooms.byProperty(p.id).forEach(r=>{
      if(norm(r.name).includes(q)){
        push(results, 'Rooms', RESULT_CAP_PER_GROUP, { icon:'bi-door-open', label:r.name, sub:p.name, href:`property-details.html?id=${p.id}&tab=rooms` });
      }
    });
    DB.ratePlans.byProperty(p.id).forEach(rp=>{
      if(norm(rp.name).includes(q)){
        push(results, 'Rate Plans', RESULT_CAP_PER_GROUP, { icon:'bi-tags', label:rp.name, sub:p.name, href:`property-details.html?id=${p.id}&tab=rateplans` });
      }
    });
    DB.channels.byProperty(p.id).forEach(c=>{
      if(norm(c.name).includes(q)){
        push(results, 'Channels', RESULT_CAP_PER_GROUP, { icon:'bi-diagram-3', label:c.name, sub:p.name, href:`property-details.html?id=${p.id}&tab=channels` });
      }
    });
    if(typeof PORTALDATA !== 'undefined'){
      PORTALDATA.competitors(p.id).forEach(c=>{
        const hay = norm([c.name, c.city, c.country].join(' '));
        if(hay.includes(q)){
          push(results, 'Competitors', RESULT_CAP_PER_GROUP, {
            icon:'bi-building-fill', label:c.name, sub:c.city ? `${c.city}${c.country?', '+c.country:''}` : 'Tracked competitor',
            href:'property-competitors.html'
          });
        }
      });
    }
    PROPERTY_PAGES.forEach(pg=>{
      if(norm(pg.label+' '+pg.keywords).includes(q)){
        push(results, 'Pages', RESULT_CAP_PER_GROUP, {
          icon:pg.icon, label:pg.label, sub:'Go to page', href: pg.dynamicId ? `${pg.href}?id=${p.id}` : pg.href
        });
      }
    });

    return sortByGroupOrder(results);
  }

  // ---- Dropdown wiring — shared by both portals' topbars ----
  function renderResults(container, results, query){
    if(!query.trim()){ container.innerHTML = ''; container.classList.add('d-none'); return; }
    if(!results.length){
      container.innerHTML = `<div class="gs-empty"><i class="bi bi-search me-2"></i>No matches for "${escapeHtml(query)}"</div>`;
      container.classList.remove('d-none');
      return;
    }
    let lastGroup = null;
    container.innerHTML = results.map(r=>{
      const groupHeader = r.group!==lastGroup ? `<div class="gs-group-label">${escapeHtml(r.group)}</div>` : '';
      lastGroup = r.group;
      return `${groupHeader}<a class="gs-item" href="${r.href}">
        <span class="gs-item-icon"><i class="bi ${r.icon}"></i></span>
        <span class="gs-item-body">
          <span class="gs-item-title">${escapeHtml(r.label)}</span>
          ${r.sub ? `<span class="gs-item-sub">${escapeHtml(r.sub)}</span>` : ''}
        </span>
      </a>`;
    }).join('');
    container.classList.remove('d-none');
  }

  function wire(inputEl, resultsEl, searchFn){
    if(!inputEl || !resultsEl) return;
    let debounceTimer = null;
    inputEl.addEventListener('input', function(){
      clearTimeout(debounceTimer);
      const value = this.value;
      debounceTimer = setTimeout(()=> renderResults(resultsEl, searchFn(value), value), 120);
    });
    inputEl.addEventListener('focus', function(){
      if(this.value.trim()) renderResults(resultsEl, searchFn(this.value), this.value);
    });
    inputEl.addEventListener('keydown', function(e){
      if(e.key === 'Escape'){ resultsEl.classList.add('d-none'); this.blur(); }
    });
    document.addEventListener('click', e=>{
      if(!inputEl.contains(e.target) && !resultsEl.contains(e.target)) resultsEl.classList.add('d-none');
    });
  }

  return { searchCompany, searchProperty, wire };
})();
