require("dotenv").config();

const express = require("express");
const cors = require("cors");
const authRoutes = require("./routes/auth.routes");
const caktoRoutes = require("./routes/cakto.routes");

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.use("/auth", authRoutes);
app.use("/webhooks/cakto", caktoRoutes);

const port = process.env.PORT || 3333;

app.listen(port, () => {
  console.log(`API rodando na porta ${port}`);
});
