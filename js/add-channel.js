document.addEventListener('DOMContentLoaded', ()=>{
  const editId = APP.qs('id');
  const existing = editId ? DB.channels.get(editId) : null;
  const preselectProperty = APP.qs('propertyId') || (existing ? existing.propertyId : null);
  const isMaster = existing && existing.type === 'master';

  if(!RBAC.requireModuleAccess(RBAC.MODULES.CHANNELS, existing ? 'edit' : 'create')) return;
  if(existing && !RBAC.canAccessProperty(existing.propertyId)){ location.href='properties.html'; return; }
  if(!existing && preselectProperty && !RBAC.canAccessProperty(preselectProperty)){ location.href='properties.html'; return; }

  function breadcrumbFor(propertyId){
    const p = propertyId ? DB.properties.get(propertyId) : null;
    if(p){
      return [
        {label:'Home', href:'dashboard.html'},
        {label:'Properties', href:'properties.html'},
        {label:p.name, href:`property-details.html?id=${p.id}&tab=channels`},
        {label:'Channels', href:`property-details.html?id=${p.id}&tab=channels`},
        {label: existing?'Edit':'Add New'}
      ];
    }
    return [
      {label:'Home', href:'dashboard.html'},
      {label:'Properties', href:'properties.html'},
      {label: existing?'Edit Channel':'Add Channel'}
    ];
  }

  APP.mount({
    title: existing ? 'Edit Channel' : 'Add New Channel',
    subtitle: existing ? `Update details for ${existing.name}` : 'Add a distribution channel for this property.',
    breadcrumb: breadcrumbFor(preselectProperty)
  });

  const propertySelect = document.getElementById('f_property');
  const typeSelect = document.getElementById('f_type');
  const nameWrap = document.getElementById('customNameWrap');
  const nameInput = document.getElementById('f_name');
  const cancelBtn = document.getElementById('cancelBtn');

  propertySelect.innerHTML = RBAC.filterProperties(DB.properties.all()).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');

  function updateCancelHref(propertyId){
    cancelBtn.href = propertyId ? `property-details.html?id=${propertyId}&tab=channels` : 'properties.html';
  }

  function refreshNameField(){
    const showName = typeSelect.value === 'custom';
    nameWrap.classList.toggle('d-none', !showName);
    nameInput.required = showName;
  }

  if(isMaster){
    // The Master Channel's type/name are fixed — only its status is editable here.
    typeSelect.innerHTML = `<option value="master">Master Channel</option>`;
    typeSelect.disabled = true;
    nameWrap.classList.add('d-none');
  }
  typeSelect.addEventListener('change', refreshNameField);

  if(existing){
    document.getElementById('submitLabel').textContent = 'Update Channel';
    propertySelect.value = existing.propertyId;
    propertySelect.disabled = true;
    if(!isMaster) typeSelect.value = existing.type;
    nameInput.value = existing.type === 'custom' ? existing.name : '';
    document.getElementById('f_status').value = existing.status;
  } else if(preselectProperty){
    propertySelect.value = preselectProperty;
  }
  refreshNameField();
  updateCancelHref(preselectProperty || propertySelect.value);
  propertySelect.addEventListener('change', function(){
    updateCancelHref(this.value);
    APP.setBreadcrumb(breadcrumbFor(this.value));
  });

  document.getElementById('channelForm').addEventListener('submit', function(e){
    e.preventDefault();
    if(!this.checkValidity()){ this.reportValidity(); return; }

    const type = typeSelect.value;
    const name = isMaster ? existing.name : (type === 'custom' ? nameInput.value.trim() : DB.CHANNEL_TYPES[type].label);

    const payload = {
      id: existing ? existing.id : undefined,
      propertyId: propertySelect.value,
      type,
      name,
      status: document.getElementById('f_status').value
    };
    const saved = DB.channels.save(payload);
    APP.toast(existing?'Channel Updated':'Channel Created', `${saved.name} has been ${existing?'updated':'added'}.`, 'success');
    setTimeout(()=> location.href = `property-details.html?id=${saved.propertyId}&tab=channels`, 700);
  });
});
