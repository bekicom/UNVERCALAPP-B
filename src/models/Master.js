import mongoose from "mongoose";

const masterVehicleSchema = new mongoose.Schema(
  {
    plateNumber: { type: String, required: true, trim: true },
    model: { type: String, default: "", trim: true },
    totalDebt: { type: Number, required: true, min: 0, default: 0 },
    totalPaid: { type: Number, required: true, min: 0, default: 0 },
    lastSaleAt: { type: Date, default: null }
  },
  { _id: true }
);

const masterSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    fullName: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    notes: { type: String, default: "", trim: true },
    vehicles: { type: [masterVehicleSchema], default: [] }
  },
  { timestamps: true }
);

masterSchema.index({ tenantId: 1, fullName: 1 });
masterSchema.index({ tenantId: 1, phone: 1 });
masterSchema.index({ tenantId: 1, "vehicles.plateNumber": 1 });

export const Master = mongoose.model("Master", masterSchema);
