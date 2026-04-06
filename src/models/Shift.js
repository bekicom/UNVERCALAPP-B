import mongoose from "mongoose";

const shiftSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    cashierId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    cashierUsername: { type: String, required: true, trim: true, index: true },
    shiftNumber: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ["open", "closed"], required: true, default: "open", index: true },
    openedAt: { type: Date, required: true, default: Date.now, index: true },
    closedAt: { type: Date, default: null },
    totalSalesCount: { type: Number, required: true, min: 0, default: 0 },
    totalItemsCount: { type: Number, required: true, min: 0, default: 0 },
    totalAmount: { type: Number, required: true, min: 0, default: 0 },
    totalCash: { type: Number, required: true, min: 0, default: 0 },
    totalCard: { type: Number, required: true, min: 0, default: 0 },
    totalClick: { type: Number, required: true, min: 0, default: 0 },
    totalDebt: { type: Number, required: true, min: 0, default: 0 },
    lastSaleAt: { type: Date, default: null }
  },
  { timestamps: true }
);

shiftSchema.index({ tenantId: 1, openedAt: -1 });
shiftSchema.index({ tenantId: 1, cashierId: 1, status: 1 });

export const Shift = mongoose.model("Shift", shiftSchema);
