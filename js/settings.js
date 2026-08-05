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
  // Checkbox ON = category enabled (shown in the feed/bell badge) — the inverse of how they're
  // stored (settings.mutedNotifCategories lists only what's turned OFF), so a fresh install with
  // no saved preference yet defaults every category to visible instead of silently muted.
  const muted = new Set(s.mutedNotifCategories || []);
  document.getElementById('s_notifyAccounts').checked = !muted.has('accounts');
  document.getElementById('s_notifyAccess').checked = !muted.has('access');
  document.getElementById('s_notifySecurity').checked = !muted.has('security');

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

  // Switches to the tab containing a given field and focuses it — used when validation fails on
  // a field that isn't the currently-visible tab. Native `required`/min/max HTML5 validation is
  // silently skipped by the browser for any field inside a display:none ancestor (per spec,
  // elements that aren't rendered are barred from constraint validation), and this form's tabs
  // are exactly that (d-none on every tab but the active one) — so submitting from any tab other
  // than Company Information would otherwise let an empty/invalid Company Name or Email through
  // uncaught. Validating manually here, regardless of which tab is showing, closes that gap.
  function focusInTab(tab, fieldId){
    document.querySelectorAll('#settingsTabs .nav-link').forEach(b=>b.classList.toggle('active', b.dataset.tab===tab));
    ['company','currency','notif','prefs'].forEach(t=>document.getElementById('tab-'+t).classList.toggle('d-none', t!==tab));
    document.getElementById(fieldId).focus();
  }

  document.getElementById('settingsForm').addEventListener('submit', function(e){
    e.preventDefault();

    const companyName = document.getElementById('s_companyName').value.trim();
    const companyEmail = document.getElementById('s_companyEmail').value.trim();
    const taxRate = Number(document.getElementById('s_taxRate').value);
    const serviceCharge = Number(document.getElementById('s_serviceCharge').value);

    if(!companyName){
      APP.toast('Company Name Required', 'Enter a company name before saving.', 'danger');
      focusInTab('company', 's_companyName'); return;
    }
    if(!companyEmail || !/^\S+@\S+\.\S+$/.test(companyEmail)){
      APP.toast('Valid Company Email Required', 'Enter a valid company email address before saving.', 'danger');
      focusInTab('company', 's_companyEmail'); return;
    }
    if(!(taxRate>=0 && taxRate<=100)){
      APP.toast('Invalid Tax Rate', 'Tax Rate must be between 0 and 100.', 'danger');
      focusInTab('currency', 's_taxRate'); return;
    }
    if(!(serviceCharge>=0 && serviceCharge<=100)){
      APP.toast('Invalid Service Charge', 'Service Charge must be between 0 and 100.', 'danger');
      focusInTab('currency', 's_serviceCharge'); return;
    }

    DB.settings.save({
      companyName, companyEmail,
      companyPhone: document.getElementById('s_companyPhone').value,
      companyAddress: document.getElementById('s_companyAddress').value,
      timezone: document.getElementById('s_timezone').value,
      currency: document.getElementById('s_currency').value,
      currencySymbol: document.getElementById('s_currencySymbol').value,
      dateFormat: document.getElementById('s_dateFormat').value,
      taxRate, serviceCharge,
      mutedNotifCategories: [
        !document.getElementById('s_notifyAccounts').checked && 'accounts',
        !document.getElementById('s_notifyAccess').checked && 'access',
        !document.getElementById('s_notifySecurity').checked && 'security'
      ].filter(Boolean),
      theme: APP.getTheme()
    });
    APP.toast('Settings Saved', 'Your preferences have been updated successfully.', 'success');
  });
});
