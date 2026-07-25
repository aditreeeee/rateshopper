document.addEventListener('DOMContentLoaded', ()=>{
  if(!RBAC.requireRole()) return;

  APP.mount({
    title:'My Profile', subtitle:'Manage your personal account information.',
    breadcrumb:[{label:'Home',href:'dashboard.html'},{label:'Profile'}]
  });

  const me = RBAC.currentUser();
  document.getElementById('pf_avatarPreview').src = me.avatar;
  document.getElementById('pf_nameDisplay').textContent = me.name;
  document.getElementById('pf_roleDisplay').textContent = RBAC.ROLE_LABELS[me.role];
  document.getElementById('pf_emailDisplay').textContent = me.email;
  document.getElementById('pf_phoneDisplay').textContent = me.phone || '—';
  document.getElementById('pf_avatarUrl').value = me.avatar;
  document.getElementById('pf_name').value = me.name;
  document.getElementById('pf_role').value = RBAC.ROLE_LABELS[me.role];
  document.getElementById('pf_email').value = me.email;
  document.getElementById('pf_phone').value = me.phone || '';
  document.getElementById('pf_bio').value = me.bio || '';

  if(!RBAC.isCompanyLevel(me.role)){
    const names = (me.assignedProperties||[]).map(id=>{ const p = DB.properties.get(id); return p ? p.name : null; }).filter(Boolean);
    const note = document.createElement('div');
    note.className = 'kv-row';
    note.innerHTML = `<span class="k">Assigned Properties</span><span class="v">${names.join(', ') || '—'}</span>`;
    document.querySelector('.section-card:has(#pf_avatarPreview)')?.appendChild(note);
  }

  document.getElementById('pf_avatarUrl').addEventListener('input', function(){
    if(this.value) document.getElementById('pf_avatarPreview').src = this.value;
  });

  document.getElementById('profileForm').addEventListener('submit', function(e){
    e.preventDefault();
    const email = document.getElementById('pf_email').value.trim();
    const dupe = DB.users.byEmail(email);
    if(dupe && dupe.id !== me.id){
      APP.toast('Email Already In Use', 'Another account already uses that email address.', 'danger');
      return;
    }
    const updated = {
      ...me,
      name: document.getElementById('pf_name').value.trim(),
      email,
      phone: document.getElementById('pf_phone').value.trim(),
      bio: document.getElementById('pf_bio').value.trim(),
      avatar: document.getElementById('pf_avatarUrl').value.trim() || me.avatar
    };
    DB.users.save(updated);
    APP.toast('Profile Updated', 'Your profile has been saved successfully.', 'success');
    document.getElementById('pf_nameDisplay').textContent = updated.name;
    document.getElementById('pf_emailDisplay').textContent = updated.email;
    document.getElementById('pf_phoneDisplay').textContent = updated.phone || '—';
  });
});
