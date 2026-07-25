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

  let selectedChildIds = new Set(existing && existing.role===RBAC.ROLES.PROPERTY_ADMIN ? (existing.childPropertyIds||[]) : []);

  function refreshRoleDependentUI(){
    const role = roleSelect.value;
    const isOwner = role === RBAC.ROLES.PROPERTY_OWNER;
    const needsProperties = role === RBAC.ROLES.PROPERTY_USER || isOwner; // legacy Property User (single) + Property Owner (multi)
    const needsBenchmark = role === RBAC.ROLES.PROPERTY_ADMIN;
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

    document.getElementById('benchmarkAssignmentCard').classList.toggle('d-none', !needsBenchmark);
    if(needsBenchmark) refreshBenchmarkUI();

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

  function refreshBenchmarkUI(){
    // Only Property Owners create Property Admins now, and only over their own organization's
    // Parent Properties — not the whole company portfolio.
    const ownProperties = DB.properties.all().filter(p=> RBAC.assignedPropertyIds().includes(p.id));
    const parentSelect = document.getElementById('f_parentProperty');
    parentSelect.innerHTML = ownProperties.length ? ownProperties.map(p=>`<option value="${p.id}">${p.name}</option>`).join('') : `<option value="">No Parent Properties yet — create one first</option>`;
    if(existing && existing.parentPropertyId) parentSelect.value = existing.parentPropertyId;

    renderChildPropertyGrid();
  }

  function renderChildPropertyGrid(){
    const competitors = DB.competitors.all();
    document.getElementById('childPropertyGrid').innerHTML = competitors.length ? competitors.map(c=>{
      const checked = selectedChildIds.has(c.id);
      return `<div class="col-md-6">
        <label class="d-flex align-items-center gap-2 p-2 border rounded-3" style="border-color:var(--border-1) !important">
          <input type="checkbox" class="form-check-input child-property-check" value="${c.id}" ${checked?'checked':''}>
          <span style="font-size:.85rem">${c.name}<span class="text-muted"> — ${c.city}, ${c.country}</span></span>
        </label>
      </div>`;
    }).join('') : `<div class="col-12 text-muted small">No competitor properties yet — add one below.</div>`;

    document.querySelectorAll('.child-property-check').forEach(cb=>{
      cb.addEventListener('change', function(){
        if(this.checked) selectedChildIds.add(this.value); else selectedChildIds.delete(this.value);
      });
    });
  }

  document.getElementById('addCompetitorBtn').addEventListener('click', ()=>{
    document.getElementById('newCompetitorForm').classList.toggle('d-none');
  });
  document.getElementById('saveCompetitorBtn').addEventListener('click', ()=>{
    const name = document.getElementById('nc_name').value.trim();
    const city = document.getElementById('nc_city').value.trim();
    const country = document.getElementById('nc_country').value.trim();
    if(!name || !city || !country){ APP.toast('Missing Details', 'Enter a name, city, and country for the competitor.', 'danger'); return; }
    const saved = DB.competitors.save({ name, city, country, status:'active', avgRate: DB.rand(3000,12000), lastUpdated: DB.fmtDate(new Date()) });
    selectedChildIds.add(saved.id);
    document.getElementById('nc_name').value = '';
    document.getElementById('nc_city').value = '';
    document.getElementById('nc_country').value = '';
    document.getElementById('newCompetitorForm').classList.add('d-none');
    renderChildPropertyGrid();
    APP.toast('Competitor Added', `${saved.name} added to the competitor pool.`, 'success');
  });

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
    const needsBenchmark = role === RBAC.ROLES.PROPERTY_ADMIN;

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

    let parentPropertyId = isOwner ? ownerParentPropertyId : null, childPropertyIds = [];
    if(needsBenchmark){
      parentPropertyId = document.getElementById('f_parentProperty').value;
      childPropertyIds = [...selectedChildIds];
      if(!parentPropertyId){ APP.toast('No Parent Property', 'Select the Parent Property this admin owns.', 'danger'); return; }
      if(!childPropertyIds.length){ APP.toast('No Child Properties', 'Select at least one competitor to benchmark against.', 'danger'); return; }
      assignedProperties = [parentPropertyId]; // keeps the generic assignedPropertyIds() lookup consistent
    }

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
      parentPropertyId: (isOwner || needsBenchmark) ? parentPropertyId : null,
      childPropertyIds: needsBenchmark ? childPropertyIds : [],
      permissions,
      // Tracked so a Property Owner keeps visibility/management over Property Admins they
      // create even when the Parent Property picked isn't one of the owner's own properties.
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
