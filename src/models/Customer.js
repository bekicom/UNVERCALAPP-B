import mongoose from "mongoose";

const customerSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    address: { type: String, required: true, trim: true },
    totalDebt: { type: Number, required: true, min: 0, default: 0 },
    totalPaid: { type: Number, required: true, min: 0, default: 0 }
  },
  { timestamps: true }
);

customerSchema.index({ tenantId: 1, phone: 1 }, { unique: true });
customerSchema.index({ tenantId: 1, fullName: 1 });

export const Customer = mongoose.model("Customer", customerSchema);
