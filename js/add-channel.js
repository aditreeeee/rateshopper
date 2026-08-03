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

  PORTAL.mountForRole({
    title: existing ? 'Edit Channel' : 'Add New Channel',
    subtitle: existing ? `Update details for ${existing.name}` : 'Add a distribution channel for this property.',
    breadcrumb: breadcrumbFor(preselectProperty)
  });

  const propertySelect = document.getElementById('f_property');
  const channelSelect = document.getElementById('f_channel');
  const channelCodeLabel = document.getElementById('f_channelCode');
  const cancelBtn = document.getElementById('cancelBtn');

  propertySelect.innerHTML = RBAC.filterProperties(DB.properties.all()).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');

  function updateCancelHref(propertyId){
    cancelBtn.href = propertyId ? `property-details.html?id=${propertyId}&tab=channels` : 'properties.html';
  }

  // Channels a property already has (edit target excluded) can't be picked again — mirrors a
  // future UNIQUE(PropertyId, ChannelCode) constraint in SQL Server.
  function usedCodesForProperty(propertyId){
    return new Set(DB.channels.all()
      .filter(c=>c.propertyId===propertyId && c.type!=='master' && c.id!==(existing&&existing.id))
      .map(c=>c.channelCode));
  }

  function refreshChannelOptions(){
    // Only unassigned channels are ever listed — a channel this property already has isn't
    // shown at all, not just greyed out, so there's no way to pick it twice from this screen.
    const used = propertySelect.value ? usedCodesForProperty(propertySelect.value) : new Set();
    const available = DB.CHANNEL_CATALOG.filter(c=> !used.has(c.code));
    channelSelect.innerHTML = available.length
      ? available.map(c=> `<option value="${c.code}">${c.code} — ${c.name}</option>`).join('')
      : `<option value="">No unassigned channels left for this property</option>`;
    if(existing) channelSelect.value = existing.channelCode;
    channelCodeLabel.textContent = channelSelect.value || '-';
  }

  if(isMaster){
    // The Master Channel's identity is fixed — only its status is editable here.
    channelSelect.innerHTML = `<option value="${DB.MASTER_CHANNEL_CODE}">${DB.MASTER_CHANNEL_CODE} — ${DB.CHANNEL_TYPES.master.label}</option>`;
    channelSelect.disabled = true;
    channelCodeLabel.textContent = DB.MASTER_CHANNEL_CODE;
  } else {
    refreshChannelOptions();
  }
  channelSelect.addEventListener('change', ()=>{ channelCodeLabel.textContent = channelSelect.value || '-'; });

  if(existing){
    document.getElementById('submitLabel').textContent = 'Update Channel';
    propertySelect.value = existing.propertyId;
    propertySelect.disabled = true;
    document.getElementById('f_status').value = existing.status;
    document.getElementById('f_website').value = existing.website || '';
  } else if(preselectProperty){
    propertySelect.value = preselectProperty;
  }
  updateCancelHref(preselectProperty || propertySelect.value);
  propertySelect.addEventListener('change', function(){
    updateCancelHref(this.value);
    APP.setBreadcrumb(breadcrumbFor(this.value));
    if(!isMaster) refreshChannelOptions();
  });

  document.getElementById('channelForm').addEventListener('submit', function(e){
    e.preventDefault();
    if(!this.checkValidity()){ this.reportValidity(); return; }

    if(!isMaster && !channelSelect.value){ APP.toast('No Channel Selected', 'This property has no unassigned channels left to add.', 'danger'); return; }
    const channelCode = isMaster ? DB.MASTER_CHANNEL_CODE : Number(channelSelect.value);
    const catalogEntry = DB.channelCatalogEntry(channelCode);
    if(!catalogEntry){ APP.toast('Invalid Channel', 'Please choose a channel from the list.', 'error'); return; }
    // Belt-and-braces against a stale/duplicate submit (e.g. two tabs open) — the data layer
    // also enforces this, but fail fast here with a clear message instead of a silent overwrite.
    if(!isMaster && usedCodesForProperty(propertySelect.value).has(channelCode)){
      APP.toast('Channel Already Added', 'This property is already connected to that channel.', 'danger');
      refreshChannelOptions();
      return;
    }

    // type stays a loose legacy key purely for icon/color lookups elsewhere (they all fall back
    // to the generic 'custom' style for any code outside the 5 originally-special-cased OTAs).
    const legacyType = Object.keys(DB.CHANNEL_TYPE_CODES).find(k=> DB.CHANNEL_TYPE_CODES[k]===channelCode && k!=='master');
    const type = isMaster ? 'master' : (legacyType || 'custom');

    const payload = {
      id: existing ? existing.id : undefined,
      propertyId: propertySelect.value,
      channelCode,
      type,
      name: catalogEntry.name,
      status: document.getElementById('f_status').value,
      website: document.getElementById('f_website').value.trim()
    };
    const saved = DB.channels.save(payload);
    APP.toast(existing?'Channel Updated':'Channel Created', `${saved.name} has been ${existing?'updated':'added'}.`, 'success');
    setTimeout(()=> location.href = `property-details.html?id=${saved.propertyId}&tab=channels`, 700);
  });
});
