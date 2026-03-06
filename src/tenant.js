export function tenantFilter(req, extra = {}) {
  return { tenantId: req.user.tenantId, ...extra };
}

export function withTenant(req, doc = {}) {
  return { tenantId: req.user.tenantId, ...doc };
}
