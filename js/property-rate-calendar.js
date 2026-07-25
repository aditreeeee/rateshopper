/* ==========================================================================
   Property Owner Portal — Rate Calendar. Identical grid engine to the
   Company/Admin Rate Calendar (js/rate-calendar.js, untouched) — same
   toolbar, same sticky grid, same Bulk Update + Rate Parity modals — just
   mounted inside the Portal shell instead of the admin app shell, and scoped
   to the Property Owner's active property instead of a ?propertyId= param.
   ========================================================================== */
let gridStart = new Date();       // first visible date column, defaults to today
let GRID_DAYS = 14;                // visible date columns at once — changeable via the 7/14/30 Days filter
let gridWorking = {};             // { ratePlanId: { dateKey: {price, occPrices:{occ:price}} } }
let gridHistory = [];             // undo stack of gridWorking snapshots
let gridDirty = false;
let currentPropertyId = null;     // resolved from PORTAL.activePropertyId()
let currentChannelId = '';        // always a specific channel id — defaults to the property's Master Channel
let currentRoomFilter = '';       // '' = All Rooms, otherwise narrows the grid to a single room
let canEditRates = false;         // RBAC.can(RATE_CALENDAR,'edit') — gates inline edit, bulk update, save/cancel/undo

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Rate Calendar', subtitle:"Day-by-day pricing for your property's rooms and rate plans." });
  if(!me) return;
  currentPropertyId = PORTAL.activePropertyId(me);

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
  channelFilter.value = (masterChannel ? masterChannel.id : (channels[0] || {}).id) || '';
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

  document.getElementById('prevPeriod').addEventListener('click', ()=> shiftPeriod(-1));
  document.getElementById('nextPeriod').addEventListener('click', ()=> shiftPeriod(1));
  document.getElementById('btnToday').addEventListener('click', ()=>{ gridStart = new Date(); renderGrid(); });

  document.querySelectorAll('#rangeFilter [data-days]').forEach(btn=>{
    btn.addEventListener('click', function(){
      GRID_DAYS = Number(this.dataset.days);
      document.querySelectorAll('#rangeFilter [data-days]').forEach(b=>{
        const active = b===this;
        b.classList.toggle('btn-soft', active);
        b.classList.toggle('btn-outline-primary', !active);
      });
      renderGrid();
    });
  });

  document.getElementById('btnUndo').addEventListener('click', undoGrid);
  document.getElementById('btnCancelChanges').addEventListener('click', cancelGridChanges);
  document.getElementById('btnSaveChanges').addEventListener('click', saveGridChanges);

  document.getElementById('bulkModal').addEventListener('show.bs.modal', refreshBulkTargetOptions);
  document.getElementById('bu_channel').addEventListener('change', refreshBulkRoomOptions);
  document.getElementById('bu_room').addEventListener('change', refreshBulkPlanOptions);
  document.getElementById('bu_scope').addEventListener('change', updateBulkScopeUI);
  document.getElementById('bu_apply').addEventListener('click', applyBulkUpdate);
  document.getElementById('bu_clearRates').addEventListener('click', clearBulkRates);

  buildWeekdayButtons();
  loadGrid();
});

function buildWeekdayButtons(){
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  document.getElementById('bu_weekdayBtns').innerHTML = days.map((d,i)=>
    `<button type="button" class="btn btn-outline-primary btn-sm wd-btn" data-dow="${i}">${d}</button>`).join('');
  document.querySelectorAll('.wd-btn').forEach(b=> b.addEventListener('click', ()=> b.classList.toggle('active')||b.classList.toggle('btn-soft')));
}

function keyOf(d){ return d.toISOString().slice(0,10); }

function shiftPeriod(dir){
  gridStart.setDate(gridStart.getDate()+dir*GRID_DAYS);
  renderGrid();
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

  const dates = [];
  for(let i=0;i<GRID_DAYS;i++){ const d = new Date(gridStart); d.setDate(gridStart.getDate()+i); dates.push(d); }
  document.getElementById('periodLabel').textContent = `${dates[0].toLocaleDateString('en-IN',{day:'2-digit',month:'short'})} – ${dates[dates.length-1].toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}`;

  if(!rooms.length){
    host.innerHTML = `<div class="empty-state"><i class="bi bi-door-closed"></i><h5>No rooms for this property</h5><p>Add a room and rate plan to start pricing.</p><a href="add-room.html?propertyId=${propertyId}" class="btn btn-primary">Add Room</a></div>`;
    return;
  }

  const theadDates = dates.map(d=>{
    const isToday = keyOf(d)===todayKey;
    return `<th class="${isToday?'today-col':''}">${d.toLocaleDateString('en-IN',{weekday:'short'})}<br>${d.getDate()} ${d.toLocaleDateString('en-IN',{month:'short'})}</th>`;
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
              <button type="button" class="btn btn-sm-icon btn-soft parity-btn" style="width:24px;height:24px" title="Compare across channels" data-room="${room.id}" data-plan="${rp.id}" data-occ="${occ}"><i class="bi bi-bar-chart-line" style="font-size:.68rem"></i></button>
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
  refreshBulkRoomOptions();
}
function refreshBulkRoomOptions(){
  const propertyId = currentPropertyId;
  const channelId = document.getElementById('bu_channel').value;
  const rooms = channelId ? DB.rooms.byChannel(channelId) : DB.rooms.byProperty(propertyId);
  const roomSel = document.getElementById('bu_room');
  roomSel.innerHTML = `<option value="">All Rooms</option>` + rooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  refreshBulkPlanOptions();
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
      for(let d=new Date(from); d<=new Date(to); d.setDate(d.getDate()+1)) dates.push(keyOf(d));
    }
  } else if(scope==='visible'){
    for(let i=0;i<GRID_DAYS;i++){ const d = new Date(gridStart); d.setDate(gridStart.getDate()+i); dates.push(keyOf(d)); }
  } else if(scope==='weekdays'){
    const from = document.getElementById('bu_wdFrom').value;
    const to = document.getElementById('bu_wdTo').value;
    const activeDows = [...document.querySelectorAll('.wd-btn.active')].map(b=>Number(b.dataset.dow));
    if(from && to && activeDows.length){
      for(let d=new Date(from); d<=new Date(to); d.setDate(d.getDate()+1)){
        if(activeDows.includes(d.getDay())) dates.push(keyOf(d));
      }
    }
  } else if(scope==='weekends'){
    for(let i=0;i<GRID_DAYS;i++){
      const d = new Date(gridStart); d.setDate(gridStart.getDate()+i);
      if(d.getDay()===5 || d.getDay()===6) dates.push(keyOf(d));
    }
  }
  return dates;
}

function applyBulkUpdate(){
  const dates = collectBulkDates();
  const planIds = bulkTargetPlanIds();
  if(!dates.length){ APP.toast('No Dates Selected', 'Please specify valid dates for the chosen scope.', 'danger'); return; }
  if(!planIds.length){ APP.toast('No Rate Plans', 'The selected room/property has no rate plans to update.', 'danger'); return; }

  const priceAction = document.getElementById('bu_priceAction').value;
  const priceValue = Number(document.getElementById('bu_priceValue').value)||0;

  pushGridHistory();
  planIds.forEach(planId=>{
    if(!gridWorking[planId]) gridWorking[planId] = {};
    const rp = DB.ratePlans.get(planId);
    const room = rp ? DB.rooms.get(rp.roomId) : null;
    const maxOcc = Math.max((room && room.maxOccupancy) || 1, (rp && rp.baseOccupancy) || 1);
    dates.forEach(key=>{
      const cur = gridWorking[planId][key] || {price:0, occPrices:{}};
      const occPrices = {...(cur.occPrices||{})};
      for(let occ=1; occ<=maxOcc; occ++){
        const curOccPrice = occPrices[occ]!=null ? occPrices[occ] : cur.price;
        let price = curOccPrice;
        if(priceAction==='fixed') price = priceValue;
        else if(priceAction==='incAmt') price = curOccPrice + priceValue;
        else if(priceAction==='decAmt') price = Math.max(0, curOccPrice - priceValue);
        else if(priceAction==='incPct') price = Math.round(curOccPrice * (1 + priceValue/100));
        else if(priceAction==='decPct') price = Math.max(0, Math.round(curOccPrice * (1 - priceValue/100)));
        occPrices[occ] = price;
      }
      const basePrice = rp ? (occPrices[rp.baseOccupancy] != null ? occPrices[rp.baseOccupancy] : cur.price) : cur.price;
      gridWorking[planId][key] = { price: basePrice, occPrices };
    });
  });

  markGridDirty();
  renderGrid();
  bootstrap.Modal.getInstance(document.getElementById('bulkModal')).hide();
  APP.toast('Bulk Update Applied', `Updated ${dates.length} date(s) across ${planIds.length} rate plan(s) in draft. Click "Save Changes" to publish.`, 'success');
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
   a matching room (rows) against every date from today through end of this month
   (columns), so you can eyeball how your price compares day-by-day.
   ========================================================================== */
function datesTodayThroughEndOfMonth(){
  const start = new Date(); start.setHours(0,0,0,0);
  const end = new Date(start.getFullYear(), start.getMonth()+1, 0);
  const dates = [];
  for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) dates.push(new Date(d));
  return dates;
}

function openRateParity(roomId, planId, occ){
  const room = DB.rooms.get(roomId);
  const originPlan = DB.ratePlans.get(planId);
  if(!room || !originPlan) return;

  const channels = DB.channels.byProperty(currentPropertyId);
  const dates = datesTodayThroughEndOfMonth();

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

  document.getElementById('parityMeta').textContent = `${room.name}  •  ${originPlan.name}  •  ${occ} Pax`;

  const todayKey = keyOf(new Date());
  const theadDates = dates.map(d=>{
    const isToday = keyOf(d)===todayKey;
    return `<th class="${isToday?'today-col':''}">${d.toLocaleDateString('en-IN',{weekday:'short'})}<br>${d.getDate()} ${d.toLocaleDateString('en-IN',{month:'short'})}</th>`;
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

  document.getElementById('parityGridHost').innerHTML = `<div class="grid-table-wrap"><table class="grid-table">
    <thead><tr><th class="grid-sticky-col">Channel</th>${theadDates}</tr></thead>
    <tbody>${bodyRows}</tbody>
  </table></div>`;

  new bootstrap.Modal(document.getElementById('parityModal')).show();
}
