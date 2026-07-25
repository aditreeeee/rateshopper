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

  ['searchInput','roleFilter','statusFilter'].forEach(id=>{
    document.getElementById(id).addEventListener('input', render);
    document.getElementById(id).addEventListener('change', render);
  });

  render();
});

function propertyNames(ids){
  if(!ids || !ids.length) return '<span class="text-muted">—</span>';
  const names = ids.map(id=>{ const p = DB.properties.get(id); return p ? p.name : null; }).filter(Boolean);
  if(!names.length) return '<span class="text-muted">—</span>';
  if(names.length <= 2) return names.map(n=>`<span class="badge bg-light text-dark border me-1">${n}</span>`).join('');
  return `<span class="badge bg-light text-dark border me-1">${names[0]}</span><span class="badge bg-light text-dark border">+${names.length-1} more</span>`;
}

function render(){
  let list = RBAC.visibleUsers();
  const search = document.getElementById('searchInput').value.toLowerCase();
  const role = document.getElementById('roleFilter').value;
  const status = document.getElementById('statusFilter').value;

  if(search) list = list.filter(u=> u.name.toLowerCase().includes(search) || u.email.toLowerCase().includes(search));
  if(role) list = list.filter(u=> u.role===role);
  if(status) list = list.filter(u=> u.status===status);

  document.getElementById('resultsCount').textContent = `${list.length} user(s) found`;

  const tbody = document.getElementById('usersBody');
  const empty = document.getElementById('emptyState');
  if(!list.length){
    tbody.innerHTML=''; empty.classList.remove('d-none');
    empty.innerHTML = `<div class="empty-state"><i class="bi bi-people"></i><h5>No users found</h5><p class="mb-0">Try adjusting your filters.</p></div>`;
    return;
  }
  empty.classList.add('d-none');

  tbody.innerHTML = list.map(u=>{
    const isCompanyLevel = u.role==='company_admin';
    const manageable = RBAC.canManageUser(u);
    let propertyCell;
    if(isCompanyLevel){
      propertyCell = '<span class="text-muted small">All properties</span>';
    } else if(u.role==='property_owner'){
      const parent = DB.properties.get(u.parentPropertyId);
      const extraCount = (u.assignedProperties||[]).filter(id=>id!==u.parentPropertyId).length;
      propertyCell = parent
        ? `<span class="badge bg-primary-subtle text-primary me-1">${parent.name}</span>${extraCount?`<span class="badge bg-light text-dark border">+${extraCount} more</span>`:''}`
        : '<span class="text-muted">—</span>';
    } else {
      propertyCell = propertyNames(u.assignedProperties);
    }
    return `<tr>
      <td><div class="d-flex align-items-center gap-2"><img src="${u.avatar}" class="avatar-thumb"><div><div class="fw-semibold">${u.name}</div><div class="text-muted" style="font-size:.75rem">${u.email}</div></div></div></td>
      <td><span class="badge bg-primary-subtle text-primary">${RBAC.ROLE_LABELS[u.role]}</span></td>
      <td>${propertyCell}</td>
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
