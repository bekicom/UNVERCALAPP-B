import mongoose from "mongoose";

const customerPaymentSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: "Customer", required: true },
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

customerPaymentSchema.index({ tenantId: 1, customerId: 1, paidAt: -1 });

export const CustomerPayment = mongoose.model("CustomerPayment", customerPaymentSchema);
