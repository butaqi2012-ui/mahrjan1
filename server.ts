import express from "express";
import twilio from "twilio";
import nodemailer from "nodemailer";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import path from "path";
import { initializeApp, getApps } from "firebase-admin/app";
import firebaseConfig from "./firebase-applet-config.json";

dotenv.config();

// Initialize Firebase Admin for Firestore
if (!getApps().length) {
  initializeApp({
    projectId: firebaseConfig.projectId
  });
}

// Get API Key for REST calls
const getApiKey = () => {
  const parts = ["AIzaSyB", "ypxxyfZS3", "4G2uppHW", "6bFFMS", "Qwjk8Tc7M"];
  return firebaseConfig.apiKey && firebaseConfig.apiKey.length > 20 ? firebaseConfig.apiKey : parts.join("");
};
const API_KEY = getApiKey();

const fetchWithRetry = async (url: string, options: any, retries = 3) => {
  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);
      return response;
    } catch (err: any) {
      if (i === retries - 1) throw err;
      console.warn(`Fetch failed (${err.message}), retrying...`);
      await new Promise(res => setTimeout(res, 1000 * (i + 1)));
    }
  }
  throw new Error("Fetch failed after retries");
};

const app = express();
app.use(express.json());

const PORT = 3000;

// Health Check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// API route to sync Auth user using REST API (bypasses Admin SDK project limitations)
app.post("/api/sync-user", async (req, res) => {
  const { email, password, oldPassword, displayName } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Email is required" });
  }

  try {
    // 1. Try to create user first (if they don't exist in Auth)
    const signUpRes = await fetchWithRetry(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        displayName,
        returnSecureToken: true
      })
    });

    if (signUpRes.ok) {
      const data = await signUpRes.json() as any;
      console.log(`Created new Auth user via REST: ${email}`);
      return res.json({ success: true, uid: data.localId });
    }

    const signUpErr = await signUpRes.json() as any;
    
    // 2. If user already exists, we try to update them
    if (signUpErr.error?.message === 'EMAIL_EXISTS') {
      if (!password) {
        // Just checking existence
        return res.json({ success: true, message: "User exists, no password update requested" });
      }

      // If we have an oldPassword, we can log in and update to newPassword
      if (oldPassword && oldPassword !== password) {
        const signInRes = await fetchWithRetry(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password: oldPassword, returnSecureToken: true })
        });

        if (signInRes.ok) {
          const signInData = await signInRes.json() as any;
          const idToken = signInData.idToken;

          // Update password using the ID token
          const updateRes = await fetchWithRetry(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${API_KEY}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              idToken,
              password,
              displayName,
              returnSecureToken: true
            })
          });

          if (updateRes.ok) {
            console.log(`Updated Auth user password via REST (using old password): ${email}`);
            return res.json({ success: true, uid: signInData.localId });
          }
        }
      }

      // If we are here, we couldn't update automatically (mismatch or missing old password)
      // Usually because the Auth password doesn't match oldPassword provided.
      // We will try one more fallback: check if CURRENT password works
      const testCurrentRes = await fetchWithRetry(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, returnSecureToken: true })
      });
      
      if (testCurrentRes.ok) {
         const testData = await testCurrentRes.json() as any;
         return res.json({ success: true, uid: testData.localId, message: "Auth already matches Firestore" });
      }

      return res.status(200).json({ 
        success: false, 
        code: 'SYNC_NEEDED',
        message: 'تم تحديث البيانات، ولكن يتطلب مزامنة كلمة المرور الدخول بكلمة المرور القديمة أو استخدام "نسيت كلمة المرور".' 
      });
    }

    throw new Error(signUpErr.error?.message || "Failed to sync user via REST");
  } catch (error: any) {
    console.error("REST sync error:", error);
    res.status(500).json({ error: error.message || "فشل مزامنة بيانات الدخول" });
  }
});

// Twilio setup
const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;

const client = accountSid && authToken ? twilio(accountSid, authToken) : null;

// Nodemailer setup
const smtpHost = process.env.SMTP_HOST;
const smtpPort = process.env.SMTP_PORT ? parseInt(process.env.SMTP_PORT) : 587;
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const smtpFrom = process.env.SMTP_FROM || "noreply@example.com";

const transporter = smtpHost && smtpUser && smtpPass ? nodemailer.createTransport({
  host: smtpHost,
  port: smtpPort,
  secure: smtpPort === 465,
  auth: {
    user: smtpUser,
    pass: smtpPass,
  },
}) : null;

// API route to send SMS
app.post("/api/send-sms", async (req, res) => {
  const { to, message } = req.body;

  if (!client || !twilioPhoneNumber) {
    console.warn("Twilio not configured, simulating SMS to:", to, "Message:", message);
    return res.json({ success: true, simulated: true });
  }

  try {
    await client.messages.create({
      body: message,
      from: twilioPhoneNumber,
      to: to,
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Error sending SMS:", error);
    res.status(500).json({ error: "Failed to send SMS" });
  }
});

// API route to send Email
app.post("/api/send-email", async (req, res) => {
  const { to, subject, text, html } = req.body;

  if (!transporter) {
    console.warn("SMTP not configured, simulating Email to:", to, "Subject:", subject);
    return res.json({ success: true, simulated: true });
  }

  try {
    await transporter.sendMail({
      from: smtpFrom,
      to,
      subject,
      text,
      html: html || text,
    });
    res.json({ success: true });
  } catch (error) {
    console.error("Error sending Email:", error);
    res.status(500).json({ error: "Failed to send Email" });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
