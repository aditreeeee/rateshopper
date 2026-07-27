/* ==========================================================================
   RBAC — Role-Based Access Control engine (frontend-only mock)
   ---------------------------------------------------------------------------
   This is deliberately structured the way a real backend would split the
   concern: DB.users (js/data.js) is a dumb CRUD store — the same shape a
   future ASP.NET "UsersController" + SQL Server "Users" table would expose.
   Every "who can do what" rule lives here instead, so swapping the mock
   DB.* calls for real HTTP calls to a .NET API later doesn't require
   touching any permission logic — only this file's internals change (e.g.
   `can()` becomes a call to a claims/JWT-derived permission set returned
   by the API, rather than reading localStorage).
   ========================================================================== */
const RBAC = (() => {

  const ROLES = {
    COMPANY_ADMIN: 'company_admin',
    PROPERTY_OWNER: 'property_owner'
  };

  const ROLE_LABELS = {
    company_admin: 'Company Admin',
    property_owner: 'Property Owner'
  };

  // Higher number = higher in the hierarchy. Used for "can X manage Y" checks.
  // Company Admin is the top of the hierarchy — the Company Owner role has been retired and
  // its full authority folded into Company Admin. Property Admin and Property User have also
  // been retired — Property Owner already fully covers their capabilities.
  const ROLE_RANK = { company_admin: 4, property_owner: 3 };

  const MODULES = {
    DASHBOARD: 'dashboard',
    PROPERTIES: 'properties',
    CHANNELS: 'channels',
    ROOMS: 'rooms',
    RATE_PLANS: 'ratePlans',
    RATE_CALENDAR: 'rateCalendar',
    USERS: 'users',
    SETTINGS: 'settings'
  };

  const MODULE_LABELS = {
    dashboard: 'Dashboard', properties: 'Properties', channels: 'Channels', rooms: 'Rooms',
    ratePlans: 'Rate Plans', rateCalendar: 'Rate Calendar', users: 'Users', settings: 'Settings'
  };

  function session(){
    try{ return JSON.parse(sessionStorage.getItem('hop_session') || localStorage.getItem('hop_session') || 'null'); }
    catch(e){ return null; }
  }

  function currentUser(){
    const s = session();
    if(!s || !s.userId) return null;
    const u = DB.users.get(s.userId);
    // Property Admin and Property User have been retired from the supported login hierarchy —
    // any lingering session for one (e.g. from before this change) is treated as logged out.
    const retiredRoles = ['property_admin', 'property_user'];
    return (u && u.status === 'active' && !retiredRoles.includes(u.role)) ? u : null;
  }

  function currentRole(){
    const u = currentUser();
    return u ? u.role : null;
  }

  function isCompanyLevel(role){
    role = role || currentRole();
    return role === ROLES.COMPANY_ADMIN;
  }

  /**
   * can(module, action) — the single gate every page/button should check.
   * action: 'view' | 'create' | 'edit' | 'delete'
   */
  function can(moduleName, action){
    action = action || 'view';
    const u = currentUser();
    if(!u) return false;

    switch(u.role){
      case ROLES.COMPANY_ADMIN:
        return true; // full access to everything, always — top of the hierarchy

      case ROLES.PROPERTY_OWNER:
        // No company-wide settings, and nobody left below them in the hierarchy to manage.
        if(moduleName === MODULES.SETTINGS || moduleName === MODULES.USERS) return false;
        // Full CRUD on their Parent Property's Rooms, Rate Plans, Calendar, Channels.
        return true;

      default:
        return false;
    }
  }

  /** Property IDs this user is allowed to see/operate on. Company-level roles see all. */
  function assignedPropertyIds(){
    const u = currentUser();
    if(!u) return [];
    if(isCompanyLevel(u.role)) return DB.properties.all().map(p=>p.id);
    // Property Owner's administrative scope = their own Parent Property (the hotel they
    // actually manage) + any properties they've since created themselves (ownerId).
    // NOTE: assignedProperties is NOT part of this — for a Property Owner that list is a
    // *rate comparison* set (see comparisonPropertyIds()), not a grant of management access.
    if(u.role === ROLES.PROPERTY_OWNER){
      const owned = DB.properties.all().filter(p=>p.ownerId===u.id).map(p=>p.id);
      return [...new Set([u.parentPropertyId, ...owned].filter(Boolean))];
    }
    return u.assignedProperties || [];
  }

  /** Properties a Property Owner has selected to benchmark their own rates against — display/comparison only, not an access grant. */
  function comparisonPropertyIds(){
    const u = currentUser();
    return (u && u.role === ROLES.PROPERTY_OWNER) ? (u.assignedProperties || []) : [];
  }

  /** How many more Parent Properties this Property Owner may still create (Infinity if unset). */
  function propertyLimitRemaining(user){
    const u = user || currentUser();
    if(!u || u.role !== ROLES.PROPERTY_OWNER) return Infinity;
    if(u.propertyLimit == null) return Infinity;
    const used = DB.properties.all().filter(p=>p.ownerId===u.id).length;
    return Math.max(0, u.propertyLimit - used);
  }

  function canAccessProperty(propertyId){
    return assignedPropertyIds().includes(propertyId);
  }

  /** Filters any array of {id,...} properties down to what the current user may see. */
  function filterProperties(list){
    const ids = assignedPropertyIds();
    return list.filter(p => ids.includes(p.id));
  }

  // The only supported hierarchy: Company Admin -> Property Owner. Company Admin is the top
  // authority (Company Owner has been retired) and can create more Company Admin peers as well
  // as Property Owners. Property Owner has nobody left below them to create (Property Admin has
  // also been retired — it was fully redundant with what Property Owner already does).
  const CREATABLE_ROLES = {
    [ROLES.COMPANY_ADMIN]: [ROLES.COMPANY_ADMIN, ROLES.PROPERTY_OWNER]
  };

  /** Roles the current user is allowed to create in the Users module (enforces the hierarchy). */
  function creatableRoles(){
    return CREATABLE_ROLES[currentRole()] || [];
  }

  /** Can the current user edit/delete this specific target user record? */
  function canManageUser(targetUser){
    const me = currentUser();
    if(!me || !targetUser) return false;
    if(me.id === targetUser.id) return false; // manage your own account via Profile, not Users

    switch(me.role){
      case ROLES.COMPANY_ADMIN:
        // Top of the hierarchy — manages everyone else, including other Company Admin peers.
        return true;
      default:
        // Property Owner has nobody left below them to manage — Property Admin has been
        // retired, and the Users module is hidden for this role (see can()).
        return false;
    }
  }

  /** Users visible in the Users module list for the current role. */
  function visibleUsers(){
    const me = currentUser();
    if(!me) return [];
    const all = DB.users.all();
    switch(me.role){
      case ROLES.COMPANY_ADMIN:
        return all.filter(u => u.id !== me.id);
      default:
        return [];
    }
  }

  // The safe "you're logged in but can't be here" landing page. Never redirect to whatever
  // page we're currently on for this — that turns a denied check into an infinite reload loop
  // (this bit dashboard.html itself: it guards its own access and was redirecting to itself).
  function fallbackPage(){
    const here = (location.pathname.split('/').pop() || 'index.html');
    return here === 'dashboard.html' ? 'index.html' : 'dashboard.html';
  }

  /** Page guard: redirect away if the current role isn't in the allow-list. Call at top of a page's script. */
  function requireRole(...allowedRoles){
    const role = currentRole();
    if(!role){ location.href = 'index.html'; return false; }
    if(allowedRoles.length && !allowedRoles.includes(role)){
      location.href = fallbackPage();
      return false;
    }
    return true;
  }

  /** Page guard: redirect away if the current user lacks `action` on `moduleName`. */
  function requireModuleAccess(moduleName, action){
    if(!currentUser()){ location.href = 'index.html'; return false; }
    if(!can(moduleName, action || 'view')){ location.href = fallbackPage(); return false; }
    return true;
  }

  return {
    ROLES, ROLE_LABELS, ROLE_RANK, MODULES, MODULE_LABELS,
    session, currentUser, currentRole, isCompanyLevel, can,
    assignedPropertyIds, propertyLimitRemaining, comparisonPropertyIds, canAccessProperty, filterProperties,
    creatableRoles, canManageUser, visibleUsers,
    requireRole, requireModuleAccess
  };
})();
