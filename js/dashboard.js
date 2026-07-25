document.addEventListener('DOMContentLoaded', ()=>{
  if(!RBAC.requireModuleAccess(RBAC.MODULES.DASHBOARD, 'view')) return;

  const me = RBAC.currentUser();
  APP.mount({ title:'Dashboard', subtitle:`Welcome back, ${me.name.split(' ')[0]}! Here's what's happening across your properties.`, breadcrumb:[{label:'Home',href:'dashboard.html'},{label:'Dashboard'}] });

  const properties = RBAC.filterProperties(DB.properties.all());
  const scopedIds = new Set(properties.map(p=>p.id));
  const rooms = DB.rooms.all().filter(r=> scopedIds.has(r.propertyId));
  const ratePlans = DB.ratePlans.all().filter(rp=> scopedIds.has(rp.propertyId));
  const activity = DB.activity.all();
  const notifs = DB.notifications.all().slice(0,5);

  const totalRoomsCount = rooms.reduce((s,r)=>s+r.totalRooms,0);
  const occupancy = DB.rand(58,84);
  const adr = Math.round(rooms.reduce((s,r)=>s+r.basePrice,0)/Math.max(rooms.length,1));
  const revenue = adr * totalRoomsCount * (occupancy/100) * 30;

  const stats = [
    {icon:'bi-building', color:'#3861fb', bg:'#eef4ff', label:'Total Properties', value:properties.length, trend:'+2 this year', up:true},
    {icon:'bi-door-open', color:'#00c2a8', bg:'#e6faf7', label:'Total Rooms', value:totalRoomsCount, trend:'+12 this month', up:true},
    {icon:'bi-tags', color:'#b9791a', bg:'#fff8e6', label:'Rate Plans', value:ratePlans.length, trend:'Active plans', up:true},
    {icon:'bi-graph-up-arrow', color:'#12b76a', bg:'#e7faf1', label:"Today's Occupancy", value:occupancy+'%', trend:'+4.2% vs last week', up:true},
    {icon:'bi-currency-rupee', color:'#3861fb', bg:'#eef4ff', label:'ADR', value:APP.fmtCurrency(adr), trend:'Average Daily Rate', up:true},
    {icon:'bi-wallet2', color:'#ff4d5e', bg:'#fff0f1', label:'Revenue (MTD)', value:APP.fmtCurrency(Math.round(revenue)), trend:'+8.1% vs last month', up:true},
  ];
  document.getElementById('statCards').innerHTML = stats.map(s=>`
    <div class="col-md-4 col-xl-4 col-xxl-2">
      <div class="stat-card">
        <div class="stat-icon" style="background:${s.bg};color:${s.color}"><i class="bi ${s.icon}"></i></div>
        <div>
          <div class="stat-label">${s.label}</div>
          <h3>${s.value}</h3>
          <div class="stat-trend ${s.up?'up':'down'}"><i class="bi bi-arrow-${s.up?'up':'down'}-short"></i>${s.trend}</div>
        </div>
      </div>
    </div>`).join('');

  // Revenue chart
  const months = ['Aug','Sep','Oct','Nov','Dec','Jan','Feb','Mar','Apr','May','Jun','Jul'];
  const revData = months.map(()=>DB.rand(300000,950000));
  new Chart(document.getElementById('revenueChart'), {
    type:'line',
    data:{ labels:months, datasets:[{
      label:'Revenue', data:revData, borderColor:'#3861fb', backgroundColor:'rgba(56,97,251,.12)',
      fill:true, tension:.4, pointRadius:3, pointBackgroundColor:'#3861fb', borderWidth:3
    }]},
    options:{ plugins:{legend:{display:false}}, scales:{ y:{ticks:{callback:v=>'₹'+(v/1000)+'k'}, grid:{color:'rgba(120,130,180,.1)'}}, x:{grid:{display:false}} } }
  });

  // Occupancy chart
  const occData = months.map(()=>DB.rand(45,92));
  new Chart(document.getElementById('occupancyChart'), {
    type:'bar',
    data:{ labels:months, datasets:[{ label:'Occupancy %', data:occData, backgroundColor:'#00c2a8', borderRadius:6, maxBarThickness:28 }]},
    options:{ plugins:{legend:{display:false}}, scales:{ y:{max:100, ticks:{callback:v=>v+'%'}, grid:{color:'rgba(120,130,180,.1)'}}, x:{grid:{display:false}} } }
  });

  // Mini calendar
  renderMiniCalendar();
  function renderMiniCalendar(){
    const now = new Date();
    document.getElementById('miniCalMonth').textContent = now.toLocaleDateString('en-IN',{month:'long', year:'numeric'});
    const first = new Date(now.getFullYear(), now.getMonth(), 1);
    const startDow = first.getDay();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth()+1, 0).getDate();
    let html = '<table><thead><tr>'+['S','M','T','W','T','F','S'].map(d=>`<th class="text-muted" style="font-size:.68rem">${d}</th>`).join('')+'</tr></thead><tbody><tr>';
    for(let i=0;i<startDow;i++) html+='<td></td>';
    let col = startDow;
    for(let d=1; d<=daysInMonth; d++){
      const isToday = d===now.getDate();
      const hasDot = DB.rand(0,4)===0;
      html += `<td class="${isToday?'today':''} ${hasDot?'has-dot':''}">${d}</td>`;
      col++;
      if(col%7===0) html+='</tr><tr>';
    }
    html += '</tr></tbody></table>';
    document.getElementById('miniCalendar').innerHTML = html;
  }

  // Notifications
  const notifColors = {success:'#12b76a', brand:'#3861fb', warn:'#b9791a', danger:'#ff4d5e'};
  document.getElementById('notifList').innerHTML = notifs.length ? notifs.map(n=>`
    <div class="activity-item">
      <div class="activity-ico" style="background:${notifColors[n.color]}1a;color:${notifColors[n.color]}"><i class="bi ${n.icon}"></i></div>
      <div class="flex-grow-1">
        <div class="fw-semibold" style="font-size:.83rem">${n.title}</div>
        <div class="text-muted" style="font-size:.76rem">${n.msg}</div>
      </div>
      ${!n.read?'<span class="badge bg-primary-subtle text-primary rounded-pill align-self-start" style="font-size:.6rem">New</span>':''}
    </div>`).join('') : `<div class="empty-state py-3"><i class="bi bi-bell-slash"></i><p class="mb-0 small">No notifications</p></div>`;

  // Activity
  const actColors = {success:'#12b76a', brand:'#3861fb', warn:'#b9791a', danger:'#ff4d5e'};
  document.getElementById('activityList').innerHTML = activity.map(a=>`
    <div class="activity-item">
      <div class="activity-ico" style="background:${actColors[a.color]}1a;color:${actColors[a.color]}"><i class="bi ${a.icon}"></i></div>
      <div class="flex-grow-1">
        <div style="font-size:.84rem">${a.text}</div>
        <div class="text-muted" style="font-size:.74rem">${a.time}</div>
      </div>
    </div>`).join('');

  if(!RBAC.can(RBAC.MODULES.PROPERTIES, 'create')) document.getElementById('qaAddProperty').classList.add('d-none');
  if(!RBAC.can(RBAC.MODULES.ROOMS, 'create')) document.getElementById('qaAddRoom').classList.add('d-none');
  if(!RBAC.can(RBAC.MODULES.RATE_PLANS, 'create')) document.getElementById('qaAddRatePlan').classList.add('d-none');
  if(!RBAC.can(RBAC.MODULES.RATE_CALENDAR, 'view')) document.getElementById('qaRateCalendar').classList.add('d-none');

  document.querySelectorAll('[data-range]').forEach(btn=>{
    btn.addEventListener('click', function(){
      document.querySelectorAll('[data-range]').forEach(b=>{b.classList.remove('btn-soft','active');b.classList.add('btn-outline-primary');});
      this.classList.add('btn-soft','active'); this.classList.remove('btn-outline-primary');
      APP.toast('Range Updated', 'Chart refreshed for selected range.', 'info');
    });
  });
});
