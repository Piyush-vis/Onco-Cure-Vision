const mongoose = require('mongoose');
const dns = require('dns');

// Force Node.js to use Google's public DNS (8.8.8.8) for all lookups.
// This bypasses OS/carrier DNS that may not support SRV records,
// which MongoDB Atlas connection strings require.
dns.setServers(['8.8.8.8', '8.8.4.4', '1.1.1.1']);

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;

