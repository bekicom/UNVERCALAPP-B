import mongoose from "mongoose";

const masterPaymentSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    masterId: { type: mongoose.Schema.Types.ObjectId, ref: "Master", required: true },
    vehicleId: { type: mongoose.Schema.Types.ObjectId, required: true },
    amount: { type: Number, required: true, min: 0 },
    note: { type: String, default: "", trim: true },
    cashierId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    cashierUsername: { type: String, required: true, trim: true },
    allocations: [
      {
        saleId: { type: mongoose.Schema.Types.ObjectId, ref: "Sale", required: true },
        appliedAmount: { type: Number, required: true, min: 0 }
      }
    ],
    paidAt: { type: Date, required: true, default: Date.now }
  },
  { timestamps: true }
);

masterPaymentSchema.index({ tenantId: 1, masterId: 1, vehicleId: 1, paidAt: -1 });

export const MasterPayment = mongoose.model("MasterPayment", masterPaymentSchema);
