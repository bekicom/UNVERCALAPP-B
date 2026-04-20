import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import http from "node:http";
import { initDb } from "./db.js";
import { initDisplayHub } from "./displayHub.js";
import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import supplierRoutes from "./routes/supplierRoutes.js";
import expenseRoutes from "./routes/expenseRoutes.js";
import salesRoutes from "./routes/salesRoutes.js";
import customerRoutes from "./routes/customerRoutes.js";
import masterRoutes from "./routes/masterRoutes.js";
import settingsRoutes from "./routes/settingsRoutes.js";
import shiftRoutes from "./routes/shiftRoutes.js";
import warehouseRoutes from "./routes/warehouseRoutes.js";
import { startSuperAdminBot } from "./bot/superAdminBot.js";

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 4000);
const host = String(process.env.HOST || "0.0.0.0").trim() || "0.0.0.0";
const server = http.createServer(app);

app.use(cors());
app.use(express.json({ limit: "5mb" }));

app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    host,
    port,
    localUrl: `http://127.0.0.1:${port}/api`
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/products", productRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/expenses", expenseRoutes);
app.use("/api/sales", salesRoutes);
app.use("/api/shifts", shiftRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/masters", masterRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/warehouses", warehouseRoutes);
app.use((err, _req, res, _next) => {
  console.error("Unhandled API error:", err);
  res.status(500).json({ message: "Server xatosi" });
});

initDb()
  .then(() => {
    initDisplayHub(server);
    server.listen(port, host, () => {
      console.log(`API is running on http://${host}:${port}`);
    });
    startSuperAdminBot();
  })
  .catch((err) => {
    console.error("Backend startup failed:", err);
    process.exit(1);
  });
