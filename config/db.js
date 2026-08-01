const mongoose = require("mongoose");

/**
 * Connects to MongoDB Atlas using the connection string in MONGO_URI.
 * Exits the process if the connection fails, since the app cannot
 * function without a database connection.
 */
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGO_URI, {
      // Modern mongoose (6+/8+) does not need useNewUrlParser/useUnifiedTopology,
      // but these options are harmless if present in older setups.
    });

    console.log(`✅ MongoDB Atlas connected: ${conn.connection.host}`);

    mongoose.connection.on("disconnected", () => {
      console.warn("⚠️  MongoDB disconnected. Attempting to reconnect is handled by the driver.");
    });

    mongoose.connection.on("error", (err) => {
      console.error("❌ MongoDB connection error:", err.message);
    });
  } catch (error) {
    console.error("❌ Failed to connect to MongoDB:", error.message);
    process.exit(1);
  }
};

module.exports = connectDB;
