const dns = require("dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const mongoSanitize = require("express-mongo-sanitize");

const validateEnv = require("./config/validateEnv");
const connectDB = require("./config/db");
const { errorHandler, notFound } = require("./middleware/errorMiddleware");
const { generalLimiter, authLimiter, chatLimiter, paymentLimiter, imageLimiter, uploadLimiter } = require("./middleware/Ratelimiters");

const authRoutes = require("./routes/authRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const chatRoutes = require("./routes/chatroutes");
const imageRoutes = require("./routes/imageroutes");
const uploadRoutes = require("./routes/uploadRoutes");
const conversationRoutes = require("./routes/conversationRoutes");
const memoryRoutes = require("./routes/memoryRoutes");

// 1. Validate environment variables before doing anything else
validateEnv();

// 2. Connect to MongoDB Atlas
connectDB();

const app = express();

// Render/Heroku/etc sit behind a reverse proxy — needed for rate-limit and
// req.ip to see the real client IP instead of the proxy's IP.
app.set("trust proxy", 1);

// 3. Global security + parsing middleware
app.use(helmet());
app.use(
  cors({
    origin: process.env.CLIENT_URL || "*",
    credentials: true,
    exposedHeaders: ["X-Images-Remaining", "X-Image-Limit", "X-User-Plan", "X-Conversation-Id"],
  })
);
app.use(express.json({ limit: "200kb" })); // caps request body size — blocks oversized payload abuse
app.use(express.urlencoded({ extended: true, limit: "200kb" }));
app.use(mongoSanitize()); // strips $ and . from request data to block NoSQL injection
app.use(generalLimiter);

// 4. Health check
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Genfo AI backend is running.",
    data: { timestamp: new Date().toISOString() },
  });
});

app.get("/api/health", (req, res) => {
  res.status(200).json({
    success: true,
    message: "OK",
    data: null,
  });
});

// 5. Routes
app.use("/api/auth/login", authLimiter);
app.use("/api/auth/signup", authLimiter);
app.use("/api/auth/google", authLimiter);
app.use("/api/payment", paymentLimiter);
app.use("/api/chat", chatLimiter);
app.use("/api/image", imageLimiter);
app.use("/api/upload", uploadLimiter);

app.use("/api/auth", authRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/image", imageRoutes);
app.use("/api/upload", uploadRoutes);
app.use("/api/chat/conversations", conversationRoutes);
app.use("/api/memory", memoryRoutes);

// 6. 404 + error handlers (must be last)
app.use(notFound);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Genfo AI backend running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || "development"}`);
});

// Handle unhandled promise rejections gracefully
process.on("unhandledRejection", (err) => {
  console.error("💥 Unhandled Rejection:", err.message);
});

module.exports = app;
