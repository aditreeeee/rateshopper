document.addEventListener('DOMContentLoaded', ()=>{
  const editId = APP.qs('id');
  const existing = editId ? DB.ratePlans.get(editId) : null;
  const preselectProperty = APP.qs('propertyId') || (existing ? existing.propertyId : null);

  if(!RBAC.requireModuleAccess(RBAC.MODULES.RATE_PLANS, existing ? 'edit' : 'create')) return;
  if(existing && !RBAC.canAccessProperty(existing.propertyId)){ location.href='properties.html'; return; }
  if(!existing && preselectProperty && !RBAC.canAccessProperty(preselectProperty)){ location.href='properties.html'; return; }

  function breadcrumbFor(propertyId){
    const p = propertyId ? DB.properties.get(propertyId) : null;
    if(p){
      return [
        {label:'Home', href:'dashboard.html'},
        {label:'Properties', href:'properties.html'},
        {label:p.name, href:`property-details.html?id=${p.id}&tab=rateplans`},
        {label:'Rate Plans', href:`property-details.html?id=${p.id}&tab=rateplans`},
        {label: existing?'Edit':'Add New'}
      ];
    }
    return [
      {label:'Home', href:'dashboard.html'},
      {label:'Properties', href:'properties.html'},
      {label: existing?'Edit Rate Plan':'Add Rate Plan'}
    ];
  }

  PORTAL.mountForRole({
    title: existing ? 'Edit Rate Plan' : 'Create Rate Plan',
    subtitle: existing ? `Update pricing rules for ${existing.name}` : 'Define a new pricing and cancellation policy for a room.',
    breadcrumb: breadcrumbFor(preselectProperty)
  });

  const propertySelect = document.getElementById('f_property');
  const channelSelect = document.getElementById('f_channel');
  const roomSelect = document.getElementById('f_room');
  const cancelBtn = document.getElementById('cancelBtn');
  propertySelect.innerHTML = RBAC.filterProperties(DB.properties.all()).map(p=>`<option value="${p.id}">${p.name}</option>`).join('');

  function updateCancelHref(propertyId){
    cancelBtn.href = propertyId ? `property-details.html?id=${propertyId}&tab=rateplans` : 'properties.html';
  }

  function refreshChannels(propertyId){
    const channels = DB.channels.byProperty(propertyId);
    channelSelect.innerHTML = channels.length ? channels.map(c=>`<option value="${c.id}">${c.name}</option>`).join('') : `<option value="">No channels — add one first</option>`;
  }
  function refreshRooms(channelId){
    const rooms = channelId ? DB.rooms.byChannel(channelId) : [];
    roomSelect.innerHTML = rooms.length ? rooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('') : `<option value="">No rooms on this channel — add one first</option>`;
  }
  propertySelect.addEventListener('change', ()=>{
    refreshChannels(propertySelect.value);
    refreshRooms(channelSelect.value);
    updateCancelHref(propertySelect.value);
    APP.setBreadcrumb(breadcrumbFor(propertySelect.value));
  });
  channelSelect.addEventListener('change', ()=> refreshRooms(channelSelect.value));

  if(existing){
    document.getElementById('submitLabel').textContent = 'Update Rate Plan';
    propertySelect.value = existing.propertyId;
    refreshChannels(existing.propertyId);
    channelSelect.value = existing.channelId;
    refreshRooms(existing.channelId);
    roomSelect.value = existing.roomId;
    document.getElementById('f_name').value = existing.name;
    document.getElementById('f_meal').value = existing.mealPlan;
    document.getElementById('f_refundable').value = String(existing.refundable);
    document.getElementById('f_minStay').value = existing.minStay;
    document.getElementById('f_maxStay').value = existing.maxStay;
    document.getElementById('f_cancellation').value = existing.cancellationPolicy;
    document.getElementById('f_baseOcc').value = existing.baseOccupancy;
    document.getElementById('f_extraAdult').value = existing.extraAdultPrice;
    document.getElementById('f_extraChild').value = existing.extraChildPrice;
    document.getElementById('f_status').value = existing.status;
    // Prefill with today's occupancy prices as a representative snapshot so the fields aren't
    // blank on edit — left untouched, the override below is skipped and nothing changes.
    const todayRates = DB.rates.forPlan(existing.id)[DB.fmtDate(new Date())];
    if(todayRates && todayRates.occPrices){
      [1,2,3,4].forEach(occ=>{
        if(todayRates.occPrices[occ] != null) document.getElementById('f_occ'+occ).value = todayRates.occPrices[occ];
      });
    }
  } else {
    const startProperty = preselectProperty || propertySelect.value;
    if(preselectProperty) propertySelect.value = preselectProperty;
    refreshChannels(startProperty);
    refreshRooms(channelSelect.value);
  }
  updateCancelHref(preselectProperty || propertySelect.value);

  document.getElementById('f_refundable').addEventListener('change', function(){
    if(!document.getElementById('f_cancellation').value){
      document.getElementById('f_cancellation').value = this.value==='true'
        ? 'Free cancellation up to 24 hours before check-in.'
        : 'Non-refundable. No changes or cancellations allowed.';
    }
  });

  document.getElementById('rpForm').addEventListener('submit', function(e){
    e.preventDefault();
    if(!this.checkValidity()){ this.reportValidity(); return; }
    if(!channelSelect.value){ APP.toast('No Channel Selected', 'Please add a channel to this property first.', 'danger'); return; }
    if(!roomSelect.value){ APP.toast('No Room Selected', 'Please add a room to this channel first.', 'danger'); return; }
    const payload = {
      id: existing ? existing.id : undefined,
      propertyId: propertySelect.value,
      channelId: channelSelect.value,
      roomId: roomSelect.value,
      name: document.getElementById('f_name').value.trim(),
      mealPlan: document.getElementById('f_meal').value,
      refundable: document.getElementById('f_refundable').value === 'true',
      minStay: Number(document.getElementById('f_minStay').value),
      maxStay: Number(document.getElementById('f_maxStay').value),
      cancellationPolicy: document.getElementById('f_cancellation').value.trim(),
      baseOccupancy: Number(document.getElementById('f_baseOcc').value),
      extraAdultPrice: Number(document.getElementById('f_extraAdult').value),
      extraChildPrice: Number(document.getElementById('f_extraChild').value),
      status: document.getElementById('f_status').value
    };
    const saved = DB.ratePlans.save(payload);

    // Occupancy price fields left blank keep whatever DB.ratePlans.save() auto-derived from the
    // room's base price; any filled-in tier overrides that starting price across every date
    // already seeded for this plan (same "blank = unchanged" convention as the Rate Calendar's
    // Bulk Update).
    const occOverrides = {};
    [1,2,3,4].forEach(occ=>{
      const raw = document.getElementById('f_occ'+occ).value;
      if(raw !== '') occOverrides[occ] = Number(raw);
    });
    if(Object.keys(occOverrides).length){
      const room = DB.rooms.get(saved.roomId);
      const maxOcc = Math.max((room && room.maxOccupancy) || 1, 1);
      const planRates = DB.rates.forPlan(saved.id);
      Object.keys(planRates).forEach(dateKey=>{
        const cur = planRates[dateKey];
        const occPrices = {...(cur.occPrices||{})};
        Object.keys(occOverrides).forEach(occStr=>{
          const occ = Number(occStr);
          if(occ <= maxOcc) occPrices[occ] = occOverrides[occ];
        });
        const price = occPrices[saved.baseOccupancy] != null ? occPrices[saved.baseOccupancy] : cur.price;
        planRates[dateKey] = { price, occPrices };
      });
      DB.rates.saveAll(saved.id, planRates);
    }

    APP.toast(existing?'Rate Plan Updated':'Rate Plan Created', `${saved.name} saved successfully.`, 'success');
    // Editing returns you to where you came from (Rate Plans tab); creating a brand new
    // plan takes you straight to its calendar so you can set initial pricing.
    const destTab = existing ? 'rateplans' : 'ratecalendar';
    setTimeout(()=> location.href = `property-details.html?id=${saved.propertyId}&tab=${destTab}`, 800);
  });
});
