let notifFilter = 'all';

document.addEventListener('DOMContentLoaded', ()=>{
  APP.mount({
    title:'Notifications', subtitle:'Stay up to date on user accounts, roles, and access changes.',
    breadcrumb:[{label:'Home',href:'dashboard.html'},{label:'Notifications'}]
  });

  document.querySelectorAll('[data-filter]').forEach(btn=>{
    btn.addEventListener('click', function(){
      document.querySelectorAll('[data-filter]').forEach(b=>{b.classList.remove('btn-soft','active');b.classList.add('btn-outline-primary');});
      this.classList.add('btn-soft','active'); this.classList.remove('btn-outline-primary');
      notifFilter = this.dataset.filter;
      render();
    });
  });
  document.getElementById('markAllBtn').addEventListener('click', ()=>{
    DB.notifications.markAllRead();
    APP.toast('All Caught Up', 'All notifications marked as read.', 'success');
    render();
  });

  render();
});

function render(){
  const colors = {success:'#12b76a', brand:'#3861fb', warn:'#b9791a', danger:'#ff4d5e'};
  let list = DB.notifications.all();
  if(notifFilter==='unread') list = list.filter(n=>!n.read);

  const wrap = document.getElementById('notifListFull');
  const empty = document.getElementById('notifEmpty');
  if(!list.length){
    wrap.innerHTML = ''; empty.classList.remove('d-none');
    empty.innerHTML = `<div class="empty-state"><i class="bi bi-bell-slash"></i><h5>No notifications</h5><p>You're all caught up!</p></div>`;
    return;
  }
  empty.classList.add('d-none');

  wrap.innerHTML = list.map(n=>`
    <div class="d-flex align-items-start gap-3 p-3 border-bottom" style="border-color:var(--border-2) !important;${!n.read?'background:var(--bg-surface-2)':''}">
      <div class="activity-ico" style="background:${colors[n.color]}1a;color:${colors[n.color]}"><i class="bi ${n.icon}"></i></div>
      <div class="flex-grow-1">
        <div class="d-flex justify-content-between">
          <div class="fw-semibold">${n.title} ${!n.read?'<span class="badge bg-primary-subtle text-primary rounded-pill ms-1" style="font-size:.6rem">New</span>':''}</div>
          <small class="text-muted">${APP.fmtDateReadable(n.time)}</small>
        </div>
        <div class="text-muted small">${n.msg}</div>
      </div>
      <div class="d-flex gap-1">
        ${!n.read?`<button class="btn btn-sm-icon btn-soft" title="Mark read" onclick="markRead('${n.id}')"><i class="bi bi-check2"></i></button>`:''}
        <button class="btn btn-sm-icon btn-light-danger" title="Remove" onclick="removeNotif('${n.id}')"><i class="bi bi-x-lg"></i></button>
      </div>
    </div>`).join('');
}

function markRead(id){ DB.notifications.markRead(id); render(); }
function removeNotif(id){ DB.notifications.remove(id); APP.toast('Removed', 'Notification dismissed.', 'info'); render(); }
