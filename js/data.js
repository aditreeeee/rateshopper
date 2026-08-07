/* ==========================================================================
   Hotel Owner Panel — Data Layer (localStorage simulated backend)
   ========================================================================== */
const DB = (() => {
  const KEYS = {
    session:'hop_session', properties:'hop_properties', channels:'hop_channels', rooms:'hop_rooms',
    ratePlans:'hop_ratePlans', rates:'hop_rates', notifications:'hop_notifications',
    settings:'hop_settings', users:'hop_users',
    seeded:'hop_seeded_v29'
  };

  // Categories the Company Admin notification feed (hop_notifications) is grouped into — used
  // by Settings > Notifications (mute a category) and by notifications.html (filter by category).
  const NOTIF_CATEGORIES = { accounts:'Account Changes', access:'Access & Permissions', security:'Security Events' };

  // Sales channels a property distributes through. Every property always has exactly one
  // 'master' channel (its own direct inventory); OTA channels (Goibibo, MakeMyTrip, Booking.com,
  // Agoda, Yatra...) and free-form 'custom' channels are added on top for rate-shopping comparisons.
  const CHANNEL_TYPES = {
    master:     { label:'Master Channel', icon:'bi-house-door-fill', color:'#0041d9' },
    goibibo:    { label:'GoIBIBO MMT V3', icon:'bi-globe2',          color:'#e0117a' },
    makemytrip: { label:'MakeMyTrip',     icon:'bi-globe2',          color:'#d0021b' },
    booking:    { label:'Booking.com',    icon:'bi-globe2',          color:'#003580' },
    agoda:      { label:'Agoda',          icon:'bi-globe2',          color:'#5392f9' },
    yatra:      { label:'Yatra / Travel Guru', icon:'bi-globe2',     color:'#f4831f' },
    custom:     { label:'Customised',     icon:'bi-sliders',         color:'#00c2a8' }
  };
  const OTA_CHANNEL_TYPES = ['goibibo','makemytrip','booking','agoda','yatra'];

  // ---- Channel master catalog -------------------------------------------------------------
  // The fixed, numbered channel list every property-level Channel record maps onto via
  // `channelCode`. This mirrors the future SQL Server 2022 design 1:1 — a small lookup/dimension
  // table `Channels(ChannelCode INT PRIMARY KEY, ChannelName NVARCHAR(150) NOT NULL)` that a
  // property's own Channel rows (`PropertyChannels`, keyed by their own INT/GUID identity column,
  // today's `channels[].id`) reference via a plain `ChannelCode INT` foreign key. Keeping the
  // catalog code (INT, matches the real-world channel manager numbering) separate from each
  // property's own channel-instance id is what lets this migrate to .NET/EF Core + SQL Server
  // without any renumbering or type changes: ChannelCode stays INT end to end, ChannelName stays
  // NVARCHAR and is never user-edited (picked from this list only), so there's nothing to migrate
  // or reconcile when the backend goes live. Master/Direct isn't in this catalog (it isn't a
  // 3rd-party channel) and uses the reserved code below instead.
  const MASTER_CHANNEL_CODE = 1; // reserved — Direct/Master, not part of the OTA catalog
  const CHANNEL_CATALOG = [
    {code:1000, name:'Via.com'},
    {code:1001, name:'Yatra / Travel Guru'},
    {code:1002, name:'MakeMyTrip'},
    {code:1005, name:'Agoda'},
    {code:1007, name:'Booking.com'},
    {code:1011, name:'Expedia'},
    {code:1016, name:'Traveloka'},
    {code:1019, name:'Airbnb'},
    {code:1020, name:'EaseMyTrip'},
    {code:1021, name:'Trip.com (CTrip)'},
    {code:1024, name:'GoIBIBO MMT V3'},
    {code:1025, name:'HappyEasyGo'},
    {code:1030, name:'IRCTC'},
    {code:1031, name:'Hostelworld'},
    {code:1033, name:'HyperGuest'},
    {code:1034, name:'Hobse'},
    {code:1036, name:'Simplotel'},
    {code:1039, name:'ClearTrip 2023'},
    {code:1041, name:'Agoda - C1'},
    {code:1042, name:'Agoda - C2'},
    {code:1043, name:'Agoda - C3'},
    {code:1044, name:'Agoda - C4'},
    {code:1045, name:'Agoda - C5'},
    {code:1046, name:'Expedia - C1'},
    {code:1047, name:'Expedia - C2'},
    {code:1048, name:'Expedia - C3'},
    {code:1049, name:'Expedia - C4'},
    {code:1050, name:'Expedia - C5'},
    {code:1051, name:'GoIBIBO MMT V3 - C1'},
    {code:1052, name:'GoIBIBO MMT V3 - C2'},
    {code:1053, name:'GoIBIBO MMT V3 - C3'},
    {code:1054, name:'GoIBIBO MMT V3 - C4'},
    {code:1055, name:'GoIBIBO MMT V3 - C5'},
    {code:1056, name:'Booking.com - C1'},
    {code:1057, name:'Booking.com - C2'},
    {code:1058, name:'Booking.com - C3'},
    {code:1059, name:'Booking.com - C4'},
    {code:1060, name:'Booking.com - C5'},
    {code:1061, name:'Custom Channel 1'},
    {code:1062, name:'Custom Channel 2'},
    {code:1063, name:'Custom Channel 3'},
    {code:1064, name:'Custom Channel 4'},
    {code:1065, name:'Custom Channel 5'},
    {code:1066, name:'Custom Channel 6'},
    {code:1067, name:'Custom Channel 7'},
    {code:1068, name:'Custom Channel 8'},
    {code:1069, name:'Custom Channel 9'},
    {code:1070, name:'Custom Channel 10'},
    {code:1071, name:'Custom Channel 11'},
    {code:1072, name:'Custom Channel 12'},
    {code:1073, name:'Custom Channel 13'},
    {code:1074, name:'Custom Channel 14'},
    {code:1075, name:'Custom Channel 15'},
    {code:1076, name:'Custom Channel 16'},
    {code:1077, name:'Custom Channel 17'},
    {code:1078, name:'Custom Channel 18'},
    {code:1079, name:'Custom Channel 19'},
    {code:1083, name:'IXIGO'}
  ];
  // legacy internal `type` key -> catalog code, for the 5 OTAs this app already special-cases
  // (icon/color lookups elsewhere key off `type`, so these keep working unchanged).
  const CHANNEL_TYPE_CODES = { master:MASTER_CHANNEL_CODE, goibibo:1024, makemytrip:1002, booking:1007, agoda:1005, yatra:1001 };
  function channelCatalogEntry(code){ return CHANNEL_CATALOG.find(c=>c.code===code) || (code===MASTER_CHANNEL_CODE ? {code, name:CHANNEL_TYPES.master.label} : null); }
  // Next unused "Custom Channel N" catalog code for a property (falls back to the lowest unused
  // one if a property somehow burns through all 19 — still a valid INT, never crashes).
  function nextCustomChannelCode(propertyId){
    const used = new Set(channels.all().filter(c=>c.propertyId===propertyId).map(c=>c.channelCode));
    const pool = CHANNEL_CATALOG.filter(c=>c.code>=1061 && c.code<=1079);
    const free = pool.find(c=>!used.has(c.code));
    return (free || pool[0]).code;
  }

  const CITIES = [
    {name:'Grand Horizon Resort', city:'Goa', state:'Goa', country:'India', addr:'Candolim Beach Road, Goa 403515', img:'https://images.unsplash.com/photo-1566073771259-6a8506099945?w=800&q=60'},
    {name:'Metropolitan Business Hotel', city:'Mumbai', state:'Maharashtra', country:'India', addr:'Bandra Kurla Complex, Mumbai 400051', img:'https://images.unsplash.com/photo-1551882547-ff40c63fe5fa?w=800&q=60'},
    {name:'The Heritage Palace', city:'Jaipur', state:'Rajasthan', country:'India', addr:'MI Road, Jaipur 302001', img:'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=60'},
    {name:'Emerald Hills Retreat', city:'Manali', state:'Himachal Pradesh', country:'India', addr:'Old Manali, Himachal Pradesh 175131', img:'https://images.unsplash.com/photo-1520250497591-112f2f40a3f4?w=800&q=60'},
    {name:'Sunset Bay Boutique Inn', city:'Kochi', state:'Kerala', country:'India', addr:'Marine Drive, Kochi 682031', img:'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=800&q=60'},
    {name:'Skyline Downtown Suites', city:'Dubai', state:'Dubai', country:'UAE', addr:'Sheikh Zayed Road, Dubai', img:'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=800&q=60'},
    {name:'Maple Leaf Lodge', city:'Toronto', state:'Ontario', country:'Canada', addr:'Queen Street West, Toronto, ON', img:'https://images.unsplash.com/photo-1445019980597-93fa8acb246c?w=800&q=60'}
  ];

  // Brand affiliation pool — independent hotels vs. chain-managed properties, used by the
  // Property Finder's Brand filter/search (mirrors a future `Brands` lookup table in SQL Server).
  const PROPERTY_BRANDS = ['Independent','Horizon Collection','Metro Stays','Heritage Group','Emerald Hospitality','SunBay Hotels'];

  const ROOM_TYPES = [
    {name:'Deluxe Room', bed:'King Bed', cap:2, category:'Deluxe', img:'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=700&q=60'},
    {name:'Executive Suite', bed:'King Bed', cap:3, category:'Suite', img:'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=700&q=60'},
    {name:'Standard Twin', bed:'Twin Beds', cap:2, category:'Standard', img:'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=700&q=60'},
    {name:'Family Room', bed:'Queen + Bunk', cap:4, category:'Family', img:'https://images.unsplash.com/photo-1595576508898-0ad5c879a061?w=700&q=60'},
    {name:'Presidential Suite', bed:'King Bed', cap:4, category:'Suite', img:'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=700&q=60'},
    {name:'Superior Room', bed:'Queen Bed', cap:2, category:'Deluxe', img:'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=700&q=60'},
    {name:'Junior Suite', bed:'King Bed', cap:3, category:'Suite', img:'https://images.unsplash.com/photo-1591088398332-8a7791972843?w=700&q=60'},
    {name:'Cozy Single', bed:'Single Bed', cap:1, category:'Standard', img:'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?w=700&q=60'}
  ];

  const MEAL_PLANS = ['EP','CP','MAP','AP'];
  const MEAL_LABELS = {EP:'European Plan (Room Only)',CP:'Continental Plan (Room + Breakfast)',MAP:'Modified American Plan (Breakfast + 1 Meal)',AP:'American Plan (All Meals)'};

  function uid(prefix){ return prefix + '_' + Math.random().toString(36).slice(2,9); }

  // In-memory cache over localStorage reads. Some keys (hop_rates especially) hold a multi-MB
  // blob covering every property/channel/room/rate-plan/date — CRUD helpers like
  // DB.rates.forPlan() call get() on that key dozens of times per page (once per date, per
  // room, per channel), and JSON.parse-ing megabytes of text that often is what made
  // Dashboard/Market Intelligence/Channel Analysis slow to open. Every write goes through
  // set(), which keeps this cache in sync, so it's always as fresh as localStorage itself.
  const _cache = {};
  function get(key, fallback){
    if(!(key in _cache)){
      try{ _cache[key] = JSON.parse(localStorage.getItem(key)); }
      catch(e){ _cache[key] = undefined; }
    }
    const v = _cache[key];
    return (v===null||v===undefined) ? fallback : v;
  }
  function set(key, val){ localStorage.setItem(key, JSON.stringify(val)); _cache[key] = val; }

  function rand(min,max){ return Math.floor(Math.random()*(max-min+1))+min; }
  function pick(arr){ return arr[Math.floor(Math.random()*arr.length)]; }
  function shuffle(arr){ const a=[...arr]; for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
  // Local calendar day (not toISOString's UTC day) — a UTC-based key silently shifts by one
  // day for any user whose timezone offset is non-zero relative to UTC (e.g. local midnight in
  // IST is still "yesterday" in UTC), which desyncs date keys from what's actually on screen.
  function fmtDate(d){
    const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  // Builds a {1: price, 2: price, ...} map up to maxOcc guests. Occupancy at/under the
  // rate plan's base occupancy costs the same as the base price; each guest above it adds extraAdultPrice.
  function buildOccPrices(basePrice, baseOccupancy, extraAdultPrice, maxOcc){
    const occPrices = {};
    for(let occ=1; occ<=Math.max(maxOcc,1); occ++){
      const extraGuests = Math.max(0, occ - baseOccupancy);
      occPrices[occ] = basePrice + extraGuests*extraAdultPrice;
    }
    return occPrices;
  }

  function seed(){
    if(get(KEYS.seeded,false)) return;

    // Mark seeded immediately — before generating anything. If a later step throws (e.g. a
    // localStorage quota error on a large dataset), we must NOT let seed() re-run on the next
    // page load: that would mint brand-new random ids for every record, silently invalidating
    // any session/user id already handed out and causing an endless "log in, land on the next
    // page, can't find that user, get bounced back to login" loop.
    set(KEYS.seeded, true);

    // A real reseed means every record gets brand-new ids. Any session already sitting in
    // storage points at a user id from the previous dataset — clear it so login doesn't
    // bounce (log in, land on a page that can't find that user, get redirected right back out).
    localStorage.removeItem(KEYS.session);
    sessionStorage.removeItem(KEYS.session);

    try {

    // Properties
    const properties = CITIES.map((c,i)=>({
      id: uid('prop'),
      // hmsPropertyId — the identifier this property is registered under in eGlobe Solutions'
      // own HMS. Kept deliberately distinct from `id` (this app's own internal record id, never
      // shown to a user): hmsPropertyId is the one an admin types in (or edits) to match
      // whatever id the property already has on the HMS side, so the two systems can be linked
      // up. Must stay unique across every property — see properties.isHmsIdTaken() below.
      hmsPropertyId: 'EGS-P-' + String(100000+i),
      name: c.name,
      type: pick(['Resort','Business Hotel','Heritage Hotel','Boutique Hotel']),
      city: c.city,
      state: c.state || '',
      country: c.country,
      brand: pick(PROPERTY_BRANDS),
      code: 'PRC-' + String(1000+i),
      address: c.addr,
      phone: '+91 98' + rand(10000000,99999999),
      email: c.name.toLowerCase().replace(/[^a-z]+/g,'.') + '@hotelmail.com',
      website: 'www.' + c.name.toLowerCase().replace(/[^a-z]+/g,'') + '.com',
      status: i===3 ? 'inactive' : 'active',
      logo: c.img,
      stars: rand(3,5),
      rooms: rand(40,180),
      description: `${c.name} is a premium property located in the heart of ${c.city}, offering world-class hospitality, curated amenities, and unforgettable guest experiences.`,
      amenities: ['Free WiFi','Swimming Pool','Spa','Restaurant','Parking','Gym','Airport Shuttle','24x7 Front Desk'].filter(()=>Math.random()>0.25),
      createdAt: fmtDate(new Date(Date.now()-rand(30,600)*86400000))
    }));
    set(KEYS.properties, properties);

    // Channels — every property gets a Master Channel (its own direct inventory) plus every
    // OTA channel type seeded in, for a rich rate-shopping demo with real cross-channel data.
    let channels = [];
    properties.forEach(p=>{
      channels.push({ id: uid('chan'), propertyId: p.id, channelCode: MASTER_CHANNEL_CODE, name: CHANNEL_TYPES.master.label, type:'master', status:'active', createdAt: p.createdAt });
      OTA_CHANNEL_TYPES.forEach(type=>{
        channels.push({ id: uid('chan'), propertyId: p.id, channelCode: CHANNEL_TYPE_CODES[type], name: CHANNEL_TYPES[type].label, type, status: Math.random()>0.1?'active':'inactive', createdAt: p.createdAt });
      });
    });
    set(KEYS.channels, channels);
    const masterChannelByProperty = {};
    channels.filter(c=>c.type==='master').forEach(c=> masterChannelByProperty[c.propertyId]=c.id);

    // Users — mock RBAC accounts. Passwords are plaintext here only because this is a
    // frontend-only demo; a real backend would never store or compare passwords this way
    // (ASP.NET Identity + password hashing, issuing a JWT on successful login).
    // Pre-generated so seeded Property Admins below can reference their creating owner's id.
    const kavitaId = uid('usr'), vikramId = uid('usr'), adityaId = uid('usr');
    // Backfill ownerId on each seeded property so RBAC.assignedPropertyIds() (which now derives
    // a Property Owner's scope from properties they "own") matches the seeded assignments below.
    [[kavitaId,[0,1]],[vikramId,[2,3,4]],[adityaId,[5,6]]].forEach(([ownerId,idxs])=>{
      idxs.forEach(i=>{ if(properties[i]) properties[i].ownerId = ownerId; });
    });
    set(KEYS.properties, properties);
    const users = [
      {
        id: uid('usr'), hmsUserId:'EGS-U-200001', name:'Arjun Mehta', email:'admin@eglobe.com', password:'Admin@123',
        role:'company_admin', status:'active', assignedProperties:[], permissions:null,
        phone:'+91 9820033445', bio:'Company Admin — full platform oversight across every property.',
        avatar:'https://ui-avatars.com/api/?name=Arjun+Mehta&background=00c2a8&color=fff&size=200',
        createdAt: fmtDate(new Date(Date.now()-360*86400000))
      },
      {
        id: kavitaId, hmsUserId:'EGS-U-200002', name:'Kavita Nair', firstName:'Kavita', lastName:'Nair', email:'property.owner@eglobe.com', password:'Property@123',
        role:'property_owner', status:'active', parentPropertyId: properties[0].id,
        assignedProperties:[properties[1].id, properties[2].id, properties[3].id, properties[4].id, properties[5].id], permissions:null,
        phone:'+91 9820055667', bio:'Property Owner — manages her assigned properties end-to-end.',
        avatar:'https://ui-avatars.com/api/?name=Kavita+Nair&background=b9791a&color=fff&size=200',
        createdAt: fmtDate(new Date(Date.now()-240*86400000))
      },
      {
        id: vikramId, hmsUserId:'EGS-U-200003', name:'Vikram Rao', firstName:'Vikram', lastName:'Rao', email:'vikram.rao@eglobe.com', password:'Property@123',
        role:'property_owner', status:'active', parentPropertyId: properties[2].id,
        assignedProperties:[properties[3].id, properties[4].id], permissions:null,
        phone:'+91 9820099001', bio:'Property Owner — manages a portfolio of heritage and boutique properties.',
        avatar:'https://ui-avatars.com/api/?name=Vikram+Rao&background=8c5cf7&color=fff&size=200',
        createdAt: fmtDate(new Date(Date.now()-200*86400000))
      },
      {
        id: adityaId, hmsUserId:'EGS-U-200004', name:'Aditya Verma', firstName:'Aditya', lastName:'Verma', email:'aditya.verma@eglobe.com', password:'Property@123',
        role:'property_owner', status:'active', parentPropertyId: properties[5].id,
        assignedProperties:[properties[5].id, properties[6].id], permissions:null,
        phone:'+91 9820099445', bio:'Property Owner — manages the international portfolio (Dubai, Toronto).',
        avatar:'https://ui-avatars.com/api/?name=Aditya+Verma&background=d0021b&color=fff&size=200',
        createdAt: fmtDate(new Date(Date.now()-170*86400000))
      }
    ];
    set(KEYS.users, users);

    // Rooms — every channel (Master + each OTA) gets its own listed rooms, so there's real
    // data to rate-shop/compare across channels, not just on the Master Channel. OTA channels
    // reuse a subset of the Master Channel's own room-type list (rather than an independent
    // random pick) so room *names* actually overlap across channels for the same property —
    // otherwise rate-parity/channel-comparison features have nothing matching to compare.
    let rooms = [];
    let masterRoomTypesForProperty = ROOM_TYPES;
    channels.forEach(chan=>{
      if(chan.type==='master'){
        const n = rand(3,5);
        masterRoomTypesForProperty = [...ROOM_TYPES].sort(()=>Math.random()-0.5).slice(0,n);
      }
      const shuffled = chan.type==='master'
        ? masterRoomTypesForProperty
        : shuffle(masterRoomTypesForProperty).slice(0, Math.min(masterRoomTypesForProperty.length, rand(2,3)));
      // OTA channels tend to price a touch above/below direct — small per-channel variance
      const channelPriceBias = chan.type==='master' ? 1 : (0.92 + Math.random()*0.16);
      shuffled.forEach(rt=>{
        const roomMealPlans = MEAL_PLANS.filter(()=>Math.random()>0.35);
        rooms.push({
          id: uid('room'),
          propertyId: chan.propertyId,
          channelId: chan.id,
          name: rt.name,
          category: rt.category,
          bedType: rt.bed,
          capacity: rt.cap,
          maxOccupancy: rt.cap + rand(0,1),
          totalRooms: rand(5,30),
          size: rand(22,65),
          basePrice: Math.round(rand(2500,12000)*channelPriceBias/10)*10,
          status: Math.random()>0.1?'active':'inactive',
          img: rt.img,
          amenities: ['AC','TV','Mini Bar','Balcony','Room Service','Safe'].filter(()=>Math.random()>0.3),
          mealPlans: roomMealPlans.length ? roomMealPlans : [MEAL_PLANS[0]]
        });
      });
    });
    set(KEYS.rooms, rooms);

    // Rate Plans
    let ratePlans = [];
    rooms.forEach(r=>{
      const n = rand(1,2);
      for(let i=0;i<n;i++){
        const meal = pick(MEAL_PLANS);
        const refundable = Math.random()>0.4;
        ratePlans.push({
          id: uid('rp'),
          propertyId: r.propertyId,
          channelId: r.channelId,
          roomId: r.id,
          name: `${r.name} - ${meal} ${refundable?'Flexible':'Non-Refundable'}`,
          mealPlan: meal,
          refundable,
          minStay: pick([1,1,1,2,3]),
          maxStay: pick([7,14,30]),
          cancellationPolicy: refundable ? 'Free cancellation up to 24 hours before check-in' : 'Non-refundable. No changes or cancellations allowed.',
          baseOccupancy: r.capacity,
          extraAdultPrice: rand(500,1500),
          extraChildPrice: rand(250,800),
          status: Math.random()>0.1?'active':'inactive',
          createdAt: fmtDate(new Date(Date.now()-rand(10,300)*86400000))
        });
      }
    });
    set(KEYS.ratePlans, ratePlans);

    // Rates (1 year of pricing per rate plan) — store sparsely by date for perf: generate for each ratePlan a base + variance
    // Each day carries occPrices: a price per occupancy level (1..room.maxOccupancy) so the
    // rate grid can show "1 Pax / 2 Pax / 3 Pax..." rows with their own editable price per rate plan.
    let rates = {}; // rates[ratePlanId][date] = {price, occPrices:{1:.., 2:..}}
    const today = new Date();
    ratePlans.forEach(rp=>{
      const room = rooms.find(r=>r.id===rp.roomId);
      const base = room ? room.basePrice : 5000;
      const maxOcc = room ? room.maxOccupancy : 2;
      rates[rp.id] = {};
      for(let d=-7; d<97; d++){
        const date = new Date(today); date.setDate(today.getDate()+d);
        const key = fmtDate(date);
        const isWeekend = [0,6].includes(date.getDay());
        let price = Math.round((base + (isWeekend?base*0.25:0) + rand(-300,400))/10)*10;
        rates[rp.id][key] = {
          price,
          occPrices: buildOccPrices(price, rp.baseOccupancy, rp.extraAdultPrice, maxOcc)
        };
      }
    });
    set(KEYS.rates, rates);

    // Notifications — Company Admin's notification feed is about accounts and access, not
    // hotel operations (bookings/reviews/check-ins live inside each property, not here).
    // `category` groups these into the three buckets Settings > Notifications lets you mute
    // (accounts/access/security — see NOTIF_CATEGORIES below) and that notifications.html filters by.
    const ROLE_LABELS_FOR_SEED = { company_admin:'Company Admin', property_owner:'Property Owner' };
    const notifActions = [
      u=>({icon:'bi-person-plus',color:'success',category:'accounts',title:'New User Created',msg:`${u.name} was added as ${ROLE_LABELS_FOR_SEED[u.role]||u.role}.`}),
      u=>({icon:'bi-shield-lock',color:'brand',category:'access',title:'Role Assigned',msg:`${u.name} was granted ${ROLE_LABELS_FOR_SEED[u.role]||u.role} access.`}),
      u=>({icon:'bi-toggle-off',color: u.status==='active'?'success':'danger',category:'accounts',title: u.status==='active'?'User Activated':'User Deactivated',msg:`${u.name}'s account was marked ${u.status}.`}),
      u=>({icon:'bi-key',color:'warn',category:'security',title:'Password Reset Requested',msg:`${u.name} requested a password reset.`}),
      u=>({icon:'bi-pencil-square',color:'brand',category:'access',title:'Permissions Updated',msg:`Module permissions were updated for ${u.name}.`}),
      u=>({icon:'bi-box-arrow-in-right',color:'success',category:'security',title:'New Sign-In',msg:`${u.name} signed in from a new device.`})
    ];
    const notifCombos = shuffle(users.flatMap(u=> notifActions.map(fn=>fn(u))));
    let notifications = notifCombos.slice(0,28).map((t,i)=>({id:uid('ntf'), ...t, read: i>8, time: fmtDate(new Date(Date.now()-rand(0,10)*86400000)) }));
    set(KEYS.notifications, notifications);

    // Settings
    set(KEYS.settings, {
      companyName:'eGlobe Solutions', companyEmail:'owner@example.com', companyPhone:'+91 9876543210',
      companyAddress:'315, Ansal Classic Tower, J Nlock, Rajouri Garden, New Delhi',
      currency:'INR', currencySymbol:'₹', taxRate:12, serviceCharge:5,
      timezone:'Asia/Kolkata (GMT+5:30)', dateFormat:'DD/MM/YYYY',
      mutedNotifCategories:[],
      theme:'light'
    });

    } catch(err){
      console.error('DB.seed(): demo data generation failed partway through — the app will run with whatever was saved before this point.', err);
    }
  }

  // ---- CRUD helpers ----
  const properties = {
    all: ()=> get(KEYS.properties, []),
    get: id=> properties.all().find(p=>p.id===id),
    save: p=>{
      const list=properties.all();
      if(p.id){
        // Merge, don't replace — an edit form only ever sends the fields it actually has inputs
        // for (e.g. add-property.js has no Brand/State/Property Code inputs). A plain
        // `list[i]=p` replace silently wiped every field the form didn't know about on each
        // save, so those fields never carried forward to the rest of the app after a first edit.
        const i=list.findIndex(x=>x.id===p.id);
        if(i>-1){ list[i] = {...list[i], ...p}; p = list[i]; }
        else { p.createdAt=p.createdAt||fmtDate(new Date()); list.push(p); }
      } else { p.id=uid('prop'); p.createdAt=fmtDate(new Date()); list.push(p); }
      set(KEYS.properties,list); return p;
    },
    remove: id=>{
      set(KEYS.properties, properties.all().filter(p=>p.id!==id));
      rooms.all().filter(r=>r.propertyId===id).forEach(r=>rooms.remove(r.id));
      set(KEYS.channels, channels.all().filter(c=>c.propertyId!==id));
    },
    // True if some OTHER property already uses this Property ID — checked case-insensitively
    // (and trimmed) since eGlobe's HMS and this app's own edit form are two separate places the
    // same value can be typed, and a stray space/case mismatch shouldn't be treated as "unique".
    isHmsIdTaken: (hmsPropertyId, excludeId)=>{
      const norm = String(hmsPropertyId||'').trim().toLowerCase();
      return properties.all().some(p=> p.id!==excludeId && String(p.hmsPropertyId||'').trim().toLowerCase()===norm);
    }
  };
  const channels = {
    all: ()=> get(KEYS.channels, []),
    byProperty: pid=> channels.all().filter(c=>c.propertyId===pid),
    get: id=> channels.all().find(c=>c.id===id),
    save: c=>{
      const list = channels.all();
      if(c.id){
        const i=list.findIndex(x=>x.id===c.id);
        if(i>-1) list[i]=c; else { c.createdAt = c.createdAt || fmtDate(new Date()); list.push(c); }
      } else {
        // Data-layer safety net — one connection per master channel per property. Mirrors a
        // future UNIQUE(PropertyId, ChannelCode) constraint: if a channel with this exact
        // propertyId+channelCode already exists, update that record instead of creating a
        // duplicate, no matter which caller forgot to check first.
        const dupe = list.find(x=>x.propertyId===c.propertyId && x.channelCode===c.channelCode);
        if(dupe){
          c.id = dupe.id; c.createdAt = dupe.createdAt;
          const i = list.findIndex(x=>x.id===dupe.id); list[i]=c;
        } else {
          c.id = uid('chan'); c.createdAt = fmtDate(new Date()); list.push(c);
        }
      }
      set(KEYS.channels,list); return c;
    },
    // The Master Channel represents the property's own direct inventory and can't be removed —
    // deleting a property is the only way to remove it (cascades via properties.remove above).
    remove: id=>{
      const c = channels.get(id);
      if(!c || c.type==='master') return false;
      set(KEYS.channels, channels.all().filter(x=>x.id!==id));
      rooms.all().filter(r=>r.channelId===id).forEach(r=>rooms.remove(r.id));
      return true;
    }
  };
  const rooms = {
    all: ()=> get(KEYS.rooms, []),
    byProperty: pid=> rooms.all().filter(r=>r.propertyId===pid),
    byChannel: chanId=> rooms.all().filter(r=>r.channelId===chanId),
    get: id=> rooms.all().find(r=>r.id===id),
    save: r=>{ const list=rooms.all(); if(r.id){ const i=list.findIndex(x=>x.id===r.id); list[i]=r; } else { r.id=uid('room');
        // New rooms go to the end of their channel's manual ordering (see sortOrder, used by
        // the Rooms list's Move Up/Down controls) — mirrors how ratePlans.save() assigns sortOrder.
        if(r.sortOrder==null){ const siblings = list.filter(x=>x.channelId===r.channelId); r.sortOrder = siblings.length ? Math.max(...siblings.map(x=>x.sortOrder||0))+1 : 0; }
        list.push(r);
      } set(KEYS.rooms,list); return r; },
    remove: id=>{ set(KEYS.rooms, rooms.all().filter(r=>r.id!==id)); ratePlans.all().filter(rp=>rp.roomId===id).forEach(rp=>ratePlans.remove(rp.id)); }
  };
  const ratePlans = {
    all: ()=> get(KEYS.ratePlans, []),
    byRoom: rid=> ratePlans.all().filter(r=>r.roomId===rid),
    byProperty: pid=> ratePlans.all().filter(r=>r.propertyId===pid),
    byChannel: chanId=> ratePlans.all().filter(r=>r.channelId===chanId),
    get: id=> ratePlans.all().find(r=>r.id===id),
    save: rp=>{ const list=ratePlans.all(); if(rp.id){ const i=list.findIndex(x=>x.id===rp.id); list[i]=rp; } else { rp.id=uid('rp'); rp.createdAt=fmtDate(new Date());
        // New rate plans go to the end of their room's manual ordering (see sortOrder, used by
        // the Rate Plans list's Move Up/Down controls) rather than sharing a sortOrder with
        // whatever else already exists — sortOrder is only ever meant to be unique per room.
        if(rp.sortOrder==null){ const siblings = list.filter(x=>x.roomId===rp.roomId); rp.sortOrder = siblings.length ? Math.max(...siblings.map(x=>x.sortOrder||0))+1 : 0; }
        list.push(rp);
        const rates = get(KEYS.rates,{}); if(!rates[rp.id]){ rates[rp.id]={}; const room=rooms.get(rp.roomId); const base= room?room.basePrice:5000; const maxOcc= room?room.maxOccupancy:2;
          const today=new Date(); for(let d=-7; d<97; d++){ const date=new Date(today); date.setDate(today.getDate()+d); rates[rp.id][fmtDate(date)]={price:base,occPrices:buildOccPrices(base, rp.baseOccupancy||2, rp.extraAdultPrice||0, maxOcc)}; } set(KEYS.rates,rates); }
      } set(KEYS.ratePlans,list); return rp; },
    remove: id=>{ set(KEYS.ratePlans, ratePlans.all().filter(r=>r.id!==id)); const rates=get(KEYS.rates,{}); delete rates[id]; set(KEYS.rates,rates); }
  };
  const rates = {
    all: ()=> get(KEYS.rates, {}),
    forPlan: rpId=> (get(KEYS.rates,{})[rpId]) || {},
    setDay: (rpId, dateKey, data)=>{ const all=get(KEYS.rates,{}); if(!all[rpId]) all[rpId]={}; all[rpId][dateKey] = {...(all[rpId][dateKey]||{}), ...data}; set(KEYS.rates, all); },
    saveAll: (rpId, obj)=>{ const all=get(KEYS.rates,{}); all[rpId]=obj; set(KEYS.rates, all); },
    // Sets one fixed price for every date in [startKey, endKey] inclusive — a quick "pricing
    // range" action for a single rate plan (pick a date range, apply one price), same idea as
    // the Rate Calendar's Bulk Update but scoped to one plan and reachable from the Rate Plans
    // list directly instead of needing to open the calendar first.
    setRange: (rpId, startKey, endKey, price, baseOccupancy, extraAdultPrice, maxOcc)=>{
      const all = get(KEYS.rates,{});
      if(!all[rpId]) all[rpId] = {};
      let d = new Date(startKey+'T00:00:00');
      const end = new Date(endKey+'T00:00:00');
      while(d <= end){
        all[rpId][fmtDate(d)] = { price, occPrices: buildOccPrices(price, baseOccupancy, extraAdultPrice, maxOcc) };
        d.setDate(d.getDate()+1);
      }
      set(KEYS.rates, all);
    }
  };
  // Categories the Company Admin's notification feed is grouped into — see NOTIF_CATEGORIES
  // export below. Settings > Notifications lets an admin mute a whole category; muted categories
  // are hidden from both the bell badge count and the notifications.html feed itself (a "mute"
  // that still surfaced items elsewhere would just be confusing).
  const notifications = {
    all: ()=> get(KEYS.notifications, []),
    visible: ()=>{
      const muted = new Set(settings.get().mutedNotifCategories || []);
      return notifications.all().filter(n=> !n.category || !muted.has(n.category));
    },
    unreadCount: ()=> notifications.visible().filter(n=>!n.read).length,
    markRead: id=>{ const list=notifications.all(); const n=list.find(x=>x.id===id); if(n) n.read=true; set(KEYS.notifications,list); },
    markAllRead: ()=>{ const list=notifications.all(); list.forEach(n=>n.read=true); set(KEYS.notifications,list); },
    remove: id=>{ set(KEYS.notifications, notifications.all().filter(n=>n.id!==id)); }
  };
  const settings = { get: ()=> get(KEYS.settings, {}), save: s=> set(KEYS.settings, s) };

  // Plain CRUD only — the same shape a future ASP.NET "UsersController" + SQL Server
  // "Users" table would expose. Role hierarchy rules (who can create/edit/delete whom)
  // live in js/rbac.js, not here, so this layer stays a dumb data store either way.
  const users = {
    all: ()=> get(KEYS.users, []),
    get: id=> users.all().find(u=>u.id===id),
    byEmail: email=> users.all().find(u=> u.email.toLowerCase()===String(email).toLowerCase()),
    byProperty: propertyId=> users.all().filter(u=> (u.assignedProperties||[]).includes(propertyId)),
    save: u=>{
      const list = users.all();
      if(u.id){ const i=list.findIndex(x=>x.id===u.id); list[i]=u; }
      else { u.id=uid('usr'); u.createdAt=fmtDate(new Date()); list.push(u); }
      set(KEYS.users,list); return u;
    },
    remove: id=>{ set(KEYS.users, users.all().filter(u=>u.id!==id)); },
    // Same case/whitespace-insensitive uniqueness check as properties.isHmsIdTaken(), for the
    // User ID an admin enters on the Add/Edit User form.
    isHmsIdTaken: (hmsUserId, excludeId)=>{
      const norm = String(hmsUserId||'').trim().toLowerCase();
      return users.all().some(u=> u.id!==excludeId && String(u.hmsUserId||'').trim().toLowerCase()===norm);
    }
  };

  // Defensive migration, safe to run on every load regardless of seeding history: guarantees
  // every property has a Master Channel, and backfills any room/rate plan that predates the
  // Channels feature (or was otherwise saved without one) onto that property's Master Channel.
  function ensureChannels(){
    const allProperties = properties.all();
    const allChannels = channels.all();
    let channelsChanged = false;
    const masterByProperty = {};

    allProperties.forEach(p=>{
      let master = allChannels.find(c=>c.propertyId===p.id && c.type==='master');
      if(!master){
        master = { id: uid('chan'), propertyId: p.id, channelCode: MASTER_CHANNEL_CODE, name: CHANNEL_TYPES.master.label, type:'master', status:'active', createdAt: p.createdAt || fmtDate(new Date()) };
        allChannels.push(master);
        channelsChanged = true;
      }
      masterByProperty[p.id] = master.id;
    });
    // Backfill Brand/Property Code/State on any property saved before the Property Finder
    // existed, so search/filter never chokes on undefined fields.
    let propertiesFieldsChanged = false;
    allProperties.forEach((p,i)=>{
      if(p.brand == null){ p.brand = pick(PROPERTY_BRANDS); propertiesFieldsChanged = true; }
      if(p.code == null){ p.code = 'PRC-' + String(1000+i); propertiesFieldsChanged = true; }
      if(p.state == null){ p.state = ''; propertiesFieldsChanged = true; }
      // Backfill hmsPropertyId on any property saved before this field existed — derived from
      // the property's own id (never collides with another record, no need to re-check
      // uniqueness) rather than reusing the seed's sequential EGS-P-100000+i scheme, which is
      // only guaranteed unique across a single fresh seed().
      if(p.hmsPropertyId == null){ p.hmsPropertyId = 'EGS-P-LEGACY-' + p.id.slice(-6).toUpperCase(); propertiesFieldsChanged = true; }
    });
    if(propertiesFieldsChanged) set(KEYS.properties, allProperties);

    // Same backfill for users' hmsUserId.
    const allUsers = users.all();
    let usersFieldsChanged = false;
    allUsers.forEach(u=>{
      if(u.hmsUserId == null){ u.hmsUserId = 'EGS-U-LEGACY-' + u.id.slice(-6).toUpperCase(); usersFieldsChanged = true; }
    });
    if(usersFieldsChanged) set(KEYS.users, allUsers);
    // Backfill channelCode on any channel saved before this field existed, so every record
    // stays SQL-ready (NOT NULL INT) without needing a one-time server-side migration later.
    allChannels.forEach(c=>{
      if(c.channelCode == null){
        c.channelCode = c.type==='master' ? MASTER_CHANNEL_CODE : (CHANNEL_TYPE_CODES[c.type] || nextCustomChannelCode(c.propertyId));
        channelsChanged = true;
      }
    });
    if(channelsChanged) set(KEYS.channels, allChannels);

    const allRooms = rooms.all();
    let roomsChanged = false;
    allRooms.forEach(r=>{
      if(!r.channelId && masterByProperty[r.propertyId]){ r.channelId = masterByProperty[r.propertyId]; roomsChanged = true; }
    });
    allRooms.forEach(r=>{
      if(!r.mealPlans){ r.mealPlans = [MEAL_PLANS[0]]; roomsChanged = true; }
    });
    // Backfill sortOrder (Rooms list's Move Up/Down) on any room saved before that feature
    // existed — per-channel counters, assigned in existing array order, same pattern as the
    // Rate Plans list's sortOrder backfill below.
    const roomSortCounters = {};
    allRooms.forEach(r=>{
      if(r.sortOrder == null){
        roomSortCounters[r.channelId] = (roomSortCounters[r.channelId] ?? -1) + 1;
        r.sortOrder = roomSortCounters[r.channelId];
        roomsChanged = true;
      }
    });
    if(roomsChanged) set(KEYS.rooms, allRooms);

    const allRatePlans = ratePlans.all();
    let ratePlansChanged = false;
    const roomChannel = {}; allRooms.forEach(r=> roomChannel[r.id]=r.channelId);
    allRatePlans.forEach(rp=>{
      if(!rp.channelId){
        rp.channelId = roomChannel[rp.roomId] || masterByProperty[rp.propertyId];
        ratePlansChanged = true;
      }
    });
    // Self-heal any rate plan whose baseOccupancy doesn't match its own room's base occupancy
    // (room.capacity) — previously every rate plan defaulted to a flat 2 regardless of the room
    // it was on, so a 3-guest-base room could end up with a plan that still thought only 2 guests
    // were included, silently charging an extra-adult surcharge for a guest the room itself
    // considers standard. Add Rate Plan now keeps this field read-only/synced going forward (see
    // js/add-rate-plan.js); this backfills anything saved before that existed.
    const roomById = {}; allRooms.forEach(r=> roomById[r.id]=r);
    allRatePlans.forEach(rp=>{
      const room = roomById[rp.roomId];
      if(room && rp.baseOccupancy !== room.capacity){
        rp.baseOccupancy = room.capacity;
        ratePlansChanged = true;
      }
    });
    // Backfill sortOrder (Rate Plans list's Move Up/Down) on any rate plan saved before that
    // feature existed — per-room counters, assigned in existing array order, so a first-time
    // reorder starts from exactly the order the list was already showing rather than jumbling it.
    const sortCounters = {};
    allRatePlans.forEach(rp=>{
      if(rp.sortOrder == null){
        sortCounters[rp.roomId] = (sortCounters[rp.roomId] ?? -1) + 1;
        rp.sortOrder = sortCounters[rp.roomId];
        ratePlansChanged = true;
      }
    });
    if(ratePlansChanged) set(KEYS.ratePlans, allRatePlans);

    // Backfill `category` on any notification saved before Settings > Notifications gained
    // per-category muting, matched by its title (the same titles notifActions in seed() emits)
    // so existing installs don't suddenly have uncategorized notifications that silently vanish
    // from every category filter and from the "only show this category" mute logic.
    const titleToCategory = {
      'New User Created':'accounts', 'User Activated':'accounts', 'User Deactivated':'accounts',
      'Role Assigned':'access', 'Permissions Updated':'access',
      'Password Reset Requested':'security', 'New Sign-In':'security'
    };
    const allNotifications = notifications.all();
    let notificationsChanged = false;
    allNotifications.forEach(n=>{
      if(!n.category){ n.category = titleToCategory[n.title] || 'accounts'; notificationsChanged = true; }
    });
    if(notificationsChanged) set(KEYS.notifications, allNotifications);

    seedRoomMappingDemoProperty();
  }

  // ---- One-time demo property for exercising Room Mapping with mismatched room names ----
  // Every regular seeded property draws its room names from the same shared ROOM_TYPES pool
  // (see seed() above), so two properties often end up with identically-named rooms — a trivial
  // 100%-confidence auto-match that never exercises the mapping review workflow. This adds one
  // more real property with its OWN bespoke room names (deliberately close-but-not-identical to
  // the shared pool: "Superior"/"Deluxe" instead of "Superior Room"/"Deluxe Room", plus "Studio"
  // and "Grand Suite" which don't exist in the shared pool at all) so Room Mapping has a genuine
  // mix of exact, fuzzy, and no-name-match cases to show off. Runs once (guarded by a fixed
  // hmsPropertyId sentinel below), then assigns it as one of Kavita Nair's competitor properties
  // (RBAC.comparisonPropertyIds() reads a Property Owner's own `assignedProperties` field) —
  // non-destructive, same backfill pattern as the rest of ensureChannels(), so it appears for
  // anyone with existing browser data without needing a full reseed.
  const DEMO_MAP_HMS_ID = 'EGS-P-DEMOMAP01';
  function seedRoomMappingDemoProperty(){
    if(properties.all().find(p=>p.hmsPropertyId===DEMO_MAP_HMS_ID)) return;

    const p = {
      id: uid('prop'), hmsPropertyId: DEMO_MAP_HMS_ID, name:'Silver Oak Suites',
      type:'Boutique Hotel', city:'Udaipur', state:'Rajasthan', country:'India',
      brand: pick(PROPERTY_BRANDS), code:'PRC-DEMO1',
      address:'Lake Pichola Road, Udaipur 313001',
      phone:'+91 98'+rand(10000000,99999999),
      email:'silveroaksuites@hotelmail.com', website:'www.silveroaksuites.com',
      status:'active', logo:'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=800&q=60',
      stars: rand(3,5), rooms: rand(40,120),
      description:'Silver Oak Suites is a boutique lakeside property in Udaipur, seeded specifically to demo Room Mapping against rooms named differently than the rest of the portfolio.',
      amenities:['Free WiFi','Swimming Pool','Spa','Restaurant','Parking','24x7 Front Desk'],
      createdAt: fmtDate(new Date(Date.now()-45*86400000))
    };
    const allProps = properties.all(); allProps.push(p); set(KEYS.properties, allProps);

    const demoChannels = [{ id: uid('chan'), propertyId: p.id, channelCode: MASTER_CHANNEL_CODE, name: CHANNEL_TYPES.master.label, type:'master', status:'active', createdAt: p.createdAt }];
    OTA_CHANNEL_TYPES.forEach(type=>{
      demoChannels.push({ id: uid('chan'), propertyId: p.id, channelCode: CHANNEL_TYPE_CODES[type], name: CHANNEL_TYPES[type].label, type, status: Math.random()>0.1?'active':'inactive', createdAt: p.createdAt });
    });
    const allChannels = channels.all().concat(demoChannels); set(KEYS.channels, allChannels);

    const DEMO_ROOM_TYPES = [
      {name:'Superior', bed:'Queen Bed', cap:2, category:'Deluxe', img:'https://images.unsplash.com/photo-1590490360182-c33d57733427?w=700&q=60'},
      {name:'Deluxe', bed:'King Bed', cap:2, category:'Deluxe', img:'https://images.unsplash.com/photo-1611892440504-42a792e24d32?w=700&q=60'},
      {name:'Junior Suite', bed:'King Bed', cap:3, category:'Suite', img:'https://images.unsplash.com/photo-1591088398332-8a7791972843?w=700&q=60'},
      {name:'Studio', bed:'Twin Beds', cap:2, category:'Standard', img:'https://images.unsplash.com/photo-1522771739844-6a9f6d5f14af?w=700&q=60'},
      {name:'Grand Suite', bed:'King Bed', cap:4, category:'Suite', img:'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?w=700&q=60'}
    ];
    const demoRooms = [];
    const masterChan = demoChannels[0];
    demoChannels.forEach(chan=>{
      const roomTypesForChannel = chan.type==='master' ? DEMO_ROOM_TYPES : shuffle(DEMO_ROOM_TYPES).slice(0, rand(2,3));
      const channelPriceBias = chan.type==='master' ? 1 : (0.92 + Math.random()*0.16);
      roomTypesForChannel.forEach(rt=>{
        const roomMealPlans = MEAL_PLANS.filter(()=>Math.random()>0.35);
        demoRooms.push({
          id: uid('room'), propertyId: p.id, channelId: chan.id,
          name: rt.name, category: rt.category, bedType: rt.bed, capacity: rt.cap,
          maxOccupancy: rt.cap + rand(0,1), totalRooms: rand(5,30), size: rand(22,65),
          basePrice: Math.round(rand(2500,12000)*channelPriceBias/10)*10,
          status:'active', img: rt.img,
          amenities:['AC','TV','Mini Bar','Balcony','Room Service','Safe'].filter(()=>Math.random()>0.3),
          mealPlans: roomMealPlans.length ? roomMealPlans : [MEAL_PLANS[0]]
        });
      });
    });
    const allRooms = rooms.all().concat(demoRooms); set(KEYS.rooms, allRooms);

    const demoRatePlans = [];
    demoRooms.forEach(r=>{
      const meal = pick(MEAL_PLANS), refundable = Math.random()>0.4;
      demoRatePlans.push({
        id: uid('rp'), propertyId: r.propertyId, channelId: r.channelId, roomId: r.id,
        name: `${r.name} - ${meal} ${refundable?'Flexible':'Non-Refundable'}`,
        mealPlan: meal, refundable, minStay: pick([1,1,1,2,3]), maxStay: pick([7,14,30]),
        cancellationPolicy: refundable ? 'Free cancellation up to 24 hours before check-in' : 'Non-refundable. No changes or cancellations allowed.',
        baseOccupancy: r.capacity, extraAdultPrice: rand(500,1500), extraChildPrice: rand(250,800),
        status:'active', sortOrder:0, createdAt: p.createdAt
      });
    });
    const allRatePlans = ratePlans.all().concat(demoRatePlans); set(KEYS.ratePlans, allRatePlans);

    const allRates = rates.all();
    const today = new Date();
    demoRatePlans.forEach(rp=>{
      const room = demoRooms.find(r=>r.id===rp.roomId);
      const maxOcc = room ? room.maxOccupancy : 2;
      allRates[rp.id] = {};
      for(let d=-7; d<97; d++){
        const date = new Date(today); date.setDate(today.getDate()+d);
        const key = fmtDate(date);
        const isWeekend = [0,6].includes(date.getDay());
        const base = room ? room.basePrice : 5000;
        const price = Math.round((base + (isWeekend?base*0.25:0) + rand(-300,400))/10)*10;
        allRates[rp.id][key] = { price, occPrices: buildOccPrices(price, rp.baseOccupancy, rp.extraAdultPrice, maxOcc) };
      }
    });
    set(KEYS.rates, allRates);

    // Assign as a competitor property to Kavita Nair specifically (the user asked for this
    // exact assignment) — appended to her assignedProperties, same field
    // RBAC.comparisonPropertyIds() already reads for every other competitor property.
    const allUsers = users.all();
    const kavita = allUsers.find(u=> u.name==='Kavita Nair');
    if(kavita){
      kavita.assignedProperties = kavita.assignedProperties || [];
      if(!kavita.assignedProperties.includes(p.id)) kavita.assignedProperties.push(p.id);
      set(KEYS.users, allUsers);
    }
  }

  return { seed, ensureChannels, uid, get, set, rand, pick, fmtDate, MEAL_PLANS, MEAL_LABELS, CHANNEL_TYPES,
    OTA_CHANNEL_TYPES, CHANNEL_CATALOG, CHANNEL_TYPE_CODES, MASTER_CHANNEL_CODE, channelCatalogEntry, NOTIF_CATEGORIES,
    properties, channels, rooms, ratePlans, rates, notifications, settings, users };
})();

DB.seed();
DB.ensureChannels();
