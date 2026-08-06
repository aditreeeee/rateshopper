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
  PWIDGETS.initTabbar('detailTabs');

  const canCreateChannel = RBAC.can(RBAC.MODULES.CHANNELS, 'create');
  const addChannelBtn = document.getElementById('addChannelBtn');
  if(canCreateChannel){ addChannelBtn.href = `add-channel.html?propertyId=${p.id}`; } else { addChannelBtn.classList.add('d-none'); }

  const canCreateRoom = RBAC.can(RBAC.MODULES.ROOMS, 'create');
  const addRoomBtn = document.getElementById('addRoomBtn');
  if(canCreateRoom){ addRoomBtn.href = `add-room.html?propertyId=${p.id}`; } else { addRoomBtn.classList.add('d-none'); }
  const importRoomsBtn = document.getElementById('importRoomsBtn');
  if(canCreateRoom){ importRoomsBtn.addEventListener('click', openImportRoomsModal); } else { importRoomsBtn.classList.add('d-none'); }

  const canCreateRatePlan = RBAC.can(RBAC.MODULES.RATE_PLANS, 'create');
  const addRpBtn = document.getElementById('addRpBtn');
  if(canCreateRatePlan){ addRpBtn.href = `add-rate-plan.html?propertyId=${p.id}`; } else { addRpBtn.classList.add('d-none'); }
  const importRpBtn = document.getElementById('importRpBtn');
  if(canCreateRatePlan){ importRpBtn.addEventListener('click', openImportRpModal); } else { importRpBtn.classList.add('d-none'); }

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
  document.getElementById('rpMealFilter').addEventListener('change', renderRatePlans);

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

  // Rate Plans' Channel filter groups its options under <optgroup> labels (Direct / OTA
  // Channels / Customised Channels, from each channel's own `type`) instead of one flat list —
  // a property with many OTA channels reads far faster grouped than alphabetically flat.
  const GROUP_LABELS = { master:'Direct', custom:'Customised Channels' };
  const groups = { master:[], ota:[], custom:[] };
  channels.forEach(c=>{
    (DB.OTA_CHANNEL_TYPES.includes(c.type) ? groups.ota : (groups[c.type] || groups.custom)).push(c);
  });
  const groupHtml = (label, list)=> list.length
    ? `<optgroup label="${label}">${list.map(c=>`<option value="${c.id}">${c.name}</option>`).join('')}</optgroup>` : '';
  document.getElementById('rpChannelFilter').innerHTML = `<option value="">All Channels</option>` +
    groupHtml(GROUP_LABELS.master, groups.master) +
    groupHtml('OTA Channels', groups.ota) +
    groupHtml(GROUP_LABELS.custom, groups.custom);

  document.getElementById('rpMealFilter').innerHTML = `<option value="">All Meal Plans</option>` +
    DB.MEAL_PLANS.map(mp=>`<option value="${mp}" title="${DB.MEAL_LABELS[mp]}">${mp}</option>`).join('');
}

function renderOverview(){
  const p = currentProperty;
  const channels = DB.channels.byProperty(p.id);
  const rooms = DB.rooms.byProperty(p.id);
  const ratePlans = DB.ratePlans.byProperty(p.id);
  const totalInv = rooms.reduce((s,r)=>s+r.totalRooms,0);

  document.getElementById('p_stats').innerHTML = [
    {label:'Channels', value:channels.length, icon:'bi-diagram-3', color:'#8c5cf7', bg:'#f3edff'},
    {label:'Room Types', value:rooms.length, icon:'bi-door-open', color:'#0041d9', bg:'#e6e6fa'},
    {label:'Rate Plans', value:ratePlans.length, icon:'bi-tags', color:'#0073cf', bg:'#dceefc'}
  ].map(s=>`<div class="col-md-4 col-xl-3 col-6"><div class="stat-card"><div class="stat-icon" style="background:${s.bg};color:${s.color}"><i class="bi ${s.icon}"></i></div><div><div class="stat-label">${s.label}</div><h3 style="font-size:1.25rem">${s.value}</h3></div></div></div>`).join('');

  document.getElementById('kv_hmsPropertyId').textContent = p.hmsPropertyId || '—';
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
          ${c.website ? `<div class="mt-1" style="font-size:.7rem"><i class="bi bi-link-45deg me-1"></i><a href="${/^https?:\/\//.test(c.website)?c.website:'https://'+c.website}" target="_blank" rel="noopener">${c.website}</a></div>` : ''}
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
  const canCreate = RBAC.can(RBAC.MODULES.ROOMS, 'create');
  const canDelete = RBAC.can(RBAC.MODULES.ROOMS, 'delete');
  document.getElementById('roomsCount').textContent = `${rooms.length} room type(s)`;

  // Grouped by channel (then sortOrder within each channel) so "move up/down" only ever means
  // "within this channel's own room list" — same reordering pattern as Rate Plans, scoped to
  // whichever grouping the plans/rooms actually belong to.
  rooms = [...rooms].sort((a,b)=>{
    const chanA = DB.channels.get(a.channelId), chanB = DB.channels.get(b.channelId);
    return (chanA?chanA.name:'').localeCompare(chanB?chanB.name:'') || (a.sortOrder||0)-(b.sortOrder||0);
  });
  function roomPos(r){
    const siblings = DB.rooms.byChannel(r.channelId).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
    const pos = siblings.findIndex(x=>x.id===r.id);
    return { isFirst: pos<=0, isLast: pos>=siblings.length-1 };
  }

  document.getElementById('roomsGrid').innerHTML = rooms.length ? rooms.map(r=>{
    const {isFirst, isLast} = roomPos(r);
    return `
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
              ${canEdit ? `
                <div class="btn-group btn-group-sm" role="group" aria-label="Reorder within channel">
                  <button class="btn btn-sm-icon btn-soft btn-reorder" title="Move up" ${isFirst?'disabled':''} onclick="moveRoom('${r.id}',-1)"><i class="bi bi-arrow-up"></i></button>
                  <button class="btn btn-sm-icon btn-soft btn-reorder" title="Move down" ${isLast?'disabled':''} onclick="moveRoom('${r.id}',1)"><i class="bi bi-arrow-down"></i></button>
                </div>` : ''}
              ${canEdit ? `<a href="add-room.html?id=${r.id}" class="btn btn-sm-icon btn-soft" title="Edit"><i class="bi bi-pencil"></i></a>` : ''}
              ${canCreate ? `<button class="btn btn-sm-icon btn-soft" title="Duplicate" onclick="duplicatePropertyRoom('${r.id}')"><i class="bi bi-copy"></i></button>` : ''}
              ${canDelete ? `<button class="btn btn-sm-icon btn-light-danger" title="Delete" onclick="deletePropertyRoom('${r.id}')"><i class="bi bi-trash3"></i></button>` : ''}
            </div>
          </div>
        </div>
      </div>
    </div>`;
  }).join('') : `<div class="col-12"><div class="empty-state"><i class="bi bi-door-closed"></i><h5>No rooms yet</h5><p>Add a room type to this channel.</p></div></div>`;

  document.getElementById('roomsListBody').innerHTML = rooms.length ? rooms.map(r=>{
    const {isFirst, isLast} = roomPos(r);
    return `
    <tr>
      <td class="fw-semibold">${r.name}</td>
      <td>${channelBadge(r.channelId)}</td>
      <td>${r.bedType}</td>
      <td class="text-center">${r.capacity} guests</td>
      <td>${(r.mealPlans||[]).map(mp=>`<span class="badge bg-light text-dark border me-1" style="font-size:.68rem" title="${DB.MEAL_LABELS[mp]}">${mp}</span>`).join('') || '—'}</td>
      <td class="text-end fw-semibold">${APP.fmtCurrency(r.basePrice)}</td>
      <td class="text-end">
        ${canEdit ? `
          <div class="btn-group btn-group-sm me-1" role="group" aria-label="Reorder within channel">
            <button class="btn btn-sm-icon btn-soft btn-reorder" title="Move up" ${isFirst?'disabled':''} onclick="moveRoom('${r.id}',-1)"><i class="bi bi-arrow-up"></i></button>
            <button class="btn btn-sm-icon btn-soft btn-reorder" title="Move down" ${isLast?'disabled':''} onclick="moveRoom('${r.id}',1)"><i class="bi bi-arrow-down"></i></button>
          </div>` : ''}
        ${canEdit ? `<a href="add-room.html?id=${r.id}" class="btn btn-sm-icon btn-soft" title="Edit"><i class="bi bi-pencil"></i></a>` : ''}
        ${canCreate ? `<button class="btn btn-sm-icon btn-soft" title="Duplicate" onclick="duplicatePropertyRoom('${r.id}')"><i class="bi bi-copy"></i></button>` : ''}
        ${canDelete ? `<button class="btn btn-sm-icon btn-light-danger" title="Delete" onclick="deletePropertyRoom('${r.id}')"><i class="bi bi-trash3"></i></button>` : ''}
      </td>
    </tr>`;
  }).join('') : `<tr><td colspan="7"><div class="empty-state"><i class="bi bi-door-closed"></i><h5>No rooms yet</h5><p>Add a room type to this channel.</p></div></td></tr>`;
}

// Swaps this room's sortOrder with its neighbor within the SAME channel's own ordered list
// (dir: -1 up, +1 down) — mirrors moveRatePlan() below, including the re-normalize-before-swap
// self-healing for rooms saved before sortOrder existed.
function moveRoom(roomId, dir){
  const r = DB.rooms.get(roomId);
  if(!r) return;
  const siblings = DB.rooms.byChannel(r.channelId)
    .sort((a,b)=> (a.sortOrder||0)-(b.sortOrder||0) || String(a.id).localeCompare(String(b.id)));
  siblings.forEach((s,i)=>{ if(s.sortOrder !== i){ s.sortOrder = i; DB.rooms.save(s); } });

  const idx = siblings.findIndex(x=>x.id===roomId);
  const swapIdx = idx + dir;
  if(swapIdx<0 || swapIdx>=siblings.length) return;
  DB.rooms.save({ ...siblings[idx], sortOrder: swapIdx });
  DB.rooms.save({ ...siblings[swapIdx], sortOrder: idx });
  renderRooms();
}

function renderRatePlans(){
  const p = currentProperty;
  const channelId = document.getElementById('rpChannelFilter').value;
  const mealPlan = document.getElementById('rpMealFilter').value;
  let ratePlans = DB.ratePlans.byProperty(p.id);
  if(channelId) ratePlans = ratePlans.filter(rp=>rp.channelId===channelId);
  if(mealPlan) ratePlans = ratePlans.filter(rp=>rp.mealPlan===mealPlan);
  const canEdit = RBAC.can(RBAC.MODULES.RATE_PLANS, 'edit');
  const canCreate = RBAC.can(RBAC.MODULES.RATE_PLANS, 'create');
  const canDelete = RBAC.can(RBAC.MODULES.RATE_PLANS, 'delete');
  document.getElementById('rpCount').textContent = `${ratePlans.length} rate plan(s)`;

  // Grouped by ROOM NAME (not room record/channel) — a room type is a separate DB record per
  // channel (its own id, own sortOrder), so a property with the same room type listed on several
  // channels would otherwise repeat that same room name as its own group over and over, once per
  // channel, for no useful reason — just wasted vertical space with nothing new to say. Grouping
  // by name merges all of a room type's plans together regardless of which channel each one is
  // actually on (still shown via each row's own Channel column). Sort order and Move Up/Down
  // stay scoped to each plan's own room record/channel exactly as before — only the VISUAL
  // grouping changes here.
  ratePlans = [...ratePlans].sort((a,b)=>{
    const roomA = DB.rooms.get(a.roomId), roomB = DB.rooms.get(b.roomId);
    return (roomA?roomA.name:'').localeCompare(roomB?roomB.name:'') || (a.sortOrder||0)-(b.sortOrder||0);
  });

  // Rendered as room group headers (reusing the .rc-group-row pattern from Room Rate
  // Comparison) rather than a per-row Room column — plans are already sorted room-by-room
  // above, so a header row per room reads faster than reading the same room name repeated
  // down a column, and it's one less column competing for width.
  const groups = {}; const roomNameOrder = [];
  ratePlans.forEach(rp=>{
    const room = DB.rooms.get(rp.roomId);
    const groupKey = room ? room.name : 'Unassigned Room';
    if(!groups[groupKey]){ groups[groupKey] = []; roomNameOrder.push(groupKey); }
    groups[groupKey].push(rp);
  });

  document.getElementById('rpBody').innerHTML = ratePlans.length ? roomNameOrder.map(groupKey=>{
    const roomPlans = groups[groupKey];
    const groupHeader = `<tr class="rc-group-row"><td colspan="6">
      <i class="bi bi-door-open me-2 text-muted"></i><strong>${groupKey}</strong>
      <span class="text-muted ms-2" style="font-size:.72rem">${roomPlans.length} rate plan${roomPlans.length===1?'':'s'}</span>
    </td></tr>`;
    return groupHeader + roomPlans.map(rp=>{
      const room = DB.rooms.get(rp.roomId);
      const roomSiblings = DB.ratePlans.byRoom(rp.roomId).sort((a,b)=>(a.sortOrder||0)-(b.sortOrder||0));
      const posInRoom = roomSiblings.findIndex(x=>x.id===rp.id);
      const isFirst = posInRoom<=0, isLast = posInRoom>=roomSiblings.length-1;
      return `<tr>
      <td class="fw-semibold">${rp.name}</td>
      <td>${channelBadge(rp.channelId)}</td>
      <td><span class="badge bg-primary-subtle text-primary">${rp.mealPlan}</span></td>
      <td class="small text-muted">${rp.refundable?'Refundable':'Non-Refundable'}</td>
      <td><span class="badge-status ${rp.status==='active'?'badge-active':'badge-inactive'}">${rp.status}</span></td>
      <td class="text-end">
        ${canEdit ? `
          <div class="btn-group btn-group-sm me-1" role="group" aria-label="Reorder within ${room?room.name:'room'}">
            <button class="btn btn-sm-icon btn-soft btn-reorder" title="Move up" ${isFirst?'disabled':''} onclick="moveRatePlan('${rp.id}',-1)"><i class="bi bi-arrow-up"></i></button>
            <button class="btn btn-sm-icon btn-soft btn-reorder" title="Move down" ${isLast?'disabled':''} onclick="moveRatePlan('${rp.id}',1)"><i class="bi bi-arrow-down"></i></button>
          </div>` : ''}
        ${canEdit ? `<a href="add-rate-plan.html?id=${rp.id}" class="btn btn-sm-icon btn-outline-primary" title="Edit Rate Plan"><i class="bi bi-pencil"></i></a>` : ''}
        ${canCreate ? `<button class="btn btn-sm-icon btn-soft" title="Duplicate" onclick="duplicatePropertyRatePlan('${rp.id}')"><i class="bi bi-copy"></i></button>` : ''}
        ${canDelete ? `<button class="btn btn-sm-icon btn-light-danger" title="Delete Rate Plan" onclick="deletePropertyRatePlan('${rp.id}')"><i class="bi bi-trash3"></i></button>` : ''}
      </td>
    </tr>`;
    }).join('');
  }).join('') : `<tr><td colspan="6"><div class="empty-state"><i class="bi bi-tags"></i><h5>No rate plans</h5></div></td></tr>`;
}

// Swaps this rate plan's sortOrder with its neighbor within the SAME room's own ordered list
// (dir: -1 up, +1 down) — reordering is always scoped to one room's plans, never across rooms,
// since "position" only means anything relative to the other plans on the same room.
function moveRatePlan(ratePlanId, dir){
  const rp = DB.ratePlans.get(ratePlanId);
  if(!rp) return;
  // Stable sort with an id tiebreaker, then re-normalize to guaranteed-distinct 0..n-1 sortOrder
  // values before swapping — if sortOrder was ever missing/duplicated on two siblings (e.g. a
  // rate plan saved before this feature existed), swapping their raw values directly would just
  // write the same number back to both and silently no-op instead of actually moving anything.
  const siblings = DB.ratePlans.byRoom(rp.roomId)
    .sort((a,b)=> (a.sortOrder||0)-(b.sortOrder||0) || String(a.id).localeCompare(String(b.id)));
  siblings.forEach((s,i)=>{ if(s.sortOrder !== i){ s.sortOrder = i; DB.ratePlans.save(s); } });

  const idx = siblings.findIndex(x=>x.id===ratePlanId);
  const swapIdx = idx + dir;
  if(swapIdx<0 || swapIdx>=siblings.length) return;
  DB.ratePlans.save({ ...siblings[idx], sortOrder: swapIdx });
  DB.ratePlans.save({ ...siblings[swapIdx], sortOrder: idx });
  renderRatePlans();
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

// ---- Duplicate ----
function duplicatePropertyRoom(roomId){
  if(!RBAC.can(RBAC.MODULES.ROOMS, 'create')){ APP.toast('Not Allowed', 'You do not have permission to create rooms.', 'danger'); return; }
  const r = DB.rooms.get(roomId);
  if(!r) return;
  const { id, ...rest } = r;
  const saved = DB.rooms.save({ ...rest, name: `${r.name} (Copy)` });
  APP.toast('Room Duplicated', `${saved.name} created from ${r.name}.`, 'success');
  renderRooms(); renderRatePlans(); renderOverview(); renderChannels();
}

function duplicatePropertyRatePlan(ratePlanId){
  if(!RBAC.can(RBAC.MODULES.RATE_PLANS, 'create')){ APP.toast('Not Allowed', 'You do not have permission to create rate plans.', 'danger'); return; }
  const rp = DB.ratePlans.get(ratePlanId);
  if(!rp) return;
  const { id, createdAt, ...rest } = rp;
  const saved = DB.ratePlans.save({ ...rest, name: `${rp.name} (Copy)` });
  APP.toast('Rate Plan Duplicated', `${saved.name} created from ${rp.name}.`, 'success');
  renderRatePlans(); renderOverview();
}

// ---- Import — paste-in CSV, one row per room/rate plan. Kept intentionally simple (no quoted-
// field support) since this is a bulk-entry convenience, not a general CSV parser. ----
function parseCsv(text){
  const lines = text.split('\n').map(l=>l.trim()).filter(Boolean);
  if(lines.length < 2) return { header:[], rows:[] };
  const header = lines[0].split(',').map(h=>h.trim());
  const rows = lines.slice(1).map(line=>{
    const cells = line.split(',').map(c=>c.trim());
    const row = {};
    header.forEach((h,i)=> row[h] = cells[i] !== undefined ? cells[i] : '');
    return row;
  });
  return { header, rows };
}

function openImportRoomsModal(){
  const p = currentProperty;
  const channels = DB.channels.byProperty(p.id);
  const sel = document.getElementById('importRoomsChannel');
  sel.innerHTML = channels.length ? channels.map(c=>`<option value="${c.id}">${c.name}</option>`).join('') : `<option value="">No channels — add one first</option>`;
  document.getElementById('importRoomsCsv').value = '';
  document.getElementById('importRoomsError').classList.add('d-none');
  new bootstrap.Modal(document.getElementById('importRoomsModal')).show();
}

document.addEventListener('DOMContentLoaded', ()=>{
  document.getElementById('importRoomsApply').addEventListener('click', ()=>{
    const errEl = document.getElementById('importRoomsError');
    errEl.classList.add('d-none');
    const channelId = document.getElementById('importRoomsChannel').value;
    if(!channelId){ errEl.textContent = 'Select a channel first.'; errEl.classList.remove('d-none'); return; }
    const { header, rows } = parseCsv(document.getElementById('importRoomsCsv').value);
    const required = ['name','category','bedType','size','capacity','maxOccupancy','totalRooms','basePrice','mealPlans','status'];
    const missing = required.filter(h=>!header.includes(h));
    if(!rows.length || missing.length){
      errEl.textContent = missing.length ? `Missing column(s): ${missing.join(', ')}.` : 'Paste at least one data row below the header.';
      errEl.classList.remove('d-none');
      return;
    }
    const p = currentProperty;
    let created = 0;
    rows.forEach(row=>{
      if(!row.name) return;
      DB.rooms.save({
        propertyId: p.id,
        channelId,
        name: row.name,
        category: row.category || 'Standard',
        bedType: row.bedType || 'Queen',
        size: Number(row.size) || 0,
        capacity: Number(row.capacity) || 1,
        maxOccupancy: Number(row.maxOccupancy) || Number(row.capacity) || 1,
        totalRooms: Number(row.totalRooms) || 1,
        basePrice: Number(row.basePrice) || 0,
        status: row.status === 'inactive' ? 'inactive' : 'active',
        img: 'https://images.unsplash.com/photo-1631049307264-da0ec9d70304?w=600',
        amenities: [],
        mealPlans: (row.mealPlans||'EP').split('|').map(m=>m.trim()).filter(Boolean)
      });
      created++;
    });
    bootstrap.Modal.getInstance(document.getElementById('importRoomsModal')).hide();
    APP.toast('Rooms Imported', `${created} room(s) created.`, 'success');
    renderRooms(); renderRatePlans(); renderOverview(); renderChannels();
  });

  document.getElementById('importRpApply').addEventListener('click', ()=>{
    const errEl = document.getElementById('importRpError');
    errEl.classList.add('d-none');
    const channelId = document.getElementById('importRpChannel').value;
    if(!channelId){ errEl.textContent = 'Select a channel first.'; errEl.classList.remove('d-none'); return; }
    const { header, rows } = parseCsv(document.getElementById('importRpCsv').value);
    const required = ['name','roomName','mealPlan','refundable','minStay','maxStay','cancellationPolicy','baseOccupancy','extraAdultPrice','extraChildPrice','status'];
    const missing = required.filter(h=>!header.includes(h));
    if(!rows.length || missing.length){
      errEl.textContent = missing.length ? `Missing column(s): ${missing.join(', ')}.` : 'Paste at least one data row below the header.';
      errEl.classList.remove('d-none');
      return;
    }
    const p = currentProperty;
    const roomsOnChannel = DB.rooms.byChannel(channelId);
    let created = 0;
    const notFound = [];
    rows.forEach(row=>{
      if(!row.name) return;
      const room = roomsOnChannel.find(r=>r.name.toLowerCase() === (row.roomName||'').toLowerCase());
      if(!room){ notFound.push(row.roomName || '(blank)'); return; }
      DB.ratePlans.save({
        propertyId: p.id,
        channelId,
        roomId: room.id,
        name: row.name,
        mealPlan: row.mealPlan || 'EP',
        refundable: String(row.refundable).toLowerCase() === 'true',
        minStay: Number(row.minStay) || 1,
        maxStay: Number(row.maxStay) || 30,
        cancellationPolicy: row.cancellationPolicy || 'Non-refundable. No changes or cancellations allowed.',
        baseOccupancy: Number(row.baseOccupancy) || 2,
        extraAdultPrice: Number(row.extraAdultPrice) || 0,
        extraChildPrice: Number(row.extraChildPrice) || 0,
        status: row.status === 'inactive' ? 'inactive' : 'active'
      });
      created++;
    });
    if(notFound.length){
      errEl.textContent = `Skipped row(s) — room not found on this channel: ${notFound.join(', ')}.`;
      errEl.classList.remove('d-none');
    }
    if(created){
      bootstrap.Modal.getInstance(document.getElementById('importRpModal')).hide();
      APP.toast('Rate Plans Imported', `${created} rate plan(s) created.`, 'success');
      renderRatePlans(); renderOverview();
    }
  });
});

function openImportRpModal(){
  const p = currentProperty;
  const channels = DB.channels.byProperty(p.id);
  const sel = document.getElementById('importRpChannel');
  sel.innerHTML = channels.length ? channels.map(c=>`<option value="${c.id}">${c.name}</option>`).join('') : `<option value="">No channels — add one first</option>`;
  document.getElementById('importRpCsv').value = '';
  document.getElementById('importRpError').classList.add('d-none');
  new bootstrap.Modal(document.getElementById('importRpModal')).show();
}
