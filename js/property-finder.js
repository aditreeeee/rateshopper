/* ==========================================================================
   Property Finder — async, search-first competitor picker built to scale to
   10,000+ properties: nothing renders the full catalog into the DOM. Every
   keystroke/filter/sort/scroll goes through fetchPage(), a single function
   shaped exactly like a future .NET endpoint
   (GET /api/properties/search?query=&country=&state=&brand=&type=&status=
   &minStars=&sort=&page=&pageSize=) would respond — server-side search +
   pagination. Swapping the mock body of fetchPage() for a real fetch() call
   is the only change needed to go live; every other function here (render,
   selection state, infinite scroll, the Selected Competitors panel) is
   already written against that async, paginated contract.
   ========================================================================== */
const PropertyFinder = (() => {

  const PAGE_SIZE = 20;
  const NETWORK_DELAY = 220; // simulated latency, so the loading states are real to build against
  let _instanceSeq = 0; // unique per mount(), used to namespace single-select radio groups

  function sortList(list, sort){
    const arr = [...list];
    switch(sort){
      case 'name_desc':  return arr.sort((a,b)=> b.name.localeCompare(a.name));
      case 'stars_desc': return arr.sort((a,b)=> (b.stars||0)-(a.stars||0));
      case 'stars_asc':  return arr.sort((a,b)=> (a.stars||0)-(b.stars||0));
      case 'recent':     return arr.sort((a,b)=> new Date(b.createdAt)-new Date(a.createdAt));
      case 'name_asc':
      default:           return arr.sort((a,b)=> a.name.localeCompare(b.name));
    }
  }

  // Stand-in for GET /api/properties/search — the only function a real backend integration
  // needs to replace. Everything below treats its result as an opaque paginated response.
  function fetchPage({ query, filters, sort, page, pageSize, excludeIds }){
    return new Promise(resolve=>{
      setTimeout(()=>{
        let list = DB.properties.all();
        if(excludeIds && excludeIds.length){
          const ex = new Set(excludeIds);
          list = list.filter(p=>!ex.has(p.id));
        }
        const q = (query||'').trim().toLowerCase();
        if(q){
          list = list.filter(p=>
            (p.name||'').toLowerCase().includes(q) ||
            (p.city||'').toLowerCase().includes(q) ||
            (p.state||'').toLowerCase().includes(q) ||
            (p.country||'').toLowerCase().includes(q) ||
            (p.brand||'').toLowerCase().includes(q) ||
            (p.code||'').toLowerCase().includes(q) ||
            String(p.stars||'').includes(q)
          );
        }
        if(filters){
          if(filters.country)  list = list.filter(p=>p.country===filters.country);
          if(filters.state)    list = list.filter(p=>p.state===filters.state);
          if(filters.brand)    list = list.filter(p=>p.brand===filters.brand);
          if(filters.type)     list = list.filter(p=>p.type===filters.type);
          if(filters.status)   list = list.filter(p=>p.status===filters.status);
          if(filters.minStars) list = list.filter(p=>(p.stars||0) >= Number(filters.minStars));
        }
        list = sortList(list, sort);

        const total = list.length;
        const start = (page-1)*pageSize;
        const items = list.slice(start, start+pageSize);
        resolve({ items, total, page, pageSize, hasMore: start+items.length < total });
      }, NETWORK_DELAY);
    });
  }

  // Facet values for the filter dropdowns. A real backend would expose these as small lookup/
  // facet endpoints rather than deriving them from the full list client-side.
  function filterOptions(excludeIds){
    const ex = new Set(excludeIds||[]);
    const list = DB.properties.all().filter(p=>!ex.has(p.id));
    const uniq = key => [...new Set(list.map(p=>p[key]).filter(Boolean))].sort();
    return { countries: uniq('country'), states: uniq('state'), brands: uniq('brand'), types: uniq('type') };
  }

  function escapeHtml(s){
    return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  /**
   * mount(container, options) -> controller
   * options.mode:        'multi' (default) | 'single' — single caps selection at one property
   *                       and swaps the side "Selected Competitors" panel for one highlighted
   *                       card with Change/Clear actions (used for Parent Property).
   * options.selectedIds: string[]      initial selection
   * options.excludeId:   string|null   a property id that can never be selected (e.g. itself)
   * options.onChange:    (ids) => void fires on every selection change
   */
  function mount(container, options = {}){
    const mode = options.mode === 'single' ? 'single' : 'multi';
    const instanceId = ++_instanceSeq;
    let selected = new Map(); // id -> full property record, cached so cards/chips never need a refetch
    (options.selectedIds || []).slice(0, mode==='single'?1:undefined).forEach(id=>{
      const p = DB.properties.get(id);
      if(p) selected.set(id, p);
    });
    let excludeId = options.excludeId || null;
    let query = '';
    let filters = {};
    let sort = 'name_asc';
    let page = 1;
    let loading = false;
    let hasMore = true;
    let searchToken = 0; // discards stale responses when a newer search/filter/scroll supersedes them

    const searchFilterMarkup = `
        <div class="pf-search-row">
          <div class="pf-search-input">
            <i class="bi bi-search"></i>
            <input type="text" class="form-control" placeholder="Search by property name, code, city, state, country, brand, star rating, or type...">
          </div>
          <button type="button" class="btn btn-soft pf-filter-toggle"><i class="bi bi-sliders me-1"></i>Filters</button>
          <select class="form-select form-select-sm pf-sort">
            <option value="name_asc">Name (A-Z)</option>
            <option value="name_desc">Name (Z-A)</option>
            <option value="stars_desc">Star Rating (High-Low)</option>
            <option value="stars_asc">Star Rating (Low-High)</option>
            <option value="recent">Recently Added</option>
          </select>
        </div>
        <div class="pf-filter-panel d-none">
          <div class="row g-2">
            <div class="col-6 col-md-4 col-lg-2">
              <label class="pf-filter-label">Country</label>
              <select class="form-select form-select-sm pf-f-country"><option value="">All Countries</option></select>
            </div>
            <div class="col-6 col-md-4 col-lg-2">
              <label class="pf-filter-label">State</label>
              <select class="form-select form-select-sm pf-f-state"><option value="">All States</option></select>
            </div>
            <div class="col-6 col-md-4 col-lg-2">
              <label class="pf-filter-label">Brand</label>
              <select class="form-select form-select-sm pf-f-brand"><option value="">All Brands</option></select>
            </div>
            <div class="col-6 col-md-4 col-lg-2">
              <label class="pf-filter-label">Property Type</label>
              <select class="form-select form-select-sm pf-f-type"><option value="">All Types</option></select>
            </div>
            <div class="col-6 col-md-4 col-lg-2">
              <label class="pf-filter-label">Min. Star Rating</label>
              <select class="form-select form-select-sm pf-f-stars">
                <option value="">Any</option>
                <option value="3">3+ Stars</option>
                <option value="4">4+ Stars</option>
                <option value="5">5 Stars</option>
              </select>
            </div>
            <div class="col-6 col-md-4 col-lg-2">
              <label class="pf-filter-label">Status</label>
              <select class="form-select form-select-sm pf-f-status">
                <option value="">All Statuses</option>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>
          <button type="button" class="btn btn-link btn-sm p-0 mt-2 pf-clear-filters">Clear all filters</button>
        </div>`;

    container.innerHTML = mode === 'single'
      ? `<div class="pf-widget pf-widget-single">
          <div class="pf-single-selected d-none"></div>
          <div class="pf-picker-area">
            ${searchFilterMarkup}
            <div class="pf-results-meta text-muted small mb-1 mt-2">Searching...</div>
            <div class="pf-results"></div>
          </div>
        </div>`
      : `<div class="pf-widget">
          ${searchFilterMarkup}
          <div class="row g-3 mt-1">
            <div class="col-lg-7">
              <div class="pf-results-meta text-muted small mb-1">Searching...</div>
              <div class="pf-results"></div>
            </div>
            <div class="col-lg-5">
              <div class="pf-selected-panel">
                <div class="pf-selected-header">
                  <span>Selected Competitors <span class="pf-selected-count badge bg-primary-subtle text-primary">0</span></span>
                  <button type="button" class="btn btn-link btn-sm p-0 pf-clear-selected d-none">Clear all</button>
                </div>
                <div class="pf-selected-list"></div>
              </div>
            </div>
          </div>
        </div>`;

    const els = {
      pickerArea: container.querySelector('.pf-picker-area'),
      singleSelected: container.querySelector('.pf-single-selected'),
      searchInput: container.querySelector('.pf-search-input input'),
      filterToggle: container.querySelector('.pf-filter-toggle'),
      filterPanel: container.querySelector('.pf-filter-panel'),
      sort: container.querySelector('.pf-sort'),
      fCountry: container.querySelector('.pf-f-country'),
      fState: container.querySelector('.pf-f-state'),
      fBrand: container.querySelector('.pf-f-brand'),
      fType: container.querySelector('.pf-f-type'),
      fStars: container.querySelector('.pf-f-stars'),
      fStatus: container.querySelector('.pf-f-status'),
      clearFilters: container.querySelector('.pf-clear-filters'),
      resultsMeta: container.querySelector('.pf-results-meta'),
      results: container.querySelector('.pf-results'),
      selectedList: container.querySelector('.pf-selected-list'),
      selectedCount: container.querySelector('.pf-selected-count'),
      clearSelected: container.querySelector('.pf-clear-selected')
    };

    function populateFilterOptions(){
      const opts = filterOptions(excludeId ? [excludeId] : []);
      const optHtml = (all, list) => `<option value="">${all}</option>` + list.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
      els.fCountry.innerHTML = optHtml('All Countries', opts.countries);
      els.fState.innerHTML   = optHtml('All States', opts.states);
      els.fBrand.innerHTML   = optHtml('All Brands', opts.brands);
      els.fType.innerHTML    = optHtml('All Types', opts.types);
    }
    populateFilterOptions();

    function emitChange(){
      if(typeof options.onChange === 'function') options.onChange([...selected.keys()]);
    }

    function renderSelected(){
      const ids = [...selected.keys()];
      els.selectedCount.textContent = ids.length;
      els.clearSelected.classList.toggle('d-none', ids.length===0);
      if(!ids.length){
        els.selectedList.innerHTML = `<div class="pf-empty text-muted small">No competitors selected yet — search and check properties on the left.</div>`;
        return;
      }
      els.selectedList.innerHTML = ids.map(id=>{
        const p = selected.get(id);
        return `<div class="pf-chip" data-id="${id}">
          <div class="pf-chip-body">
            <div class="pf-chip-name">${escapeHtml(p.name)}</div>
            <div class="pf-chip-meta">${escapeHtml(p.city)}${p.state?', '+escapeHtml(p.state):''}, ${escapeHtml(p.country)} • ${escapeHtml(p.brand||'—')} • ${'★'.repeat(p.stars||0)}</div>
          </div>
          <button type="button" class="pf-chip-remove" title="Remove"><i class="bi bi-x-lg"></i></button>
        </div>`;
      }).join('');
    }

    // Single mode: one highlighted card in place of the picker, with Change/Clear actions —
    // the picker area only reappears while actively choosing/changing the selection.
    function renderSingleCard(){
      const id = [...selected.keys()][0];
      if(!id){
        els.singleSelected.classList.add('d-none');
        els.singleSelected.innerHTML = '';
        els.pickerArea.classList.remove('d-none');
        return;
      }
      const p = selected.get(id);
      els.singleSelected.innerHTML = `
        <div class="pf-single-card">
          <div class="pf-single-card-icon"><i class="bi bi-building-check"></i></div>
          <div class="pf-single-card-body">
            <div class="pf-single-card-label">Primary Property</div>
            <div class="pf-single-card-name">${escapeHtml(p.name)}</div>
            <div class="pf-single-card-meta">${escapeHtml(p.city)}${p.state?', '+escapeHtml(p.state):''}, ${escapeHtml(p.country)} • ${escapeHtml(p.brand||'—')} • ${'★'.repeat(p.stars||0)} • ${escapeHtml(p.type||'—')}</div>
          </div>
          <div class="pf-single-card-actions">
            <button type="button" class="btn btn-soft btn-sm pf-single-change">Change</button>
            <button type="button" class="btn btn-light btn-sm-icon pf-single-clear" title="Clear"><i class="bi bi-x-lg"></i></button>
          </div>
        </div>`;
      els.singleSelected.classList.remove('d-none');
      els.pickerArea.classList.add('d-none');
    }

    function syncRowCheckedState(id, checked){
      const row = els.results.querySelector(`.pf-row[data-id="${id}"]`);
      if(row){ row.classList.toggle('pf-row-checked', checked); const cb = row.querySelector('input'); if(cb) cb.checked = checked; }
    }

    function toggleSelect(id, checked){
      if(mode === 'single'){
        const prevId = [...selected.keys()][0];
        selected.clear();
        if(checked){
          const p = DB.properties.get(id);
          if(p) selected.set(id, p);
        }
        if(prevId && prevId !== id) syncRowCheckedState(prevId, false);
        renderSingleCard();
        emitChange();
        return;
      }
      if(checked){
        const p = DB.properties.get(id);
        if(p) selected.set(id, p);
      } else {
        selected.delete(id);
      }
      renderSelected();
      syncRowCheckedState(id, checked);
      emitChange();
    }

    if(mode === 'single') renderSingleCard(); else renderSelected();

    function rowHtml(p){
      const checked = selected.has(p.id);
      const inputHtml = mode === 'single'
        ? `<input type="radio" name="pf-radio-${instanceId}" class="form-check-input" ${checked?'checked':''}>`
        : `<input type="checkbox" class="form-check-input" ${checked?'checked':''}>`;
      return `<label class="pf-row ${checked?'pf-row-checked':''}" data-id="${p.id}">
        ${inputHtml}
        <div class="pf-row-body">
          <div class="pf-row-top">
            <span class="pf-row-name">${escapeHtml(p.name)}</span>
            <span class="pf-row-stars">${'★'.repeat(p.stars||0)}</span>
          </div>
          <div class="pf-row-meta">
            ${escapeHtml(p.city)}${p.state?', '+escapeHtml(p.state):''}, ${escapeHtml(p.country)}
            <span class="pf-dot">•</span>${escapeHtml(p.brand||'—')}
            <span class="pf-dot">•</span>${escapeHtml(p.type||'—')}
            <span class="pf-dot">•</span><span class="badge-status ${p.status==='active'?'badge-active':'badge-inactive'}" style="font-size:.62rem">${p.status}</span>
            ${p.code?`<span class="pf-dot">•</span><span class="text-muted">${escapeHtml(p.code)}</span>`:''}
          </div>
        </div>
      </label>`;
    }

    async function loadPage(reset){
      if(loading) return;
      loading = true;
      const token = ++searchToken;
      if(reset){
        page = 1;
        els.results.innerHTML = `<div class="pf-loading text-muted small p-3"><i class="bi bi-hourglass-split me-1"></i>Searching...</div>`;
      } else {
        els.results.insertAdjacentHTML('beforeend', `<div class="pf-loading-more text-muted small p-2 text-center"><i class="bi bi-hourglass-split me-1"></i>Loading more...</div>`);
      }
      const res = await fetchPage({ query, filters, sort, page, pageSize: PAGE_SIZE, excludeIds: excludeId ? [excludeId] : [] });
      if(token !== searchToken) return; // a newer search superseded this one — drop the stale response
      loading = false;
      hasMore = res.hasMore;
      const loadingMore = els.results.querySelector('.pf-loading-more');
      if(loadingMore) loadingMore.remove();

      if(reset){
        els.resultsMeta.textContent = res.total ? `${res.total} propert${res.total===1?'y':'ies'} found` : 'No properties match your search.';
        els.results.innerHTML = res.items.map(rowHtml).join('') || `<div class="pf-empty text-muted small p-3">No properties match your search. Try adjusting filters.</div>`;
      } else {
        els.results.insertAdjacentHTML('beforeend', res.items.map(rowHtml).join(''));
      }
      page += 1;
    }

    // ---- Infinite scroll: fetch the next page shortly before the user hits the bottom ----
    els.results.addEventListener('scroll', ()=>{
      if(loading || !hasMore) return;
      const { scrollTop, scrollHeight, clientHeight } = els.results;
      if(scrollHeight - (scrollTop+clientHeight) < 120) loadPage(false);
    });

    // ---- Selection (event delegation so it survives re-renders/appends) ----
    els.results.addEventListener('change', e=>{
      const row = e.target.closest('.pf-row');
      if(!row) return;
      toggleSelect(row.dataset.id, e.target.checked);
    });

    if(mode === 'single'){
      els.singleSelected.addEventListener('click', e=>{
        if(e.target.closest('.pf-single-change')){
          els.singleSelected.classList.add('d-none');
          els.pickerArea.classList.remove('d-none');
        } else if(e.target.closest('.pf-single-clear')){
          const prevId = [...selected.keys()][0];
          selected.clear();
          if(prevId) syncRowCheckedState(prevId, false);
          renderSingleCard();
          emitChange();
        }
      });
    } else {
      els.selectedList.addEventListener('click', e=>{
        const chip = e.target.closest('.pf-chip');
        if(!chip || !e.target.closest('.pf-chip-remove')) return;
        toggleSelect(chip.dataset.id, false);
      });
      els.clearSelected.addEventListener('click', ()=>{
        selected.clear();
        els.results.querySelectorAll('.pf-row').forEach(r=>{ r.classList.remove('pf-row-checked'); const cb=r.querySelector('input'); if(cb) cb.checked=false; });
        renderSelected();
        emitChange();
      });
    }

    // ---- Search / filters / sort ----
    let debounceTimer = null;
    els.searchInput.addEventListener('input', function(){
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(()=>{ query = this.value; loadPage(true); }, 300);
    });
    els.filterToggle.addEventListener('click', ()=> els.filterPanel.classList.toggle('d-none'));
    [['fCountry','country'],['fState','state'],['fBrand','brand'],['fType','type'],['fStars','minStars'],['fStatus','status']].forEach(([elKey,fKey])=>{
      els[elKey].addEventListener('change', function(){ filters = { ...filters, [fKey]: this.value || undefined }; loadPage(true); });
    });
    els.clearFilters.addEventListener('click', ()=>{
      filters = {};
      [els.fCountry, els.fState, els.fBrand, els.fType, els.fStars, els.fStatus].forEach(el=> el.value='');
      loadPage(true);
    });
    els.sort.addEventListener('change', function(){ sort = this.value; loadPage(true); });

    loadPage(true);

    return {
      getSelectedIds: ()=> [...selected.keys()],
      getSelectedId: ()=> [...selected.keys()][0] || null,
      setExcludeId: (id)=>{
        excludeId = id || null;
        // A property that just became excluded (e.g. it's now the Primary Property) can't
        // remain selected here — a property can't be its own competitor.
        if(excludeId && selected.has(excludeId)){
          selected.delete(excludeId);
          if(mode === 'single') renderSingleCard(); else renderSelected();
          emitChange();
        }
        populateFilterOptions();
        loadPage(true);
      }
    };
  }

  return { mount };
})();
