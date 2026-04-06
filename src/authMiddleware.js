import jwt from "jsonwebtoken";

const fallbackJwtSecret = "uy_dokon_local_secret_2026";

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET || fallbackJwtSecret);
    if (!payload?.tenantId) {
      return res.status(401).json({ message: "Invalid token" });
    }
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ message: "Invalid token" });
  }
}
