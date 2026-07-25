document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Settings', subtitle:'Preferences for your Rate Shopper IQ portal.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  const s = PORTALDATA.settings(propertyId);
  const company = DB.settings.get();

  // Regional settings are company-wide, set by the Company Admin in Company Settings —
  // shown here read-only so this account always reflects the same units as the rest of the org.
  document.getElementById('s_currencyDisplay').textContent = `${company.currency||'INR'} (${company.currencySymbol||'₹'})`;
  document.getElementById('s_timezoneDisplay').textContent = company.timezone || 'Not set';
  document.getElementById('s_dateFormatDisplay').textContent = company.dateFormat || 'DD/MM/YYYY';

  document.getElementById('s_notifyRate').checked = s.notifyRate;
  document.getElementById('s_notifyParity').checked = s.notifyParity;
  document.getElementById('s_notifyCompetitor').checked = s.notifyCompetitor;
  document.getElementById('s_notifyMarket').checked = s.notifyMarket;
  document.getElementById('s_notifyDemand').checked = s.notifyDemand;
  document.getElementById('s_dashboardLayout').value = s.dashboardLayout;
  document.getElementById('s_defaultRangeDays').value = s.defaultRangeDays;
  document.getElementById('s_theme').value = APP.getTheme();

  document.getElementById('settingsForm').addEventListener('submit', function(e){
    e.preventDefault();
    const updated = {
      notifyRate: document.getElementById('s_notifyRate').checked,
      notifyParity: document.getElementById('s_notifyParity').checked,
      notifyCompetitor: document.getElementById('s_notifyCompetitor').checked,
      notifyMarket: document.getElementById('s_notifyMarket').checked,
      notifyDemand: document.getElementById('s_notifyDemand').checked,
      dashboardLayout: document.getElementById('s_dashboardLayout').value,
      defaultRangeDays: Number(document.getElementById('s_defaultRangeDays').value)
    };
    PORTALDATA.saveSettings(propertyId, updated);
    APP.setTheme(document.getElementById('s_theme').value);
    APP.toast('Settings Saved', 'Your preferences have been updated.', 'success');
  });
});
