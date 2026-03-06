import mongoose from "mongoose";

const supplierSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    name: { type: String, required: true, trim: true },
    address: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true }
  },
  { timestamps: true }
);

supplierSchema.index({ tenantId: 1, name: 1 }, { unique: true });

export const Supplier = mongoose.model("Supplier", supplierSchema);
