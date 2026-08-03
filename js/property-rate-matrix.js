/* ==========================================================================
   Rate Matrix — matrix-style rate comparison: Our Property vs. every mapped
   competitor property, room by room, across a date range. Reuses the Rate
   Calendar's own grid markup/CSS (.grid-table-wrap/.grid-table/.grid-sticky-col/
   .grid-price-cell/.today-col from css/style.css) so it reads as another view
   of the same module — just transposed, with dates running down the sticky
   first column instead of across the header. View-only: no inline editing,
   no occupancy/ADR/RevPAR/booking data — rate comparison only.
   ========================================================================== */
// The header (thead) and body (tbody) now live in two separate scroll containers — see
// css/rate-matrix.css's ".grid-header-scroll" comment for why — so their horizontal scroll
// position has to be kept in sync manually. The header itself is never dragged directly (its
// own overflow is hidden, no visible scrollbar there); it only ever follows the body.
function syncHeaderScroll(headerEl, bodyEl){
  if(!headerEl || !bodyEl) return;
  headerEl.scrollLeft = bodyEl.scrollLeft;
  bodyEl.onscroll = ()=>{ headerEl.scrollLeft = bodyEl.scrollLeft; };
}

// Header and body are two independent <table>s (see above), each running its own auto-layout —
// so even though both use the same min/max-width CSS constraints per column, the browser can
// still resolve each table's "stretch to fill 100%" remainder differently, since that
// distribution is influenced by each column's own *content* (date text like "Mon 3 Aug" in the
// header table vs. price text like "₹11,760" in the body table) — the two tables were only ever
// coincidentally matching in earlier testing, not guaranteed to. Forcing every header <th> to the
// body's own actual rendered column width removes that ambiguity entirely: the header no longer
// runs its own layout math at all, it just mirrors whatever the body (the real data) decided.
function syncHeaderColumnWidths(host){
  const headerTable = host && host.querySelector('.grid-header-scroll table');
  const bodyWrap = host && host.querySelector('.grid-table-wrap');
  if(!headerTable || !bodyWrap) return;
  const bodyRow = bodyWrap.querySelector('tbody tr');
  const headerCells = headerTable.querySelectorAll('thead th');
  if(!bodyRow){
    // No rows to measure against (e.g. an empty room group) — still lock the sticky column's
    // width so at least that stays aligned; date columns fall back to their own CSS constraints.
    if(headerCells[0]) headerCells[0].style.width = `${headerCells[0].getBoundingClientRect().width}px`;
    return;
  }
  const bodyCells = bodyRow.children;
  for(let i=0; i<headerCells.length && i<bodyCells.length; i++){
    const w = bodyCells[i].getBoundingClientRect().width;
    headerCells[i].style.width = `${w}px`;
    headerCells[i].style.minWidth = `${w}px`;
    headerCells[i].style.maxWidth = `${w}px`;
  }
}

let mxRangeStart = null, mxRangeEnd = null; // the matrix's active date range — drives the grid, CSV export, and Rate Parity alike
let mxPreset = '14'; // longer default window than before, so a first-time visitor sees two weeks of rate movement instead of just one

// Cross-fade a grid re-render instead of swapping its content instantly. The previous version of
// this swapped content after a single requestAnimationFrame — only ~16ms after the fade-out
// class was added — which is nowhere near enough time for the opacity transition (220ms, matching
// #mx_gridHost/#parityGridHost's CSS transition-duration) to actually get low. The column-count/
// width jump was therefore happening in full view; the "fade" never got a chance to mask it. Now
// the re-render is deferred until the fade-out transition has actually finished.
const GRID_FADE_MS = 220;
function fadeAndRerender(host, renderFn){
  host.classList.add('mx-grid-fade');
  setTimeout(()=>{
    renderFn();
    requestAnimationFrame(()=> host.classList.remove('mx-grid-fade'));
  }, GRID_FADE_MS);
}

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
    // Sits flush with the end of the sticky "Property / Room" column, not spilling over into the
    // first date column, so the first date (e.g. Monday) starts exactly where it should.
    // Measured from the sticky column's own right edge (not wrap.left + stickyWidth) since the
    // wrap can carry its own left inset (e.g. the scrollbar-gutter offset), which would otherwise
    // throw this off by that same amount.
    const leftElWidth = leftEl.getBoundingClientRect().width || 34;
    const stickyRight = stickyEl ? stickyEl.getBoundingClientRect().right : (wrapRect.left + stickyWidth);
    leftEl.style.left = `${(stickyRight - cardRect.left) - leftElWidth}px`;
    leftEl.style.right = 'auto';
  }
  const rightEl = document.getElementById(rightId);
  if(rightEl){
    rightEl.style.top = `${top}px`; rightEl.style.height = `${h}px`;
    // Flush with the table's own real right edge — overlaying the last visible date column,
    // instead of a fixed px guess that could land past it in the card's padding.
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
let mxSelectedCompetitors = null; // Set of competitor ids, null = not yet initialized (defaults to all)
let mxHiddenGroups = new Set();   // competitor ids hidden via the Properties selector
let mxCollapsedGroups = new Set(); // competitor ids collapsed (rows hidden, divider still shown)

// ---- date helpers shared by the range picker, the grid, CSV export, and Rate Parity ----
function mxStartOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x; }
function mxAddDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x; }
function mxAddMonths(d,n){ const x=new Date(d); x.setMonth(x.getMonth()+n); return x; }
function mxSameDay(a,b){ return !!a && !!b && a.toDateString()===b.toDateString(); }
function mxFmtShort(d){ return d.toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}); }
function mxPresetRange(key){
  const today = mxStartOfDay(new Date());
  if(key==='today') return { start:today, end:today };
  if(key==='yesterday'){ const y=mxAddDays(today,-1); return { start:y, end:y }; }
  if(key==='7') return { start:today, end:mxAddDays(today,6) };
  if(key==='14') return { start:today, end:mxAddDays(today,13) };
  if(key==='30') return { start:today, end:mxAddDays(today,29) };
  if(key==='90') return { start:today, end:mxAddDays(today,89) };
  if(key==='lastMonth'){
    const firstOfThisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    const lastMonthEnd = mxAddDays(firstOfThisMonth,-1);
    const lastMonthStart = new Date(lastMonthEnd.getFullYear(), lastMonthEnd.getMonth(), 1);
    return { start:lastMonthStart, end:lastMonthEnd };
  }
  return { start:today, end:mxAddDays(today,6) };
}

document.addEventListener('DOMContentLoaded', ()=>{
  // Rendered inline as part of Rate Shopper (not a standalone page) — the page chrome
  // (sidebar/topbar/theme/breadcrumb) is already set up by property-rate-shopper.js's own
  // PORTAL.mount() call, which runs first; this only needs the session/property check.
  const me = PORTAL.guard();
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
  // Room Category — only the categories actually present among your own rooms are offered, so the
  // list is never longer than what could possibly match something.
  const roomCategories = [...new Set(ourRooms.map(r=>r.category).filter(Boolean))].sort();
  document.getElementById('mx_roomCategory').innerHTML += roomCategories.map(cat=>`<option value="${cat}">${cat}</option>`).join('');
  // Market Segment — each tracked comparison property's own type (Resort/Business Hotel/Heritage
  // Hotel/Boutique Hotel), the same classification used everywhere else a property is described.
  const marketSegments = [...new Set(comps.map(c=>{ const cp = DB.properties.get(c.realPropertyId); return cp ? cp.type : null; }).filter(Boolean))].sort();
  document.getElementById('mx_marketSegment').innerHTML += marketSegments.map(seg=>`<option value="${seg}">${seg}</option>`).join('');

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
    const categoryFilter = document.getElementById('mx_roomCategory').value;
    const segmentFilter = document.getElementById('mx_marketSegment').value;
    const comparisonType = document.getElementById('mx_comparisonType').value;
    const search = document.getElementById('mx_search').value.trim().toLowerCase();

    const myRooms = ourRooms.filter(r=> !roomFilter || r.id===roomFilter)
      .filter(r=> !categoryFilter || r.category===categoryFilter)
      .filter(r=> !search || r.name.toLowerCase().includes(search) || property.name.toLowerCase().includes(search));
    const groups = [{ id:'me', name:`${property.name} (You)`, isMe:true, propertyIdForLookup:propertyId,
      rooms: myRooms.map(r=>({ roomName:r.name, ourRoomId:r.id })) }];

    comps.forEach(c=>{
      if(mxHiddenGroups.has(c.id)) return;
      if(!mxSelectedCompetitors.has(c.id)) return;
      // Market Segment — the comparison property's own type (Resort/Business Hotel/etc.).
      if(segmentFilter){
        const cp = DB.properties.get(c.realPropertyId);
        if(!cp || cp.type !== segmentFilter) return;
      }
      MAPPING.ensureAutoMapped(propertyId, c.realPropertyId);
      const ev = MAPPING.evaluate(propertyId, c.realPropertyId);
      let mapped = ev.rooms.filter(r=>r.compRoom);
      if(roomFilter) mapped = mapped.filter(r=>r.ourRoom.id===roomFilter);
      if(categoryFilter) mapped = mapped.filter(r=> r.compRoom.category===categoryFilter || r.ourRoom.category===categoryFilter);
      if(search){
        const nameMatch = c.name.toLowerCase().includes(search);
        mapped = mapped.filter(r=> nameMatch || r.compRoom.name.toLowerCase().includes(search));
      }
      if(!mapped.length) return;
      // Comparison Type — "matched" (default) keeps one row per like-for-like mapped room;
      // "cheapest" collapses each competitor down to just their single lowest base-priced room,
      // for a quick "who's the cheapest option available" read instead of a full room-by-room grid.
      if(comparisonType==='cheapest'){
        mapped = [mapped.reduce((min,r)=> r.compRoom.basePrice < min.compRoom.basePrice ? r : min)];
      }
      groups.push({
        id:c.id, name:c.name, isMe:false, propertyIdForLookup:c.realPropertyId,
        rooms: mapped.map(r=>({ roomName:r.compRoom.name, ourRoomId:r.ourRoom.id }))
      });
    });
    return groups;
  }

  // Every date in the currently selected range (inclusive) — shared by the grid, CSV export,
  // and Rate Parity, so all three always agree on "what dates am I looking at right now".
  function currentDates(){
    const dates = [];
    let d = new Date(mxRangeStart);
    while(d <= mxRangeEnd){ dates.push(new Date(d)); d = mxAddDays(d,1); }
    return dates;
  }

  function renderGrid(){
    const dates = currentDates();

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
      return `<th class="grid-date-col ${isToday?'today-col':''}" scope="col">${d.toLocaleDateString('en-IN',{weekday:'short'})}<br>${d.getDate()} ${d.toLocaleDateString('en-IN',{month:'short'})}</th>`;
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
      // Keyboard-accessible collapse/expand — not just a click target: role="button" + tabindex
      // so it's Tab-reachable, aria-expanded so its state is announced, and Enter/Space wired
      // below alongside the existing click handler (My Property's row never collapses, so it's
      // left as a plain, non-interactive row).
      const toggleAttrs = g.isMe ? '' : `role="button" tabindex="0" aria-expanded="${!collapsed}" aria-label="${collapsed?'Expand':'Collapse'} ${g.name} rooms"`;
      bodyRows += `<tr class="grid-room-row mx-group-toggle" data-group="${g.id}" ${toggleAttrs}><td class="grid-sticky-col ${g.isMe?'mx-mine':''}"><span class="mx-group-label">${chevron}${propIcon}<span class="mx-group-name">${g.name}</span></span></td>${dates.map(()=>'<td></td>').join('')}</tr>`;
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

    host.innerHTML = `<div class="grid-split-wrap">
      <div class="grid-header-scroll"><table class="grid-table"><thead><tr><th class="grid-sticky-col" scope="col">Property / Room</th>${theadDates}</tr></thead></table></div>
      <div class="grid-table-wrap" tabindex="0" role="group" aria-label="Rate Matrix, scrollable with arrow keys"><table class="grid-table">
        <tbody>${bodyRows}</tbody>
      </table></div>
    </div>`;
    syncHeaderColumnWidths(host);
    alignEdgeZonesToHeader(document.querySelector('.mx-grid-card'), host, 'mx_edgeLeft', 'mx_edgeRight');
    alignVerticalEdgeZones(document.querySelector('.mx-grid-card'), host.querySelector('.grid-table-wrap'), 'mx_edgeUp', 'mx_edgeDown', 14);
    syncHeaderScroll(host.querySelector('.grid-header-scroll'), host.querySelector('.grid-table-wrap'));

    document.querySelectorAll('.mx-group-toggle').forEach(tr=>{
      const groupId = tr.dataset.group;
      if(groupId==='me') return; // My Property is always expanded
      const toggle = ()=>{
        if(mxCollapsedGroups.has(groupId)) mxCollapsedGroups.delete(groupId); else mxCollapsedGroups.add(groupId);
        renderGrid();
      };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', e=>{
        if(e.key==='Enter' || e.key===' '){ e.preventDefault(); toggle(); }
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
     a matching room (rows) against a date range (columns). Defaults to whatever
     range the Rate Matrix itself is showing, but has its own independent range
     picker (preset pills + plain date inputs) so it can be widened or narrowed
     without touching the main grid — no custom calendar widget to figure out.
     ========================================================================== */
  let parityCtx = null; // { room, originPlan, occ, currentChannel, forPropertyId }
  let parityRangeStart = null, parityRangeEnd = null;

  function parityDatesInRange(){
    const dates = [];
    let d = new Date(parityRangeStart);
    while(d <= parityRangeEnd){ dates.push(new Date(d)); d = mxAddDays(d,1); }
    return dates;
  }

  function renderParityGrid(){
    const { room, originPlan, occ, currentChannel, forPropertyId } = parityCtx;
    const channels = DB.channels.byProperty(forPropertyId || propertyId);
    const dates = parityDatesInRange();

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

    document.getElementById('parityMeta').textContent = `${room.name}  •  ${originPlan.name}  •  ${occ} Pax  •  ${mxFmtShort(dates[0])} – ${mxFmtShort(dates[dates.length-1])}`;

    const todayKey = DB.fmtDate(new Date());
    const theadDates = dates.map(d=>{
      const isToday = DB.fmtDate(d)===todayKey;
      return `<th class="grid-date-col ${isToday?'today-col':''}" scope="col">${d.toLocaleDateString('en-IN',{weekday:'short'})}<br>${d.getDate()} ${d.toLocaleDateString('en-IN',{month:'short'})}</th>`;
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

    const parityHost = document.getElementById('parityGridHost');
    parityHost.innerHTML = `<div class="grid-table-wrap" tabindex="0" role="group" aria-label="Rate Parity, scrollable with arrow keys"><table class="grid-table">
      <thead><tr><th class="grid-sticky-col" scope="col">Channel</th>${theadDates}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table></div>`;
    alignEdgeZonesToHeader(document.querySelector('.parity-scroll-wrap'), parityHost, 'parity_edgeLeft', 'parity_edgeRight');
  }

  function setParityActivePreset(days){
    document.querySelectorAll('#parity_rangeGroup [data-days]').forEach(b=>{
      const active = Number(b.dataset.days)===days;
      b.classList.toggle('btn-outline-primary', active); b.classList.toggle('btn-soft', !active);
      b.setAttribute('aria-pressed', String(active));
    });
    // Same rule as the main grid: range-shift arrows only for 30 Days or a manual/custom range
    // (days==null), never for the fixed 7/14 Day presets.
    const shiftable = days === 30 || days == null;
    const wrap = document.querySelector('.parity-scroll-wrap');
    if(wrap) wrap.classList.toggle('mx-range-shiftable', shiftable);
  }
  function applyParityRange(start, end, presetDays){
    parityRangeStart = mxStartOfDay(start); parityRangeEnd = mxStartOfDay(end);
    document.getElementById('parity_startDate').value = DB.fmtDate(parityRangeStart);
    document.getElementById('parity_endDate').value = DB.fmtDate(parityRangeEnd);
    setParityActivePreset(presetDays || null);

    // Same cross-fade treatment as the main grid — softens the column-count jump when the
    // parity range changes instead of an instant swap.
    fadeAndRerender(document.getElementById('parityGridHost'), renderParityGrid);
  }
  // Shift the parity range backward/forward by its own current span — mirrors mxShiftRange, kept
  // separate since the parity range is independent of the main grid's.
  function parityShiftRange(direction){
    const spanDays = Math.round((parityRangeEnd - parityRangeStart) / 86400000) + 1;
    const newStart = mxAddDays(parityRangeStart, direction*spanDays);
    const newEnd = mxAddDays(parityRangeEnd, direction*spanDays);
    const activeBtn = document.querySelector('#parity_rangeGroup [data-days].btn-outline-primary');
    applyParityRange(newStart, newEnd, activeBtn ? Number(activeBtn.dataset.days) : null);
  }
  document.querySelectorAll('#parity_rangeGroup [data-days]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const days = Number(btn.dataset.days);
      applyParityRange(mxStartOfDay(new Date()), mxAddDays(mxStartOfDay(new Date()), days-1), days);
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

  function openRateParity(roomId, planId, occ, currentChannel, forPropertyId){
    const room = DB.rooms.get(roomId);
    const originPlan = DB.ratePlans.get(planId);
    if(!room || !originPlan) return;
    parityCtx = { room, originPlan, occ, currentChannel, forPropertyId };

    // Seed from the Rate Matrix's own currently-active range — the parity picker starts wherever
    // the matrix is looking, but can be changed independently from here without affecting it.
    const seedDates = currentDates();
    parityRangeStart = mxStartOfDay(seedDates[0]);
    parityRangeEnd = mxStartOfDay(seedDates[seedDates.length-1]);
    document.getElementById('parity_startDate').value = DB.fmtDate(parityRangeStart);
    document.getElementById('parity_endDate').value = DB.fmtDate(parityRangeEnd);
    setParityActivePreset(null);

    renderParityGrid();
    // getOrCreateInstance (not `new Modal(...)`) — this can be opened many times per page visit,
    // and constructing a fresh instance every time leaves the previous one's event listeners
    // attached to the same DOM element, which is what was causing the page to become unresponsive
    // ("frozen") after the modal had been opened more than once.
    bootstrap.Modal.getOrCreateInstance(document.getElementById('parityModal')).show();
  }

  function resetFilters(){
    document.getElementById('mx_room').value = '';
    document.getElementById('mx_roomCategory').value = '';
    document.getElementById('mx_occ').value = '2';
    document.getElementById('mx_mealPlan').value = '';
    document.getElementById('mx_channel').value = ourMaster ? ourMaster.id : '';
    document.getElementById('mx_ratePlan').value = '';
    document.getElementById('mx_marketSegment').value = '';
    document.getElementById('mx_comparisonType').value = 'matched';
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
    const dates = currentDates();

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

  /* ==========================================================================
     Time Range — a sleek pill/segmented single-select (7D/14D/30D/90D) inline with the page
     header controls, plus a "Custom" pill that pops open a Google Analytics/Power BI-style dual
     month calendar. Replaces the old dropdown-with-presets-list entirely — every fixed option is
     now one click away instead of two. The grid, CSV export, and Rate Parity all still read the
     resulting mxRangeStart/mxRangeEnd exactly as before.
     ========================================================================== */
  let mxCalMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1); // left calendar's anchor month; right = +1 month
  let mxPickStart = null, mxPickEnd = null; // in-progress Custom Range selection, not yet applied

  function setActiveSeg(presetKey){
    document.querySelectorAll('.mx-seg-btn[data-preset]').forEach(b=>{
      const active = b.dataset.preset===presetKey;
      b.classList.toggle('active', active);
      b.setAttribute('aria-pressed', String(active));
    });
  }

  function applyRange(start, end, presetKey){
    mxRangeStart = mxStartOfDay(start); mxRangeEnd = mxStartOfDay(end);
    mxPreset = presetKey;
    setActiveSeg(presetKey);
    document.getElementById('mx_dateRangeLabel').textContent = mxSameDay(mxRangeStart,mxRangeEnd)
      ? mxFmtShort(mxRangeStart) : `${mxFmtShort(mxRangeStart)} – ${mxFmtShort(mxRangeEnd)}`;

    // Prev/Next range-shift arrows live embedded in the grid's own date header row (the
    // .mx-edge-left/right zones) and only make sense once the window is wide enough that paging
    // by a whole period is actually useful — 30D/90D/Custom, never 7D/14D (the CSS in
    // rate-matrix.css hides them entirely unless this class is present).
    document.querySelector('.mx-grid-card').classList.toggle('mx-range-shiftable', presetKey!=='7' && presetKey!=='14');

    // Cross-fade the grid instead of an instant column-count jump — going from 7D to 14D roughly
    // doubles the date columns, which felt like a jarring, "choppy" jump when swapped in instantly.
    fadeAndRerender(document.getElementById('mx_gridHost'), renderGrid);
  }

  // ---- Prev/Next range navigation — keyboard- and mouse-accessible way to step through time
  // without reopening the Custom picker every time; keeps the currently active window's length
  // (7/14/30/90 days or a custom span) and just slides it backward/forward by that same span. ----
  function mxShiftRange(direction){
    const spanDays = Math.round((mxRangeEnd - mxRangeStart) / 86400000) + 1;
    const newStart = mxAddDays(mxRangeStart, direction*spanDays);
    const newEnd = mxAddDays(mxRangeEnd, direction*spanDays);
    applyRange(newStart, newEnd, mxPreset==='custom' ? 'custom' : mxPreset);
  }

  function mxDaysInMonthGrid(monthDate){
    const first = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const gridStart = mxAddDays(first, -first.getDay());
    return Array.from({length:42}).map((_,i)=> mxAddDays(gridStart, i));
  }

  function renderCalMonth(hostId, labelId, monthDate){
    document.getElementById(labelId).textContent = monthDate.toLocaleDateString('en-IN',{month:'long',year:'numeric'});
    const today = mxStartOfDay(new Date());
    const dowLabels = ['S','M','T','W','T','F','S'];
    const cellsHtml = mxDaysInMonthGrid(monthDate).map(d=>{
      const inMonth = d.getMonth()===monthDate.getMonth();
      if(!inMonth) return `<button type="button" class="mx-drp-day" disabled tabindex="-1" style="visibility:hidden"></button>`;
      let cls = 'mx-drp-day';
      const isStart = mxSameDay(d, mxPickStart), isEnd = mxSameDay(d, mxPickEnd);
      const inRange = mxPickStart && mxPickEnd && d > mxPickStart && d < mxPickEnd;
      if(mxSameDay(d, today)) cls += ' mx-drp-today';
      if(isStart || isEnd) cls += ' mx-drp-endpoint';
      if(isStart) cls += ' mx-drp-range-start';
      if(isEnd) cls += ' mx-drp-range-end';
      if(inRange) cls += ' mx-drp-in-range';
      return `<button type="button" class="${cls}" data-date="${DB.fmtDate(d)}">${d.getDate()}</button>`;
    }).join('');
    document.getElementById(hostId).innerHTML = dowLabels.map(d=>`<div class="mx-drp-dow">${d}</div>`).join('') + cellsHtml;
  }

  function mxPickDate(d){
    if(!mxPickStart || (mxPickStart && mxPickEnd)){ mxPickStart = d; mxPickEnd = null; }
    else if(d < mxPickStart){ mxPickEnd = mxPickStart; mxPickStart = d; }
    else mxPickEnd = d;
    renderDualCalendar();
  }

  function updateSelectedLabel(){
    const lbl = document.getElementById('mx_drpSelectedLabel');
    const applyBtn = document.getElementById('mx_drpApply');
    if(mxPickStart && mxPickEnd){ lbl.textContent = `${mxFmtShort(mxPickStart)} – ${mxFmtShort(mxPickEnd)}`; applyBtn.disabled = false; }
    else if(mxPickStart){ lbl.textContent = `${mxFmtShort(mxPickStart)} – select end date`; applyBtn.disabled = true; }
    else { lbl.textContent = 'Select a start and end date'; applyBtn.disabled = true; }
  }

  function renderDualCalendar(){
    renderCalMonth('mx_drpCal1', 'mx_drpMonthLabel1', mxCalMonth);
    renderCalMonth('mx_drpCal2', 'mx_drpMonthLabel2', mxAddMonths(mxCalMonth, 1));
    updateSelectedLabel();
    document.querySelectorAll('#mx_drpCal1 .mx-drp-day:not(:disabled), #mx_drpCal2 .mx-drp-day:not(:disabled)').forEach(btn=>{
      btn.addEventListener('click', ()=> mxPickDate(new Date(btn.dataset.date+'T00:00:00')));
    });
  }

  function closeCustomDropdown(){
    bootstrap.Dropdown.getOrCreateInstance(document.getElementById('mx_customBtn')).hide();
  }

  // 7D/14D/30D/90D — plain single-select pills, applied immediately on click.
  document.querySelectorAll('.mx-seg-btn[data-preset]:not(#mx_customBtn)').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const { start, end } = mxPresetRange(btn.dataset.preset);
      applyRange(start, end, btn.dataset.preset);
    });
  });

  // Custom — opening the popover seeds the calendar from whatever range is currently active,
  // so re-opening it always shows where you already are, not a stale/blank selection. If there
  // isn't enough room below the trigger to fit the whole dual calendar, flip it to open upward
  // instead of silently letting the bottom half render off-screen/under the fold.
  document.getElementById('mx_customDropdown').addEventListener('show.bs.dropdown', (e)=>{
    mxPickStart = new Date(mxRangeStart); mxPickEnd = new Date(mxRangeEnd);
    mxCalMonth = new Date(mxPickStart.getFullYear(), mxPickStart.getMonth(), 1);
    renderDualCalendar();
    const triggerRect = e.relatedTarget.getBoundingClientRect();
    const spaceBelow = window.innerHeight - triggerRect.bottom;
    document.getElementById('mx_customDropdown').classList.toggle('dropup', spaceBelow < 340 && triggerRect.top > 340);
  });
  document.getElementById('mx_drpPrevMonth').addEventListener('click', ()=>{ mxCalMonth = mxAddMonths(mxCalMonth, -1); renderDualCalendar(); });
  document.getElementById('mx_drpNextMonth').addEventListener('click', ()=>{ mxCalMonth = mxAddMonths(mxCalMonth, 1); renderDualCalendar(); });
  document.getElementById('mx_drpCancel').addEventListener('click', closeCustomDropdown);
  document.getElementById('mx_drpApply').addEventListener('click', ()=>{
    if(!mxPickStart || !mxPickEnd) return;
    applyRange(mxPickStart, mxPickEnd, 'custom');
    closeCustomDropdown();
  });

  // Range-shift is now triggered by clicking the grid's own left/right edge zones (embedded in
  // the date header row) rather than separate toolbar buttons — see applyRange() for the
  // .mx-range-shiftable visibility toggle that hides these for 7D/14D.
  document.getElementById('mx_edgeLeft').addEventListener('click', ()=> mxShiftRange(-1));
  document.getElementById('mx_edgeRight').addEventListener('click', ()=> mxShiftRange(1));

  // Keyboard access for the grids themselves — both .grid-table-wrap elements are focusable
  // (tabindex="0", set where they're rendered) precisely so a keyboard-only user has a way to
  // scroll a wide table that isn't just "hover near the edge with a mouse." Delegated on document
  // since both wraps are rebuilt (innerHTML) on every render.
  document.addEventListener('keydown', e=>{
    const wrap = e.target.closest('.grid-table-wrap[tabindex]');
    if(!wrap) return;
    const step = 80;
    const moves = {
      ArrowLeft:[-step,0], ArrowRight:[step,0], ArrowUp:[0,-step], ArrowDown:[0,step],
      PageUp:[0,-wrap.clientHeight*0.9], PageDown:[0,wrap.clientHeight*0.9],
      Home:[-wrap.scrollWidth,0], End:[wrap.scrollWidth,0]
    };
    if(!moves[e.key]) return;
    e.preventDefault();
    wrap.scrollBy({ left:moves[e.key][0], top:moves[e.key][1], behavior:'smooth' });
  });

  // Edge hover-scroll — hovering near an edge of a grid scrolls smoothly toward it for as long as
  // the cursor stays there, instead of a click-to-scroll arrow/directional pad. Looks up the
  // scroll container fresh on every frame since renderGrid()/renderParityGrid() rebuild their
  // host's innerHTML (and therefore the .grid-table-wrap element itself) on every change, so a
  // reference captured once would go stale. Shared between the main Rate Matrix grid (4
  // directions) and the Rate Parity modal's grid (left/right only, it never scrolls vertically).
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
    });
  }
  wireEdgeScroll('#mx_gridHost .grid-table-wrap', [
    { id:'mx_edgeUp',    dx:0,  dy:-9 },
    { id:'mx_edgeDown',  dx:0,  dy:9  },
    { id:'mx_edgeLeft',  dx:-9, dy:0  },
    { id:'mx_edgeRight', dx:9,  dy:0  },
  ]);
  // These zones stay hoverable (for panning within the loaded columns) at every preset — only
  // the click-to-jump-a-period behavior is gated to when a 30 Days/Custom range makes it useful.
  document.getElementById('parity_edgeLeft').addEventListener('click', ()=>{
    if(document.querySelector('.parity-scroll-wrap').classList.contains('mx-range-shiftable')) parityShiftRange(-1);
  });
  document.getElementById('parity_edgeRight').addEventListener('click', ()=>{
    if(document.querySelector('.parity-scroll-wrap').classList.contains('mx-range-shiftable')) parityShiftRange(1);
  });
  wireEdgeScroll('#parityGridHost .grid-table-wrap', [
    { id:'parity_edgeLeft',  dx:-9, dy:0 },
    { id:'parity_edgeRight', dx:9,  dy:0 },
  ]);

  // ---- Wiring ----

  ['mx_room','mx_roomCategory','mx_occ','mx_mealPlan','mx_channel','mx_ratePlan','mx_marketSegment','mx_comparisonType'].forEach(id=>{
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
  { const { start, end } = mxPresetRange(mxPreset); applyRange(start, end, mxPreset); }

  // Re-sync the header/body column widths and the arrow positions on resize — both are computed
  // from live measurements, so a viewport-width change (which shifts the auto-layout stretch
  // math) needs to redo that math rather than leaving stale inline widths from the old size.
  let mxResizeRaf = null;
  window.addEventListener('resize', ()=>{
    cancelAnimationFrame(mxResizeRaf);
    mxResizeRaf = requestAnimationFrame(()=>{
      const gridHost = document.getElementById('mx_gridHost');
      syncHeaderColumnWidths(gridHost);
      alignEdgeZonesToHeader(document.querySelector('.mx-grid-card'), gridHost, 'mx_edgeLeft', 'mx_edgeRight');
      alignVerticalEdgeZones(document.querySelector('.mx-grid-card'), gridHost.querySelector('.grid-table-wrap'), 'mx_edgeUp', 'mx_edgeDown', 14);
    });
  });
});
