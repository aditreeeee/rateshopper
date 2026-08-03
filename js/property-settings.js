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

  document.getElementById('s_alertCompetitorChange').checked = s.alertCompetitorChange;
  document.getElementById('s_alertNewLowest').checked = s.alertNewLowest;
  document.getElementById('s_alertParityMismatch').checked = s.alertParityMismatch;
  document.getElementById('s_alertMissingRate').checked = s.alertMissingRate;
  document.getElementById('s_alertLargeIncrease').checked = s.alertLargeIncrease;
  document.getElementById('s_alertLargeDecrease').checked = s.alertLargeDecrease;
  document.getElementById('s_alertNewMappedRoom').checked = s.alertNewMappedRoom;
  document.getElementById('s_defaultRangeDays').value = s.defaultRangeDays;

  // Appearance applies immediately (same as the topbar's own theme toggle) rather than waiting
  // on the form's Save button — a theme switch isn't the kind of setting anyone expects to have
  // to "save" before it takes effect.
  document.getElementById('s_themeToggle').addEventListener('click', ()=> APP.toggleTheme());

  document.getElementById('settingsForm').addEventListener('submit', function(e){
    e.preventDefault();
    const updated = {
      alertCompetitorChange: document.getElementById('s_alertCompetitorChange').checked,
      alertNewLowest: document.getElementById('s_alertNewLowest').checked,
      alertParityMismatch: document.getElementById('s_alertParityMismatch').checked,
      alertMissingRate: document.getElementById('s_alertMissingRate').checked,
      alertLargeIncrease: document.getElementById('s_alertLargeIncrease').checked,
      alertLargeDecrease: document.getElementById('s_alertLargeDecrease').checked,
      alertNewMappedRoom: document.getElementById('s_alertNewMappedRoom').checked,
      defaultRangeDays: Number(document.getElementById('s_defaultRangeDays').value)
    };
    PORTALDATA.saveSettings(propertyId, updated);
    APP.toast('Settings Saved', 'Your preferences have been updated.', 'success');
  });
});
