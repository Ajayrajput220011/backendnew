import express from "express";
import nodemailer from "nodemailer";
import cors from "cors";
import bodyParser from "body-parser";
import dotenv from "dotenv";

// ✅ Load .env variables
dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

// Store OTPs temporarily (for testing)
const otpStore = {};

// ✅ Route to send OTP
app.post("/api/send-otp", async (req, res) => {
  const { toEmail } = req.body;

  if (!toEmail) {
    return res.status(400).json({ success: false, message: "Email required" });
  }

  // Generate 6-digit OTP
  const otp = Math.floor(100000 + Math.random() * 900000);
  otpStore[toEmail] = otp;

  try {
    // Configure mail transporter
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER, // ✅ from .env
        pass: process.env.EMAIL_PASS, // ✅ from .env
      },
    });

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: toEmail,
      subject: "Your OTP Code",
      text: `Your OTP code is ${otp}`,
    };

    await transporter.sendMail(mailOptions);
    res.json({ success: true, message: "OTP sent successfully" });
  } catch (err) {
    console.error("Email send error:", err);
    res
      .status(500)
      .json({ success: false, message: "Server error while sending OTP" });
  }
});

// ✅ Route to verify OTP
app.post("/api/verify-otp", (req, res) => {
  const { toEmail, otp } = req.body;

  if (otpStore[toEmail] && otpStore[toEmail].toString() === otp.toString()) {
    delete otpStore[toEmail];
    res.json({ success: true, message: "OTP verified successfully" });
  } else {
    res.status(400).json({ success: false, message: "Invalid OTP" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
