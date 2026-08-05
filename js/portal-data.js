/* ==========================================================================
   Property Owner Portal — mock Rate Shopper / Revenue Management data engine.
   Reuses DB (js/data.js) for real property/room/rate-plan data wherever it
   exists ("My Rate" baseline) and layers deterministic synthetic data on top
   for everything a rate-shopping SaaS needs that this project doesn't model
   yet (competitor pool, per-channel parity, demand forecast). Only the small
   identity records (competitors, notifications, settings) are persisted to
   localStorage — every derived number (a rate on a given date, a channel's
   variance, demand for a date) is computed on the fly from a seeded PRNG
   keyed by (entity, date, channel), so reloads stay stable without ever
   risking the localStorage bloat that hit DB.rates previously.
   ========================================================================== */
const PORTALDATA = (() => {

  const KEYS = {
    seeded: 'hop_portal_seeded_v1_',
    competitors: 'hop_portal_competitors_',
    notifications: 'hop_portal_notifications_',
    settings: 'hop_portal_settings_',
    realOverrides: 'hop_portal_real_overrides_' // per-user pin/favorite state for real comparison properties
  };

  const CHANNELS = [
    { key:'direct',     label:'Direct',       icon:'bi-house-door-fill', color:'#3861fb' },
    { key:'booking',    label:'Booking.com',  icon:'bi-globe2',          color:'#003580' },
    { key:'agoda',      label:'Agoda',        icon:'bi-globe2',          color:'#5392f9' },
    { key:'goibibo',    label:'Goibibo',      icon:'bi-globe2',          color:'#e0117a' },
    { key:'makemytrip', label:'MakeMyTrip',   icon:'bi-globe2',          color:'#d0021b' },
    { key:'yatra',      label:'Yatra',        icon:'bi-globe2',          color:'#f4831f' },
    { key:'expedia',    label:'Expedia',      icon:'bi-globe2',          color:'#fdb913' },
    { key:'hotelscom',  label:'Hotels.com',   icon:'bi-globe2',          color:'#d0006f' }
  ];

  const ROOM_TYPES = ['Deluxe Room','Executive Suite','Standard Twin','Premium King Room','Family Suite'];
  const MEAL_PLANS = ['EP','CP','MAP','AP'];
  const CANCEL_POLICIES = ['Free Cancellation','Non-Refundable','Partial Refund (50%)','Free until 24h prior'];
  const NAME_PREFIX = ['Grand','Royal','Ocean','Palm','Silver','Golden','Blue','Crown','Sunset','Emerald','Regal','Coastal','Urban','Heritage','Skyline','Lotus','Pearl','Amber','Ivory','Crimson','Marina','Summit','Orchid','Horizon','Zenith'];
  const NAME_SUFFIX = ['Palace','Resort','Hotel','Suites','Inn','Residency','Towers','Retreat','Plaza','Grand','Manor','Court'];
  const LOCAL_EVENTS = ['Music Festival','Trade Expo','Wedding Season Peak','Sports Tournament','Cultural Fair','Business Summit'];

  // ---- deterministic PRNG helpers (no storage needed for derived numbers) ----
  function hash(str){ let h=0; for(let i=0;i<str.length;i++){ h=(h*31+str.charCodeAt(i))|0; } return Math.abs(h); }
  function seededInt(seedStr, min, max){ return min + (hash(seedStr) % (max-min+1)); }
  function seededFloat(seedStr){ return (hash(seedStr) % 10000) / 10000; } // 0..0.9999

  function dateKeyOffset(offsetDays){
    const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate()+offsetDays);
    return DB.fmtDate(d);
  }
  function dayOfWeek(dateKey){ return new Date(dateKey+'T00:00:00').getDay(); } // 0=Sun..6=Sat
  function isWeekend(dateKey){ const d=dayOfWeek(dateKey); return d===5 || d===6; }
  // A small fixed holiday calendar (month-day) so "holiday pricing" is consistent every year.
  const HOLIDAYS = ['01-01','01-26','03-08','04-14','08-15','10-02','10-24','12-25'];
  function isHoliday(dateKey){ return HOLIDAYS.includes(dateKey.slice(5)); }

  function init(propertyId){
    if(DB.get(KEYS.seeded+propertyId, false)) return;
    generateCompetitors(propertyId);
    generateNotifications(propertyId);
    DB.set(KEYS.seeded+propertyId, true);
  }

  function generateCompetitors(propertyId){
    const property = DB.properties.get(propertyId) || {};
    const used = new Set();
    const list = [];
    for(let i=0;i<50;i++){
      let name;
      do { name = `${DB.pick(NAME_PREFIX)} ${DB.pick(NAME_SUFFIX)}`; } while(used.has(name));
      used.add(name);
      const stars = DB.rand(2,5);
      const baseRate = DB.rand(2200, 15000);
      list.push({
        id: DB.uid('pcomp'),
        name,
        city: property.city || 'Goa',
        country: property.country || 'India',
        distanceKm: (DB.rand(3,180)/10), // 0.3km .. 18.0km
        stars,
        image: `https://images.unsplash.com/photo-${DB.pick(['1566073771259-6a8506099945','1551882547-ff40c63fe5fa','1582719508461-905c673771fd','1520250497591-112f2f40a3f4','1571003123894-1f0594d2b5d9','1512453979798-5ea266f8880c','1445019980597-93fa8acb246c','1445019980597-93fa8acb246c'])}?w=600&q=60`,
        roomType: DB.pick(ROOM_TYPES),
        mealPlan: DB.pick(MEAL_PLANS),
        primaryChannel: DB.pick(CHANNELS).key,
        baseRate,
        cancellationPolicy: DB.pick(CANCEL_POLICIES),
        pinned: false,
        favorite: i < 4, // seed a few favorites so the UI isn't empty on first load
        amenities: ['Free WiFi','Swimming Pool','Spa','Restaurant','Parking','Gym','Airport Shuttle','24x7 Front Desk'].filter(()=>Math.random()>0.4),
        createdAt: DB.fmtDate(new Date())
      });
    }
    DB.set(KEYS.competitors+propertyId, list);
  }

  // Real properties the Company Admin selected as this Property Owner's benchmark set
  // (RBAC.comparisonPropertyIds() — the "Assigned Properties" picked at user creation, NOT an
  // access grant). These are computed fresh every call (not persisted) so they always reflect
  // the current selection, and use the real DB rate data via myRateOnDate() wherever it exists.
  function realOverrides(userId){ return DB.get(KEYS.realOverrides+userId, {}); }

  function comparisonRealProperties(){
    const me = RBAC.currentUser();
    if(!me || me.role !== RBAC.ROLES.PROPERTY_OWNER) return [];
    const overrides = realOverrides(me.id);
    const ids = RBAC.comparisonPropertyIds().filter(id=> id !== me.parentPropertyId);
    return ids.map(id=>{
      const p = DB.properties.get(id);
      if(!p) return null;
      const ov = overrides[id] || {};
      return {
        id: 'pcomp_real_'+p.id, realPropertyId: p.id, isReal: true,
        name: p.name, city: p.city, country: p.country,
        distanceKm: 0, stars: p.stars || 4, image: p.logo,
        roomType: 'Multiple Room Types', mealPlan: 'Varies', primaryChannel: 'direct',
        baseRate: myBaseRate(p.id), cancellationPolicy: 'Varies by Rate Plan',
        pinned: !!ov.pinned, favorite: !!ov.favorite,
        amenities: p.amenities || [], createdAt: p.createdAt
      };
    }).filter(Boolean);
  }

  function competitors(propertyId){
    return [...comparisonRealProperties(), ...DB.get(KEYS.competitors+propertyId, [])];
  }
  function competitor(propertyId, id){ return competitors(propertyId).find(c=>c.id===id); }
  function saveCompetitor(propertyId, comp){
    if(comp.isReal){
      const me = RBAC.currentUser();
      if(!me) return;
      const overrides = realOverrides(me.id);
      overrides[comp.realPropertyId] = { pinned: !!comp.pinned, favorite: !!comp.favorite };
      DB.set(KEYS.realOverrides+me.id, overrides);
      return;
    }
    const list = DB.get(KEYS.competitors+propertyId, []);
    const i = list.findIndex(c=>c.id===comp.id);
    if(i>-1) list[i]=comp;
    DB.set(KEYS.competitors+propertyId, list);
  }

  // ---- rate derivation --------------------------------------------------
  function trendFactor(seedBase, dateKey){
    // Slow drift across the year so charts show a believable up/down trend, not pure noise.
    const dayIdx = Math.round((new Date(dateKey+'T00:00:00') - new Date(dateKeyOffset(-180)+'T00:00:00')) / 86400000);
    const wave = Math.sin((dayIdx/365) * Math.PI * 2 + (hash(seedBase)%100)/100*Math.PI) * 0.06;
    return 1 + wave;
  }
  function premiumFactor(dateKey){
    let f = 1;
    if(isWeekend(dateKey)) f *= 1.14;
    if(isHoliday(dateKey)) f *= 1.28;
    return f;
  }

  function competitorRateOnDate(comp, dateKey){
    if(comp.isReal) return myRateOnDate(comp.realPropertyId, dateKey);
    const variance = 0.88 + seededFloat(comp.id+dateKey) * 0.30; // 0.88x .. 1.18x
    const rate = comp.baseRate * variance * premiumFactor(dateKey) * trendFactor(comp.id, dateKey);
    return Math.round(rate/10)*10;
  }

  function competitorTrend(comp, dateKey){
    const today = competitorRateOnDate(comp, dateKey);
    const yesterday = competitorRateOnDate(comp, dateKeyOffset(dayOffsetFromToday(dateKey)-1));
    if(today>yesterday) return 'up';
    if(today<yesterday) return 'down';
    return 'flat';
  }
  function dayOffsetFromToday(dateKey){
    return Math.round((new Date(dateKey+'T00:00:00') - new Date(dateKeyOffset(0)+'T00:00:00')) / 86400000);
  }

  // "My Rate" — reuse the real DB where it exists (Master channel's rate plans cover roughly
  // -7..+97 days per data.js seeding), otherwise derive from the property's average base price.
  function myBaseRate(propertyId){
    // Scoped to the Master (Direct) channel's own rooms only — same rule every sibling helper
    // here (myRateOnDate, mealPlanBaseRate) already follows. Averaging across every channel's
    // rooms (including OTA channels' separate synthetic room records, which can carry their own
    // base prices) would silently skew this fallback away from the property's actual Direct rate.
    const channels = DB.channels.byProperty(propertyId);
    const master = channels.find(c=>c.type==='master');
    const rooms = master ? DB.rooms.byChannel(master.id) : DB.rooms.byProperty(propertyId);
    if(!rooms.length) return 6000;
    return Math.round(rooms.reduce((s,r)=>s+r.basePrice,0)/rooms.length);
  }
  function myRateOnDate(propertyId, dateKey){
    const channels = DB.channels.byProperty(propertyId);
    const master = channels.find(c=>c.type==='master');
    if(master){
      // Average the base-occupancy price across every Master-channel room/rate plan that has
      // an actual price set for this date — so editing ANY room's rates in the Rate Calendar
      // (not just the first room) shows up here, everywhere "My Rate" is read from.
      const masterRooms = DB.rooms.byChannel(master.id);
      const prices = [];
      masterRooms.forEach(room=>{
        DB.ratePlans.byRoom(room.id).forEach(plan=>{
          const day = DB.rates.forPlan(plan.id)[dateKey];
          if(day) prices.push(day.price);
        });
      });
      if(prices.length) return Math.round(prices.reduce((a,b)=>a+b,0)/prices.length);
    }
    const base = myBaseRate(propertyId);
    const variance = 0.97 + seededFloat(propertyId+dateKey+'my') * 0.06;
    return Math.round(base * variance * premiumFactor(dateKey) / 10) * 10;
  }

  function channelVariance(channelKey, dateKey){
    // Stable per-channel markup/markdown vs. the direct rate (OTAs commonly run a few % off/above).
    const table = { direct:1, booking:1.03, agoda:0.98, goibibo:0.95, makemytrip:0.97, yatra:0.94, expedia:1.02, hotelscom:1.01 };
    const jitter = 0.98 + seededFloat(channelKey+dateKey) * 0.04;
    return (table[channelKey]||1) * jitter;
  }
  function channelRate(baseRate, channelKey, dateKey){
    return Math.round(baseRate * channelVariance(channelKey, dateKey) / 10) * 10;
  }

  // ---- meal-plan-scoped rate (EP/CP/MAP/AP) — used by the Rate Plan Trend Analysis panel to
  // compare "my EP rate vs. the market's EP rate" etc., independent of any single room/date
  // filter. Same deterministic seasonal/weekend math as myRateOnDate/competitorRateOnDate, just
  // averaged over whichever of a property's rooms actually offer that meal plan.
  // Returns null (not a silent all-rooms fallback) when a specific meal plan is requested and
  // NONE of the property's rooms actually offer it — a property/competitor that genuinely has no
  // EP rooms should show as "no data", not quietly substitute the all-rooms average, which used
  // to make picking a meal plan with no matching rooms look like the filter wasn't doing anything. ----
  function mealPlanBaseRate(propertyId, mealPlan){
    const channels = DB.channels.byProperty(propertyId);
    const master = channels.find(c=>c.type==='master');
    const rooms = master ? DB.rooms.byChannel(master.id) : DB.rooms.byProperty(propertyId);
    if(!mealPlan) return rooms.length ? Math.round(rooms.reduce((s,r)=>s+r.basePrice,0)/rooms.length) : myBaseRate(propertyId);
    const matched = rooms.filter(r=> DB.ratePlans.byRoom(r.id).some(p=>p.mealPlan===mealPlan));
    if(!matched.length) return null;
    return Math.round(matched.reduce((s,r)=>s+r.basePrice,0)/matched.length);
  }
  function mealPlanRateOnDate(propertyId, mealPlan, dateKey){
    const base = mealPlanBaseRate(propertyId, mealPlan);
    if(base==null) return null;
    const variance = 0.96 + seededFloat(propertyId+mealPlan+dateKey) * 0.08;
    return Math.round(base * variance * premiumFactor(dateKey) * trendFactor(propertyId+mealPlan, dateKey) / 10) * 10;
  }

  // ---- calendar signals used for rate intelligence (no occupancy/booking-volume data here —
  // this app only ever reasons about rates, never rooms sold/available) -----------------------
  function localEventOn(dateKey){
    return seededFloat(dateKey+'event') > 0.93 ? DB.pick(LOCAL_EVENTS) : null;
  }

  // ---- notifications (persisted so read/unread state sticks) -------------
  // Every alert type here is about pricing, competitor activity, channel parity, or data
  // quality — never hotel operations (bookings/check-ins live on the property, not the portal).
  function generateNotifications(propertyId){
    const templates = [
      {type:'competitorChange', icon:'bi-arrow-left-right', title:'Competitor price change', priority:'medium', message:'A tracked competitor changed their rate for upcoming dates.'},
      {type:'newLowest', icon:'bi-graph-down-arrow', title:'New lowest price', priority:'high', message:'A competitor is now the cheapest in your comparison set for this date range.'},
      {type:'parityMismatch', icon:'bi-bar-chart-line', title:'Rate parity mismatch', priority:'high', message:'Your OTA rate is undercutting your Direct rate on one or more channels.'},
      {type:'missingRate', icon:'bi-question-circle', title:'Missing competitor rate', priority:'low', message:'No rate could be found for a tracked competitor on one or more dates.'},
      {type:'largeIncrease', icon:'bi-arrow-up-circle', title:'Large price increase', priority:'medium', message:'A tracked competitor raised their rate sharply for upcoming dates.'},
      {type:'largeDecrease', icon:'bi-arrow-down-circle', title:'Large price decrease', priority:'high', message:'A tracked competitor dropped their rate sharply for upcoming dates.'},
      {type:'newMappedRoom', icon:'bi-door-open', title:'New mapped room', priority:'low', message:'A new room type was matched and mapped to one of your comparison properties.'}
    ];
    const list = Array.from({length:16}).map((_,i)=>{
      const t = DB.pick(templates);
      const hoursAgo = DB.rand(1,240);
      return {
        id: DB.uid('pntf'),
        type:t.type, icon:t.icon, priority:t.priority,
        title:t.title,
        message: t.message,
        read: i > 5,
        createdAt: new Date(Date.now()-hoursAgo*3600000).toISOString()
      };
    }).sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
    DB.set(KEYS.notifications+propertyId, list);
  }
  function notifications(propertyId){ return DB.get(KEYS.notifications+propertyId, []); }
  function markNotificationRead(propertyId, id){
    const list = notifications(propertyId);
    const n = list.find(x=>x.id===id);
    if(n) n.read = true;
    DB.set(KEYS.notifications+propertyId, list);
  }
  function markAllNotificationsRead(propertyId){
    const list = notifications(propertyId);
    list.forEach(n=>n.read=true);
    DB.set(KEYS.notifications+propertyId, list);
  }
  function unreadNotificationCount(propertyId){ return notifications(propertyId).filter(n=>!n.read).length; }
  // Used by Market Intelligence's Action Center to log an applied rate change into the same
  // alert feed the bell dropdown already reads — no separate audit/history store needed.
  function addNotification(propertyId, notif){
    const list = notifications(propertyId);
    list.unshift({ id: DB.uid('pntf'), read:false, createdAt: new Date().toISOString(), ...notif });
    DB.set(KEYS.notifications+propertyId, list);
  }

  // ---- settings ------------------------------------------------------------
  // Portal-only preferences (notifications, layout). Regional units (currency/timezone/date
  // format) are NOT stored here — they're owned by the Company Admin in DB.settings and
  // read directly from there, so every property always reflects the same company-wide units.
  function settings(propertyId){
    return DB.get(KEYS.settings+propertyId, {
      alertCompetitorChange:true, alertNewLowest:true, alertParityMismatch:true, alertMissingRate:false,
      alertLargeIncrease:true, alertLargeDecrease:true, alertNewMappedRoom:false,
      defaultRangeDays:14
    });
  }
  function saveSettings(propertyId, s){ DB.set(KEYS.settings+propertyId, s); }

  // ---- pricing recommendations (computed on the fly from today's comparison) — every reason
  // here is driven by rate/market signals only (competitor movement, weekend/holiday rate
  // patterns, local events), never occupancy or booking-pace/volume data. ---------------------
  function recommendations(propertyId){
    const comps = competitors(propertyId);
    const today = dateKeyOffset(0);
    const myRate = myRateOnDate(propertyId, today);
    const marketAvg = Math.round(comps.reduce((s,c)=>s+competitorRateOnDate(c,today),0)/comps.length);
    const items = [];

    const diffPct = ((marketAvg-myRate)/myRate)*100;
    if(diffPct > 6){
      items.push(mkRec('increase', Math.round((marketAvg-myRate)*0.6/10)*10, 'Competitor movement — market average is running above your rate', 82, propertyId, today));
    } else if(diffPct < -6){
      items.push(mkRec('decrease', Math.round((myRate-marketAvg)*0.5/10)*10, 'You are priced above the market — risk of losing share to competitors', 76, propertyId, today));
    } else {
      items.push(mkRec('hold', 0, 'Your rate is well aligned with the current market average', 90, propertyId, today));
    }

    if(isWeekend(dateKeyOffset(2))){
      items.push(mkRec('increase', DB.rand(150,400), 'Upcoming weekend — this market typically commands higher Fri/Sat rates', 71, propertyId, dateKeyOffset(2)));
    }
    const evt = localEventOn(dateKeyOffset(5));
    if(evt){
      items.push(mkRec('increase', DB.rand(300,700), `Local event detected: ${evt} — consider pricing ahead of the market`, 68, propertyId, dateKeyOffset(5)));
    }
    return items;
  }
  // Deterministic "last scraped" moment for a given property+date, so the stale-data badge
  // stays stable across re-renders in the same session instead of flickering on every reload.
  function lastScrapedAt(seed){
    const dayKey = dateKeyOffset(0);
    const minutesAgo = seededInt(seed+dayKey+'scraped', 4, 340); // ~4 min to ~5.5 hrs ago
    return new Date(Date.now() - minutesAgo*60000);
  }

  // Rate Parity Score — % of your own Direct-vs-OTA room/rate-plan pairs (given date) where the
  // OTA isn't undercutting your Direct rate. Single source of truth shared by the Dashboard KPI,
  // Market Insight Cards' parity alert, and Pricing Recommendations' "Fix Rate Parity" trigger —
  // previously each of those reimplemented this check independently and could disagree.
  function firstParityViolation(propertyId, dateKey){
    const channels = DB.channels.byProperty(propertyId);
    const master = channels.find(c=>c.type==='master');
    if(!master) return null;
    const otaChannels = channels.filter(c=>c.type!=='master');
    const masterRooms = DB.rooms.byChannel(master.id);
    let violation = null;
    masterRooms.forEach(room=>{
      if(violation) return;
      DB.ratePlans.byRoom(room.id).forEach(plan=>{
        if(violation) return;
        otaChannels.forEach(ch=>{
          if(violation) return;
          const dayData = DB.rates.forPlan(plan.id)[dateKey];
          const directPrice = dayData ? dayData.price : room.basePrice;
          const otaRoom = DB.rooms.byChannel(ch.id).find(r=>r.name===room.name);
          if(!otaRoom) return;
          const otaPlan = DB.ratePlans.byRoom(otaRoom.id).find(p=>p.mealPlan===plan.mealPlan);
          if(!otaPlan) return;
          const otaDay = DB.rates.forPlan(otaPlan.id)[dateKey];
          const otaPrice = otaDay ? otaDay.price : otaRoom.basePrice;
          if(otaPrice < directPrice*0.97) violation = { channel:ch, room, plan, directPrice, otaPrice };
        });
      });
    });
    return violation;
  }
  function parityScore(propertyId, dateKey){
    const channels = DB.channels.byProperty(propertyId);
    const master = channels.find(c=>c.type==='master');
    if(!master) return 100;
    const otaChannels = channels.filter(c=>c.type!=='master');
    const masterRooms = DB.rooms.byChannel(master.id);
    let total = 0, violations = 0;
    masterRooms.forEach(room=>{
      DB.ratePlans.byRoom(room.id).forEach(plan=>{
        const dayData = DB.rates.forPlan(plan.id)[dateKey];
        const directPrice = dayData ? dayData.price : room.basePrice;
        otaChannels.forEach(ch=>{
          const otaRoom = DB.rooms.byChannel(ch.id).find(r=>r.name===room.name);
          if(!otaRoom) return;
          const otaPlan = DB.ratePlans.byRoom(otaRoom.id).find(p=>p.mealPlan===plan.mealPlan);
          if(!otaPlan) return;
          total++;
          const otaDay = DB.rates.forPlan(otaPlan.id)[dateKey];
          const otaPrice = otaDay ? otaDay.price : otaRoom.basePrice;
          if(otaPrice < directPrice*0.97) violations++;
        });
      });
    });
    return total ? Math.round(100 - (violations/total*100)) : 100;
  }

  function mkRec(action, amount, reason, confidence, propertyId, dateKey){
    const current = myRateOnDate(propertyId, dateKey);
    const expected = action==='increase' ? current+amount : action==='decrease' ? current-amount : current;
    return {
      id: DB.uid('prec'), action, amount, reason, confidence, date: dateKey,
      currentRate: current, expectedRate: Math.max(500,expected),
      expectedADR: Math.max(500,expected)
    };
  }

  return {
    KEYS, CHANNELS, ROOM_TYPES, MEAL_PLANS, CANCEL_POLICIES, LOCAL_EVENTS,
    init, dateKeyOffset, dayOfWeek, isWeekend, isHoliday, dayOffsetFromToday,
    competitors, competitor, saveCompetitor, comparisonRealProperties,
    competitorRateOnDate, competitorTrend,
    myBaseRate, myRateOnDate, channelRate, channelVariance, mealPlanBaseRate, mealPlanRateOnDate,
    localEventOn,
    notifications, addNotification, markNotificationRead, markAllNotificationsRead, unreadNotificationCount,
    settings, saveSettings, recommendations, lastScrapedAt, parityScore, firstParityViolation
  };
})();
