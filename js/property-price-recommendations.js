document.addEventListener('DOMContentLoaded', ()=>{
  const me = PORTAL.mount({ title:'Pricing Recommendations', subtitle:'AI-style pricing guidance based on market movement and rate positioning.' });
  if(!me) return;
  const propertyId = PORTAL.activePropertyId(me);

  const recs = PORTALDATA.recommendations(propertyId);

  document.getElementById('recGrid').innerHTML = recs.map(r=>{
    const actionLabel = r.action==='increase' ? `Increase by ${APP.fmtCurrency(r.amount)}` : r.action==='decrease' ? `Decrease by ${APP.fmtCurrency(r.amount)}` : 'Keep Current Price';
    const icon = r.action==='increase' ? 'bi-arrow-up' : r.action==='decrease' ? 'bi-arrow-down' : 'bi-dash';
    return `<div class="col-md-6 col-xl-4">
      <div class="rec-card">
        <div class="d-flex justify-content-between align-items-start mb-2">
          <span class="rec-badge ${r.action}"><i class="bi ${icon}"></i>${actionLabel}</span>
          <span class="text-muted small">${APP.fmtDateReadable(r.date)}</span>
        </div>
        <p class="text-muted small mb-3">${r.reason}</p>
        <div class="row g-2 mb-3">
          <div class="col-6"><div class="text-muted" style="font-size:.68rem">Current Rate</div><div class="fw-semibold">${APP.fmtCurrency(r.currentRate)}</div></div>
          <div class="col-6"><div class="text-muted" style="font-size:.68rem">Expected Rate</div><div class="fw-semibold">${APP.fmtCurrency(r.expectedRate)}</div></div>
        </div>
        <div class="d-flex justify-content-between align-items-center mb-1">
          <span class="text-muted small">Confidence</span><span class="fw-semibold small">${r.confidence}%</span>
        </div>
        <div class="confidence-track mb-3"><div class="confidence-fill" style="width:${r.confidence}%"></div></div>
        <div class="d-flex gap-2 mt-3">
          <button class="btn btn-primary btn-sm flex-fill" onclick="APP.toast('Recommendation Applied','${actionLabel.replace(/'/g,"")} has been applied to your Rate Calendar (demo only).','success')">Apply</button>
          <button class="btn btn-light btn-sm flex-fill" onclick="APP.toast('Dismissed','Recommendation dismissed.','info')">Dismiss</button>
        </div>
      </div>
    </div>`;
  }).join('') || `<div class="col-12">${PWIDGETS.emptyState('bi-lightbulb','No recommendations right now','Check back soon — your pricing looks well optimized.')}</div>`;
});
