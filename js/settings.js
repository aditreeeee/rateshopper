document.addEventListener('DOMContentLoaded', ()=>{
  if(!RBAC.requireRole(RBAC.ROLES.COMPANY_ADMIN)) return;

  APP.mount({
    title:'Settings', subtitle:'Configure company details, currency, taxes and preferences.',
    breadcrumb:[{label:'Home',href:'dashboard.html'},{label:'Settings'}]
  });

  document.querySelectorAll('#settingsTabs .nav-link').forEach(btn=>{
    btn.addEventListener('click', function(){
      document.querySelectorAll('#settingsTabs .nav-link').forEach(b=>b.classList.remove('active'));
      this.classList.add('active');
      ['company','currency','notif','prefs'].forEach(t=>document.getElementById('tab-'+t).classList.add('d-none'));
      document.getElementById('tab-'+this.dataset.tab).classList.remove('d-none');
    });
  });

  const s = DB.settings.get();
  document.getElementById('s_companyName').value = s.companyName||'';
  document.getElementById('s_companyEmail').value = s.companyEmail||'';
  document.getElementById('s_companyPhone').value = s.companyPhone||'';
  document.getElementById('s_timezone').value = s.timezone||'';
  document.getElementById('s_companyAddress').value = s.companyAddress||'';
  document.getElementById('s_currency').value = s.currency||'INR';
  document.getElementById('s_currencySymbol').value = s.currencySymbol||'₹';
  document.getElementById('s_dateFormat').value = s.dateFormat||'DD/MM/YYYY';
  document.getElementById('s_taxRate').value = s.taxRate||0;
  document.getElementById('s_serviceCharge').value = s.serviceCharge||0;
  document.getElementById('s_notifyBooking').checked = !!s.notifyBooking;
  document.getElementById('s_notifyCancellation').checked = !!s.notifyCancellation;
  document.getElementById('s_notifyRateChange').checked = !!s.notifyRateChange;

  function reflectTheme(){
    const t = APP.getTheme();
    document.getElementById('prefLight').classList.toggle('btn-soft', t==='light');
    document.getElementById('prefLight').classList.toggle('btn-outline-primary', t!=='light');
    document.getElementById('prefDark').classList.toggle('btn-soft', t==='dark');
    document.getElementById('prefDark').classList.toggle('btn-outline-primary', t!=='dark');
  }
  reflectTheme();
  document.getElementById('prefLight').addEventListener('click', ()=>{ APP.setTheme('light'); reflectTheme(); });
  document.getElementById('prefDark').addEventListener('click', ()=>{ APP.setTheme('dark'); reflectTheme(); });

  document.getElementById('settingsForm').addEventListener('submit', function(e){
    e.preventDefault();
    DB.settings.save({
      companyName: document.getElementById('s_companyName').value,
      companyEmail: document.getElementById('s_companyEmail').value,
      companyPhone: document.getElementById('s_companyPhone').value,
      companyAddress: document.getElementById('s_companyAddress').value,
      timezone: document.getElementById('s_timezone').value,
      currency: document.getElementById('s_currency').value,
      currencySymbol: document.getElementById('s_currencySymbol').value,
      dateFormat: document.getElementById('s_dateFormat').value,
      taxRate: Number(document.getElementById('s_taxRate').value),
      serviceCharge: Number(document.getElementById('s_serviceCharge').value),
      notifyBooking: document.getElementById('s_notifyBooking').checked,
      notifyCancellation: document.getElementById('s_notifyCancellation').checked,
      notifyRateChange: document.getElementById('s_notifyRateChange').checked,
      theme: APP.getTheme()
    });
    APP.toast('Settings Saved', 'Your preferences have been updated successfully.', 'success');
  });
});
