let selectedUsers = new Set(); // ids currently checked for bulk actions — reset whenever the filtered list changes shape
const USERS_PAGE_SIZE = 10;
let usersPage = 0;

document.addEventListener('DOMContentLoaded', ()=>{
  if(!RBAC.requireModuleAccess(RBAC.MODULES.USERS, 'view')) return;

  const canCreate = RBAC.creatableRoles().length > 0;

  APP.mount({
    title:'Users', subtitle:'Manage the accounts that can sign in and what they can access.',
    breadcrumb:[{label:'Home',href:'dashboard.html'},{label:'Users'}],
    actions: canCreate ? `<a href="add-user.html" class="btn btn-primary"><i class="bi bi-plus-lg me-1"></i>Add User</a>` : ''
  });

  const roles = [...new Set(RBAC.visibleUsers().map(u=>u.role))];
  document.getElementById('roleFilter').innerHTML += roles.map(r=>`<option value="${r}">${RBAC.ROLE_LABELS[r]}</option>`).join('');

  function onFilterChange(){ usersPage = 0; selectedUsers.clear(); render(); }
  ['searchInput','roleFilter','statusFilter','sortBy'].forEach(id=>{
    document.getElementById(id).addEventListener('input', onFilterChange);
    document.getElementById(id).addEventListener('change', onFilterChange);
  });

  document.getElementById('prevPageBtn').addEventListener('click', ()=>{ usersPage = Math.max(0, usersPage-1); render(); });
  document.getElementById('nextPageBtn').addEventListener('click', ()=>{ usersPage++; render(); });

  document.getElementById('selectAllCheckbox').addEventListener('change', function(){
    const tbody = document.getElementById('usersBody');
    if(this.checked) tbody.querySelectorAll('[data-select-id]').forEach(el=>selectedUsers.add(el.dataset.selectId));
    else tbody.querySelectorAll('[data-select-id]').forEach(el=>selectedUsers.delete(el.dataset.selectId));
    render();
  });
  document.getElementById('bulkClearBtn').addEventListener('click', ()=>{ selectedUsers.clear(); render(); });
  document.getElementById('bulkActivateBtn').addEventListener('click', ()=>bulkSetUserStatus('active'));
  document.getElementById('bulkDeactivateBtn').addEventListener('click', ()=>bulkSetUserStatus('inactive'));
  document.getElementById('bulkDeleteBtn').addEventListener('click', bulkDeleteUsers);

  render();
});

function toggleSelectUser(id, checked){
  if(checked) selectedUsers.add(id); else selectedUsers.delete(id);
  render();
}

// Bulk operations only ever touch users RBAC.canManageUser() actually allows this admin to
// manage — same rule the per-row Edit/Delete buttons already enforce — so a mixed selection
// silently skips anything out of scope instead of failing the whole batch.
function manageableSelection(){
  return [...selectedUsers].map(id=>DB.users.get(id)).filter(u=>u && RBAC.canManageUser(u));
}

function bulkSetUserStatus(status){
  const targets = manageableSelection();
  if(!targets.length){ APP.toast('Not Allowed', 'None of the selected users are manageable from this account.', 'danger'); return; }
  targets.forEach(u=> DB.users.save({...u, status}));
  APP.toast('Users Updated', `${targets.length} user(s) marked ${status}.`, 'success');
  selectedUsers.clear();
  render();
}

function bulkDeleteUsers(){
  const targets = manageableSelection();
  if(!targets.length){ APP.toast('Not Allowed', 'None of the selected users are manageable from this account.', 'danger'); return; }
  APP.confirmModal({
    title:'Delete Users?', message:`Remove ${targets.length} selected user(s)? They will immediately lose access. This action cannot be undone.`,
    confirmText:'Delete', danger:true,
    onConfirm: ()=>{
      targets.forEach(u=> DB.users.remove(u.id));
      APP.toast('Users Removed', `${targets.length} user(s) deleted.`, 'danger');
      selectedUsers.clear();
      render();
    }
  });
}

function render(){
  let list = RBAC.visibleUsers();

  // Per-role summary — a quick "who's on this account" overview independent of whatever's
  // currently filtered/searched, so switching filters to inspect one role never costs you the
  // overall picture. Each chip doubles as a shortcut into that role's filtered view.
  const roleFilterEl = document.getElementById('roleFilter');
  const roleCounts = {};
  list.forEach(u=>{ roleCounts[u.role] = (roleCounts[u.role]||0)+1; });
  document.getElementById('roleSummary').innerHTML = Object.keys(roleCounts).sort().map(r=>
    `<button type="button" class="badge bg-primary-subtle text-primary border-0" style="cursor:pointer" onclick="document.getElementById('roleFilter').value='${r}'; document.getElementById('roleFilter').dispatchEvent(new Event('change'));">${RBAC.ROLE_LABELS[r]}: ${roleCounts[r]}</button>`
  ).join('') + `<span class="badge bg-light text-dark border">Total: ${list.length}</span>`;

  const search = document.getElementById('searchInput').value.toLowerCase();
  const role = roleFilterEl.value;
  const status = document.getElementById('statusFilter').value;
  const sort = document.getElementById('sortBy').value;

  if(search) list = list.filter(u=> u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search));
  if(role) list = list.filter(u=> u.role===role);
  if(status) list = list.filter(u=> u.status===status);

  if(sort==='name') list.sort((a,b)=>a.name.localeCompare(b.name));
  if(sort==='role') list.sort((a,b)=> RBAC.ROLE_LABELS[a.role].localeCompare(RBAC.ROLE_LABELS[b.role]) || a.name.localeCompare(b.name));
  if(sort==='status') list.sort((a,b)=> a.status.localeCompare(b.status) || a.name.localeCompare(b.name));
  if(sort==='newest') list.sort((a,b)=> (b.createdAt||'').localeCompare(a.createdAt||''));

  document.getElementById('resultsCount').textContent = `${list.length} user(s) found`;

  const tbody = document.getElementById('usersBody');
  const empty = document.getElementById('emptyState');

  // Selections on ids no longer in the filtered list at all get dropped; selections on OTHER
  // pages of the same filtered list are deliberately left alone.
  const visibleIds = new Set(list.map(u=>u.id));
  [...selectedUsers].forEach(id=>{ if(!visibleIds.has(id)) selectedUsers.delete(id); });

  const totalPages = Math.max(1, Math.ceil(list.length / USERS_PAGE_SIZE));
  usersPage = Math.min(usersPage, totalPages-1);
  const pageStart = usersPage * USERS_PAGE_SIZE;
  const pageRows = list.slice(pageStart, pageStart + USERS_PAGE_SIZE);

  document.getElementById('pageInfo').textContent = list.length
    ? `Showing ${pageStart+1}-${Math.min(pageStart+USERS_PAGE_SIZE, list.length)} of ${list.length}` : '';
  document.getElementById('prevPageBtn').disabled = usersPage<=0;
  document.getElementById('nextPageBtn').disabled = usersPage>=totalPages-1;
  document.getElementById('paginationBar').classList.toggle('d-none', !list.length);

  const pageManageableIds = new Set(pageRows.filter(u=>RBAC.canManageUser(u)).map(u=>u.id));
  document.getElementById('selectAllWrap').classList.toggle('d-none', pageManageableIds.size===0);
  document.getElementById('selectAllCheckbox').checked = pageManageableIds.size>0 && [...pageManageableIds].every(id=>selectedUsers.has(id));
  const bulkBar = document.getElementById('bulkBar');
  bulkBar.classList.toggle('d-none', selectedUsers.size===0);
  document.getElementById('bulkCount').textContent = `${selectedUsers.size} selected`;

  if(!list.length){
    tbody.innerHTML=''; empty.classList.remove('d-none');
    empty.innerHTML = `<div class="empty-state"><i class="bi bi-people"></i><h5>No users found</h5><p class="mb-0">Try adjusting your filters.</p></div>`;
    return;
  }
  empty.classList.add('d-none');

  tbody.innerHTML = pageRows.map(u=>{
    const isCompanyLevel = u.role==='company_admin';
    const manageable = RBAC.canManageUser(u);
    let parentCell, competitorsCell;
    if(isCompanyLevel){
      parentCell = '<span class="text-muted small">All properties</span>';
      competitorsCell = '<span class="text-muted small">—</span>';
    } else {
      const parent = DB.properties.get(u.parentPropertyId);
      parentCell = parent ? `<span class="badge bg-primary-subtle text-primary">${parent.name}</span>` : '<span class="text-muted">—</span>';
      const compNames = (u.assignedProperties||[]).filter(id=>id!==u.parentPropertyId).map(id=>{ const p=DB.properties.get(id); return p?p.name:null; }).filter(Boolean);
      competitorsCell = compNames.length ? compNames.map(n=>`<span class="badge bg-light text-dark border me-1">${n}</span>`).join('') : '<span class="text-muted">—</span>';
    }
    return `<tr data-select-id="${u.id}">
      <td>${manageable ? `<input class="form-check-input" type="checkbox" ${selectedUsers.has(u.id)?'checked':''} onchange="toggleSelectUser('${u.id}', this.checked)">` : ''}</td>
      <td><div class="d-flex align-items-center gap-2"><img src="${u.avatar}" class="avatar-thumb"><div><div class="fw-semibold">${u.name}</div><div class="text-muted" style="font-size:.75rem">${u.email}</div></div></div></td>
      <td><span class="badge bg-primary-subtle text-primary">${RBAC.ROLE_LABELS[u.role]}</span></td>
      <td>${parentCell}</td>
      <td>${competitorsCell}</td>
      <td><span class="badge-status ${u.status==='active'?'badge-active':'badge-inactive'}">${u.status}</span></td>
      <td class="text-end">
        ${manageable ? `
          <a href="add-user.html?id=${u.id}" class="btn btn-sm-icon btn-outline-primary" title="Edit"><i class="bi bi-pencil"></i></a>
          <button class="btn btn-sm-icon btn-light-danger" title="Delete" onclick="deleteUser('${u.id}')"><i class="bi bi-trash3"></i></button>
        ` : `<span class="text-muted small">No access</span>`}
      </td>
    </tr>`;
  }).join('');
}

function deleteUser(id){
  const u = DB.users.get(id);
  if(!RBAC.canManageUser(u)){ APP.toast('Not Allowed', 'You do not have permission to remove this user.', 'danger'); return; }
  APP.confirmModal({
    title:'Delete User?', message:`Remove "${u.name}" (${RBAC.ROLE_LABELS[u.role]})? They will immediately lose access.`,
    confirmText:'Delete', danger:true,
    onConfirm: ()=>{ DB.users.remove(id); APP.toast('User Removed', `${u.name} has been deleted.`, 'danger'); render(); }
  });
}
