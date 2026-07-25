/* ==========================================================================
   Login — authenticates against DB.users (mock) and starts an RBAC session.
   A future .NET backend swaps doLogin()'s body for a POST /api/auth/login
   call that returns a JWT; everything else (session shape consumers read,
   the demo-account list) stays the same.
   ========================================================================== */
const DEMO_ACCOUNTS = [
  {role:'company_admin', icon:'bi-award-fill', email:'admin@eglobe.com', password:'Admin@123', desc:'Full platform access — every company & property'},
  {role:'property_owner', icon:'bi-building', email:'property.owner@eglobe.com', password:'Property@123', desc:'Manages 2 assigned properties end-to-end'},
  {role:'property_admin', icon:'bi-graph-up-arrow', email:'neha.kapoor@eglobe.com', password:'Admin@123', desc:'1 property + competitor rate benchmarking'}
];

document.documentElement.setAttribute('data-theme','light'); // login always light for brand consistency on the orb bg

document.addEventListener('DOMContentLoaded', ()=>{
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
        <span class="d-block text-white-50" style="font-size:.72rem">${acc.desc}</span>
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
    APP.toast('Reset Link Sent', 'Check your inbox for password reset instructions (demo only).', 'success');
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
    // Property User is no longer part of the supported login hierarchy.
    const valid = user && user.password === password && user.status === 'active' && user.role !== 'property_user';

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
