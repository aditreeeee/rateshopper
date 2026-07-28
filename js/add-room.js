const ROOM_AMENITIES = ['AC','TV','Mini Bar','Balcony','Room Service','Safe','WiFi','Bathtub','City View','Sea View'];

document.addEventListener('DOMContentLoaded', ()=>{
  const editId = APP.qs('id');
  const existing = editId ? DB.rooms.get(editId) : null;
  const preselectProperty = APP.qs('propertyId') || (existing ? existing.propertyId : null);

  if(!RBAC.requireModuleAccess(RBAC.MODULES.ROOMS, existing ? 'edit' : 'create')) return;
  if(existing && !RBAC.canAccessProperty(existing.propertyId)){ location.href='properties.html'; return; }
  if(!existing && preselectProperty && !RBAC.canAccessProperty(preselectProperty)){ location.href='properties.html'; return; }

  function breadcrumbFor(propertyId){
    const p = propertyId ? DB.properties.get(propertyId) : null;
    if(p){
      return [
        {label:'Home', href:'dashboard.html'},
        {label:'Properties', href:'properties.html'},
        {label:p.name, href:`property-details.html?id=${p.id}&tab=rooms`},
        {label:'Rooms', href:`property-details.html?id=${p.id}&tab=rooms`},
        {label: existing?'Edit':'Add New'}
      ];
    }
    return [
      {label:'Home', href:'dashboard.html'},
      {label:'Properties', href:'properties.html'},
      {label: existing?'Edit Room':'Add Room'}
    ];
  }

  PORTAL.mountForRole({
    title: existing ? 'Edit Room' : 'Add New Room',
    subtitle: existing ? `Update details for ${existing.name}` : 'Create a new room type for a property.',
    breadcrumb: breadcrumbFor(preselectProperty)
  });

  // A rate plan links to a specific room by id — a brand-new room has no id yet (it's only
  // assigned on save), so there's nothing to link against until the room exists. Show this
  // section only once editing an existing room.
  if(!existing) document.getElementById('linkedRatePlansCard').classList.add('d-none');

  const cancelBtn = document.getElementById('cancelBtn');
  function updateCancelHref(propertyId){
    cancelBtn.href = propertyId ? `property-details.html?id=${propertyId}&tab=rooms` : 'properties.html';
  }

  document.getElementById('f_property').innerHTML = RBAC.filterProperties(DB.properties.all()).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
  document.getElementById('roomAmenitiesGrid').innerHTML = ROOM_AMENITIES.map(a=>`
    <div class="col-md-4 col-6">
      <div class="form-check">
        <input class="form-check-input ram-check" type="checkbox" value="${a}" id="ram_${a.replace(/\s/g,'')}">
        <label class="form-check-label small" for="ram_${a.replace(/\s/g,'')}">${a}</label>
      </div>
    </div>`).join('');

  document.getElementById('roomMealPlanGrid').innerHTML = DB.MEAL_PLANS.map(mp=>`
    <div class="col-md-3 col-6">
      <div class="form-check">
        <input class="form-check-input rmp-check" type="checkbox" value="${mp}" id="rmp_${mp}">
        <label class="form-check-label small" for="rmp_${mp}" title="${DB.MEAL_LABELS[mp]}">${mp}</label>
      </div>
    </div>`).join('');

  const channelSelect = document.getElementById('f_channel');
  function refreshChannels(propertyId){
    const channels = DB.channels.byProperty(propertyId);
    channelSelect.innerHTML = channels.length ? channels.map(c=>`<option value="${c.id}">${c.name}</option>`).join('') : `<option value="">No channels — add one first</option>`;
  }

  if(existing){
    document.getElementById('submitLabel').textContent = 'Update Room';
    document.getElementById('f_property').value = existing.propertyId;
    refreshChannels(existing.propertyId);
    channelSelect.value = existing.channelId;
    document.getElementById('f_name').value = existing.name;
    document.getElementById('f_category').value = existing.category;
    document.getElementById('f_bed').value = existing.bedType;
    document.getElementById('f_size').value = existing.size;
    document.getElementById('f_capacity').value = existing.capacity;
    document.getElementById('f_maxOcc').value = existing.maxOccupancy;
    document.getElementById('f_total').value = existing.totalRooms;
    document.getElementById('f_price').value = existing.basePrice;
    document.getElementById('f_status').value = existing.status;
    document.getElementById('roomImgPreview').src = existing.img;
    document.getElementById('roomImgInput').value = existing.img;
    (existing.amenities||[]).forEach(a=>{ const el=document.getElementById('ram_'+a.replace(/\s/g,'')); if(el) el.checked=true; });
    (existing.mealPlans||[]).forEach(mp=>{ const el=document.getElementById('rmp_'+mp); if(el) el.checked=true; });
  } else {
    refreshChannels(preselectProperty || document.getElementById('f_property').value);
    if(preselectProperty) document.getElementById('f_property').value = preselectProperty;
    document.querySelectorAll('.rmp-check').forEach(cb=> cb.checked = true);
  }
  updateCancelHref(preselectProperty || document.getElementById('f_property').value);

  document.getElementById('f_property').addEventListener('change', function(){
    updateCancelHref(this.value);
    APP.setBreadcrumb(breadcrumbFor(this.value));
    refreshChannels(this.value);
  });

  document.getElementById('roomImgInput').addEventListener('input', function(){
    if(this.value) document.getElementById('roomImgPreview').src = this.value;
  });

  function refreshLinkedRatePlans(){
    const propertyId = document.getElementById('f_property').value;
    const channelId = channelSelect.value;
    const plans = channelId ? DB.ratePlans.byChannel(channelId) : [];
    const host = document.getElementById('linkedRatePlansGrid');
    document.getElementById('createRpLink').href = `add-rate-plan.html?propertyId=${propertyId}`;
    const selectAll = document.getElementById('rp_selectAll');

    if(!plans.length){
      document.getElementById('selectAllRpWrap').classList.add('d-none');
      host.innerHTML = `<div class="text-muted small">No rate plans exist for this property yet.</div>`;
      return;
    }
    document.getElementById('selectAllRpWrap').classList.remove('d-none');
    host.innerHTML = plans.map(rp=>{
      const linkedToThisRoom = existing && rp.roomId === existing.id;
      const otherRoom = DB.rooms.get(rp.roomId);
      return `<label class="d-flex align-items-center gap-2 p-2 border rounded-3" style="border-color:var(--border-1) !important">
        <input type="checkbox" class="form-check-input rp-link-check flex-shrink-0" value="${rp.id}" ${linkedToThisRoom?'checked':''}>
        <span class="flex-grow-1">
          <span class="d-block fw-semibold" style="font-size:.85rem">${rp.name}</span>
          <span class="d-block text-muted" style="font-size:.74rem">${rp.mealPlan} • ${rp.refundable?'Refundable':'Non-Refundable'} ${otherRoom && !linkedToThisRoom ? `• currently on <strong>${otherRoom.name}</strong>` : ''}</span>
        </span>
      </label>`;
    }).join('');

    selectAll.checked = false;
    syncSelectAllState();
    document.querySelectorAll('.rp-link-check').forEach(cb=> cb.addEventListener('change', syncSelectAllState));
  }

  function syncSelectAllState(){
    const boxes = [...document.querySelectorAll('.rp-link-check')];
    const selectAll = document.getElementById('rp_selectAll');
    selectAll.checked = boxes.length>0 && boxes.every(b=>b.checked);
  }

  document.getElementById('rp_selectAll').addEventListener('change', function(){
    document.querySelectorAll('.rp-link-check').forEach(cb=> cb.checked = this.checked);
  });

  refreshLinkedRatePlans();
  document.getElementById('f_property').addEventListener('change', refreshLinkedRatePlans);
  channelSelect.addEventListener('change', refreshLinkedRatePlans);

  document.getElementById('roomForm').addEventListener('submit', function(e){
    e.preventDefault();
    if(!this.checkValidity()){ this.reportValidity(); return; }
    if(!channelSelect.value){ APP.toast('No Channel Selected', 'Add a channel to this property first.', 'danger'); return; }
    const amenities = [...document.querySelectorAll('.ram-check:checked')].map(c=>c.value);
    const mealPlans = [...document.querySelectorAll('.rmp-check:checked')].map(c=>c.value);
    if(!mealPlans.length){ APP.toast('No Meal Plan Selected', 'Choose at least one meal plan this room can offer.', 'danger'); return; }
    const payload = {
      id: existing ? existing.id : undefined,
      propertyId: document.getElementById('f_property').value,
      channelId: channelSelect.value,
      name: document.getElementById('f_name').value.trim(),
      category: document.getElementById('f_category').value,
      bedType: document.getElementById('f_bed').value,
      size: Number(document.getElementById('f_size').value),
      capacity: Number(document.getElementById('f_capacity').value),
      maxOccupancy: Number(document.getElementById('f_maxOcc').value),
      totalRooms: Number(document.getElementById('f_total').value),
      basePrice: Number(document.getElementById('f_price').value),
      status: document.getElementById('f_status').value,
      img: document.getElementById('roomImgInput').value.trim() || document.getElementById('roomImgPreview').src,
      amenities,
      mealPlans
    };
    const saved = DB.rooms.save(payload);

    const checkedPlanIds = [...document.querySelectorAll('.rp-link-check:checked')].map(c=>c.value);
    let relinkedCount = 0;
    DB.ratePlans.byChannel(saved.channelId).forEach(rp=>{
      const shouldLink = checkedPlanIds.includes(rp.id);
      if(shouldLink && rp.roomId !== saved.id){ DB.ratePlans.save({...rp, roomId: saved.id}); relinkedCount++; }
      if(!shouldLink && rp.roomId === saved.id){ /* leave linked — a rate plan must always belong to a room */ }
    });

    APP.toast(existing?'Room Updated':'Room Added', `${saved.name} has been ${existing?'updated':'created'}${relinkedCount?` and linked to ${relinkedCount} rate plan(s)`:''}.`, 'success');
    setTimeout(()=> location.href = `property-details.html?id=${saved.propertyId}&tab=rooms`, 700);
  });
});
