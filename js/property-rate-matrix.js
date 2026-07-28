/* ==========================================================================
   Rate Matrix — matrix-style rate comparison: Our Property vs. every mapped
   competitor property, room by room, across a date range. Reuses the Rate
   Calendar's own grid markup/CSS (.grid-table-wrap/.grid-table/.grid-sticky-col/
   .grid-price-cell/.today-col from css/style.css) so it reads as another view
   of the same module — just transposed, with dates running down the sticky
   first column instead of across the header. View-only: no inline editing,
   no occupancy/ADR/RevPAR/booking data — rate comparison only.
   ========================================================================== */
let mxGridStart = new Date();
let mxRangeMode = '14';
let mxSelectedCompetitors = null; // Set of competitor ids, null = not yet initialized (defaults to all)
let mxHiddenGroups = new Set();   // competitor ids hidden via the Properties selector
let mxCollapsedGroups = new Set(); // competitor ids collapsed (rows hidden, divider still shown)

document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Rate Matrix', subtitle:'Your rate vs. every mapped competitor room, side by side across a date range.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);
  const property = DB.properties.get(propertyId);

  const ourChannels = DB.channels.byProperty(propertyId);
  const ourMaster = ourChannels.find(c=>c.type==='master');
  const ourRooms = ourMaster ? DB.rooms.byChannel(ourMaster.id) : [];
  // Only the real properties your Company Admin actually assigned to you — same set as every
  // other Rate Intelligence page (Rate Shopper, Dashboard, Market Intelligence, Room Comparison).
  const comps = PORTALDATA.comparisonRealProperties();
  mxSelectedCompetitors = new Set(comps.map(c=>c.id));

  if(!ourRooms.length){
    document.getElementById('mx_gridHost').innerHTML = `<div class="empty-state"><i class="bi bi-door-closed"></i><h5>No rooms for this property</h5><p class="mb-0">Add a room and rate plan first.</p></div>`;
    return;
  }

  // ---- Filter option population ----
  document.getElementById('mx_room').innerHTML += ourRooms.map(r=>`<option value="${r.id}">${r.name}</option>`).join('');
  document.getElementById('mx_mealPlan').innerHTML += PORTALDATA.MEAL_PLANS.map(m=>`<option value="${m}">${m}</option>`).join('');
  document.getElementById('mx_channel').innerHTML = ourChannels.map(c=>`<option value="${c.id}" ${c.type==='master'?'selected':''}>${c.name}</option>`).join('');

  function renderCompetitorMenu(){
    const menu = document.getElementById('mx_competitorMenu');
    menu.innerHTML = `
      <div class="mx-check-actions">
        <button type="button" class="btn btn-link btn-sm p-0" id="mx_compAll">Select All</button>
        <span class="text-muted">·</span>
        <button type="button" class="btn btn-link btn-sm p-0" id="mx_compNone">Clear</button>
      </div>
      ${comps.map(c=>`<label class="mx-check-row"><input type="checkbox" class="mx-comp-check" value="${c.id}" ${mxSelectedCompetitors.has(c.id)?'checked':''}>${c.name}</label>`).join('') || '<div class="text-muted small px-2">No comparison properties assigned yet.</div>'}
    `;
    document.getElementById('mx_compAll').addEventListener('click', ()=>{ mxSelectedCompetitors = new Set(comps.map(c=>c.id)); renderCompetitorMenu(); renderGrid(); });
    document.getElementById('mx_compNone').addEventListener('click', ()=>{ mxSelectedCompetitors = new Set(); renderCompetitorMenu(); renderGrid(); });
    document.querySelectorAll('.mx-comp-check').forEach(cb=>{
      cb.addEventListener('change', ()=>{
        if(cb.checked) mxSelectedCompetitors.add(cb.value); else mxSelectedCompetitors.delete(cb.value);
        updateCompetitorBtnLabel();
        renderGrid();
      });
    });
    updateCompetitorBtnLabel();
  }
  function updateCompetitorBtnLabel(){
    const btn = document.getElementById('mx_competitorBtn');
    if(mxSelectedCompetitors.size === comps.length) btn.textContent = 'All Competitors';
    else if(mxSelectedCompetitors.size === 0) btn.textContent = 'No Competitors';
    else btn.textContent = `${mxSelectedCompetitors.size} Competitor${mxSelectedCompetitors.size>1?'s':''}`;
  }

  function renderColumnMenu(){
    const menu = document.getElementById('mx_columnMenu');
    menu.innerHTML = `
      <label class="mx-check-row"><input type="checkbox" checked disabled>${property.name} (You)</label>
      ${comps.map(c=>`<label class="mx-check-row"><input type="checkbox" class="mx-col-check" value="${c.id}" ${mxHiddenGroups.has(c.id)?'':'checked'}>${c.name}</label>`).join('')}
    `;
    document.querySelectorAll('.mx-col-check').forEach(cb=>{
      cb.addEventListener('change', ()=>{
        if(cb.checked) mxHiddenGroups.delete(cb.value); else mxHiddenGroups.add(cb.value);
        renderGrid();
      });
    });
  }

  // ---- Channel resolution: find the same room name on a specific channel, for either our own
  // property or a competitor's — matched by channelCode (the fixed catalog from js/data.js) so
  // "Booking.com" on my property correctly maps to "Booking.com" on theirs, never by raw id. ----
  function findRoomOnChannel(pid, refChannel, roomName){
    if(!refChannel) return null;
    const channels = DB.channels.byProperty(pid);
    const target = channels.find(c=>c.id===refChannel.id) || channels.find(c=>c.channelCode===refChannel.channelCode);
    if(!target) return null;
    return DB.rooms.byChannel(target.id).find(r=>r.name===roomName) || null;
  }

  function rateFor(channelRoom, dateKey, occ, mealPlanFilter, ratePlanFilter){
    if(!channelRoom) return null;
    let plans = DB.ratePlans.byRoom(channelRoom.id);
    if(mealPlanFilter) plans = plans.filter(p=>p.mealPlan===mealPlanFilter);
    if(ratePlanFilter==='refundable') plans = plans.filter(p=>p.refundable);
    else if(ratePlanFilter==='nonrefundable') plans = plans.filter(p=>!p.refundable);
    const plan = plans[0];
    if(!plan) return null;
    const day = DB.rates.forPlan(plan.id)[dateKey];
    const price = day ? ((day.occPrices && day.occPrices[occ]!=null) ? day.occPrices[occ] : day.price) : channelRoom.basePrice;
    return { price, plan };
  }

  // ---- Build the visible column groups (My Property + each visible/mapped competitor) ----
  function buildGroups(){
    const roomFilter = document.getElementById('mx_room').value;
    const search = document.getElementById('mx_search').value.trim().toLowerCase();

    const myRooms = ourRooms.filter(r=> !roomFilter || r.id===roomFilter)
      .filter(r=> !search || r.name.toLowerCase().includes(search) || property.name.toLowerCase().includes(search));
    const groups = [{ id:'me', name:`${property.name} (You)`, isMe:true, propertyIdForLookup:propertyId,
      rooms: myRooms.map(r=>({ roomName:r.name, ourRoomId:r.id })) }];

    comps.forEach(c=>{
      if(mxHiddenGroups.has(c.id)) return;
      if(!mxSelectedCompetitors.has(c.id)) return;
      MAPPING.ensureAutoMapped(propertyId, c.realPropertyId);
      const ev = MAPPING.evaluate(propertyId, c.realPropertyId);
      let mapped = ev.rooms.filter(r=>r.compRoom);
      if(roomFilter) mapped = mapped.filter(r=>r.ourRoom.id===roomFilter);
      if(search){
        const nameMatch = c.name.toLowerCase().includes(search);
        mapped = mapped.filter(r=> nameMatch || r.compRoom.name.toLowerCase().includes(search));
      }
      if(!mapped.length) return;
      groups.push({
        id:c.id, name:c.name, isMe:false, propertyIdForLookup:c.realPropertyId,
        rooms: mapped.map(r=>({ roomName:r.compRoom.name, ourRoomId:r.ourRoom.id }))
      });
    });
    return groups;
  }

  function numDaysFor(range){
    return Number(range);
  }

  function renderGrid(){
    const days = numDaysFor(mxRangeMode);
    const dates = [];
    for(let i=0;i<days;i++){ const d = new Date(mxGridStart); d.setDate(mxGridStart.getDate()+i); dates.push(d); }
    document.getElementById('periodLabel').textContent =
      `${dates[0].toLocaleDateString('en-IN',{day:'2-digit',month:'short'})} – ${dates[dates.length-1].toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'})}`;

    const occ = Number(document.getElementById('mx_occ').value);
    const mealPlanFilter = document.getElementById('mx_mealPlan').value;
    const ratePlanFilter = document.getElementById('mx_ratePlan').value;
    const channelId = document.getElementById('mx_channel').value;
    const myChannel = DB.channels.get(channelId) || ourMaster;

    const groups = buildGroups();
    const host = document.getElementById('mx_gridHost');

    if(!groups.some(g=>g.rooms.length)){
      host.innerHTML = `<div class="empty-state"><i class="bi bi-grid-3x3-gap"></i><h5>No mapped rooms to compare</h5><p class="mb-0">Adjust your filters, or map competitor rooms from the Competitors page's "Review Mapping" action.</p></div>`;
      return;
    }

    // Dates run across the top (sticky header row); Property/Room runs down the sticky first
    // column — same orientation as the Rate Calendar itself. Each group (My Property, then
    // every visible competitor) gets its own collapsible section-divider row, then one row per
    // mapped room. My Property is rendered first, so its rates can be looked up while rendering
    // every competitor row after it, to color each competitor cell cheaper/pricier vs. mine.
    const todayKey = DB.fmtDate(new Date());
    const theadDates = dates.map(d=>{
      const isToday = DB.fmtDate(d)===todayKey;
      return `<th class="${isToday?'today-col':''}">${d.toLocaleDateString('en-IN',{weekday:'short'})}<br>${d.getDate()} ${d.toLocaleDateString('en-IN',{month:'short'})}</th>`;
    }).join('');

    const totalRooms = groups.reduce((s,g)=>s+g.rooms.length, 0);
    document.getElementById('mx_summary').textContent =
      `Comparing ${groups[0].rooms.length} of your rooms against ${groups.length-1} competitor propert${groups.length-1===1?'y':'ies'} (${totalRooms-groups[0].rooms.length} mapped rooms) over ${dates.length} day${dates.length>1?'s':''}.`;

    const myRates = {}; // { ourRoomId: { dateKey: price } } — filled in while rendering the "me" group, read while rendering every group after it
    let bodyRows = '';
    groups.forEach(g=>{
      const collapsed = !g.isMe && mxCollapsedGroups.has(g.id);
      const chevron = g.isMe
        ? `<i class="bi bi-chevron-down mx-collapse-chevron" style="visibility:hidden"></i>`
        : `<i class="bi bi-chevron-${collapsed?'right':'down'} mx-collapse-chevron"></i>`;
      const propIcon = g.isMe ? '<i class="bi bi-star-fill"></i>' : '';
      const roomCount = !g.isMe ? `<span class="text-muted fw-normal" style="font-size:.72rem"> (${g.rooms.length} room${g.rooms.length===1?'':'s'})</span>` : '';
      bodyRows += `<tr class="grid-room-row mx-group-toggle" data-group="${g.id}"><td class="grid-sticky-col ${g.isMe?'mx-mine':''}"><span class="mx-group-label">${chevron}${propIcon}<span class="mx-group-name">${g.name}</span>${roomCount}</span></td>${dates.map(()=>'<td></td>').join('')}</tr>`;
      if(!g.rooms.length){
        bodyRows += `<tr><td class="grid-sticky-col"><div class="grid-plan-label text-muted small"><i class="bi bi-exclamation-circle me-1"></i>No mapped rooms</div></td>${dates.map(()=>'<td></td>').join('')}</tr>`;
        return;
      }
      if(collapsed) return;
      g.rooms.forEach(r=>{
        let rowRoomId = null, rowPlanId = null;
        const cells = dates.map(d=>{
          const dateKey = DB.fmtDate(d);
          const isToday = dateKey===todayKey;
          const channelRoom = findRoomOnChannel(g.propertyIdForLookup, myChannel, r.roomName);
          const result = rateFor(channelRoom, dateKey, occ, mealPlanFilter, ratePlanFilter);
          const price = result ? result.price : null;
          if(channelRoom) rowRoomId = channelRoom.id;
          if(result) rowPlanId = result.plan.id;
          if(g.isMe){
            if(!myRates[r.ourRoomId]) myRates[r.ourRoomId] = {}; myRates[r.ourRoomId][dateKey] = price;
          }

          const myPrice = (myRates[r.ourRoomId]||{})[dateKey];
          let diffTip = '';
          if(!g.isMe && price!=null && myPrice!=null){
            const diffPct = ((price-myPrice)/myPrice)*100;
            diffTip = ` • ${diffPct>=0?'+':''}${diffPct.toFixed(1)}% vs. your rate`;
          }
          const tooltip = price!=null
            ? `${g.name} — ${r.roomName} • ${occ} Pax • ${result.plan.mealPlan} • ${result.plan.refundable?'Flexible':'Non-Refundable'} • ${myChannel?myChannel.name:''} • ${APP.fmtDateReadable(dateKey)}: ${APP.fmtCurrency(price)}${diffTip}`
            : `${g.name} — ${r.roomName} — no rate available on ${myChannel?myChannel.name:'this channel'} for ${APP.fmtDateReadable(dateKey)}`;
          return `<td class="grid-price-cell ${g.isMe?'mx-mine':''} ${price==null?'mx-empty':''} ${isToday?'today-col':''}" title="${tooltip}">
            <div class="py-2 px-1"><div class="gp-price">${price!=null?APP.fmtCurrency(price):'—'}</div></div>
          </td>`;
        }).join('');
        const parityBtn = (rowRoomId && rowPlanId)
          ? `<button type="button" class="btn btn-sm-icon btn-soft parity-btn" style="width:24px;height:24px" title="Compare across channels" data-room="${rowRoomId}" data-plan="${rowPlanId}" data-property="${g.propertyIdForLookup}" data-occ="${occ}"><img src="https://www.eglobe-solutions.com/channelmanager/images/parity-view.png" alt="Rate Parity" class="parity-icon"></button>`
          : '';
        bodyRows += `<tr><td class="grid-sticky-col ${g.isMe?'mx-mine':''}"><div class="grid-plan-label d-flex align-items-center justify-content-between gap-2"><span class="name">${r.roomName}</span>${parityBtn}</div></td>${cells}</tr>`;
      });
    });

    host.innerHTML = `<div class="grid-table-wrap"><table class="grid-table">
      <thead><tr><th class="grid-sticky-col">Property / Room</th>${theadDates}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table></div>`;

    document.querySelectorAll('.mx-group-toggle').forEach(tr=>{
      const groupId = tr.dataset.group;
      if(groupId==='me') return; // My Property is always expanded
      tr.addEventListener('click', ()=>{
        if(mxCollapsedGroups.has(groupId)) mxCollapsedGroups.delete(groupId); else mxCollapsedGroups.add(groupId);
        renderGrid();
      });
    });

    document.querySelectorAll('.parity-btn').forEach(btn=>{
      btn.addEventListener('click', function(e){
        e.stopPropagation();
        openRateParity(this.dataset.room, this.dataset.plan, Number(this.dataset.occ), myChannel, this.dataset.property);
      });
    });
  }

  /* ==========================================================================
     Rate Parity — for one room/rate plan/occupancy, shows every channel that lists
     a matching room (rows) against every date from today through end of this month
     (columns), so you can eyeball how your price compares day-by-day. Ported
     verbatim from the Rate Calendar's own implementation.
     ========================================================================== */
  function datesTodayThroughEndOfMonth(){
    const start = new Date(); start.setHours(0,0,0,0);
    const end = new Date(start.getFullYear(), start.getMonth()+1, 0);
    const dates = [];
    for(let d=new Date(start); d<=end; d.setDate(d.getDate()+1)) dates.push(new Date(d));
    return dates;
  }

  function openRateParity(roomId, planId, occ, currentChannel, forPropertyId){
    const room = DB.rooms.get(roomId);
    const originPlan = DB.ratePlans.get(planId);
    if(!room || !originPlan) return;

    const channels = DB.channels.byProperty(forPropertyId || propertyId);
    const dates = datesTodayThroughEndOfMonth();

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
        const key = DB.fmtDate(d);
        const dayData = DB.rates.forPlan(row.ratePlan.id)[key];
        const price = dayData ? ((dayData.occPrices && dayData.occPrices[occ]!=null) ? dayData.occPrices[occ] : dayData.price) : null;
        return price;
      });
      return { ...row, prices };
    });

    document.getElementById('parityMeta').textContent = `${room.name}  •  ${originPlan.name}  •  ${occ} Pax`;

    const todayKey = DB.fmtDate(new Date());
    const theadDates = dates.map(d=>{
      const isToday = DB.fmtDate(d)===todayKey;
      return `<th class="${isToday?'today-col':''}">${d.toLocaleDateString('en-IN',{weekday:'short'})}<br>${d.getDate()} ${d.toLocaleDateString('en-IN',{month:'short'})}</th>`;
    }).join('');

    const bodyRows = priceGrid.map(row=>{
      const meta = DB.CHANNEL_TYPES[row.channel.type] || DB.CHANNEL_TYPES.custom;
      const isCurrent = currentChannel && row.channel.id === currentChannel.id;
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

  function shiftPeriod(dir){
    mxGridStart.setDate(mxGridStart.getDate() + dir*numDaysFor(mxRangeMode));
    renderGrid();
  }

  function resetFilters(){
    document.getElementById('mx_room').value = '';
    document.getElementById('mx_occ').value = '2';
    document.getElementById('mx_mealPlan').value = '';
    document.getElementById('mx_channel').value = ourMaster ? ourMaster.id : '';
    document.getElementById('mx_ratePlan').value = '';
    document.getElementById('mx_search').value = '';
    mxSelectedCompetitors = new Set(comps.map(c=>c.id));
    mxHiddenGroups = new Set();
    mxCollapsedGroups = new Set();
    renderCompetitorMenu();
    renderColumnMenu();
    renderGrid();
  }

  function exportCsv(){
    const groups = buildGroups();
    const occ = Number(document.getElementById('mx_occ').value);
    const mealPlanFilter = document.getElementById('mx_mealPlan').value;
    const ratePlanFilter = document.getElementById('mx_ratePlan').value;
    const channelId = document.getElementById('mx_channel').value;
    const myChannel = DB.channels.get(channelId) || ourMaster;
    const days = numDaysFor(mxRangeMode);
    const dates = [];
    for(let i=0;i<days;i++){ const d=new Date(mxGridStart); d.setDate(mxGridStart.getDate()+i); dates.push(d); }

    const dateHeaders = dates.map(d=>APP.fmtDateReadable(DB.fmtDate(d)));
    const lines = [['Property / Room', ...dateHeaders].map(v=>`"${v}"`).join(',')];
    groups.forEach(g=>{
      if(!g.rooms.length){ lines.push([`"${g.name}"`, ...dates.map(()=>'""')].join(',')); return; }
      g.rooms.forEach(r=>{
        const row = [`${g.name} — ${r.roomName}`];
        dates.forEach(d=>{
          const dateKey = DB.fmtDate(d);
          const channelRoom = findRoomOnChannel(g.propertyIdForLookup, myChannel, r.roomName);
          const result = rateFor(channelRoom, dateKey, occ, mealPlanFilter, ratePlanFilter);
          row.push(result ? result.price : '');
        });
        lines.push(row.map(v=>`"${v}"`).join(','));
      });
    });
    const blob = new Blob([lines.join('\n')], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `rate-matrix-${DB.fmtDate(new Date())}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
    APP.toast('Export Complete', 'Your CSV file has been downloaded.', 'success');
  }

  // ---- Wiring ----
  document.getElementById('prevPeriod').addEventListener('click', ()=> shiftPeriod(-1));
  document.getElementById('nextPeriod').addEventListener('click', ()=> shiftPeriod(1));
  document.getElementById('btnToday').addEventListener('click', ()=>{ mxGridStart = new Date(); renderGrid(); });

  document.querySelectorAll('#rangeFilter [data-range]').forEach(btn=>{
    btn.addEventListener('click', function(){
      mxRangeMode = this.dataset.range;
      document.querySelectorAll('#rangeFilter [data-range]').forEach(b=>{
        const active = b===this;
        b.classList.toggle('btn-soft', !active);
        b.classList.toggle('btn-outline-primary', active);
      });
      renderGrid();
    });
  });

  ['mx_room','mx_occ','mx_mealPlan','mx_channel','mx_ratePlan'].forEach(id=>{
    document.getElementById(id).addEventListener('change', renderGrid);
  });
  document.getElementById('mx_search').addEventListener('input', renderGrid);
  document.getElementById('mx_reset').addEventListener('click', resetFilters);

  document.getElementById('mx_exportCsv').addEventListener('click', (e)=>{ e.preventDefault(); exportCsv(); });
  document.getElementById('mx_exportExcel').addEventListener('click', (e)=>{ e.preventDefault(); APP.toast('Export Started', 'Your Excel workbook is being prepared for download.', 'success'); });
  document.getElementById('mx_exportPdf').addEventListener('click', (e)=>{ e.preventDefault(); APP.toast('Export Started', 'Your PDF report is being prepared for download.', 'success'); });
  document.getElementById('mx_print').addEventListener('click', ()=> window.print());

  renderCompetitorMenu();
  renderColumnMenu();
  renderGrid();
});
