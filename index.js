// ---------------------------
// Load environment variables
// ---------------------------
import dotenv from "dotenv";
dotenv.config();
import express from "express";
import cors from "cors";
import bodyParser from "body-parser";
import bcrypt from "bcrypt";
import Razorpay from "razorpay";
import nodemailer from "nodemailer";
import pkg from "pg";

const { Pool } = pkg;
const app = express();

// ---------------------------
// Middleware
// ---------------------------
app.use(cors());
app.use(express.json());
app.use(bodyParser.json());

// ---------------------------
// PostgreSQL Connection
// ---------------------------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    require: true,
    rejectUnauthorized: false,
  },
  keepAlive: true,
  connectionTimeoutMillis: 10000,
});

// Test database connection
(async () => {
  try {
    const client = await pool.connect();
    console.log("✅ Connected to PostgreSQL successfully!");
    client.release();
  } catch (err) {
    console.error("❌ PostgreSQL connection error:", err.message);
  }
})();
// ---------------------------
// Razorpay Setup
// ---------------------------
const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET,
});

// ---------------------------
// Payment Order
// ---------------------------
app.post("/api/payment/orders", async (req, res) => {
  const { amount, currency } = req.body;
  try {
    const options = {
      amount: amount * 100,
      currency: currency || "INR",
      receipt: `receipt_${Date.now()}`,
    };
    const order = await razorpay.orders.create(options);
    res.status(200).json(order);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
// ---------------------------
// POST: Save a new contact message
// ---------------------------
app.post("/api/contacts", async (req, res) => {
  const { firstName, lastName, email, message } = req.body;

  if (!firstName || !lastName || !email || !message) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    await pool.query(
      "INSERT INTO contacts (first_name, last_name, email, message) VALUES ($1, $2, $3, $4)",
      [firstName, lastName, email, message]
    );
    res.status(200).json({ message: "Message saved successfully!" });
  } catch (err) {
    console.error("Database error:", err);
    res.status(500).json({ message: "Database error. Please try again later." });
  }
});

// ---------------------------
// GET: Fetch all contact messages
// ---------------------------
app.get("/api/contacts", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, first_name, last_name, email, message, created_at FROM contacts ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Database fetch error:", err);
    res.status(500).json({ message: "Database fetch error. Please try again later." });
  }
});

// ---------------------------
// DELETE: Remove a specific contact message by ID
// ---------------------------
app.delete("/api/contacts/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("DELETE FROM contacts WHERE id = $1", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Contact not found." });
    }

    res.status(200).json({ message: "Contact deleted successfully!" });
  } catch (err) {
    console.error("Database delete error:", err);
    res.status(500).json({ message: "Database delete error. Please try again later." });
  }
});

app.post("/api/subscribe", async (req, res) => {
  const { email } = req.body;

  // Basic validation
  if (!email || !email.includes("@")) {
    return res.status(400).json({ message: "Valid email is required." });
  }

  try {
    // Check if email already exists
    const existing = await pool.query("SELECT id FROM subscribers WHERE email = $1", [email]);

    if (existing.rows.length > 0) {
      return res.status(400).json({ message: "Email already subscribed." });
    }

    // Insert new subscriber
    await pool.query("INSERT INTO subscribers (email) VALUES ($1)", [email]);

    return res.status(201).json({ message: "Subscribed successfully!" });
  } catch (error) {
    console.error("❌ Error inserting  subscribers:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

// ✅ GET: Fetch all subscribers
app.get("/api/subscribe", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM  subscribers ORDER BY id DESC");
    return res.status(200).json(result.rows);
  } catch (error) {
    console.error("❌ Error fetching subscribers:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

// ✅ DELETE: Remove a subscriber by ID
app.delete("/api/subscribe/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("DELETE FROM subscribers WHERE id = $1 RETURNING *", [id]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Subscriber not found." });
    }

    return res.json({ message: "Subscriber deleted successfully." });
  } catch (error) {
    console.error("❌ Error deleting subscriber:", error);
    return res.status(500).json({ message: "Internal server error." });
  }
});

// ✅ Get all users1
app.get("/api/users1", async (req, res) => {
  const sql = `
    SELECT id, email, first_name, last_name, phone, address, pincode, 
           account_number, ifsc_code, created_at
    FROM users1
  `;
  try {
    const result = await pool.query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ Delete user1 by ID
app.delete("/api/users1/:id", async (req, res) => {
  const { id } = req.params;
  const sql = "DELETE FROM users1 WHERE id = $1";
  try {
    const result = await pool.query(sql, [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("DB Error:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// OTP Send + Verify
// ---------------------------

const otpStore = {};

// ✅ Email transporter (Gmail)
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

// ✅ Generate 6-digit OTP
const generateOtp = () => Math.floor(100000 + Math.random() * 900000).toString();

// ✅ Send OTP
app.post("/send-otp", async (req, res) => {
  const { toEmail } = req.body;
  if (!toEmail)
    return res.status(400).json({ success: false, message: "Email required" });

  const otp = generateOtp();
  otpStore[toEmail] = { otp, verified: false };

  try {
    await transporter.sendMail({
      from: process.env.EMAIL_USER,
      to: toEmail,
      subject: "Password Reset OTP",
      text: `Your OTP for password reset is ${otp}. It will expire in 5 minutes.`,
    });

    console.log(`✅ OTP sent to ${toEmail}: ${otp}`);
    res.json({ success: true, message: "OTP sent successfully" });

    // Expire OTP after 5 minutes
    setTimeout(() => delete otpStore[toEmail], 5 * 60 * 1000);
  } catch (err) {
    console.error("❌ Error sending email:", err);
    res.status(500).json({ success: false, message: "Failed to send OTP" });
  }
});

// ✅ Verify OTP
app.post("/verify-otp", (req, res) => {
  const { email, otp } = req.body;
  const storedOtp = otpStore[email]?.otp;

  if (storedOtp && storedOtp === otp) {
    otpStore[email].verified = true;
    return res.json({ success: true, message: "OTP verified" });
  } else {
    return res.json({ success: false, message: "Invalid or expired OTP" });
  }
});

// ✅ Change Password
app.post("/change-password", async (req, res) => {
  const { email, password } = req.body;
  const userOtp = otpStore[email];

  if (!userOtp || !userOtp.verified) {
    return res
      .status(401)
      .json({ success: false, message: "OTP not verified or expired" });
  }

  try {
    const hashedPassword = await bcrypt.hash(password, 10);

    const query = "UPDATE users SET password = $1 WHERE email = $2";
    const result = await pool.query(query, [hashedPassword, email]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    delete otpStore[email];
    res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    console.error("❌ Password update error:", err);
    res.status(500).json({ success: false, message: "Database update failed" });
  }
});


app.post("/api/signup", async (req, res) => {
  const { firstName, lastName, email, phone, address, password } = req.body;

  try {
    const checkUser = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (checkUser.rows.length > 0) {
      return res.status(400).json({ message: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    await pool.query(
      `INSERT INTO users (first_name, last_name, email, phone, address, password)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [firstName, lastName, email, phone, address, hashedPassword]
    );

    // Fetch all users
    const result = await pool.query(
      "SELECT id, first_name, last_name, email, phone, address FROM users"
    );

    res.status(200).json({
      message: "User registered successfully",
      users: result.rows,
    });
  } catch (err) {
    console.error("Signup Error:", err);
    res.status(500).json({ message: "Signup failed", error: err.message });
  }
});

// ============================================================
// ✅ LOGIN ROUTE
// ============================================================
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const allUsers = await pool.query(
      "SELECT id, first_name, last_name, email, phone, address FROM users"
    );

    res.status(200).json({
      message: "Login successful",
      loggedInUser: {
        id: user.id,
        name: `${user.first_name} ${user.last_name}`,
        email: user.email,
        phone: user.phone,
        address: user.address,
      },
      users: allUsers.rows,
    });
  } catch (err) {
    console.error("Login Error:", err);
    res.status(500).json({ message: "Login failed", error: err.message });
  }
});

// ============================================================
// ✅ GET ALL USERS (Data bhar aane ke liye)
// ============================================================
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, first_name, last_name, email, phone, address FROM users"
    );
    res.status(200).json(result.rows);
  } catch (err) {
    console.error("Fetch Users Error:", err);
    res.status(500).json({ message: "Failed to fetch users", error: err.message });
  }
});

// ============================================================
// ✅ CHANGE PASSWORD ROUTE (Password change hone chiye)
// ============================================================
app.put("/api/change-password", async (req, res) => {
  const { email, oldPassword, newPassword } = req.body;

  try {
    // Check if user exists
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const user = result.rows[0];

    // Compare old password
    const match = await bcrypt.compare(oldPassword, user.password);
    if (!match) {
      return res.status(401).json({ message: "Old password is incorrect" });
    }

    // Hash new password
    const hashedNewPassword = await bcrypt.hash(newPassword, 10);

    // Update password in database
    await pool.query("UPDATE users SET password = $1 WHERE email = $2", [
      hashedNewPassword,
      email,
    ]);

    res.status(200).json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Change Password Error:", err);
    res.status(500).json({ message: "Failed to change password", error: err.message });
  }
});

app.post("/api/change-password", async (req, res) => {
  const { email, newPassword, confirmPassword } = req.body;

  if (!email || !newPassword || !confirmPassword) {
    return res.status(400).json({ message: "All fields are required" });
  }

  if (newPassword !== confirmPassword) {
    return res.status(400).json({ message: "Passwords do not match" });
  }

  try {
    // Check if user exists
    const userResult = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password
    await pool.query("UPDATE users SET password = $1 WHERE email = $2", [hashedPassword, email]);

    res.status(200).json({ message: "Password updated successfully" });
  } catch (err) {
    console.error("Change Password Error:", err);
    res.status(500).json({ message: "Password change failed", error: err.message });
  }
});

// ✅ Fetch all users (for admin/testing)
app.get("/api/users", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, first_name, last_name, email, phone, address FROM users"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Fetch Users Error:", err);
    res.status(500).json({ message: "Failed to fetch users" });
  }
});

app.delete("/api/users/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query("DELETE FROM users WHERE id = $1 RETURNING *", [id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({ message: "User deleted successfully" });
  } catch (err) {
    console.error("Delete User Error:", err);
    res.status(500).json({ message: "Failed to delete user", error: err.message });
  }
});




app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      "SELECT * FROM admins WHERE email = $1 AND password = $2",
      [email, password]
    );

    if (result.rows.length > 0) {
      res.json({ success: true, admin: result.rows[0] });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error("DB error:", err);
    res.status(500).json({ success: false });
  }
});


app.post("/api/admin/login", async (req, res) => {
  const { email, password } = req.body;

  try {
    const result = await pool.query("SELECT * FROM admins WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(400).json({ success: false, message: "Admin not found" });
    }

    const admin = result.rows[0];
    const match = await bcrypt.compare(password, admin.password);

    if (!match) {
      return res.status(401).json({ success: false, message: "Invalid password" });
    }

    res.json({ success: true, admin });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

// ✅ Fetch all admins
app.get("/api/admins", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, email, password FROM admins ORDER BY id ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching admins:", err);
    res.status(500).json({ message: "Database error" });
  }
});

// ✅ Delete admin by ID
app.delete("/api/admins/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM admins WHERE id = $1", [id]);
    res.json({ success: true, message: "Admin deleted successfully" });
  } catch (err) {
    console.error("Delete error:", err);
    res.status(500).json({ success: false, message: "Database error" });
  }
});

// ✅ Add new admin (optional utility)
app.post("/api/admins", async (req, res) => {
  const { email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      "INSERT INTO admins (email, password) VALUES ($1, $2) RETURNING *",
      [email, hashedPassword]
    );
    res.json({ success: true, admin: result.rows[0] });
  } catch (err) {
    console.error("Add admin error:", err);
    res.status(500).json({ success: false, message: "Database error" });
  }
});



app.post("/api/orders1", async (req, res) => {
  try {
    const {
      first_name,
      last_name,
      email,
      phone,
      address,
      pincode,
      subtotal,
      shipping,
      tax,
      total,
      payment_method,
      payment_status,
      payment_id,
      cart,
      name,
      price,
      description,
      category,
      image,
    } = req.body;

    // ✅ Insert into main orders table
    const orderResult = await pool.query(
      `INSERT INTO orders1 
       (first_name, last_name, email, phone, address, pincode, subtotal, shipping, tax, total, 
        payment_method, payment_status, payment_id, name, price, description, category, image)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING id`,
      [
        first_name,
        last_name,
        email,
        phone,
        address,
        pincode,
        subtotal,
        shipping,
        tax,
        total,
        payment_method,
        payment_status,
        payment_id,
        name,
        price,
        description,
        category,
        image,
      ]
    );

    const orderId = orderResult.rows[0].id;

    // ✅ Insert each cart item
    if (Array.isArray(cart) && cart.length > 0) {
      for (const item of cart) {
        await pool.query(
          `INSERT INTO order_items (order_id, item_id, name, qty, price, image_url)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            orderId,
            item.id || null,
            item.name,
            item.qty || 1,
            parseFloat(item.Price1.replace(/[₹,]/g, "")),
            item.images?.[0] || "",
          ]
        );
      }
    }

    res.json({ success: true, message: "✅ Order saved successfully!" });
  } catch (error) {
    console.error("❌ Order Save Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

// ✅ API: Get All Orders with their Items
app.get("/api/orders1", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT o.*, 
        COALESCE(json_agg(oi.*) FILTER (WHERE oi.id IS NOT NULL), '[]') AS items
      FROM orders1 o
      LEFT JOIN order_items oi ON o.id = oi.order_id
      GROUP BY o.id
      ORDER BY o.id ASC
    `);

    res.json({ success: true, orders: result.rows });
  } catch (error) {
    console.error("❌ Fetch Orders Error:", error);
    res.status(500).json({ success: false, message: "Server Error" });
  }
});

app.get("/api/orders1", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM orders1 ORDER BY id DESC");
    res.json(result.rows); // for PostgreSQL
    // or if using MySQL:
    // res.json(result);
  } catch (error) {
    console.error("❌ Error fetching orders:", error);
    res.status(500).json({ message: "Error fetching orders" });
  }
});


// DELETE order and its items
app.delete("/api/orders1/:id", async (req, res) => {
  const { id } = req.params;

  try {
    await pool.query("DELETE FROM order_items WHERE order_id = $1", [id]);
    await pool.query("DELETE FROM orders1 WHERE id = $1", [id]);
    res.json({ success: true, message: "Order deleted successfully" });
  } catch (error) {
    console.error("Error deleting order:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
});


// -------------------------------
// Update Order Status API
// -------------------------------
app.put("/api/orders1/:id/status", async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const result = await pool.query(
      "UPDATE orders1 SET order_status = $1 WHERE id = $2 RETURNING *",
      [status, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Order not found" });
    }

    res.json({ success: true, message: "Order status updated", order: result.rows[0] });
  } catch (error) {
    console.error("Error updating order status:", error);
    res.status(500).json({ success: false, message: "Database error" });
  }
});


app.get("/api/user-orders/:email", async (req, res) => {
  const { email } = req.params;

  try {
    // Fetch all users
    const usersResult = await pool.query("SELECT * FROM users");

    // Fetch orders by email
    const ordersResult = await pool.query(
      "SELECT * FROM orders1 WHERE email = $1 ORDER BY id DESC",
      [email]
    );

    const orders = [];

    for (const order of ordersResult.rows) {
      // Fetch related order items
      const itemsResult = await pool.query(
        "SELECT * FROM order_items WHERE order_id = $1",
        [order.id]
      );

      orders.push({
        ...order,
        items: itemsResult.rows,
      });
    }

    res.json({
      users: usersResult.rows,
      orders,
    });
  } catch (err) {
    console.error("Error fetching data:", err);
    res.status(500).json({ error: "Server error" });
  }
});











// ---------------------------
// Server Start
// ---------------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () =>
  console.log(`✅ Server running at http://localhost:${PORT}`)
);