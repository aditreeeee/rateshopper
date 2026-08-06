let currentView = 'list';
let canEditProperties = false;
let canDeleteProperties = false;
let selectedProperties = new Set(); // ids currently checked for bulk actions — reset whenever the filtered list changes shape
const PROPERTIES_PAGE_SIZE = 12;
let propPage = 0;

document.addEventListener('DOMContentLoaded', ()=>{
  if(!RBAC.requireModuleAccess(RBAC.MODULES.PROPERTIES, 'view')) return;
  canEditProperties = RBAC.can(RBAC.MODULES.PROPERTIES, 'edit');
  canDeleteProperties = RBAC.can(RBAC.MODULES.PROPERTIES, 'delete');

  PORTAL.mountForRole({
    title:'Properties', subtitle:'Manage all your hotel properties in one place.',
    breadcrumb:[{label:'Home',href:'dashboard.html'},{label:'Properties'}],
    actions: RBAC.can(RBAC.MODULES.PROPERTIES, 'create') ? `<a href="add-property.html" class="btn btn-primary"><i class="bi bi-plus-lg me-1"></i>Add Property</a>` : ''
  });

  const types = [...new Set(RBAC.filterProperties(DB.properties.all()).map(p=>p.type))];
  document.getElementById('typeFilter').innerHTML += types.map(t=>`<option value="${t}">${t}</option>`).join('');

  const countries = [...new Set(RBAC.filterProperties(DB.properties.all()).map(p=>p.country).filter(Boolean))].sort();
  document.getElementById('countryFilter').innerHTML += countries.map(c=>`<option value="${c}">${c}</option>`).join('');
  refreshCityOptions();

  // Deep-link support for the topbar's universal search — a "City" result links here as
  // properties.html?city=X, a "Property" result goes straight to property-details.html instead
  // (no query param needed there), so this is the only param this page needs to honor.
  const qCity = APP.qs('city');
  if(qCity){
    document.getElementById('cityFilter').value = qCity;
    // Country filter drives which cities refreshCityOptions() even offers, so a city whose
    // country isn't selected would silently fail to set — cross-check it actually stuck.
    if(document.getElementById('cityFilter').value !== qCity){
      document.getElementById('countryFilter').value = '';
      refreshCityOptions();
      document.getElementById('cityFilter').value = qCity;
    }
  }

  // Any filter/search/sort change can change which properties are even visible and how many
  // pages there are, so a stale selection (e.g. "3 selected" including rows that just got
  // filtered out) or a stranded page number would be confusing — simplest correct behavior is to
  // reset both back to a clean slate whenever the underlying filters move.
  ['searchInput','statusFilter','typeFilter','sortBy','cityFilter'].forEach(id=>{
    document.getElementById(id).addEventListener('input', onFilterChange);
    document.getElementById(id).addEventListener('change', onFilterChange);
  });
  document.getElementById('countryFilter').addEventListener('change', ()=>{ refreshCityOptions(); onFilterChange(); });
  document.getElementById('viewGrid').addEventListener('click', ()=>{ currentView='grid'; onFilterChange(); });
  document.getElementById('viewList').addEventListener('click', ()=>{ currentView='list'; onFilterChange(); });
  document.getElementById('resetFiltersBtn').addEventListener('click', ()=>{
    document.getElementById('searchInput').value = '';
    document.getElementById('countryFilter').value = '';
    document.getElementById('cityFilter').value = '';
    document.getElementById('typeFilter').value = '';
    document.getElementById('statusFilter').value = '';
    document.getElementById('sortBy').value = 'name';
    refreshCityOptions();
    onFilterChange();
  });

  document.getElementById('prevPageBtn').addEventListener('click', ()=>{ propPage = Math.max(0, propPage-1); render(); });
  document.getElementById('nextPageBtn').addEventListener('click', ()=>{ propPage++; render(); });

  document.getElementById('selectAllCheckbox').addEventListener('change', function(){
    const grid = document.getElementById('propertyGrid');
    if(this.checked) grid.querySelectorAll('[data-select-id]').forEach(el=>selectedProperties.add(el.dataset.selectId));
    else grid.querySelectorAll('[data-select-id]').forEach(el=>selectedProperties.delete(el.dataset.selectId));
    render();
  });
  document.getElementById('bulkClearBtn').addEventListener('click', clearSelection);
  document.getElementById('bulkActivateBtn').addEventListener('click', ()=>bulkSetStatus('active'));
  document.getElementById('bulkDeactivateBtn').addEventListener('click', ()=>bulkSetStatus('inactive'));
  document.getElementById('bulkDeleteBtn').addEventListener('click', bulkDelete);

  render();
});

function onFilterChange(){ propPage = 0; selectedProperties.clear(); render(); }
function clearSelection(){ selectedProperties.clear(); render(); }

function toggleSelect(id, checked){
  if(checked) selectedProperties.add(id); else selectedProperties.delete(id);
  render();
}

function bulkSetStatus(status){
  if(!canEditProperties){ APP.toast('Not Allowed', 'You do not have permission to edit properties.', 'danger'); return; }
  const ids = [...selectedProperties];
  ids.forEach(id=> DB.properties.save({ id, status }));
  APP.toast('Properties Updated', `${ids.length} propert${ids.length===1?'y':'ies'} marked ${status}.`, 'success');
  selectedProperties.clear();
  render();
}

function bulkDelete(){
  if(!canDeleteProperties){ APP.toast('Not Allowed', 'You do not have permission to delete properties.', 'danger'); return; }
  const ids = [...selectedProperties];
  if(!ids.length) return;
  APP.confirmModal({
    title:'Delete Properties?', message:`Delete ${ids.length} selected propert${ids.length===1?'y':'ies'}? This will also remove all their rooms and rate plans. This action cannot be undone.`,
    confirmText:'Delete', danger:true,
    onConfirm: ()=>{
      ids.forEach(id=> DB.properties.remove(id));
      APP.toast('Properties Deleted', `${ids.length} propert${ids.length===1?'y':'ies'} removed.`, 'danger');
      selectedProperties.clear();
      render();
    }
  });
}

function refreshCityOptions(){
  const country = document.getElementById('countryFilter').value;
  const prevCity = document.getElementById('cityFilter').value;
  let cities = RBAC.filterProperties(DB.properties.all());
  if(country) cities = cities.filter(p=>p.country===country);
  cities = [...new Set(cities.map(p=>p.city))].sort();
  document.getElementById('cityFilter').innerHTML = `<option value="">All Cities</option>` + cities.map(c=>`<option value="${c}">${c}</option>`).join('');
  if(cities.includes(prevCity)) document.getElementById('cityFilter').value = prevCity;
}

function render(){
  let list = RBAC.filterProperties(DB.properties.all());
  const search = document.getElementById('searchInput').value.toLowerCase();
  const status = document.getElementById('statusFilter').value;
  const type = document.getElementById('typeFilter').value;
  const country = document.getElementById('countryFilter').value;
  const city = document.getElementById('cityFilter').value;
  const sort = document.getElementById('sortBy').value;

  if(search) list = list.filter(p=>p.name.toLowerCase().includes(search) || p.city.toLowerCase().includes(search));
  if(status) list = list.filter(p=>p.status===status);
  if(type) list = list.filter(p=>p.type===type);
  if(country) list = list.filter(p=>p.country===country);
  if(city) list = list.filter(p=>p.city===city);

  if(sort==='name') list.sort((a,b)=>a.name.localeCompare(b.name));
  if(sort==='rooms') list.sort((a,b)=>b.rooms-a.rooms);
  if(sort==='stars') list.sort((a,b)=>b.stars-a.stars);
  if(sort==='newest') list.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));

  document.getElementById('resultsCount').textContent = `${list.length} propert${list.length===1?'y':'ies'} found`;
  document.getElementById('viewGrid').classList.toggle('btn-soft', currentView==='grid');
  document.getElementById('viewList').classList.toggle('btn-soft', currentView==='list');

  const grid = document.getElementById('propertyGrid');
  const empty = document.getElementById('emptyState');
  const canBulk = canEditProperties || canDeleteProperties;
  // Drop any selected id that's no longer in the current filtered list at all (e.g. it was just
  // deleted, or a filter narrowed the list) so the bulk-bar count never lies — selections on
  // OTHER pages of the same filtered list are deliberately left alone.
  const visibleIds = new Set(list.map(p=>p.id));
  [...selectedProperties].forEach(id=>{ if(!visibleIds.has(id)) selectedProperties.delete(id); });

  const totalPages = Math.max(1, Math.ceil(list.length / PROPERTIES_PAGE_SIZE));
  propPage = Math.min(propPage, totalPages-1);
  const pageStart = propPage * PROPERTIES_PAGE_SIZE;
  const pageRows = list.slice(pageStart, pageStart + PROPERTIES_PAGE_SIZE);

  document.getElementById('pageInfo').textContent = list.length
    ? `Showing ${pageStart+1}-${Math.min(pageStart+PROPERTIES_PAGE_SIZE, list.length)} of ${list.length}` : '';
  document.getElementById('prevPageBtn').disabled = propPage<=0;
  document.getElementById('nextPageBtn').disabled = propPage>=totalPages-1;
  document.getElementById('paginationBar').classList.toggle('d-none', !list.length);

  document.getElementById('selectAllWrap').classList.toggle('d-none', !canBulk);
  document.getElementById('selectAllCheckbox').checked = canBulk && pageRows.length>0 && pageRows.every(p=>selectedProperties.has(p.id));
  const bulkBar = document.getElementById('bulkBar');
  bulkBar.classList.toggle('d-none', !canBulk || selectedProperties.size===0);
  document.getElementById('bulkCount').textContent = `${selectedProperties.size} selected`;
  document.getElementById('bulkActivateBtn').classList.toggle('d-none', !canEditProperties);
  document.getElementById('bulkDeactivateBtn').classList.toggle('d-none', !canEditProperties);
  document.getElementById('bulkDeleteBtn').classList.toggle('d-none', !canDeleteProperties);

  if(!list.length){
    grid.innerHTML=''; grid.classList.add('d-none');
    empty.classList.remove('d-none');
    empty.innerHTML = `<div class="empty-state"><i class="bi bi-building-slash"></i><h5>No properties found</h5><p class="mb-3">Try adjusting your filters or add a new property.</p><a href="add-property.html" class="btn btn-primary"><i class="bi bi-plus-lg me-1"></i>Add Property</a></div>`;
    return;
  }
  empty.classList.add('d-none');
  grid.classList.remove('d-none');

  if(currentView==='grid'){
    grid.innerHTML = pageRows.map(p=>`
      <div class="col-md-6 col-xl-4">
        <div class="property-card h-100" data-select-id="${p.id}">
          <div class="p-cover" style="background-image:url('${p.logo}')">
            ${canBulk ? `<div class="form-check p-select-check"><input class="form-check-input" type="checkbox" ${selectedProperties.has(p.id)?'checked':''} onchange="toggleSelect('${p.id}', this.checked)"></div>` : ''}
            <span class="badge-status ${p.status==='active'?'badge-active':'badge-inactive'} p-badge">${p.status}</span>
          </div>
          <div class="p-body">
            <div class="d-flex justify-content-between align-items-start mb-1">
              <a href="property-details.html?id=${p.id}" class="text-decoration-none"><h6 class="fw-bold mb-0 text-body">${p.name}</h6></a>
              <div class="text-warning" style="font-size:.72rem">${'★'.repeat(p.stars)}${'☆'.repeat(5-p.stars)}</div>
            </div>
            <div class="text-muted mb-1" style="font-size:.68rem"><i class="bi bi-fingerprint me-1"></i>${p.hmsPropertyId||'—'}</div>
            <div class="text-muted small mb-2"><i class="bi bi-geo-alt me-1"></i>${p.city}${p.country?', '+p.country:''} • ${p.type}</div>
            <div class="d-flex gap-3 small text-muted mb-3">
              <span><i class="bi bi-door-open me-1"></i>${p.rooms} rooms</span>
              <span><i class="bi bi-telephone me-1"></i>${p.phone}</span>
            </div>
            <div class="d-flex gap-2">
              <a href="property-details.html?id=${p.id}" class="btn btn-soft btn-sm flex-grow-1">View Details</a>
              ${canEditProperties ? `<a href="add-property.html?id=${p.id}" class="btn btn-sm-icon btn-outline-primary" title="Edit"><i class="bi bi-pencil"></i></a>` : ''}
              ${canDeleteProperties ? `<button class="btn btn-sm-icon btn-light-danger" title="Delete" onclick="deleteProperty('${p.id}')"><i class="bi bi-trash3"></i></button>` : ''}
            </div>
          </div>
        </div>
      </div>`).join('');
  } else {
    grid.innerHTML = `<div class="col-12"><div class="card-surface p-0 overflow-hidden"><table class="table-modern w-100">
      <thead><tr>${canBulk?'<th style="width:36px"></th>':''}<th>Property</th><th>City</th><th>Country</th><th>Type</th><th>Rooms</th><th>Rating</th><th>Status</th><th class="text-end">Actions</th></tr></thead>
      <tbody>${pageRows.map(p=>`
        <tr data-select-id="${p.id}">
          ${canBulk ? `<td><input class="form-check-input" type="checkbox" ${selectedProperties.has(p.id)?'checked':''} onchange="toggleSelect('${p.id}', this.checked)"></td>` : ''}
          <td><a href="property-details.html?id=${p.id}" class="d-flex align-items-center gap-2 text-decoration-none text-body"><img src="${p.logo}" class="avatar-thumb"><div><div class="fw-semibold">${p.name}</div><div class="text-muted" style="font-size:.75rem"><i class="bi bi-fingerprint me-1"></i>${p.hmsPropertyId||'—'}</div></div></a></td>
          <td>${p.city}</td>
          <td>${p.country||'-'}</td>
          <td>${p.type}</td>
          <td>${p.rooms}</td>
          <td class="text-warning">${'★'.repeat(p.stars)}</td>
          <td><span class="badge-status ${p.status==='active'?'badge-active':'badge-inactive'}">${p.status}</span></td>
          <td class="text-end">
            <a href="property-details.html?id=${p.id}" class="btn btn-sm-icon btn-soft" title="View"><i class="bi bi-eye"></i></a>
            ${canEditProperties ? `<a href="add-property.html?id=${p.id}" class="btn btn-sm-icon btn-outline-primary" title="Edit"><i class="bi bi-pencil"></i></a>` : ''}
            ${canDeleteProperties ? `<button class="btn btn-sm-icon btn-light-danger" title="Delete" onclick="deleteProperty('${p.id}')"><i class="bi bi-trash3"></i></button>` : ''}
          </td>
        </tr>`).join('')}</tbody>
    </table></div></div>`;
  }
}

function deleteProperty(id){
  if(!canDeleteProperties){ APP.toast('Not Allowed', 'You do not have permission to delete properties.', 'danger'); return; }
  const p = DB.properties.get(id);
  APP.confirmModal({
    title:'Delete Property?', message:`Are you sure you want to delete "${p.name}"? This will also remove all its rooms and rate plans. This action cannot be undone.`,
    confirmText:'Delete', danger:true,
    onConfirm: ()=>{ DB.properties.remove(id); APP.toast('Property Deleted', `${p.name} has been removed.`, 'danger'); render(); }
  });
}
