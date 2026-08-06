/* ==========================================================================
   Login — authenticates against DB.users (mock) and starts an RBAC session.
   A future .NET backend swaps doLogin()'s body for a POST /api/auth/login
   call that returns a JWT; everything else (session shape consumers read,
   the demo-account list) stays the same.
   ========================================================================== */
const DEMO_ACCOUNTS = [
  {role:'company_admin', icon:'bi-award-fill', email:'admin@eglobe.com', password:'Admin@123', desc:'Full platform access — every company & property'},
  {role:'property_owner', icon:'bi-building', email:'property.owner@eglobe.com', password:'Property@123', desc:'Manages 2 assigned properties end-to-end'}
];

document.documentElement.setAttribute('data-theme','light'); // login always light for brand consistency on the orb bg

document.addEventListener('DOMContentLoaded', ()=>{
  // Cursor-following glow — CSS (.pointer-light) just reads --lx/--ly off #authWrap, this is
  // only the tracking + the "don't glow behind the login square" exclusion zone. Reads the
  // left panel's rect fresh on every move rather than caching it once, since it's cheap and
  // means a window resize/reflow never leaves the exclusion zone stale.
  const authWrap = document.getElementById('authWrap');
  const loginPanel = document.querySelector('.auth-panel-left');
  if(authWrap && loginPanel){
    authWrap.addEventListener('mousemove', e=>{
      authWrap.style.setProperty('--lx', e.clientX + 'px');
      authWrap.style.setProperty('--ly', e.clientY + 'px');
      authWrap.classList.add('pointer-light-active');
      const r = loginPanel.getBoundingClientRect();
      const overLoginSquare = e.clientX>=r.left && e.clientX<=r.right && e.clientY>=r.top && e.clientY<=r.bottom;
      authWrap.classList.toggle('pointer-light-off', overLoginSquare);
    });
    authWrap.addEventListener('mouseleave', ()=> authWrap.classList.remove('pointer-light-active'));
  }

  const toggleEye = document.getElementById('toggleEye');
  const pwInput = document.getElementById('password');
  toggleEye.addEventListener('click', ()=>{
    const isPw = pwInput.type === 'password';
    pwInput.type = isPw ? 'text' : 'password';
    toggleEye.classList.toggle('bi-eye', !isPw);
    toggleEye.classList.toggle('bi-eye-slash', isPw);
  });

  // If already logged in with a still-valid account, skip straight to dashboard. A stale
  // session (e.g. left over from before a data reseed) points at a user id that no longer
  // exists — clear it here instead of bouncing to dashboard.html and back forever.
  if(sessionStorage.getItem('hop_session') || localStorage.getItem('hop_session')){
    const already = RBAC.currentUser();
    if(already){
      location.href = (already.role === 'property_owner' && already.parentPropertyId) ? 'property-dashboard.html' : 'dashboard.html';
      return;
    }
    sessionStorage.removeItem('hop_session');
    localStorage.removeItem('hop_session');
  }

  document.getElementById('demoAccessList').innerHTML = DEMO_ACCOUNTS.map(acc=>`
    <button type="button" class="demo-account-btn" data-email="${acc.email}" data-password="${acc.password}">
      <span class="demo-account-icon"><i class="bi ${acc.icon}"></i></span>
      <span class="flex-grow-1 text-start">
        <span class="d-block fw-semibold text-white" style="font-size:.85rem">${RBAC.ROLE_LABELS[acc.role]}</span>
      </span>
      <i class="bi bi-arrow-right-short text-white-50"></i>
    </button>`).join('');

  document.querySelectorAll('.demo-account-btn').forEach(btn=>{
    btn.addEventListener('click', function(){
      document.getElementById('email').value = this.dataset.email;
      document.getElementById('password').value = this.dataset.password;
      doLogin(this.dataset.email, this.dataset.password, true);
    });
  });

  document.getElementById('loginForm').addEventListener('submit', function(e){
    e.preventDefault();
    const email = document.getElementById('email').value.trim();
    const password = pwInput.value;
    const remember = document.getElementById('rememberMe').checked;
    doLogin(email, password, remember);
  });

  document.getElementById('sendResetBtn').addEventListener('click', function(){
    APP.toast('Reset Link Sent', 'Check your inbox for password reset instructions.', 'success');
    bootstrap.Modal.getInstance(document.getElementById('forgotModal')).hide();
  });
});

function doLogin(email, password, remember){
  const btn = document.getElementById('loginBtn');
  const btnText = document.getElementById('loginBtnText');
  const emailField = document.getElementById('email');
  const pwField = document.getElementById('password');

  emailField.classList.remove('is-invalid');
  pwField.classList.remove('is-invalid');
  btn.disabled = true;
  btnText.innerHTML = `<span class="spinner-border spinner-border-sm me-2"></span> Signing in...`;

  setTimeout(()=>{
    const user = DB.users.byEmail(email);
    // Property User and Property Admin are no longer part of the supported login hierarchy.
    const valid = user && user.password === password && user.status === 'active' && user.role !== 'property_user' && user.role !== 'property_admin';

    if(valid){
      const session = { userId: user.id, email: user.email, role: user.role, loginAt: new Date().toISOString() };
      if(remember){ localStorage.setItem('hop_session', JSON.stringify(session)); }
      else { sessionStorage.setItem('hop_session', JSON.stringify(session)); }
      APP.toast('Welcome back!', `Signed in as ${RBAC.ROLE_LABELS[user.role]}. Redirecting...`, 'success');
      // Property Owner has a dedicated Rate Shopper / Revenue Management portal — lands
      // straight on its dashboard, no intermediate admin pages.
      const landing = (user.role === 'property_owner' && user.parentPropertyId) ? 'property-dashboard.html' : 'dashboard.html';
      setTimeout(()=> location.href=landing, 600);
    } else {
      btn.disabled = false;
      btnText.innerHTML = `<i class="bi bi-box-arrow-in-right me-1"></i> Sign In`;
      emailField.classList.add('is-invalid');
      pwField.classList.add('is-invalid');
      const reason = user && user.status !== 'active' ? 'This account has been deactivated.' : 'Incorrect email or password.';
      APP.toast('Login Failed', reason, 'danger');
    }
  }, 500);
}
