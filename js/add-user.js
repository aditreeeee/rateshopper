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

  let parentFinder = null; // single-select PropertyFinder — the Parent Property
  let finder = null;       // multi-select PropertyFinder — the Comparison Properties
  // Both mounted lazily the first time the Owner role is selected.

  function refreshRoleDependentUI(){
    const role = roleSelect.value;
    const isOwner = role === RBAC.ROLES.PROPERTY_OWNER;

    // Property Owner gets split First/Last Name instead of one Full Name field.
    document.getElementById('f_nameWrap').classList.toggle('d-none', isOwner);
    document.getElementById('f_name').required = !isOwner;
    document.getElementById('f_firstNameWrap').classList.toggle('d-none', !isOwner);
    document.getElementById('f_lastNameWrap').classList.toggle('d-none', !isOwner);
    document.getElementById('f_firstName').required = isOwner;
    document.getElementById('f_lastName').required = isOwner;

    document.getElementById('ownerParentPropertyCard').classList.toggle('d-none', !isOwner);
    document.getElementById('propertyAssignmentCard').classList.toggle('d-none', !isOwner);
    document.getElementById('propertyAssignmentTitle').textContent = 'Comparison Properties';
    document.getElementById('propertyAssignmentHint').textContent = "Search and select other properties to benchmark this owner's rates against in their Rate Shopper portal. Their own Parent Property never appears here — it can't be a comparison for itself. This does not grant management access — only their Parent Property does.";

    if(isOwner && !parentFinder){
      parentFinder = PropertyFinder.mount(document.getElementById('parentPropertyFinder'), {
        mode: 'single',
        selectedIds: existing && existing.parentPropertyId ? [existing.parentPropertyId] : [],
        onChange: (ids)=>{
          // Primary Property choice excludes itself from the Comparison Properties picker below —
          // a property can't be its own comparison.
          if(finder) finder.setExcludeId(ids[0] || null);
        }
      });
      finder = PropertyFinder.mount(document.getElementById('competitorFinder'), {
        selectedIds: existing ? (existing.assignedProperties||[]) : [],
        excludeId: parentFinder.getSelectedId()
      });
    }
  }

  if(existing){
    document.getElementById('submitLabel').textContent = 'Update User';
    document.getElementById('f_hmsUserId').value = existing.hmsUserId || '';
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

    const hmsUserId = document.getElementById('f_hmsUserId').value.trim();
    if(DB.users.isHmsIdTaken(hmsUserId, existing ? existing.id : null)){
      APP.toast('User ID Already In Use', 'Another user is already registered with this User ID.', 'danger');
      document.getElementById('f_hmsUserId').focus();
      return;
    }

    const role = roleSelect.value;
    const isOwner = role === RBAC.ROLES.PROPERTY_OWNER;

    let assignedProperties = isOwner && finder ? finder.getSelectedIds() : [];

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
      ownerParentPropertyId = parentFinder ? parentFinder.getSelectedId() : null;
      if(!ownerParentPropertyId){ APP.toast('No Parent Property', "Select this Property Owner's own hotel.", 'danger'); return; }
      // A property can never be its own comparison target.
      assignedProperties = assignedProperties.filter(id=> id !== ownerParentPropertyId);
    }

    const parentPropertyId = isOwner ? ownerParentPropertyId : null;

    const payload = {
      id: existing ? existing.id : undefined,
      hmsUserId,
      name: fullName,
      firstName: isOwner ? firstName : (existing ? existing.firstName : undefined),
      lastName: isOwner ? lastName : (existing ? existing.lastName : undefined),
      email,
      password: document.getElementById('f_password').value,
      role,
      status: document.getElementById('f_status').value,
      assignedProperties,
      parentPropertyId,
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
