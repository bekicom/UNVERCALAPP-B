import mongoose from "mongoose";

function normalizeTenantId(tenantId) {
  if (tenantId instanceof mongoose.Types.ObjectId) return tenantId;
  if (typeof tenantId === "string" && mongoose.Types.ObjectId.isValid(tenantId)) {
    return new mongoose.Types.ObjectId(tenantId);
  }
  return tenantId;
}

export function tenantFilter(req, extra = {}) {
  return { tenantId: normalizeTenantId(req.user.tenantId), ...extra };
}

export function withTenant(req, doc = {}) {
  return { tenantId: normalizeTenantId(req.user.tenantId), ...doc };
}
