const AMENITY_LIST = ['Free WiFi','Swimming Pool','Spa','Restaurant','Parking','Gym','Airport Shuttle','24x7 Front Desk','Bar','Conference Room','Room Service','Laundry'];

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

  if(existing){
    document.getElementById('submitLabel').textContent = 'Update Property';
    document.getElementById('f_name').value = existing.name;
    document.getElementById('f_type').value = existing.type;
    document.getElementById('f_country').value = existing.country || '';
    document.getElementById('f_city').value = existing.city;
    document.getElementById('f_stars').value = existing.stars;
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
      city: document.getElementById('f_city').value.trim(),
      stars: Number(document.getElementById('f_stars').value),
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
    APP.toast(existing?'Property Updated':'Property Added', `${saved.name} has been ${existing?'updated':'created'} successfully.`, 'success');
    setTimeout(()=> location.href = `property-details.html?id=${saved.id}`, 700);
  });
});
