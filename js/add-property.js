const AMENITY_LIST = ['Free WiFi','Swimming Pool','Spa','Restaurant','Parking','Gym','Airport Shuttle','24x7 Front Desk','Bar','Conference Room','Room Service','Laundry'];
// The 5 channel types this app already special-cases for icon/color (js/data.js CHANNEL_TYPES) —
// shown as one-click checkboxes; anything else in the master catalog goes through "Other Channels" below.
const COMMON_CHANNEL_TYPES = ['booking','agoda','makemytrip','goibibo','yatra'];

document.addEventListener('DOMContentLoaded', ()=>{
  const editId = APP.qs('id');
  const existing = editId ? DB.properties.get(editId) : null;
  if(!RBAC.requireModuleAccess(RBAC.MODULES.PROPERTIES, existing ? 'edit' : 'create')) return;
  if(existing && !RBAC.canAccessProperty(existing.id)){ location.href = 'properties.html'; return; }

  const me = RBAC.currentUser();
  if(!existing && me.role === RBAC.ROLES.PROPERTY_OWNER && RBAC.propertyLimitRemaining(me) <= 0){
    APP.toast('Property Limit Reached', `You can only create up to ${me.propertyLimit} Parent Propert${me.propertyLimit===1?'y':'ies'}.`, 'danger');
    setTimeout(()=> location.href = 'properties.html', 900);
    return;
  }

  const limitNote = (!existing && me.role === RBAC.ROLES.PROPERTY_OWNER && me.propertyLimit != null)
    ? ` (${RBAC.propertyLimitRemaining(me)} of ${me.propertyLimit} remaining)` : '';
  APP.mount({
    title: existing ? 'Edit Property' : 'Add New Property',
    subtitle: (existing ? `Update details for ${existing.name}` : 'Create a new property listing for your portfolio.') + limitNote,
    breadcrumb:[{label:'Home',href:'dashboard.html'},{label:'Properties',href:'properties.html'},{label: existing ? 'Edit' : 'Add New'}]
  });

  document.getElementById('amenitiesGrid').innerHTML = AMENITY_LIST.map(a=>`
    <div class="col-md-4 col-6">
      <div class="form-check">
        <input class="form-check-input amenity-check" type="checkbox" value="${a}" id="am_${a.replace(/\s/g,'')}">
        <label class="form-check-label small" for="am_${a.replace(/\s/g,'')}">${a}</label>
      </div>
    </div>`).join('');

  const countries = [...new Set(DB.properties.all().map(p=>p.country).filter(Boolean))].sort();
  document.getElementById('countryList').innerHTML = countries.map(c=>`<option value="${c}">`).join('');

  /* ---- Channel Connections: pick from the master channel catalog, even before the property
     exists yet. A brand-new property starts with zero channels selected here — Direct never
     appears in this list at all (it's provisioned automatically, not a pickable "connection"),
     and any channel the property already has is excluded from every selector below so it can
     never be picked a second time — the available list is always "unassigned only". ---- */
  const canManageChannels = RBAC.can(RBAC.MODULES.CHANNELS, 'create');
  document.getElementById('channelsCard') && document.getElementById('channelsCard').classList.toggle('d-none', !canManageChannels);
  const existingChannels = existing ? DB.channels.byProperty(existing.id) : [];
  // Codes this property is already connected to (Direct/Master included) — permanently excluded
  // from every "available to add" list; nothing here can ever re-select an assigned channel.
  const assignedCodes = new Set(existingChannels.map(c=>c.channelCode));
  const alreadyConnected = existingChannels.filter(c=> c.channelCode !== DB.MASTER_CHANNEL_CODE);

  // Channels staged in this form session, not yet saved. Each entry's code is guaranteed unique
  // against both `assignedCodes` and every other entry already in this array.
  let toAdd = [];

  if(canManageChannels){
    const connectedWrap = document.getElementById('connectedChannelsWrap');
    if(alreadyConnected.length){
      connectedWrap.classList.remove('d-none');
      document.getElementById('connectedChannelsList').innerHTML = alreadyConnected.map(c=>`
        <span class="badge bg-light text-dark border d-inline-flex align-items-center gap-1" style="font-weight:500;padding:7px 12px">
          <i class="bi bi-check-circle-fill text-success"></i>${c.name}
          <span class="text-muted" style="font-size:.7rem">(${c.status})</span>
        </span>`).join('');
    } else {
      connectedWrap.classList.add('d-none');
    }

    // Every code that can never be picked from any selector: already-connected + already-staged.
    function unavailableCodes(){ return new Set([...assignedCodes, ...toAdd.map(c=>c.code)]); }

    function renderQuickAdd(){
      const unavailable = unavailableCodes();
      const chips = COMMON_CHANNEL_TYPES
        .filter(type=> !unavailable.has(DB.CHANNEL_TYPE_CODES[type]))
        .map(type=>{
          const meta = DB.CHANNEL_TYPES[type];
          return `<button type="button" class="btn btn-soft btn-sm quick-add-channel" data-type="${type}">
            <i class="bi ${meta.icon} me-1" style="color:${meta.color}"></i>${meta.label}
          </button>`;
        });
      const grid = document.getElementById('quickAddChannels');
      grid.innerHTML = chips.length ? chips.join('') : `<div class="text-muted small">All quick-add channels are already connected or staged below.</div>`;
    }

    function renderPicker(){
      const unavailable = unavailableCodes();
      const options = DB.CHANNEL_CATALOG.filter(entry=> !unavailable.has(entry.code));
      const picker = document.getElementById('f_channelPicker');
      picker.innerHTML = options.length
        ? `<option value="">Select a channel to add...</option>` + options.map(o=>`<option value="${o.code}">${o.name}</option>`).join('')
        : `<option value="">No unassigned channels left</option>`;
      picker.disabled = !options.length;
      document.getElementById('addChannelBtn').disabled = !options.length;
    }

    function renderToAdd(){
      const wrap = document.getElementById('channelsToAddWrap');
      wrap.classList.toggle('d-none', toAdd.length===0);
      document.getElementById('channelsToAddList').innerHTML = toAdd.map(c=>`
        <div class="d-flex align-items-center gap-2 p-2 border rounded-3" data-code="${c.code}" style="border-color:var(--border-1) !important">
          <i class="bi bi-globe2 text-muted"></i>
          <span class="flex-grow-1" style="font-size:.85rem">${c.name}</span>
          <select class="form-select form-select-sm to-add-status" data-code="${c.code}" style="width:112px">
            <option value="active" ${c.status==='active'?'selected':''}>Active</option>
            <option value="inactive" ${c.status==='inactive'?'selected':''}>Inactive</option>
          </select>
          <button type="button" class="btn btn-sm-icon btn-light-danger remove-to-add" data-code="${c.code}" title="Remove"><i class="bi bi-x-lg"></i></button>
        </div>`).join('');
    }

    function refreshAll(){ renderQuickAdd(); renderPicker(); renderToAdd(); }

    // Adding a channel (quick-add chip or the dropdown) immediately removes it from every
    // available list — no page refresh, no way to add it twice from this form.
    function addChannel(code){
      if(unavailableCodes().has(code)) return; // already connected or already staged — no-op
      const entry = DB.channelCatalogEntry(code);
      if(!entry) return;
      toAdd.push({ code, name:entry.name, status:'active' });
      refreshAll();
    }

    document.getElementById('quickAddChannels').addEventListener('click', e=>{
      const btn = e.target.closest('.quick-add-channel');
      if(!btn) return;
      addChannel(DB.CHANNEL_TYPE_CODES[btn.dataset.type]);
    });
    document.getElementById('addChannelBtn').addEventListener('click', ()=>{
      const code = Number(document.getElementById('f_channelPicker').value);
      if(!code) return;
      addChannel(code);
    });
    document.getElementById('channelsToAddList').addEventListener('change', e=>{
      if(!e.target.classList.contains('to-add-status')) return;
      const row = toAdd.find(c=>c.code===Number(e.target.dataset.code));
      if(row) row.status = e.target.value;
    });
    document.getElementById('channelsToAddList').addEventListener('click', e=>{
      const btn = e.target.closest('.remove-to-add');
      if(!btn) return;
      toAdd = toAdd.filter(c=>c.code!==Number(btn.dataset.code));
      refreshAll();
    });

    refreshAll();
  }

  if(existing){
    document.getElementById('submitLabel').textContent = 'Update Property';
    document.getElementById('f_name').value = existing.name;
    document.getElementById('f_type').value = existing.type;
    document.getElementById('f_country').value = existing.country || '';
    document.getElementById('f_state').value = existing.state || '';
    document.getElementById('f_city').value = existing.city;
    document.getElementById('f_stars').value = existing.stars;
    document.getElementById('f_currency').value = existing.currency || 'INR';
    document.getElementById('f_timezone').value = existing.timezone || '';
    document.getElementById('f_address').value = existing.address;
    document.getElementById('f_description').value = existing.description;
    document.getElementById('f_phone').value = existing.phone;
    document.getElementById('f_email').value = existing.email;
    document.getElementById('f_website').value = existing.website;
    document.getElementById('f_rooms').value = existing.rooms;
    document.getElementById('f_status').value = existing.status;
    document.getElementById('logoPreview').src = existing.logo;
    document.getElementById('logoUrlInput').value = existing.logo;
    (existing.amenities||[]).forEach(a=>{
      const el = document.getElementById('am_'+a.replace(/\s/g,''));
      if(el) el.checked = true;
    });
  }

  document.getElementById('logoUrlInput').addEventListener('input', function(){
    if(this.value) document.getElementById('logoPreview').src = this.value;
  });

  document.getElementById('propertyForm').addEventListener('submit', function(e){
    e.preventDefault();
    if(!this.checkValidity()){ this.reportValidity(); return; }

    const amenities = [...document.querySelectorAll('.amenity-check:checked')].map(c=>c.value);
    const payload = {
      id: existing ? existing.id : undefined,
      name: document.getElementById('f_name').value.trim(),
      type: document.getElementById('f_type').value,
      country: document.getElementById('f_country').value.trim(),
      state: document.getElementById('f_state').value.trim(),
      city: document.getElementById('f_city').value.trim(),
      stars: Number(document.getElementById('f_stars').value),
      currency: document.getElementById('f_currency').value,
      timezone: document.getElementById('f_timezone').value.trim(),
      address: document.getElementById('f_address').value.trim(),
      description: document.getElementById('f_description').value.trim(),
      phone: document.getElementById('f_phone').value.trim(),
      email: document.getElementById('f_email').value.trim(),
      website: document.getElementById('f_website').value.trim(),
      rooms: Number(document.getElementById('f_rooms').value)||0,
      status: document.getElementById('f_status').value,
      logo: document.getElementById('logoUrlInput').value.trim() || document.getElementById('logoPreview').src,
      amenities,
      ownerId: existing ? existing.ownerId : (me.role === RBAC.ROLES.PROPERTY_OWNER ? me.id : null),
      createdAt: existing ? existing.createdAt : undefined
    };
    const saved = DB.properties.save(payload);

    // Channel Connections — every staged channel is guaranteed new (never in `assignedCodes` or
    // duplicated within `toAdd`), and DB.channels.save() itself refuses a duplicate
    // propertyId+channelCode as a second line of defense.
    if(canManageChannels && toAdd.length){
      toAdd.forEach(c=>{
        const legacyType = Object.keys(DB.CHANNEL_TYPE_CODES).find(k=> DB.CHANNEL_TYPE_CODES[k]===c.code && k!=='master');
        DB.channels.save({ propertyId: saved.id, channelCode:c.code, type: legacyType || 'custom', name:c.name, status:c.status });
      });
    }

    APP.toast(existing?'Property Updated':'Property Added', `${saved.name} has been ${existing?'updated':'created'} successfully.`, 'success');
    setTimeout(()=> location.href = `property-details.html?id=${saved.id}`, 700);
  });
});
