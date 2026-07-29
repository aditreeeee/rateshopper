let currentProperty = null;

document.addEventListener('DOMContentLoaded', ()=>{
  const id = APP.qs('id');
  const p = DB.properties.get(id);
  const accessible = p && RBAC.canAccessProperty(p.id);
  currentProperty = accessible ? p : null;

  const canEditProperty = accessible && RBAC.can(RBAC.MODULES.PROPERTIES, 'edit');
  const canDeleteProperty = accessible && RBAC.can(RBAC.MODULES.PROPERTIES, 'delete');
  const canViewCalendar = accessible && RBAC.can(RBAC.MODULES.RATE_CALENDAR, 'view');
  const canViewChannels = accessible && RBAC.can(RBAC.MODULES.CHANNELS, 'view');

  PORTAL.mountForRole({
    title: accessible ? p.name : (p ? 'Access Denied' : 'Property Not Found'),
    subtitle: accessible ? `
      <span class="badge-status ${p.status==='active'?'badge-active':'badge-inactive'}">${p.status}</span>
      <span class="subtitle-sep">•</span>
      <span class="text-warning subtitle-stars">${'★'.repeat(p.stars)}${'☆'.repeat(5-p.stars)}</span>
      <span class="subtitle-sep">•</span>
      <span><i class="bi bi-geo-alt me-1"></i>${p.address}</span>
    ` : '',
    breadcrumb:[{label:'Home',href:'dashboard.html'},{label:'Properties',href:'properties.html'},{label: accessible ? p.name : 'Not Found'}],
    actions: accessible ? `
      ${canEditProperty ? `<a href="add-property.html?id=${p.id}" class="btn btn-outline-primary"><i class="bi bi-pencil me-1"></i>Edit</a>` : ''}
      ${canDeleteProperty ? `<button class="btn btn-light-danger" id="deleteBtn"><i class="bi bi-trash3 me-1"></i>Delete</button>` : ''}
    ` : ''
  });

  if(!accessible){
    document.getElementById('page-content').innerHTML = p
      ? `<div class="empty-state"><i class="bi bi-shield-lock"></i><h5>Access denied</h5><p>You are not assigned to this property.</p><a href="properties.html" class="btn btn-primary">Back to Properties</a></div>`
      : `<div class="empty-state"><i class="bi bi-building-slash"></i><h5>Property not found</h5><p>The property you're looking for doesn't exist.</p><a href="properties.html" class="btn btn-primary">Back to Properties</a></div>`;
    return;
  }

  document.getElementById('coverImg').style.backgroundImage = `url('${p.logo}')`;
  document.getElementById('p_desc').textContent = p.description;

  const canCreateChannel = RBAC.can(RBAC.MODULES.CHANNELS, 'create');
  const addChannelBtn = document.getElementById('addChannelBtn');
  if(canCreateChannel){ addChannelBtn.href = `add-channel.html?propertyId=${p.id}`; } else { addChannelBtn.classList.add('d-none'); }

  const canCreateRoom = RBAC.can(RBAC.MODULES.ROOMS, 'create');
  const addRoomBtn = document.getElementById('addRoomBtn');
  if(canCreateRoom){ addRoomBtn.href = `add-room.html?propertyId=${p.id}`; } else { addRoomBtn.classList.add('d-none'); }

  const canCreateRatePlan = RBAC.can(RBAC.MODULES.RATE_PLANS, 'create');
  const addRpBtn = document.getElementById('addRpBtn');
  if(canCreateRatePlan){ addRpBtn.href = `add-rate-plan.html?propertyId=${p.id}`; } else { addRpBtn.classList.add('d-none'); }

  populateChannelFilters();
  renderOverview();
  renderChannels();
  setRoomsView(roomsView);
  renderRooms();
  renderRatePlans();
  renderContact();

  document.getElementById('roomsChannelFilter').addEventListener('change', renderRooms);
  document.getElementById('rm_viewGrid').addEventListener('click', ()=> setRoomsView('grid'));
  document.getElementById('rm_viewList').addEventListener('click', ()=> setRoomsView('list'));
  document.getElementById('rpChannelFilter').addEventListener('change', renderRatePlans);

  // Rate Calendar tab: the live grid is embedded directly (no click-through), scoped to this property.
  // This is the only place the rate calendar is ever shown — there is no standalone full-page version.
  const embedCalendarUrl = `rate-calendar.html?propertyId=${p.id}&embed=1`;
  let calendarFrameLoaded = false;

  const rateCalendarTabBtn = document.querySelector('#detailTabs [data-tab="ratecalendar"]');
  if(!canViewCalendar && rateCalendarTabBtn) rateCalendarTabBtn.closest('.nav-item').classList.add('d-none');
  const channelsTabBtn = document.querySelector('#detailTabs [data-tab="channels"]');
  if(!canViewChannels && channelsTabBtn) channelsTabBtn.closest('.nav-item').classList.add('d-none');

  // Tabs — also keep the breadcrumb's last segment in sync with the active tab
  const TAB_LABELS = {overview:'Overview', channels:'Channels', rooms:'Rooms', rateplans:'Rate Plans', ratecalendar:'Rate Calendar', contact:'Contact & Amenities'};
  function setTabBreadcrumb(tab){
    APP.setBreadcrumb([
      {label:'Home', href:'dashboard.html'},
      {label:'Properties', href:'properties.html'},
      {label:p.name, href:`property-details.html?id=${p.id}`},
      {label:TAB_LABELS[tab]}
    ]);
  }

  function activateTab(tab){
    if(!TAB_LABELS[tab]) tab = 'overview';
    if(tab==='ratecalendar' && !canViewCalendar) tab = 'overview';
    if(tab==='channels' && !canViewChannels) tab = 'overview';
    document.querySelectorAll('#detailTabs .nav-link').forEach(b=> b.classList.toggle('active', b.dataset.tab===tab));
    Object.keys(TAB_LABELS).forEach(t=> document.getElementById('tab-'+t).classList.toggle('d-none', t!==tab));
    setTabBreadcrumb(tab);
    if(tab==='ratecalendar' && !calendarFrameLoaded){
      document.getElementById('calendarFrame').src = embedCalendarUrl;
      calendarFrameLoaded = true;
    }
    history.replaceState(null, '', `property-details.html?id=${p.id}&tab=${tab}`);
  }

  document.querySelectorAll('#detailTabs .nav-link').forEach(btn=>{
    btn.addEventListener('click', ()=> activateTab(btn.dataset.tab));
  });

  // Supports deep-linking straight into a tab, e.g. property-details.html?id=X&tab=rateplans
  activateTab(APP.qs('tab') || 'overview');

  if(canDeleteProperty){
    document.getElementById('deleteBtn').addEventListener('click', ()=>{
      APP.confirmModal({
        title:'Delete Property?', message:`This will permanently delete "${p.name}" along with all its channels, rooms and rate plans.`,
        confirmText:'Delete', danger:true,
        onConfirm: ()=>{ DB.properties.remove(p.id); APP.toast('Deleted','Property removed successfully.','danger'); setTimeout(()=>location.href='properties.html',600); }
      });
    });
  }
});

function channelBadge(channelId){
  const c = DB.channels.get(channelId);
  if(!c) return '<span class="text-muted small">—</span>';
  const meta = DB.CHANNEL_TYPES[c.type] || DB.CHANNEL_TYPES.custom;
  return `<span class="badge" style="background:${meta.color}1a;color:${meta.color}"><i class="bi ${meta.icon} me-1"></i>${c.name}</span>`;
}

function populateChannelFilters(){
  const p = currentProperty;
  const channels = DB.channels.byProperty(p.id);
  const opts = `<option value="">All Channels</option>` + channels.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  document.getElementById('roomsChannelFilter').innerHTML = opts;
  document.getElementById('rpChannelFilter').innerHTML = opts;
}

function renderOverview(){
  const p = currentProperty;
  const channels = DB.channels.byProperty(p.id);
  const rooms = DB.rooms.byProperty(p.id);
  const ratePlans = DB.ratePlans.byProperty(p.id);
  const totalInv = rooms.reduce((s,r)=>s+r.totalRooms,0);

  document.getElementById('p_stats').innerHTML = [
    {label:'Channels', value:channels.length, icon:'bi-diagram-3', color:'#8c5cf7', bg:'#f3edff'},
    {label:'Room Types', value:rooms.length, icon:'bi-door-open', color:'#3861fb', bg:'#eef4ff'},
    {label:'Rate Plans', value:ratePlans.length, icon:'bi-tags', color:'#b9791a', bg:'#fff8e6'}
  ].map(s=>`<div class="col-md-4 col-xl-3 col-6"><div class="stat-card"><div class="stat-icon" style="background:${s.bg};color:${s.color}"><i class="bi ${s.icon}"></i></div><div><div class="stat-label">${s.label}</div><h3 style="font-size:1.25rem">${s.value}</h3></div></div></div>`).join('');

  document.getElementById('kv_type').textContent = p.type;
  document.getElementById('kv_city').textContent = p.city;
  document.getElementById('kv_rooms').textContent = totalInv;
  document.getElementById('kv_created').textContent = APP.fmtDateReadable(p.createdAt);
}

function renderChannels(){
  const p = currentProperty;
  const channels = DB.channels.byProperty(p.id);
  const canEdit = RBAC.can(RBAC.MODULES.CHANNELS, 'edit');
  const canDelete = RBAC.can(RBAC.MODULES.CHANNELS, 'delete');
  document.getElementById('channelsCount').textContent = `${channels.length} channel(s)`;

  document.getElementById('channelsGrid').innerHTML = channels.length ? channels.map(c=>{
    const meta = DB.CHANNEL_TYPES[c.type] || DB.CHANNEL_TYPES.custom;
    const roomCount = DB.rooms.byChannel(c.id).length;
    const rpCount = DB.ratePlans.byChannel(c.id).length;
    return `<div class="col-md-6 col-xl-4">
      <div class="stat-card h-100 align-items-start">
        <div class="stat-icon" style="background:${meta.color}1a;color:${meta.color}"><i class="bi ${meta.icon}"></i></div>
        <div class="flex-grow-1">
          <div class="d-flex justify-content-between align-items-start">
            <div>
              <div class="fw-bold">${c.name} <span class="text-muted fw-normal" style="font-size:.7rem">#${c.channelCode}</span></div>
              <div class="text-muted" style="font-size:.76rem">${roomCount} room(s) • ${rpCount} rate plan(s)</div>
            </div>
            <span class="badge-status ${c.status==='active'?'badge-active':'badge-inactive'}">${c.status}</span>
          </div>
          ${c.type==='master' ? '<div class="text-muted mt-1" style="font-size:.7rem"><i class="bi bi-shield-check me-1"></i>Default direct channel</div>' : ''}
          <div class="d-flex gap-1 mt-2">
            ${canEdit ? `<a href="add-channel.html?id=${c.id}" class="btn btn-sm btn-soft">Edit</a>` : ''}
            ${canDelete && c.type!=='master' ? `<button class="btn btn-sm btn-light-danger" onclick="deletePropertyChannel('${c.id}')">Delete</button>` : ''}
          </div>
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="col-12"><div class="empty-state"><i class="bi bi-diagram-3"></i><h5>No channels yet</h5><p>Add an OTA or customised channel to start listing rooms and rate plans on it.</p></div></div>`;
}

// Grid/List view toggle — persisted per-browser so it sticks across visits, same pattern as
// the Competitors page's own Grid/List toggle.
let roomsView = localStorage.getItem('hop_rooms_view') === 'list' ? 'list' : 'grid';
function setRoomsView(view){
  roomsView = view;
  localStorage.setItem('hop_rooms_view', view);
  document.getElementById('rm_viewGrid').classList.toggle('btn-primary', view==='grid');
  document.getElementById('rm_viewGrid').classList.toggle('btn-soft', view!=='grid');
  document.getElementById('rm_viewList').classList.toggle('btn-primary', view==='list');
  document.getElementById('rm_viewList').classList.toggle('btn-soft', view!=='list');
  document.getElementById('roomsGrid').classList.toggle('d-none', view!=='grid');
  document.getElementById('roomsListWrap').classList.toggle('d-none', view!=='list');
}

function renderRooms(){
  const p = currentProperty;
  const channelId = document.getElementById('roomsChannelFilter').value;
  let rooms = DB.rooms.byProperty(p.id);
  if(channelId) rooms = rooms.filter(r=>r.channelId===channelId);
  const canEdit = RBAC.can(RBAC.MODULES.ROOMS, 'edit');
  const canDelete = RBAC.can(RBAC.MODULES.ROOMS, 'delete');
  document.getElementById('roomsCount').textContent = `${rooms.length} room type(s)`;

  document.getElementById('roomsGrid').innerHTML = rooms.length ? rooms.map(r=>`
    <div class="col-md-6 col-xl-4">
      <div class="room-card h-100">
        <div class="room-img" style="background-image:url('${r.img}')"></div>
        <div class="room-body">
          <div class="mb-1">${channelBadge(r.channelId)}</div>
          <h6 class="fw-bold mb-1">${r.name}</h6>
          <div class="room-cap mb-2"><i class="bi bi-people me-1"></i>${r.capacity} guests • ${r.bedType}</div>
          <div class="mb-2">${(r.mealPlans||[]).map(mp=>`<span class="badge bg-light text-dark border me-1" style="font-size:.68rem" title="${DB.MEAL_LABELS[mp]}">${mp}</span>`).join('')}</div>
          <div class="d-flex justify-content-between align-items-center">
            <span class="fw-bold text-primary">${APP.fmtCurrency(r.basePrice)}<small class="text-muted fw-normal">/night</small></span>
            <div class="d-flex gap-1">
              ${canEdit ? `<a href="add-room.html?id=${r.id}" class="btn btn-sm-icon btn-soft" title="Edit"><i class="bi bi-pencil"></i></a>` : ''}
              ${canDelete ? `<button class="btn btn-sm-icon btn-light-danger" title="Delete" onclick="deletePropertyRoom('${r.id}')"><i class="bi bi-trash3"></i></button>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>`).join('') : `<div class="col-12"><div class="empty-state"><i class="bi bi-door-closed"></i><h5>No rooms yet</h5><p>Add a room type to this channel.</p></div></div>`;

  document.getElementById('roomsListBody').innerHTML = rooms.length ? rooms.map(r=>`
    <tr>
      <td class="fw-semibold">${r.name}</td>
      <td>${channelBadge(r.channelId)}</td>
      <td>${r.bedType}</td>
      <td class="text-center">${r.capacity} guests</td>
      <td>${(r.mealPlans||[]).map(mp=>`<span class="badge bg-light text-dark border me-1" style="font-size:.68rem" title="${DB.MEAL_LABELS[mp]}">${mp}</span>`).join('') || '—'}</td>
      <td class="text-end fw-semibold">${APP.fmtCurrency(r.basePrice)}</td>
      <td class="text-end">
        ${canEdit ? `<a href="add-room.html?id=${r.id}" class="btn btn-sm-icon btn-soft" title="Edit"><i class="bi bi-pencil"></i></a>` : ''}
        ${canDelete ? `<button class="btn btn-sm-icon btn-light-danger" title="Delete" onclick="deletePropertyRoom('${r.id}')"><i class="bi bi-trash3"></i></button>` : ''}
      </td>
    </tr>`).join('') : `<tr><td colspan="7"><div class="empty-state"><i class="bi bi-door-closed"></i><h5>No rooms yet</h5><p>Add a room type to this channel.</p></div></td></tr>`;
}

function renderRatePlans(){
  const p = currentProperty;
  const channelId = document.getElementById('rpChannelFilter').value;
  let ratePlans = DB.ratePlans.byProperty(p.id);
  if(channelId) ratePlans = ratePlans.filter(rp=>rp.channelId===channelId);
  const canEdit = RBAC.can(RBAC.MODULES.RATE_PLANS, 'edit');
  const canDelete = RBAC.can(RBAC.MODULES.RATE_PLANS, 'delete');
  document.getElementById('rpCount').textContent = `${ratePlans.length} rate plan(s)`;
  document.getElementById('rpBody').innerHTML = ratePlans.length ? ratePlans.map(rp=>{
    const room = DB.rooms.get(rp.roomId);
    return `<tr>
      <td class="fw-semibold">${rp.name}</td>
      <td>${channelBadge(rp.channelId)}</td>
      <td>${room?room.name:'-'}</td>
      <td><span class="badge bg-primary-subtle text-primary">${rp.mealPlan}</span></td>
      <td class="small text-muted">${rp.refundable?'Refundable':'Non-Refundable'}</td>
      <td><span class="badge-status ${rp.status==='active'?'badge-active':'badge-inactive'}">${rp.status}</span></td>
      <td class="text-end">
        ${canEdit ? `<button class="btn btn-sm-icon btn-soft" title="Set Price for Date Range" onclick="openPriceRangeModal('${rp.id}')"><i class="bi bi-calendar-range"></i></button>` : ''}
        ${canEdit ? `<a href="add-rate-plan.html?id=${rp.id}" class="btn btn-sm-icon btn-outline-primary" title="Edit Rate Plan"><i class="bi bi-pencil"></i></a>` : ''}
        ${canDelete ? `<button class="btn btn-sm-icon btn-light-danger" title="Delete Rate Plan" onclick="deletePropertyRatePlan('${rp.id}')"><i class="bi bi-trash3"></i></button>` : ''}
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty-state"><i class="bi bi-tags"></i><h5>No rate plans</h5></div></td></tr>`;
}

function openPriceRangeModal(ratePlanId){
  const rp = DB.ratePlans.get(ratePlanId);
  if(!rp) return;
  const room = DB.rooms.get(rp.roomId);
  document.getElementById('prPlanName').textContent = `${rp.name}${room?` — ${room.name}`:''}`;
  document.getElementById('prStart').value = '';
  document.getElementById('prEnd').value = '';
  document.getElementById('prPrice').value = '';
  document.getElementById('prApply').onclick = ()=>{
    const start = document.getElementById('prStart').value;
    const end = document.getElementById('prEnd').value;
    const price = Number(document.getElementById('prPrice').value);
    if(!start || !end){ APP.toast('Missing Dates', 'Please pick a start and end date.', 'danger'); return; }
    if(start > end){ APP.toast('Invalid Range', 'The start date must be before the end date.', 'danger'); return; }
    if(!price || price<=0){ APP.toast('Invalid Price', 'Please enter a price greater than 0.', 'danger'); return; }
    const maxOcc = Math.max((room && room.maxOccupancy) || 1, rp.baseOccupancy || 1);
    DB.rates.setRange(rp.id, start, end, price, rp.baseOccupancy, rp.extraAdultPrice, maxOcc);
    bootstrap.Modal.getInstance(document.getElementById('priceRangeModal')).hide();
    APP.toast('Pricing Range Applied', `${rp.name} updated for ${start} – ${end}.`, 'success');
  };
  new bootstrap.Modal(document.getElementById('priceRangeModal')).show();
}

function renderContact(){
  const p = currentProperty;
  document.getElementById('c_phone').textContent = p.phone;
  document.getElementById('c_email').textContent = p.email;
  document.getElementById('c_website').textContent = p.website;
  document.getElementById('c_address').textContent = p.address;
  document.getElementById('c_amenities').innerHTML = (p.amenities||[]).map(a=>`<span class="badge bg-light text-dark border me-2 mb-2 py-2 px-3"><i class="bi bi-check2 text-success me-1"></i>${a}</span>`).join('') || '<span class="text-muted small">No amenities listed</span>';
}

function deletePropertyChannel(channelId){
  if(!RBAC.can(RBAC.MODULES.CHANNELS, 'delete')){ APP.toast('Not Allowed', 'You do not have permission to delete channels.', 'danger'); return; }
  const c = DB.channels.get(channelId);
  if(c.type==='master'){ APP.toast('Not Allowed', 'The Master Channel cannot be deleted.', 'danger'); return; }
  APP.confirmModal({
    title:'Delete Channel?', message:`Delete "${c.name}"? All rooms and rate plans listed on this channel will also be removed.`,
    confirmText:'Delete', danger:true,
    onConfirm: ()=>{
      DB.channels.remove(channelId);
      APP.toast('Channel Deleted', `${c.name} removed.`, 'danger');
      populateChannelFilters(); renderChannels(); renderRooms(); renderRatePlans(); renderOverview();
    }
  });
}

function deletePropertyRoom(roomId){
  if(!RBAC.can(RBAC.MODULES.ROOMS, 'delete')){ APP.toast('Not Allowed', 'You do not have permission to delete rooms.', 'danger'); return; }
  const r = DB.rooms.get(roomId);
  APP.confirmModal({
    title:'Delete Room Type?', message:`Delete "${r.name}"? Linked rate plans will also be removed.`,
    confirmText:'Delete', danger:true,
    onConfirm: ()=>{ DB.rooms.remove(roomId); APP.toast('Room Deleted', `${r.name} removed.`, 'danger'); renderRooms(); renderRatePlans(); renderOverview(); renderChannels(); }
  });
}

function deletePropertyRatePlan(ratePlanId){
  if(!RBAC.can(RBAC.MODULES.RATE_PLANS, 'delete')){ APP.toast('Not Allowed', 'You do not have permission to delete rate plans.', 'danger'); return; }
  const rp = DB.ratePlans.get(ratePlanId);
  APP.confirmModal({
    title:'Delete Rate Plan?', message:`Delete "${rp.name}"? All associated pricing calendar data will be removed.`,
    confirmText:'Delete', danger:true,
    onConfirm: ()=>{ DB.ratePlans.remove(ratePlanId); APP.toast('Rate Plan Deleted', `${rp.name} removed.`, 'danger'); renderRatePlans(); renderOverview(); }
  });
}
