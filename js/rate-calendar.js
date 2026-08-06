/* ==========================================================================
   Rate Calendar — Flagship feature: enterprise-grade grid pricing management
   Dates run across the top starting today; rooms > rate plans > occupancy run down the side.
   ========================================================================== */
// The left/right edge-scroll zones must sit exactly over the date header row and nowhere else —
// and, now that they render as a visible glass button rather than an invisible hover zone, they
// need to land exactly at the table's own visible edges (overlaying the first/last visible date
// column), not just somewhere near the card's edge. Both `top` (via thead) AND `left`/`right`
// (via the wrap's own rect) are measured directly rather than assumed from CSS positioning:
// absolutely-positioned children of `card` measure their offsets from card's padding EDGE (flush
// with its border), not from where card's own padding lets its content actually start — a
// hardcoded `right:8px`, for instance, would sit ~14px past the table's real right edge, "hovering
// outside" it in the card's own padding gutter. Measuring both elements' real
// getBoundingClientRect and taking the difference sidesteps that padding-box confusion entirely.
function alignEdgeZonesToHeader(card, host, leftId, rightId){
  const wrap = host && (host.querySelector('.grid-table-wrap') || host.querySelector('.grid-header-scroll'));
  const thead = host && host.querySelector('thead');
  if(!thead || !wrap || !card) return;
  const cardRect = card.getBoundingClientRect();
  const theadRect = thead.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const top = theadRect.top - cardRect.top;
  const h = theadRect.height;
  const stickyEl = wrap.querySelector('.grid-sticky-col');
  const stickyWidth = stickyEl ? stickyEl.getBoundingClientRect().width : 230;

  const leftEl = document.getElementById(leftId);
  if(leftEl){
    leftEl.style.top = `${top}px`; leftEl.style.height = `${h}px`;
    // Sits INSIDE the end of the sticky column, not spilling over into the first date column, so
    // the first date column starts exactly where it should. A small gap (not flush/touching)
    // keeps it visually connected to the Property/Room column it belongs to, rather than reading
    // as glued directly onto the date header next to it.
    const leftElWidth = leftEl.getBoundingClientRect().width || 34;
    const gap = 6;
    leftEl.style.left = `${(wrapRect.left - cardRect.left) + stickyWidth - leftElWidth - gap}px`;
    leftEl.style.right = 'auto';
  }
  const rightEl = document.getElementById(rightId);
  if(rightEl){
    rightEl.style.top = `${top}px`; rightEl.style.height = `${h}px`;
    rightEl.style.right = `${cardRect.right - wrapRect.right}px`;
    rightEl.style.left = 'auto';
  }
}

// Same padding-edge quirk as alignEdgeZonesToHeader, but for the top/bottom vertical hover-scroll
// zones: a CSS `bottom:0` on .mx-edge-bottom sits flush with `card`'s own border, not with where
// `wrap` (the actual scrollable table) ends — which left it overlapping wrap's own horizontal
// scrollbar and silently swallowing every mouse-down meant for the scrollbar thumb (dragging it
// did nothing). Pin the zone's `bottom` offset to (card.bottom - wrap.bottom) + scrollbarHeight so
// its bottom edge lands exactly above the scrollbar strip, computed fresh since the wrap is
// rebuilt on every render.
function alignVerticalEdgeZones(card, wrap, topId, bottomId, scrollbarHeight){
  if(!card || !wrap) return;
  const cardRect = card.getBoundingClientRect();
  const wrapRect = wrap.getBoundingClientRect();
  const bottomEl = document.getElementById(bottomId);
  if(bottomEl) bottomEl.style.bottom = `${Math.max(0, (cardRect.bottom - wrapRect.bottom) + scrollbarHeight)}px`;
  const topEl = document.getElementById(topId);
  if(topEl) topEl.style.top = `${Math.max(0, wrapRect.top - cardRect.top)}px`;
}

// Shrink date columns to divide the wrap's actual available width evenly when there are few
// enough of them (7D/14D) that doing so keeps every column comfortably readable — this is what
// actually removes the horizontal scrollbar for those ranges instead of just hoping the CSS
// min-width floor (92px) happens to fit. Wider ranges (30D/90D) would only become unreadably
// thin if forced to fit one screen, so they keep the normal min-width+scroll behavior instead
// (inline sizing is cleared back to stylesheet-driven defaults in that case).
const FIT_TO_WIDTH_MAX_DAYS = 14;
function fitDateColumnsToWidth(host, dayCount){
  const wrap = host && host.querySelector('.grid-table-wrap');
  if(!wrap) return;
  const cols = wrap.querySelectorAll('.grid-date-col, .grid-price-cell');
  if(dayCount > FIT_TO_WIDTH_MAX_DAYS){
    cols.forEach(el=>{ el.style.width = ''; el.style.minWidth = ''; el.style.maxWidth = ''; });
    return;
  }
  const stickyEl = wrap.querySelector('.grid-sticky-col');
  const stickyWidth = stickyEl ? stickyEl.getBoundingClientRect().width : 230;
  const perCol = Math.floor((wrap.clientWidth - stickyWidth) / dayCount);
  cols.forEach(el=>{
    el.style.width = `${perCol}px`; el.style.minWidth = `${perCol}px`; el.style.maxWidth = `${perCol}px`;
  });
}

// Cross-fade a grid re-render instead of swapping its content instantly. Swapping content after
// a single requestAnimationFrame (~16ms after the fade-out class was added) is nowhere near
// enough time for the opacity transition (220ms, matching #gridHost/#parityGridHost's CSS
// transition-duration) to actually get low — the column-count/width jump was happening in full
// view; the "fade" never got a chance to mask it. This defers the re-render until the fade-out
// transition has actually finished.
const GRID_FADE_MS = 220;
function fadeAndRerender(host, renderFn){
  host.classList.add('mx-grid-fade');
  setTimeout(()=>{
    renderFn();
    requestAnimationFrame(()=> host.classList.remove('mx-grid-fade'));
  }, GRID_FADE_MS);
}

let calRangeStart = null, calRangeEnd = null; // the calendar's active date range — drives the grid, bulk-update scopes, and Rate Parity alike
let calPreset = 'next14';
// Labels for the quick-range dropdown's own button — kept alongside calPresetRange() so the
// button always shows which quick range (if any) is actually active, instead of a static label.
const CAL_QUICK_RANGE_LABELS = { thisWeek:'This Week', nextWeek:'Next Week', next14:'Next 14 Days', next30:'Next 30 Days', next90:'Next 90 Days' };
let calApplyRange = null; // set inside setupDateRangePicker() — exposed at module scope so calShiftRange (called from the edge-scroll wiring, outside that closure) can reach it
let gridWorking = {};             // { ratePlanId: { dateKey: {price, occPrices:{occ:price}} } }
let gridHistory = [];             // undo stack of gridWorking snapshots
let gridDirty = false;
let currentPropertyId = null;     // resolved once from ?propertyId= / ?ratePlanId= — no in-page property switcher
let currentChannelId = '';        // always a specific channel id — defaults to the property's Master Channel
let currentRoomFilter = '';       // '' = All Rooms, otherwise narrows the grid to a single room
let canEditRates = false;         // RBAC.can(RATE_CALENDAR,'edit') — gates inline edit, bulk update, save/cancel/undo

// ---- date helpers shared by the range picker, the grid, bulk-update scopes, and Rate Parity ----
function calStartOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function calAddDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function calAddMonths(d,n){ const x=new Date(d); x.setMonth(x.getMonth()+n); return x; }
function calSameDay(a,b){ return !!a && !!b && a.toDateString()===b.toDateString(); }
function calFmtShort(d){ return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
function calPresetRange(key){
  const today = calStartOfDay(new Date());
  if(key==='today') return { start:today, end:today };
  if(key==='yesterday'){ const y=calAddDays(today,-1); return { start:y, end:y }; }
  // This/Next Week both run Sunday–Saturday, matching the custom-range calendar's own week
  // layout below (its grid starts each row on Sunday) — so "this week" always means the same
  // week the picker itself would show as the current row, not a rolling 7-days-from-today window.
  if(key==='thisWeek'){ const start = calAddDays(today, -today.getDay()); return { start, end: calAddDays(start,6) }; }
  if(key==='nextWeek'){ const start = calAddDays(today, -today.getDay()+7); return { start, end: calAddDays(start,6) }; }
  if(key==='next14' || key==='14') return { start:today, end:calAddDays(today,13) };
  if(key==='next30' || key==='30') return { start:today, end:calAddDays(today,29) };
  if(key==='next90') return { start:today, end:calAddDays(today,89) };
  if(key==='7') return { start:today, end:calAddDays(today,6) };
  if(key==='lastMonth'){
    const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthEnd = calAddDays(firstOfThisMonth,-1);
    const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
    return { start:lastMonthStart, end:lastMonthEnd };
  }
  return { start:today, end:calAddDays(today,13) };
}
// Every date in the currently selected range (inclusive) — shared by the grid, bulk-update
// "Currently Visible"/"Weekends Only" scopes, and Rate Parity, so they all always agree.
function currentDates(){
  const dates = [];
  let d = new Date(calRangeStart);
  while(d <= calRangeEnd){ dates.push(new Date(d)); d = calAddDays(d,1); }
  return dates;
}

document.addEventListener('DOMContentLoaded', ()=>{
  // This page only ever loads inside the property's own "Rate Calendar" tab (an iframe) —
  // there is no standalone/top-level page for it, so we skip the app shell (sidebar/topbar) entirely.
  document.documentElement.setAttribute('data-theme', APP.getTheme());
  document.body.classList.add('cal-embed');
  document.getElementById('app-shell').classList.add('p-3');
  const toastStack = document.createElement('div');
  toastStack.className = 'toast-stack'; toastStack.id = 'toast-stack';
  document.body.appendChild(toastStack);

  // Resolve the property purely from the URL — ?ratePlanId=xxx or ?propertyId=xxx.
  // There is no in-page property switcher; this page is always opened scoped to one property.
  const deepPlanId = APP.qs('ratePlanId');
  const deepPropertyId = APP.qs('propertyId');
  const deepPlan = deepPlanId ? DB.ratePlans.get(deepPlanId) : null;
  if(deepPlan){ currentPropertyId = deepPlan.propertyId; }
  else if(deepPropertyId && DB.properties.get(deepPropertyId)){ currentPropertyId = deepPropertyId; }
  else { currentPropertyId = (DB.properties.all()[0] || {}).id || null; }

  if(!RBAC.currentUser() || !RBAC.can(RBAC.MODULES.RATE_CALENDAR, 'view') || !RBAC.canAccessProperty(currentPropertyId)){
    document.getElementById('app-shell').innerHTML = `<div class="empty-state"><i class="bi bi-shield-lock"></i><h5>Access denied</h5><p class="mb-0">You don't have permission to view this property's rate calendar.</p></div>`;
    return;
  }
  canEditRates = RBAC.can(RBAC.MODULES.RATE_CALENDAR, 'edit');
  if(!canEditRates){
    document.getElementById('btnBulkUpdate').classList.add('d-none');
    document.getElementById('btnUndo').classList.add('d-none');
    document.getElementById('btnCancelChanges').classList.add('d-none');
    document.getElementById('btnSaveChanges').classList.add('d-none');
  }

  // Channel filter defaults to the Master Channel — there is no "All Channels" option here;
  // switch channels explicitly to see/edit that channel's own rooms and rates.
  const channelFilter = document.getElementById('channelFilter');
  const channels = DB.channels.byProperty(currentPropertyId);
  channelFilter.innerHTML = channels.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  const masterChannel = channels.find(c=>c.type==='master');
  channelFilter.value = (deepPlan && deepPlan.channelId) || (masterChannel ? masterChannel.id : (channels[0] || {}).id) || '';
  currentChannelId = channelFilter.value;
  channelFilter.addEventListener('change', function(){
    currentChannelId = this.value;
    currentRoomFilter = ''; // the room list changes with the channel — reset to "All Rooms"
    refreshRoomFilterOptions();
    renderGrid();
  });

  // Room filter — narrows the grid down to a single room within the selected channel.
  const roomFilter = document.getElementById('roomFilter');
  roomFilter.addEventListener('change', function(){ currentRoomFilter = this.value; renderGrid(); });
  function refreshRoomFilterOptions(){
    const roomsForChannel = DB.rooms.byChannel(currentChannelId);
    roomFilter.innerHTML = `<option value="">All Rooms</option>` + roomsForChannel.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
    roomFilter.value = currentRoomFilter;
  }
  refreshRoomFilterOptions();

  document.getElementById('btnUndo').addEventListener('click', undoGrid);
  document.getElementById('btnCancelChanges').addEventListener('click', cancelGridChanges);
  document.getElementById('btnSaveChanges').addEventListener('click', saveGridChanges);

  document.getElementById('bulkModal').addEventListener('show.bs.modal', refreshBulkTargetOptions);
  document.getElementById('bu_channel').addEventListener('change', refreshBulkRoomOptions);
  document.getElementById('bu_room').addEventListener('change', refreshBulkPlanOptions);
  document.getElementById('bu_ratePlan').addEventListener('change', function(){ renderBulkRoomPricing(); updateBulkSummary(); });
  document.getElementById('bu_scope').addEventListener('change', function(){ updateBulkScopeUI(); updateBulkSummary(); });
  document.getElementById('bu_apply').addEventListener('click', applyBulkUpdate);
  document.getElementById('bu_clearRates').addEventListener('click', clearBulkRates);
  ['bu_singleDate','bu_fromDate','bu_toDate','bu_wdFrom','bu_wdTo'].forEach(id=>{
    document.getElementById(id).addEventListener('change', updateBulkSummary);
  });
  document.getElementById('bu_weekdayBtns').addEventListener('click', ()=> setTimeout(updateBulkSummary));

  setupDateRangePicker();
  buildWeekdayButtons();
  loadGrid();

  // Keep 7D/14D exactly filling the available width if the window (or the iframe it's embedded
  // in) is resized — re-measuring is cheap and doesn't touch gridWorking/undo state, unlike a
  // full renderGrid().
  let resizeRaf = null;
  window.addEventListener('resize', ()=>{
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(()=>{
      const host = document.getElementById('gridHost');
      fitDateColumnsToWidth(host, currentDates().length);
      const card = document.querySelector('.cal-grid-card');
      alignEdgeZonesToHeader(card, host, 'cal_edgeLeft', 'cal_edgeRight');
      alignVerticalEdgeZones(card, host.querySelector('.grid-table-wrap'), 'cal_edgeUp', 'cal_edgeDown', 14);
    });
  });
});

function buildWeekdayButtons(){
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  document.getElementById('bu_weekdayBtns').innerHTML = days.map((d,i)=>
    `<button type="button" class="btn btn-outline-primary btn-sm wd-btn" data-dow="${i}">${d}</button>`).join('');
  document.querySelectorAll('.wd-btn').forEach(b=> b.addEventListener('click', ()=> b.classList.toggle('active')||b.classList.toggle('btn-soft')));
}

function keyOf(d){ return DB.fmtDate(d); }

// Shift the calendar's currently-active range backward/forward by its own span — keyed off
// calPreset so it keeps the same length. Only reachable by clicking the grid header's edge
// zones, which are only visible/enabled once the range is shiftable (see applyRange()).
function calShiftRange(direction){
  const spanDays = Math.round((calRangeEnd - calRangeStart) / 86400000) + 1;
  const newStart = calAddDays(calRangeStart, direction*spanDays);
  const newEnd = calAddDays(calRangeEnd, direction*spanDays);
  calApplyRange(newStart, newEnd, calPreset==='custom' ? 'custom' : calPreset);
}

/* ==========================================================================
   Date Range Picker — presets (Today/Yesterday/7/14/30 Days/Last Month) plus a
   Google Analytics / Power BI-style dual month calendar for Custom Range. Same
   component as Rate Matrix — the grid, bulk-update scopes, and Rate Parity all
   read the resulting calRangeStart/calRangeEnd via currentDates().
   ========================================================================== */
function setupDateRangePicker(){
  let calCalMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); // left calendar's anchor month; right = +1 month
  let calPickStart = null, calPickEnd = null; // in-progress Custom Range selection, not yet applied

  function setActiveSeg(presetKey){
    document.querySelectorAll('.mx-seg-btn[data-preset]').forEach(b=> b.classList.toggle('active', b.dataset.preset===presetKey));
    // The trigger button always reads "Quick Range" — it's a menu label, not a value display —
    // but still gets an .active/pressed look whenever one of ITS options (not Custom) is the
    // active range, and the currently-selected option inside the menu gets a checkmark, so the
    // selection is still visible at a glance without the button text having to change.
    const quickBtn = document.getElementById('mx_quickRangeBtn');
    const isQuickRangeActive = !!CAL_QUICK_RANGE_LABELS[presetKey];
    if(quickBtn) quickBtn.classList.toggle('active', isQuickRangeActive);
    document.querySelectorAll('#mx_quickRangeMenu .dropdown-item').forEach(item=>{
      item.classList.toggle('active', isQuickRangeActive && item.dataset.preset===presetKey);
    });
  }

  function applyRange(start, end, presetKey){
    calRangeStart = calStartOfDay(start); calRangeEnd = calStartOfDay(end);
    calPreset = presetKey;
    setActiveSeg(presetKey);
    document.getElementById('mx_dateRangeLabel').textContent = calSameDay(calRangeStart,calRangeEnd)
      ? calFmtShort(calRangeStart) : `${calFmtShort(calRangeStart)} – ${calFmtShort(calRangeEnd)}`;

    // Range-shift arrows live embedded in the grid's own date header row (the .mx-edge-left/right
    // zones) and only make sense once the window is wide enough that paging by a whole period is
    // actually useful — Next 30/90 Days or Custom, never This/Next Week or Next 14 Days
    // (rate-matrix.css hides them entirely otherwise).
    const shiftablePresets = ['next30','next90','30','custom'];
    document.querySelector('.cal-grid-card').classList.toggle('mx-range-shiftable', shiftablePresets.includes(presetKey));

    // Cross-fade the grid instead of an instant column-count jump — going from 7D to 14D/30D
    // roughly doubles the date columns, which felt like a jarring, "choppy" jump when swapped in
    // instantly.
    fadeAndRerender(document.getElementById('gridHost'), renderGrid);
  }
  calApplyRange = applyRange;

  function calDaysInMonthGrid(monthDate){
    const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const gridStartDay = calAddDays(first, -first.getDay());
    return Array.from({length:42}).map((_,i)=> calAddDays(gridStartDay, i));
  }

  function renderCalMonth(hostId, labelId, monthDate){
    document.getElementById(labelId).textContent = monthDate.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
    const today = calStartOfDay(new Date());
    const dowLabels = ['S','M','T','W','T','F','S'];
    const cellsHtml = calDaysInMonthGrid(monthDate).map(d=>{
      const inMonth = d.getMonth()===monthDate.getMonth();
      if(!inMonth) return `<button type="button" class="mx-drp-day" disabled tabindex="-1" style="visibility:hidden"></button>`;
      let cls = 'mx-drp-day';
      const isStart = calSameDay(d, calPickStart), isEnd = calSameDay(d, calPickEnd);
      const inRange = calPickStart && calPickEnd && d > calPickStart && d < calPickEnd;
      if(calSameDay(d, today)) cls += ' mx-drp-today';
      if(isStart || isEnd) cls += ' mx-drp-endpoint';
      if(isStart) cls += ' mx-drp-range-start';
      if(isEnd) cls += ' mx-drp-range-end';
      if(inRange) cls += ' mx-drp-in-range';
      return `<button type="button" class="${cls}" data-date="${keyOf(d)}">${d.getDate()}</button>`;
    }).join('');
    document.getElementById(hostId).innerHTML = dowLabels.map(d=>`<div class="mx-drp-dow">${d}</div>`).join('') + cellsHtml;
  }

  function calPickDate(d){
    if(!calPickStart || (calPickStart && calPickEnd)){ calPickStart = d; calPickEnd = null; }
    else if(d < calPickStart){ calPickEnd = calPickStart; calPickStart = d; }
    else calPickEnd = d;
    renderDualCalendar();
  }

  function updateSelectedLabel(){
    const lbl = document.getElementById('mx_drpSelectedLabel');
    const applyBtn = document.getElementById('mx_drpApply');
    if(calPickStart && calPickEnd){ lbl.textContent = `${calFmtShort(calPickStart)} – ${calFmtShort(calPickEnd)}`; applyBtn.disabled = false; }
    else if(calPickStart){ lbl.textContent = `${calFmtShort(calPickStart)} – select end date`; applyBtn.disabled = true; }
    else { lbl.textContent = 'Select a start and end date'; applyBtn.disabled = true; }
  }

  function renderDualCalendar(){
    renderCalMonth('mx_drpCal1', 'mx_drpMonthLabel1', calCalMonth);
    renderCalMonth('mx_drpCal2', 'mx_drpMonthLabel2', calAddMonths(calCalMonth, 1));
    updateSelectedLabel();
    document.querySelectorAll('#mx_drpCal1 .mx-drp-day:not(:disabled), #mx_drpCal2 .mx-drp-day:not(:disabled)').forEach(btn=>{
      btn.addEventListener('click', ()=> calPickDate(new Date(btn.dataset.date+'T00:00:00')));
    });
  }

  function closeCustomDropdown(){
    bootstrap.Dropdown.getOrCreateInstance(document.getElementById('mx_customBtn')).hide();
  }

  // Quick Range dropdown (This Week / Next Week / Next 14/30/90 Days) — applied immediately on click.
  document.querySelectorAll('#mx_quickRangeMenu [data-preset]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const { start, end } = calPresetRange(btn.dataset.preset);
      applyRange(start, end, btn.dataset.preset);
    });
  });

  // Custom — opening the popover seeds the calendar from whatever range is currently active,
  // so re-opening it always shows where you already are, not a stale/blank selection. If there
  // isn't enough room below the trigger to fit the whole dual calendar, flip it to open upward
  // instead of silently letting the bottom half render off-screen/under the fold.
  document.getElementById('mx_customDropdown').addEventListener('show.bs.dropdown', (e)=>{
    calPickStart = new Date(calRangeStart); calPickEnd = new Date(calRangeEnd);
    calCalMonth = new Date(calPickStart.getFullYear(), calPickStart.getMonth(), 1);
    renderDualCalendar();
    const triggerRect = e.relatedTarget.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    document.getElementById('mx_customDropdown').classList.toggle('dropup', spaceBelow < 340 && triggerRect.top > 340);
  });
  document.getElementById('mx_drpPrevMonth').addEventListener('click', ()=>{ calCalMonth = calAddMonths(calCalMonth, -1); renderDualCalendar(); });
  document.getElementById('mx_drpNextMonth').addEventListener('click', ()=>{ calCalMonth = calAddMonths(calCalMonth, 1); renderDualCalendar(); });
  document.getElementById('mx_drpCancel').addEventListener('click', closeCustomDropdown);
  document.getElementById('mx_drpApply').addEventListener('click', ()=>{
    if(!calPickStart || !calPickEnd) return;
    applyRange(calPickStart, calPickEnd, 'custom');
    closeCustomDropdown();
  });

  const { start, end } = calPresetRange(calPreset);
  applyRange(start, end, calPreset);
}

/* ==========================================================================
   Grid loading & rendering
   ========================================================================== */
function loadGrid(){
  const propertyId = currentPropertyId;
  gridWorking = {};
  DB.ratePlans.byProperty(propertyId).forEach(rp=>{
    gridWorking[rp.id] = JSON.parse(JSON.stringify(DB.rates.forPlan(rp.id)));
  });
  gridHistory = [];
  gridDirty = false;
  document.getElementById('btnSaveChanges').disabled = true;
  document.getElementById('btnUndo').disabled = true;
  renderGrid();
}

function renderGrid(){
  const propertyId = currentPropertyId;
  let rooms = currentChannelId ? DB.rooms.byChannel(currentChannelId) : DB.rooms.byProperty(propertyId);
  if(currentRoomFilter) rooms = rooms.filter(r=> r.id===currentRoomFilter);
  const host = document.getElementById('gridHost');
  const todayKey = keyOf(new Date());

  const dates = currentDates();

  if(!rooms.length){
    host.innerHTML = `<div class="empty-state"><i class="bi bi-door-closed"></i><h5>No rooms for this property</h5><p>Add a room and rate plan to start pricing.</p><a href="add-room.html?propertyId=${propertyId}" class="btn btn-primary">Add Room</a></div>`;
    return;
  }

  const theadDates = dates.map(d=>{
    const isToday = keyOf(d)===todayKey;
    return `<th class="grid-date-col ${isToday?'today-col':''}">${d.toLocaleDateString('en-IN',{weekday:'short'})}<br>${d.getDate()} ${d.toLocaleDateString('en-IN',{month:'short'})}</th>`;
  }).join('');

  let bodyRows = '';
  rooms.forEach(room=>{
    bodyRows += `<tr class="grid-room-row"><td class="grid-sticky-col" colspan="1"><i class="bi bi-door-open me-2"></i>${room.name} <span class="text-muted fw-normal" style="font-size:.72rem">(${room.bedType}, ${room.capacity} guests)</span></td>${dates.map(()=>'<td></td>').join('')}</tr>`;
    const plans = DB.ratePlans.byRoom(room.id);
    if(!plans.length){
      bodyRows += `<tr><td class="grid-sticky-col"><div class="grid-plan-label text-muted small"><i class="bi bi-exclamation-circle me-1"></i>No rate plans linked to this room</div></td>${dates.map(()=>'<td></td>').join('')}</tr>`;
      return;
    }
    plans.forEach(rp=>{
      const planRates = gridWorking[rp.id] || {};
      const maxOcc = Math.max(room.maxOccupancy||1, rp.baseOccupancy||1);

      // Plan header row: name, meal plan, cancellation policy — no price cells.
      // Rate plan editing lives on the Rate Plans screen, not here.
      bodyRows += `<tr class="grid-plan-header-row">
        <td class="grid-sticky-col">
          <div class="grid-plan-label">
            <div class="name">${rp.name}</div>
            <div class="meta">${rp.mealPlan} • ${rp.refundable?'Refundable':'Non-Refundable'}</div>
          </div>
        </td>
        <td colspan="${dates.length}" class="bg-body-tertiary"></td>
      </tr>`;

      // One row per occupancy level, 1 pax up to the room's max occupancy
      for(let occ=1; occ<=maxOcc; occ++){
        bodyRows += `<tr>
          <td class="grid-sticky-col">
            <div class="grid-plan-label py-2 d-flex align-items-center justify-content-between gap-2">
              <span>
                <span class="grid-occ-badge"><i class="bi bi-people"></i>${occ} Pax</span>
                ${occ===rp.baseOccupancy?'<span class="text-muted" style="font-size:.65rem"> (base)</span>':''}
              </span>
              <button type="button" class="btn btn-sm-icon btn-soft parity-btn" style="width:24px;height:24px" title="Compare across channels" data-room="${room.id}" data-plan="${rp.id}" data-occ="${occ}"><img src="https://www.eglobe-solutions.com/channelmanager/images/parity-view.png" alt="Rate Parity" class="parity-icon"></button>
            </div>
          </td>
          ${dates.map(d=>{
            const key = keyOf(d);
            const data = planRates[key] || {price:0,occPrices:{}};
            const occPrice = (data.occPrices && data.occPrices[occ]!=null) ? data.occPrices[occ] : data.price;
            const isToday = key===todayKey;
            return `<td class="grid-price-cell ${isToday?'today-col':''}" data-plan="${rp.id}" data-date="${key}" data-occ="${occ}">
              <div class="py-2 px-1">
                <div class="gp-price">${APP.fmtCurrency(occPrice)}</div>
              </div>
            </td>`;
          }).join('')}
        </tr>`;
      }
    });
  });

  host.innerHTML = `<div class="grid-table-wrap"><table class="grid-table">
    <thead><tr><th class="grid-sticky-col">Room / Rate Plan / Occupancy</th>${theadDates}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table></div>`;
  fitDateColumnsToWidth(host, dates.length);
  alignEdgeZonesToHeader(document.querySelector('.cal-grid-card'), host, 'cal_edgeLeft', 'cal_edgeRight');
  alignVerticalEdgeZones(document.querySelector('.cal-grid-card'), host.querySelector('.grid-table-wrap'), 'cal_edgeUp', 'cal_edgeDown', 14);

  document.querySelectorAll('.parity-btn').forEach(btn=>{
    btn.addEventListener('click', function(e){
      e.stopPropagation();
      openRateParity(this.dataset.room, this.dataset.plan, Number(this.dataset.occ));
    });
  });

  if(!canEditRates) return; // view-only role — cells render as plain text, no click-to-edit

  document.querySelectorAll('.grid-price-cell').forEach(cell=>{
    cell.addEventListener('click', function(){
      if(this.querySelector('input')) return;
      const planId = this.dataset.plan, key = this.dataset.date, occ = Number(this.dataset.occ);
      const rp = DB.ratePlans.get(planId);
      const existingDay = (gridWorking[planId] && gridWorking[planId][key]) || {price:0,occPrices:{}};
      const priceDiv = this.querySelector('.gp-price');
      const currentVal = (existingDay.occPrices && existingDay.occPrices[occ]!=null) ? existingDay.occPrices[occ] : existingDay.price;
      priceDiv.innerHTML = `<input type="number" class="grid-inline-input" value="${currentVal}" min="0">`;
      const input = priceDiv.querySelector('input');
      input.focus(); input.select();
      const commit = ()=>{
        const val = Number(input.value)||0;
        pushGridHistory();
        if(!gridWorking[planId]) gridWorking[planId] = {};
        const day = {...existingDay, occPrices: {...(existingDay.occPrices||{})}};
        day.occPrices[occ] = val;
        if(rp && occ===rp.baseOccupancy) day.price = val;
        gridWorking[planId][key] = day;
        markGridDirty();
        renderGrid();
      };
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e=>{ if(e.key==='Enter'){ input.blur(); } if(e.key==='Escape'){ renderGrid(); } });
      input.addEventListener('click', e=> e.stopPropagation());
    });
  });
}

/* ==========================================================================
   Undo / Save / Cancel
   ========================================================================== */
function pushGridHistory(){
  gridHistory.push(JSON.parse(JSON.stringify(gridWorking)));
  if(gridHistory.length>25) gridHistory.shift();
  document.getElementById('btnUndo').disabled = false;
}
function undoGrid(){
  if(!gridHistory.length) return;
  gridWorking = gridHistory.pop();
  document.getElementById('btnUndo').disabled = !gridHistory.length;
  renderGrid();
  APP.toast('Undo', 'Last grid change reverted.', 'info');
}
function markGridDirty(){
  gridDirty = true;
  document.getElementById('btnSaveChanges').disabled = false;
}
function cancelGridChanges(){
  if(!gridDirty) return;
  APP.confirmModal({
    title:'Discard Changes?', message:'All unsaved pricing changes in the grid will be lost.',
    confirmText:'Discard', danger:true,
    onConfirm: ()=>{ loadGrid(); APP.toast('Changes Discarded', 'Reverted to last saved rates.', 'warn'); }
  });
}
function saveGridChanges(){
  if(!gridDirty) return;
  APP.confirmModal({
    title:'Save Rate Changes?', message:'This will update the live pricing calendar for every rate plan shown in this grid.',
    confirmText:'Save Changes',
    onConfirm: ()=>{
      Object.keys(gridWorking).forEach(planId=> DB.rates.saveAll(planId, gridWorking[planId]));
      gridDirty = false;
      gridHistory = [];
      document.getElementById('btnSaveChanges').disabled = true;
      document.getElementById('btnUndo').disabled = true;
      APP.toast('Rates Saved', 'Your pricing grid has been updated successfully.', 'success');
    }
  });
}

/* ==========================================================================
   Bulk Update — targets a room + rate plan (or all of them) within the grid
   ========================================================================== */
function refreshBulkTargetOptions(){
  const propertyId = currentPropertyId;
  const channelSel = document.getElementById('bu_channel');
  const channels = DB.channels.byProperty(propertyId);
  channelSel.innerHTML = `<option value="">All Channels</option>` + channels.map(c=>`<option value="${c.id}">${c.name}</option>`).join('');
  channelSel.value = currentChannelId; // default to whatever the page-level Channel filter is set to
  document.getElementById('bu_priceAction').value = 'fixed';
  refreshBulkRoomOptions();
}
function bulkTargetRooms(){
  const propertyId = currentPropertyId;
  const channelId = document.getElementById('bu_channel').value;
  return channelId ? DB.rooms.byChannel(channelId) : DB.rooms.byProperty(propertyId);
}
function refreshBulkRoomOptions(){
  const rooms = bulkTargetRooms();
  const roomSel = document.getElementById('bu_room');
  roomSel.innerHTML = `<option value="">All Rooms</option>` + rooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  refreshBulkPlanOptions();
}
// Rooms that pricing cards should be rendered for: the specific room if one is picked, the
// specific rate plan's room if a rate plan is picked, otherwise every room the Channel filter
// resolves to — this is what lets "All Rooms" list out a distinct pricing card per room.
function resolveBulkRooms(){
  const ratePlanId = document.getElementById('bu_ratePlan').value;
  const roomId = document.getElementById('bu_room').value;
  if(ratePlanId){
    const rp = DB.ratePlans.get(ratePlanId);
    const room = rp ? DB.rooms.get(rp.roomId) : null;
    return room ? [room] : [];
  }
  if(roomId){
    const room = DB.rooms.get(roomId);
    return room ? [room] : [];
  }
  return bulkTargetRooms();
}
function renderBulkRoomPricing(){
  const list = document.getElementById('bu_roomPricingList');
  const rooms = resolveBulkRooms();
  if(!rooms.length){
    list.innerHTML = `<div class="text-muted small">No rooms found for this selection.</div>`;
    return;
  }
  list.innerHTML = rooms.map(r=>`
    <div class="bu-room-card" data-room-id="${r.id}">
      <div class="bu-room-card-title"><i class="bi bi-door-open"></i>${r.name}</div>
      <label class="form-label mb-2 small">Occupancy Pricing</label>
      <div class="bu-occ-grid">
        <div class="bu-occ-field"><label>1 Guest</label><input type="number" class="form-control form-control-sm bu-occ-input" data-occ="1" min="0" placeholder="—"></div>
        <div class="bu-occ-field"><label>2 Guests</label><input type="number" class="form-control form-control-sm bu-occ-input" data-occ="2" min="0" placeholder="—"></div>
        <div class="bu-occ-field"><label>3 Guests</label><input type="number" class="form-control form-control-sm bu-occ-input" data-occ="3" min="0" placeholder="—"></div>
        <div class="bu-occ-field"><label>4 Guests</label><input type="number" class="form-control form-control-sm bu-occ-input" data-occ="4" min="0" placeholder="—"></div>
      </div>
      <div class="bu-occ-grid bu-occ-grid-2 mt-2">
        <div class="bu-occ-field"><label>Extra Adult</label><input type="number" class="form-control form-control-sm bu-extra-adult" min="0" placeholder="—"></div>
        <div class="bu-occ-field"><label>Extra Child</label><input type="number" class="form-control form-control-sm bu-extra-child" min="0" placeholder="—"></div>
      </div>
      <div class="text-muted small mt-2">Leave an occupancy blank to leave its price unchanged. A room with fewer guest slots simply ignores the extra fields.</div>
    </div>
  `).join('');
}
function refreshBulkPlanOptions(){
  const roomId = document.getElementById('bu_room').value;
  const channelId = document.getElementById('bu_channel').value;
  const propertyId = currentPropertyId;
  let plans;
  if(roomId) plans = DB.ratePlans.byRoom(roomId);
  else if(channelId) plans = DB.ratePlans.byChannel(channelId);
  else plans = DB.ratePlans.byProperty(propertyId);
  document.getElementById('bu_ratePlan').innerHTML = `<option value="">All Rate Plans</option>` + plans.map(rp=>`<option value="${rp.id}">${rp.name}</option>`).join('');
  renderBulkRoomPricing();
  updateBulkSummary();
}
function bulkTargetPlanIds(){
  const propertyId = currentPropertyId;
  const channelId = document.getElementById('bu_channel').value;
  const roomId = document.getElementById('bu_room').value;
  const ratePlanId = document.getElementById('bu_ratePlan').value;
  if(ratePlanId) return [ratePlanId];
  if(roomId) return DB.ratePlans.byRoom(roomId).map(rp=>rp.id);
  if(channelId) return DB.ratePlans.byChannel(channelId).map(rp=>rp.id);
  return DB.ratePlans.byProperty(propertyId).map(rp=>rp.id);
}
function updateBulkSummary(){
  const summary = document.getElementById('bu_summary');
  if(!summary) return;
  const dates = collectBulkDates();
  const planIds = bulkTargetPlanIds();
  const roomIds = new Set(planIds.map(id=>{ const rp = DB.ratePlans.get(id); return rp ? rp.roomId : null; }).filter(Boolean));
  if(!dates.length || !planIds.length){
    summary.innerHTML = `<i class="bi bi-exclamation-circle me-1"></i>Select a valid date scope and target to see what will be updated.`;
    summary.classList.add('bu-summary-warn');
    return;
  }
  summary.classList.remove('bu-summary-warn');
  summary.innerHTML = `<i class="bi bi-check-circle me-1"></i>This will update <strong>${planIds.length}</strong> rate plan(s) across <strong>${roomIds.size}</strong> room(s) for <strong>${dates.length}</strong> date(s).`;
}

function updateBulkScopeUI(){
  const scope = document.getElementById('bu_scope').value;
  document.getElementById('bu_singleWrap').classList.toggle('d-none', scope!=='single');
  document.getElementById('bu_rangeWrap').classList.toggle('d-none', scope!=='range');
  document.getElementById('bu_weekdaysWrap').classList.toggle('d-none', scope!=='weekdays');
}

function collectBulkDates(){
  const scope = document.getElementById('bu_scope').value;
  let dates = [];
  if(scope==='single'){
    const v = document.getElementById('bu_singleDate').value;
    if(v) dates.push(v);
  } else if(scope==='range'){
    const from = document.getElementById('bu_fromDate').value;
    const to = document.getElementById('bu_toDate').value;
    if(from && to){
      for(let d=new Date(from+'T00:00:00'); d<=new Date(to+'T00:00:00'); d.setDate(d.getDate()+1)) dates.push(keyOf(d));
    }
  } else if(scope==='visible'){
    dates = currentDates().map(d=>keyOf(d));
  } else if(scope==='weekdays'){
    const from = document.getElementById('bu_wdFrom').value;
    const to = document.getElementById('bu_wdTo').value;
    const activeDows = [...document.querySelectorAll('.wd-btn.active')].map(b=>Number(b.dataset.dow));
    if(from && to && activeDows.length){
      for(let d=new Date(from+'T00:00:00'); d<=new Date(to+'T00:00:00'); d.setDate(d.getDate()+1)){
        if(activeDows.includes(d.getDay())) dates.push(keyOf(d));
      }
    }
  } else if(scope==='weekends'){
    dates = currentDates().filter(d=> d.getDay()===5 || d.getDay()===6 || d.getDay()===0).map(d=>keyOf(d));
  }
  return dates;
}

function applyBulkPrice(curPrice, action, value){
  if(action==='fixed') return value;
  if(action==='incAmt') return curPrice + value;
  if(action==='decAmt') return Math.max(0, curPrice - value);
  if(action==='incPct') return Math.round(curPrice * (1 + value/100));
  if(action==='decPct') return Math.max(0, Math.round(curPrice * (1 - value/100)));
  return curPrice;
}
// Reads one room card's inputs — each targeted room gets its own occupancy/surcharge values
// rather than one shared set applied to every room, since a room's price tiers/max occupancy
// are its own.
function bulkRoomCardValues(roomId){
  const card = document.querySelector(`.bu-room-card[data-room-id="${roomId}"]`);
  if(!card) return { occValues:{}, extraAdultRaw:'', extraChildRaw:'' };
  const occValues = {};
  card.querySelectorAll('.bu-occ-input').forEach(input=>{
    if(input.value !== '') occValues[Number(input.dataset.occ)] = Number(input.value);
  });
  return {
    occValues,
    extraAdultRaw: card.querySelector('.bu-extra-adult').value,
    extraChildRaw: card.querySelector('.bu-extra-child').value
  };
}

function applyBulkUpdate(){
  const dates = collectBulkDates();
  const planIds = bulkTargetPlanIds();
  if(!dates.length){ APP.toast('No Dates Selected', 'Please specify valid dates for the chosen scope.', 'danger'); return; }
  if(!planIds.length){ APP.toast('No Rate Plans', 'The selected room/property has no rate plans to update.', 'danger'); return; }

  const priceAction = document.getElementById('bu_priceAction').value;
  const rooms = resolveBulkRooms();
  const roomEdits = {};
  let hasAnyEdit = false;
  rooms.forEach(room=>{
    const v = bulkRoomCardValues(room.id);
    const hasOccEdit = Object.keys(v.occValues).length > 0 && priceAction !== 'none';
    const hasExtraEdit = v.extraAdultRaw !== '' || v.extraChildRaw !== '';
    roomEdits[room.id] = { ...v, hasOccEdit, hasExtraEdit };
    if(hasOccEdit || hasExtraEdit) hasAnyEdit = true;
  });

  if(!hasAnyEdit){
    APP.toast('Nothing to Update', 'Enter at least one occupancy price or an extra guest surcharge for a room.', 'warn');
    return;
  }

  const plansByRoom = {};
  planIds.forEach(planId=>{
    const rp = DB.ratePlans.get(planId);
    if(!rp) return;
    (plansByRoom[rp.roomId] = plansByRoom[rp.roomId] || []).push(rp);
  });

  let datePlanCount = 0, extraPlanCount = 0, historyPushed = false;
  Object.keys(roomEdits).forEach(roomId=>{
    const edit = roomEdits[roomId];
    const roomPlans = plansByRoom[roomId] || [];
    if(!roomPlans.length) return;
    const room = DB.rooms.get(roomId);
    const maxOcc = Math.max((room && room.maxOccupancy) || 1, 1);

    if(edit.hasOccEdit){
      if(!historyPushed){ pushGridHistory(); historyPushed = true; }
      roomPlans.forEach(rp=>{
        if(!gridWorking[rp.id]) gridWorking[rp.id] = {};
        dates.forEach(key=>{
          const cur = gridWorking[rp.id][key] || {price:0, occPrices:{}};
          const occPrices = {...(cur.occPrices||{})};
          Object.keys(edit.occValues).forEach(occStr=>{
            const occ = Number(occStr);
            if(occ > maxOcc) return;
            const curOccPrice = occPrices[occ]!=null ? occPrices[occ] : cur.price;
            occPrices[occ] = applyBulkPrice(curOccPrice, priceAction, edit.occValues[occ]);
          });
          const basePrice = occPrices[rp.baseOccupancy] != null ? occPrices[rp.baseOccupancy] : cur.price;
          gridWorking[rp.id][key] = { price: basePrice, occPrices };
        });
        datePlanCount++;
      });
    }

    if(edit.hasExtraEdit){
      roomPlans.forEach(rp=>{
        const updated = {...rp};
        if(edit.extraAdultRaw !== '') updated.extraAdultPrice = applyBulkPrice(rp.extraAdultPrice||0, priceAction, Number(edit.extraAdultRaw));
        if(edit.extraChildRaw !== '') updated.extraChildPrice = applyBulkPrice(rp.extraChildPrice||0, priceAction, Number(edit.extraChildRaw));
        DB.ratePlans.save(updated);
        extraPlanCount++;
      });
    }
  });

  if(historyPushed){ markGridDirty(); renderGrid(); }

  bootstrap.Modal.getInstance(document.getElementById('bulkModal')).hide();
  const parts = [];
  if(datePlanCount) parts.push(`occupancy pricing for ${dates.length} date(s) across ${datePlanCount} rate plan(s) in draft`);
  if(extraPlanCount) parts.push(`extra guest surcharge on ${extraPlanCount} rate plan(s) saved immediately`);
  APP.toast('Bulk Update Applied', parts.join('; ') + (datePlanCount ? '. Click "Save Changes" to publish pricing.' : '.'), 'success');
}

function clearBulkRates(){
  const dates = collectBulkDates();
  const planIds = bulkTargetPlanIds();
  if(!dates.length || !planIds.length){ APP.toast('Nothing to Clear', 'Select a valid scope and target first.', 'warn'); return; }
  pushGridHistory();
  planIds.forEach(planId=>{
    if(!gridWorking[planId]) return;
    dates.forEach(key=>{
      if(!gridWorking[planId][key]) return;
      const clearedOcc = {};
      Object.keys(gridWorking[planId][key].occPrices||{}).forEach(occ=> clearedOcc[occ]=0);
      gridWorking[planId][key] = {...gridWorking[planId][key], price:0, occPrices:clearedOcc};
    });
  });
  markGridDirty();
  renderGrid();
  APP.toast('Rates Cleared', `Cleared pricing for ${dates.length} date(s) across ${planIds.length} rate plan(s).`, 'warn');
}

/* ==========================================================================
   Rate Parity — for one room/rate plan/occupancy, shows every channel that lists
   a matching room (rows) against every date in the calendar's currently selected
   date range (columns), so switching the Date Range Picker up top changes what
   Rate Parity shows too, instead of always defaulting to "today through end of
   this month" regardless of what the calendar itself is displaying.
   ========================================================================== */
// Rate Parity's own date range — independent of the Rate Calendar's main range, seeded from it
// when the modal opens. Preset pills + plain date inputs, no custom calendar widget.
let parityCtx = null; // { room, originPlan, occ }
let parityRangeStart = null, parityRangeEnd = null;

function parityDatesInRange(){
  const dates = [];
  let d = new Date(parityRangeStart);
  while(d <= parityRangeEnd){ dates.push(new Date(d)); d = calAddDays(d,1); }
  return dates;
}

function renderParityGrid(){
  const { room, originPlan, occ } = parityCtx;
  const channels = DB.channels.byProperty(currentPropertyId);
  const dates = parityDatesInRange();

  // One row per channel: match a room with the same name, preferring a rate plan with the
  // same meal plan as the one being compared from; falls back to that room's first plan.
  const rows = channels.map(chan=>{
    const matchRooms = DB.rooms.byChannel(chan.id).filter(r=> r.name===room.name);
    let matchPlan = null;
    for(const mr of matchRooms){
      const plans = DB.ratePlans.byRoom(mr.id);
      matchPlan = plans.find(rp=> rp.mealPlan===originPlan.mealPlan) || plans[0];
      if(matchPlan) break;
    }
    return { channel: chan, ratePlan: matchPlan };
  }).filter(row=> row.ratePlan);

  if(!rows.length){ APP.toast('No Data', 'No comparable rate plans found on other channels.', 'warn'); return; }

  const priceGrid = rows.map(row=>{
    const prices = dates.map(d=>{
      const key = keyOf(d);
      const dayData = (gridWorking[row.ratePlan.id] && gridWorking[row.ratePlan.id][key]) || DB.rates.forPlan(row.ratePlan.id)[key];
      const price = dayData ? ((dayData.occPrices && dayData.occPrices[occ]!=null) ? dayData.occPrices[occ] : dayData.price) : null;
      return price;
    });
    return { ...row, prices };
  });

  document.getElementById('parityMeta').textContent = `${room.name}  •  ${originPlan.name}  •  ${occ} Pax  •  ${calFmtShort(dates[0])} – ${calFmtShort(dates[dates.length-1])}`;

  const todayKey = keyOf(new Date());
  const theadDates = dates.map(d=>{
    const isToday = keyOf(d)===todayKey;
    return `<th class="grid-date-col ${isToday?'today-col':''}">${d.toLocaleDateString('en-IN',{weekday:'short'})}<br>${d.getDate()} ${d.toLocaleDateString('en-IN',{month:'short'})}</th>`;
  }).join('');

  const bodyRows = priceGrid.map(row=>{
    const meta = DB.CHANNEL_TYPES[row.channel.type] || DB.CHANNEL_TYPES.custom;
    const isCurrent = row.channel.id === currentChannelId;
    return `<tr>
      <td class="grid-sticky-col">
        <div class="grid-plan-label">
          <div class="name"><i class="bi ${meta.icon} me-1" style="color:${meta.color}"></i>${row.channel.name}${isCurrent?' <span class="badge bg-primary-subtle text-primary" style="font-size:.6rem">Current</span>':''}</div>
          <div class="meta">${row.ratePlan.name}</div>
        </div>
      </td>
      ${row.prices.map(price=>{
        return `<td class="grid-price-cell"><div class="py-2 px-1"><div class="gp-price">${price!=null ? APP.fmtCurrency(price) : '—'}</div></div></td>`;
      }).join('')}
    </tr>`;
  }).join('');

  const parityHost = document.getElementById('parityGridHost');
  parityHost.innerHTML = `<div class="grid-table-wrap"><table class="grid-table">
    <thead><tr><th class="grid-sticky-col">Channel</th>${theadDates}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table></div>`;
  alignEdgeZonesToHeader(document.querySelector('.parity-scroll-wrap'), parityHost, 'parity_edgeLeft', 'parity_edgeRight');
}

// Edge hover-scroll — hovering near an edge of a grid scrolls smoothly toward it for as long as
// the cursor stays there, instead of a click-to-scroll arrow. Looks up the scroll container fresh
// on every frame since renderGrid()/renderParityGrid() rebuild their host's innerHTML (and
// therefore the .grid-table-wrap element itself) on every change, so a reference captured once
// would go stale. Shared between the main Rate Calendar grid (4 directions) and the Rate Parity
// modal's grid (left/right only, it never scrolls vertically).
function wireEdgeScroll(wrapSelector, zoneSpecs){
  let raf = null;
  function tick(dx, dy){
    const wrap = document.querySelector(wrapSelector);
    if(wrap) wrap.scrollBy({ left:dx, top:dy });
    raf = requestAnimationFrame(()=> tick(dx, dy));
  }
  zoneSpecs.forEach(z=>{
    const el = document.getElementById(z.id);
    if(!el) return;
    el.addEventListener('mouseenter', ()=>{
      el.classList.add('is-active');
      cancelAnimationFrame(raf);
      tick(z.dx, z.dy);
    });
    el.addEventListener('mouseleave', ()=>{
      el.classList.remove('is-active');
      cancelAnimationFrame(raf);
      raf = null;
    });
    // Click either jumps a fixed step in the same direction (default — for users who prefer a
    // tap over a hover-hold, coexisting with the hover-scroll above and the wrap's native
    // scrollbar), or, when a zone provides its own onClick (the horizontal range-shift zones),
    // that runs instead — hover still pans within the loaded columns either way.
    el.addEventListener('click', ()=>{
      if(z.onClick){ z.onClick(); return; }
      const wrap = document.querySelector(wrapSelector);
      if(wrap) wrap.scrollBy({ left:z.dx*24, top:z.dy*24, behavior:'smooth' });
    });
  });
}
document.addEventListener('DOMContentLoaded', ()=>{
  wireEdgeScroll('#gridHost .grid-table-wrap', [
    { id:'cal_edgeUp',    dx:0,  dy:-9 },
    { id:'cal_edgeDown',  dx:0,  dy:9  },
    { id:'cal_edgeLeft',  dx:-9, dy:0, onClick:()=> calShiftRange(-1) },
    { id:'cal_edgeRight', dx:9,  dy:0, onClick:()=> calShiftRange(1)  },
  ]);
  wireEdgeScroll('#parityGridHost .grid-table-wrap', [
    // These stay hoverable (panning within loaded columns) at every preset — only the
    // click-to-jump-a-period behavior is gated to when a 30 Days/Custom range makes it useful.
    { id:'parity_edgeLeft',  dx:-9, dy:0, onClick:()=>{ if(document.querySelector('.parity-scroll-wrap').classList.contains('mx-range-shiftable')) parityShiftRange(-1); } },
    { id:'parity_edgeRight', dx:9,  dy:0, onClick:()=>{ if(document.querySelector('.parity-scroll-wrap').classList.contains('mx-range-shiftable')) parityShiftRange(1); } },
  ]);
});

function setParityActivePreset(days){
  document.querySelectorAll('#parity_rangeGroup [data-days]').forEach(b=>{
    const active = Number(b.dataset.days)===days;
    b.classList.toggle('btn-outline-primary', active); b.classList.toggle('btn-soft', !active);
  });
  // Range-shift arrows only for 30 Days or a manual/custom range (days==null), never for the
  // fixed 7/14 Day presets — same rule as the main grid.
  const shiftable = days === 30 || days == null;
  const wrap = document.querySelector('.parity-scroll-wrap');
  if(wrap) wrap.classList.toggle('mx-range-shiftable', shiftable);
}
function applyParityRange(start, end, presetDays){
  parityRangeStart = calStartOfDay(start); parityRangeEnd = calStartOfDay(end);
  document.getElementById('parity_startDate').value = keyOf(parityRangeStart);
  document.getElementById('parity_endDate').value = keyOf(parityRangeEnd);
  setParityActivePreset(presetDays || null);

  // Same cross-fade treatment as the main grid — softens the column-count jump when the parity
  // range changes instead of an instant swap.
  fadeAndRerender(document.getElementById('parityGridHost'), renderParityGrid);
}
// Shift the parity range backward/forward by its own current span — mirrors calShiftRange, kept
// separate since the parity range is independent of the main grid's.
function parityShiftRange(direction){
  const spanDays = Math.round((parityRangeEnd - parityRangeStart) / 86400000) + 1;
  const newStart = calAddDays(parityRangeStart, direction*spanDays);
  const newEnd = calAddDays(parityRangeEnd, direction*spanDays);
  const activeBtn = document.querySelector('#parity_rangeGroup [data-days].btn-outline-primary');
  applyParityRange(newStart, newEnd, activeBtn ? Number(activeBtn.dataset.days) : null);
}
document.addEventListener('DOMContentLoaded', ()=>{
  document.querySelectorAll('#parity_rangeGroup [data-days]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const days = Number(btn.dataset.days);
      applyParityRange(calStartOfDay(new Date()), calAddDays(calStartOfDay(new Date()), days-1), days);
    });
  });
  document.getElementById('parity_apply').addEventListener('click', ()=>{
    const startVal = document.getElementById('parity_startDate').value;
    const endVal = document.getElementById('parity_endDate').value;
    if(!startVal || !endVal){ APP.toast('Missing Dates', 'Please pick both a start and end date.', 'danger'); return; }
    const start = new Date(startVal+'T00:00:00'), end = new Date(endVal+'T00:00:00');
    if(start > end){ APP.toast('Invalid Range', 'The start date must be before the end date.', 'danger'); return; }
    applyParityRange(start, end, null);
  });
});

function openRateParity(roomId, planId, occ){
  const room = DB.rooms.get(roomId);
  const originPlan = DB.ratePlans.get(planId);
  if(!room || !originPlan) return;
  parityCtx = { room, originPlan, occ };

  // Seed from the Rate Calendar's own currently-active range — the parity picker starts wherever
  // the calendar is looking, but can be changed independently from here without affecting it.
  const seedDates = currentDates();
  parityRangeStart = calStartOfDay(seedDates[0]);
  parityRangeEnd = calStartOfDay(seedDates[seedDates.length-1]);
  document.getElementById('parity_startDate').value = keyOf(parityRangeStart);
  document.getElementById('parity_endDate').value = keyOf(parityRangeEnd);
  setParityActivePreset(null);

  renderParityGrid();
  // getOrCreateInstance (not `new Modal(...)`) — this can be opened many times per visit, and
  // constructing a fresh instance every time leaves the previous one's event listeners attached
  // to the same DOM element, which can make the page feel unresponsive ("frozen") after the modal
  // has been opened more than once.
  const parityModalEl = document.getElementById('parityModal');
  // renderParityGrid() above measures the header via getBoundingClientRect() while the modal is
  // still display:none, so the edge arrows land at a zeroed-out {0,0,0,0} rect on first paint
  // (stale/misplaced-looking) until something else re-renders them. Re-run the same alignment
  // once Bootstrap has actually made the modal visible, so it's correct on the very first open.
  if(!parityModalEl.dataset.edgeAlignShownWired){
    parityModalEl.dataset.edgeAlignShownWired = '1';
    parityModalEl.addEventListener('shown.bs.modal', function(){
      const parityHost = document.getElementById('parityGridHost');
      if(parityHost) alignEdgeZonesToHeader(document.querySelector('.parity-scroll-wrap'), parityHost, 'parity_edgeLeft', 'parity_edgeRight');
    });
  }
  bootstrap.Modal.getOrCreateInstance(parityModalEl).show();
}
