document.addEventListener('DOMContentLoaded', ()=>{
  const editId = APP.qs('id');
  const existing = editId ? DB.users.get(editId) : null;

  if(existing && !RBAC.canManageUser(existing)){
    location.href = 'users.html';
    return;
  }
  if(!existing && RBAC.creatableRoles().length === 0){
    location.href = 'users.html';
    return;
  }

  APP.mount({
    title: existing ? 'Edit User' : 'Add New User',
    subtitle: existing ? `Update access for ${existing.name}` : 'Create a new account and control exactly what it can access.',
    breadcrumb:[{label:'Home',href:'dashboard.html'},{label:'Users',href:'users.html'},{label: existing?'Edit':'Add New'}]
  });

  const roleSelect = document.getElementById('f_role');
  const allowedRoles = RBAC.creatableRoles();
  // Editing never lets you escalate a role beyond what you're allowed to grant, but the
  // record's current role must still be selectable even if it's the only option.
  const roleOptions = existing && !allowedRoles.includes(existing.role) ? [existing.role, ...allowedRoles] : allowedRoles;
  roleSelect.innerHTML = roleOptions.map(r=>`<option value="${r}">${RBAC.ROLE_LABELS[r]}</option>`).join('');
  if(existing) roleSelect.disabled = true; // role/hierarchy is fixed once created in this demo

  const me = RBAC.currentUser();
  const propertyPool = RBAC.isCompanyLevel() ? DB.properties.all() : DB.properties.all().filter(p=> RBAC.assignedPropertyIds().includes(p.id));

  function refreshRoleDependentUI(){
    const role = roleSelect.value;
    const isOwner = role === RBAC.ROLES.PROPERTY_OWNER;
    const needsProperties = role === RBAC.ROLES.PROPERTY_USER || isOwner; // legacy Property User (single) + Property Owner (multi)
    const needsPermissions = role === RBAC.ROLES.PROPERTY_USER;

    // Property Owner gets split First/Last Name instead of one Full Name field.
    document.getElementById('f_nameWrap').classList.toggle('d-none', isOwner);
    document.getElementById('f_name').required = !isOwner;
    document.getElementById('f_firstNameWrap').classList.toggle('d-none', !isOwner);
    document.getElementById('f_lastNameWrap').classList.toggle('d-none', !isOwner);
    document.getElementById('f_firstName').required = isOwner;
    document.getElementById('f_lastName').required = isOwner;

    document.getElementById('ownerParentPropertyCard').classList.toggle('d-none', !isOwner);
    const parentSel = document.getElementById('f_ownerParentProperty');
    if(isOwner){
      const ownerPool = RBAC.isCompanyLevel() ? DB.properties.all() : propertyPool;
      parentSel.innerHTML = ownerPool.length ? ownerPool.map(p=>`<option value="${p.id}">${p.name}</option>`).join('') : `<option value="">No properties available</option>`;
      if(existing && existing.parentPropertyId) parentSel.value = existing.parentPropertyId;
    }

    document.getElementById('propertyAssignmentCard').classList.toggle('d-none', !needsProperties);
    document.getElementById('propertyAssignmentTitle').textContent = isOwner ? 'Comparison Properties' : 'Assigned Properties';
    document.getElementById('propertyAssignmentHint').textContent = isOwner
      ? "Optionally select other properties to benchmark this owner's rates against in their Rate Shopper portal. Their own Parent Property never appears here — it can't be a comparison for itself. This does not grant management access — only their Parent Property does."
      : 'Select the single property this Property User works at.';

    refreshComparisonGrid();
    parentSel.onchange = refreshComparisonGrid; // Parent Property choice excludes itself from the grid below

    document.getElementById('permissionsCard').classList.toggle('d-none', !needsPermissions);
    if(needsPermissions){
      const grant = (existing && existing.permissions) || {};
      document.getElementById('permissionsBody').innerHTML = RBAC.ASSIGNABLE_MODULES.map(mod=>{
        const g = grant[mod] || {view:true, create:false, edit:false, delete:false};
        return `<tr>
          <td class="fw-semibold">${RBAC.MODULE_LABELS[mod]}</td>
          ${['view','create','edit','delete'].map(action=>`
            <td class="text-center"><input type="checkbox" class="form-check-input perm-check" data-mod="${mod}" data-action="${action}" ${g[action]?'checked':''}></td>
          `).join('')}
        </tr>`;
      }).join('');
    }
  }

  function refreshComparisonGrid(){
    const role = roleSelect.value;
    const isOwner = role === RBAC.ROLES.PROPERTY_OWNER;
    const excludeId = isOwner ? document.getElementById('f_ownerParentProperty').value : null;
    const pool = excludeId ? propertyPool.filter(p=>p.id!==excludeId) : propertyPool;

    document.getElementById('propertyAssignmentGrid').innerHTML = pool.length ? pool.map(p=>{
      const checked = existing && (existing.assignedProperties||[]).includes(p.id);
      const inputType = role === RBAC.ROLES.PROPERTY_USER ? 'radio' : 'checkbox';
      return `<div class="col-md-6">
        <label class="d-flex align-items-center gap-2 p-2 border rounded-3" style="border-color:var(--border-1) !important">
          <input type="${inputType}" name="propertyAssign" class="form-check-input property-assign-check" value="${p.id}" ${checked?'checked':''}>
          <span style="font-size:.85rem">${p.name}</span>
        </label>
      </div>`;
    }).join('') : `<div class="col-12 text-muted small">No properties available to assign.</div>`;
  }

  if(existing){
    document.getElementById('submitLabel').textContent = 'Update User';
    document.getElementById('f_name').value = existing.name;
    document.getElementById('f_firstName').value = existing.firstName || (existing.name||'').split(' ')[0] || '';
    document.getElementById('f_lastName').value = existing.lastName || (existing.name||'').split(' ').slice(1).join(' ') || '';
    document.getElementById('f_email').value = existing.email;
    document.getElementById('f_password').value = existing.password;
    roleSelect.value = existing.role;
    document.getElementById('f_status').value = existing.status;
  } else {
    roleSelect.value = allowedRoles[0];
  }
  refreshRoleDependentUI();
  roleSelect.addEventListener('change', refreshRoleDependentUI);

  document.getElementById('userForm').addEventListener('submit', function(e){
    e.preventDefault();
    if(!this.checkValidity()){ this.reportValidity(); return; }

    const email = document.getElementById('f_email').value.trim();
    const dupe = DB.users.byEmail(email);
    if(dupe && (!existing || dupe.id !== existing.id)){
      APP.toast('Email Already In Use', 'Another account already uses that email address.', 'danger');
      return;
    }

    const role = roleSelect.value;
    const isOwner = role === RBAC.ROLES.PROPERTY_OWNER;
    const needsProperties = role === RBAC.ROLES.PROPERTY_USER || isOwner; // legacy Property User (single) + Property Owner (multi)

    let assignedProperties = needsProperties
      ? [...document.querySelectorAll('.property-assign-check:checked')].map(c=>c.value)
      : [];

    if(role === RBAC.ROLES.PROPERTY_USER && !assignedProperties.length){
      APP.toast('No Property Assigned', 'Select at least one property for this role.', 'danger');
      return;
    }

    let firstName = '', lastName = '', fullName = '';
    if(isOwner){
      firstName = document.getElementById('f_firstName').value.trim();
      lastName = document.getElementById('f_lastName').value.trim();
      if(!firstName || !lastName){ APP.toast('Missing Name', 'Enter both First Name and Last Name.', 'danger'); return; }
      fullName = `${firstName} ${lastName}`;
    } else {
      fullName = document.getElementById('f_name').value.trim();
    }

    let ownerParentPropertyId = null;
    if(isOwner){
      ownerParentPropertyId = document.getElementById('f_ownerParentProperty').value;
      if(!ownerParentPropertyId){ APP.toast('No Parent Property', "Select this Property Owner's own hotel.", 'danger'); return; }
      // A property can never be its own comparison target.
      assignedProperties = assignedProperties.filter(id=> id !== ownerParentPropertyId);
    }

    const parentPropertyId = isOwner ? ownerParentPropertyId : null;

    let permissions = null;
    if(role === RBAC.ROLES.PROPERTY_USER){
      permissions = {};
      RBAC.ASSIGNABLE_MODULES.forEach(mod=>{
        permissions[mod] = {
          view: document.querySelector(`.perm-check[data-mod="${mod}"][data-action="view"]`).checked,
          create: document.querySelector(`.perm-check[data-mod="${mod}"][data-action="create"]`).checked,
          edit: document.querySelector(`.perm-check[data-mod="${mod}"][data-action="edit"]`).checked,
          delete: document.querySelector(`.perm-check[data-mod="${mod}"][data-action="delete"]`).checked
        };
      });
    }

    const payload = {
      id: existing ? existing.id : undefined,
      name: fullName,
      firstName: isOwner ? firstName : (existing ? existing.firstName : undefined),
      lastName: isOwner ? lastName : (existing ? existing.lastName : undefined),
      email,
      password: document.getElementById('f_password').value,
      role,
      status: document.getElementById('f_status').value,
      assignedProperties,
      parentPropertyId,
      permissions,
      createdBy: existing ? existing.createdBy : me.id,
      avatar: existing ? existing.avatar : `https://ui-avatars.com/api/?name=${encodeURIComponent(fullName)}&background=3861fb&color=fff&size=200`,
      phone: existing ? existing.phone : '',
      bio: existing ? existing.bio : ''
    };

    const saved = DB.users.save(payload);
    APP.toast(existing?'User Updated':'User Created', `${saved.name} has been ${existing?'updated':'created'} as ${RBAC.ROLE_LABELS[saved.role]}.`, 'success');
    setTimeout(()=> location.href='users.html', 700);
  });
});
