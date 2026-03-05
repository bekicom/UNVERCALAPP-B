import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { User } from "../models/User.js";

const router = Router();

router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: "Username va parol kerak" });
  }

  const user = await User.findOne({ username }).lean();

  if (!user) {
    return res.status(401).json({ message: "Login yoki parol noto'g'ri" });
  }

  const isValid = bcrypt.compareSync(password, user.passwordHash);
  if (!isValid) {
    return res.status(401).json({ message: "Login yoki parol noto'g'ri" });
  }

  const token = jwt.sign(
    { id: user._id, username: user.username, role: user.role },
    process.env.JWT_SECRET,
    { expiresIn: "12h" }
  );

  return res.json({
    token,
    user: {
      id: user._id,
      username: user.username,
      role: user.role
    }
  });
});

export default router;
