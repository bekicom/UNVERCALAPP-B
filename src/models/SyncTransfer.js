import mongoose from "mongoose";

const syncTransferSchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Tenant", required: true, index: true },
    remoteTransferId: { type: String, required: true, trim: true },
    remoteTransferNumber: { type: String, required: true, trim: true },
    storeCode: { type: String, required: true, trim: true },
    syncedAt: { type: Date, required: true, default: Date.now },
    itemCount: { type: Number, required: true, min: 0, default: 0 }
  },
  { timestamps: true }
);

syncTransferSchema.index({ tenantId: 1, remoteTransferId: 1 }, { unique: true });

export const SyncTransfer = mongoose.model("SyncTransfer", syncTransferSchema);
