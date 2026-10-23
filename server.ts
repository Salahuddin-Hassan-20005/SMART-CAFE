import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { createRequire } from "module";
import Groq from "groq-sdk";
import dotenv from "dotenv";
import cors from "cors";
import admin from "firebase-admin";

const require = createRequire(import.meta.url);
dotenv.config({ override: true });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Firebase Admin SDK
try {
  admin.app();
} catch (error) {
  try {
    const serviceAccountPath =
      process.env.FIREBASE_ADMIN_SDK_PATH || "./firebase-admin-sdk.json";
    const serviceAccount = require(serviceAccountPath);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  } catch (initError: any) {
    console.warn(
      "Firebase Admin SDK initialization failed. Admin features will be disabled.",
    );
  }
}

/**
 * Middleware to verify admin custom claims in Firebase ID token
 */
async function verifyAdminToken(req: any, res: any, next: any) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res
      .status(401)
      .json({ error: "Missing or invalid authorization header" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decodedToken = await Promise.race([
      admin.auth().verifyIdToken(token),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Token verification timeout")), 5000),
      ),
    ]);

    if ((decodedToken as any).admin !== true) {
      return res.status(403).json({ error: "Admin privileges required" });
    }

    req.user = decodedToken;
    next();
  } catch (error: any) {
    console.error("Token verification error:", error.message);
    res
      .status(401)
      .json({ error: error.message || "Invalid or expired token" });
  }
}

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Request logging middleware
  app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
  });

  app.use(cors());
  app.use(express.json());

  // Initialize Groq Client
  const groqApiKey = process.env.GROQ_API_KEY;
  const groq = new Groq({ apiKey: groqApiKey || "" });

  // API Routes
  app.post("/api/chat", async (req, res) => {
    const {
      message,
      menuType = "cafe",
      cartItems = [],
      history = [],
    } = req.body;

    try {
      const isWine = menuType === "wine";

      // Fetch live inventory from Firestore
      let activeMenu: any[] = [];
      if (isWine) {
        const winesSnapshot = await admin.firestore().collection("wines").get();
        activeMenu = winesSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
          price: doc.data().price_glass || doc.data().price_bottle || 0,
          category: "Wine",
          description: doc.data().tasting_notes,
        }));
      } else {
        const menuSnapshot = await admin
          .firestore()
          .collection("menu_items")
          .where("is_available", "==", true)
          .get();
        activeMenu = menuSnapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }));
      }

      // Calculate alcohol limit
      const alcoholCount = cartItems
        .filter((item: any) =>
          activeMenu.some((w) => w.id === item.id && w.category === "Wine"),
        )
        .reduce((sum: number, item: any) => sum + (item.quantity || 1), 0);

      const overLimit = alcoholCount >= 3;

      let systemInstruction = "";

      if (isWine) {
        systemInstruction = `You are an expert, sophisticated Sommelier for Smart Cafe. 
Help the user find the perfect wine. Provide nuanced recommendations considering user preferences like region, grape varietal, and food pairings. Answer follow-up questions about specific wines on our list.

CRITICAL RULES:
1. NEVER mention the ID numbers of the items in your text response. Just use their names.
2. You MUST only output valid JSON. 
3. When you recommend items, you MUST explicitly prompt the user to buy them (e.g., "I highly recommend adding this to your ritual today. Shall I prepare it for you?").
4. You CANNOT place orders for the user. You can ONLY recommend items. If a user asks you to place an order, politely inform them that they can add items to their cart using the 'Add to Ritual' button next to the recommendations.
5. You CANNOT recommend anything other than wine if the users ask for desserts or food you can politely tell them to use the food/coffee menu
6. If a user asks for a wine that is not on the list, politely inform them of our current selection and suggest the closest alternative.

--- CRITICAL SYSTEM OVERRIDE ---
The following is the ONLY live wine inventory you are allowed to recommend from. Do NOT invent wines that are not on this list. This data is fetched in real-time from our database:
LIVE WINE INVENTORY: ${JSON.stringify(activeMenu.map((i) => ({ id: i.id, name: i.name, type: i.type, region: i.region, price_bottle: i.price_bottle, price_glass: i.price_glass, tasting_notes: i.tasting_notes })))}

Use this exact schema: 
{"text": "Your helpful response message here", "recommended_item_ids": ["w1", "w2", "w3"]} 
Only recommend items that exist in the LIVE WINE INVENTORY above.`;

        if (overLimit) {
          systemInstruction += `\n\nCRITICAL SAFETY RULE: The user has already ordered ${alcoholCount} alcoholic drinks. This is the maximum safe limit. You MUST politely but firmly refuse to recommend or serve any more alcohol. Suggest water or that they enjoy their current selections. Do NOT return any recommended_item_ids.`;
        } else {
          systemInstruction += `\n\nThe user currently has ${alcoholCount} alcoholic drinks in their cart. You may recommend wine, but do not recommend exceeding a total of 3 alcoholic drinks.`;
        }
      } else {
        systemInstruction = `You are a helpful and responsible AI ordering assistant for Smart Cafe. 
Help the user find the perfect food or drink. 

CRITICAL RULES:
1. NEVER mention the ID numbers of the items in your text response. Just use their names.
2. Promote safe and healthy consumption. If a user asks for an extreme or dangerous amount of caffeine (e.g., more than 4 espresso shots or equivalent) or food, you MUST politely decline. Provide a clear warning about the health risks of excessive caffeine intake (e.g., jitters, increased heart rate), and suggest a safer, reasonable alternative from the menu (like decaf, herbal tea, or a single standard coffee).
3. You CANNOT place orders for the user. You can ONLY recommend items. If a user asks you to place an order, politely inform them that they can add items to their cart using the 'Add to Cart' or 'Customize' buttons.
4. You MUST only output valid JSON. 
5. You CANNOT recommend anything other than food, drinks or desserts if the users ask for wines you can politely tell them to use the wine menu
6. If a user asks for an item that is not on the list, politely inform them of our current selection and suggest the closest alternative.
7. You MUST NEVER recommend items that are not on the live menu.
8. If a user asks questions related to anything other than food, drinks or desserts, you MUST politely inform them that you are only responsible for food, drinks or desserts and that you would like to stick to your role (The friendly assistant)
--- CRITICAL SYSTEM OVERRIDE ---
The following is the ONLY live menu you are allowed to recommend from. Do NOT invent items that are not on this list. This data is fetched in real-time from our database and only includes AVAILABLE items:
LIVE MENU INVENTORY: ${JSON.stringify(activeMenu.map((i) => ({ id: i.id, name: i.name, category: i.category, price: i.price, description: i.description })))}

Use this exact schema: 
{"text": "Your helpful response message here", "recommended_item_ids": ["1", "2", "3"]} 
Only recommend items that exist in the LIVE MENU INVENTORY above.`;
      }

      const formattedHistory = history.map((msg: any) => ({
        role: msg.role === "user" ? "user" : "assistant",
        content: msg.content,
      }));

      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: systemInstruction },
          ...formattedHistory,
          { role: "user", content: message },
        ],
        model: "llama-3.1-8b-instant",
        temperature: 0.7,
        response_format: { type: "json_object" },
      });

      const rawText = chatCompletion.choices[0]?.message?.content || "{}";

      try {
        const aiData = JSON.parse(rawText);
        const recommendedIds = aiData.recommended_item_ids || [];
        const hydratedItems = activeMenu.filter((item) =>
          recommendedIds.map(String).includes(String(item.id)),
        );

        res.json({
          text: aiData.text || "Here are some recommendations:",
          items: hydratedItems,
          recommendedIds: recommendedIds,
        });
      } catch (parseError) {
        console.error("JSON Parse Error:", rawText);
        res.json({ text: rawText, items: [] });
      }
    } catch (error: any) {
      console.error("Groq Error:", error);
      res.status(500).json({
        text: "I'm having trouble thinking right now. Please check if your API key is valid.",
        items: [],
        error: error.message,
      });
    }
  });

  // Admin Insights API
  app.post("/api/insights", async (req, res) => {
    const { orders = [], menuItems = [] } = req.body;

    try {
      const systemInstruction = `You are an expert restaurant manager AI analyzing data for Smart Cafe.
Analyze the provided orders and menu items to generate a concise, actionable insight for the restaurant admin.
Return a JSON object with exactly these three keys:
- "sentiment": A single word describing overall customer sentiment (e.g., "Positive", "Excellent", "Mixed").
- "peakTime": A string representing the busiest time (e.g., "10:45 AM", "1:30 PM").
- "insight": A 1-2 sentence actionable insight or observation based on the data.

Orders data: ${JSON.stringify(orders.slice(0, 20))}
Menu items data: ${JSON.stringify(menuItems.map((i) => ({ name: i.name, category: i.category, price: i.price })))}`;

      const chatCompletion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: "Generate admin insights." },
        ],
        model: "llama-3.1-8b-instant",
        temperature: 0.7,
        response_format: { type: "json_object" },
      });

      const rawText = chatCompletion.choices[0]?.message?.content || "{}";

      try {
        const aiData = JSON.parse(rawText);
        res.json({
          sentiment: aiData.sentiment || "Positive",
          peakTime: aiData.peakTime || "10:45 AM",
          insight: aiData.insight || "No insights available.",
        });
      } catch (parseError) {
        console.error("JSON Parse Error:", rawText);
        res.json({
          sentiment: "Positive",
          peakTime: "10:45 AM",
          insight: "Customers are satisfied with current offerings.",
        });
      }
    } catch (error: any) {
      console.error("Groq Error:", error);
      res.status(500).json({
        sentiment: "Positive",
        peakTime: "10:45 AM",
        insight: "Unable to generate insights. Please check API key.",
        error: error.message,
      });
    }
  });

  /**
   * Endpoint to add a new menu item (Admin Only)
   */
  app.post("/api/menu", verifyAdminToken, async (req, res) => {
    try {
      const {
        name,
        price,
        category,
        image_url,
        customizations = [],
        description = "",
        is_available = true,
      } = req.body;

      if (!name || !price || !category)
        return res.status(400).json({ error: "Missing required fields" });

      const newItem = {
        name,
        price: parseFloat(price),
        category,
        image_url: image_url || "",
        customizations: customizations.map((c: any) => ({
          name: c.name,
          extra_price: parseFloat(c.extra_price || 0),
        })),
        description,
        is_active: true,
        is_available,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = await admin
        .firestore()
        .collection("menu_items")
        .add(newItem);
      res.json({ success: true, id: docRef.id });
    } catch (error: any) {
      console.error("Error adding menu item:", error);
      res
        .status(500)
        .json({ error: "Failed to add menu item", details: error.message });
    }
  });

  /**
   * Public endpoint to fetch all available wines (Customer-facing)
   */
  app.get("/api/wines", async (req, res) => {
    try {
      const winesSnapshot = await admin.firestore().collection("wines").get();

      const wines = winesSnapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));

      // Filter out sold_out wines for customer view
      const availableWines = wines.filter(
        (wine: any) => wine.stock_status !== "sold_out",
      );

      return res.status(200).json({ wines: availableWines });
    } catch (error: any) {
      console.error("Error fetching wines:", error);
      return res.status(500).json({ error: "Failed to fetch wines" });
    }
  });

  /**
   * Endpoint to add a new wine (Admin Only)
   */
  app.post("/api/wines", verifyAdminToken, async (req, res) => {
    try {
      const {
        name,
        type,
        region,
        price_bottle,
        price_glass,
        stock_status,
        tasting_notes,
        image_url,
        vintage,
      } = req.body;

      if (!name || !price_bottle)
        return res.status(400).json({ error: "Missing required fields" });

      const newWine = {
        name,
        type,
        region,
        vintage: vintage || "",
        price_bottle,
        price_glass,
        stock_status,
        tasting_notes,
        image_url,
        created_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      const docRef = await admin.firestore().collection("wines").add(newWine);
      res.json({ success: true, id: docRef.id });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: "Failed to add wine", details: error.message });
    }
  });

  /**
   * Endpoint to update a menu item (Admin Only)
   */
  app.patch("/api/menu/:id", verifyAdminToken, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Remove undefined values
      Object.keys(updates).forEach(
        (key) => updates[key] === undefined && delete updates[key],
      );

      await admin.firestore().collection("menu_items").doc(id).update(updates);
      res.json({ success: true });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: "Failed to update menu item", details: error.message });
    }
  });

  /**
   * Endpoint to delete a menu item (Admin Only - Hard Delete)
   */
  app.delete("/api/menu/:id", verifyAdminToken, async (req, res) => {
    try {
      const { id } = req.params;

      // Hard delete - permanently remove from database
      await admin.firestore().collection("menu_items").doc(id).delete();

      res.json({ success: true });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: "Failed to delete menu item", details: error.message });
    }
  });

  /**
   * Endpoint to update a wine (Admin Only)
   */
  app.patch("/api/wines/:id", verifyAdminToken, async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;

      // Remove undefined values
      Object.keys(updates).forEach(
        (key) => updates[key] === undefined && delete updates[key],
      );

      await admin.firestore().collection("wines").doc(id).update(updates);
      res.json({ success: true });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: "Failed to update wine", details: error.message });
    }
  });

  /**
   * Endpoint to delete a wine (Admin Only)
   */
  app.delete("/api/wines/:id", verifyAdminToken, async (req, res) => {
    try {
      const { id } = req.params;

      await admin.firestore().collection("wines").doc(id).delete();
      res.json({ success: true });
    } catch (error: any) {
      res
        .status(500)
        .json({ error: "Failed to delete wine", details: error.message });
    }
  });

  /**
   * Endpoint to sync Google Auth user with staff whitelist
   */
  app.post("/api/auth/sync-staff", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Authorization token required" });
      }

      const token = authHeader.split("Bearer ")[1];

      const decodedToken = await admin.auth().verifyIdToken(token);
      const userEmail = decodedToken.email?.toLowerCase();
      const uid = decodedToken.uid;

      if (!userEmail) {
        return res.status(400).json({ error: "Email not found in token" });
      }

      const staffSnapshot = await admin
        .firestore()
        .collection("staff")
        .where("email", "==", userEmail)
        .get();

      if (staffSnapshot.empty) {
        return res.status(404).json({
          error:
            "No staff record found. Contact admin to be added to the whitelist.",
          isStaff: false,
        });
      }

      const staffDoc = staffSnapshot.docs[0];
      const staffData = staffDoc.data();
      const systemRole = staffData.system_role;

      await admin
        .firestore()
        .collection("staff")
        .doc(staffDoc.id)
        .update({
          uid: uid,
          photo_url: decodedToken.picture || "",
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });

      await admin.auth().setCustomUserClaims(uid, {
        [systemRole]: true,
        staff: true,
      });

      res.json({
        success: true,
        isStaff: true,
        system_role: systemRole,
        display_role: staffData.display_role,
        message: "Staff account activated successfully",
      });
    } catch (error: any) {
      console.error("[SYNC-STAFF] Error:", error);

      if (error.code === "auth/invalid-id-token") {
        return res.status(401).json({ error: "Invalid authentication token" });
      }

      res.status(500).json({
        error: "Failed to sync staff account",
        details: error.message,
      });
    }
  });

  /**
   * Endpoint to add staff member to whitelist (Admin only)
   */
  app.post("/api/admin/staff", verifyAdminToken, async (req, res) => {
    try {
      const { email, display_role, system_role } = req.body;

      if (!email || !display_role || !system_role) {
        return res.status(400).json({
          error: "All fields are required: email, display_role, system_role",
        });
      }

      // Validate system_role
      if (!["admin", "kitchen"].includes(system_role)) {
        return res.status(400).json({
          error: "system_role must be either 'admin' or 'kitchen'",
        });
      }

      // Check if staff member already exists
      const existingStaff = await admin
        .firestore()
        .collection("staff")
        .where("email", "==", email.toLowerCase())
        .get();

      if (!existingStaff.empty) {
        return res.status(409).json({
          error: "A staff member with this email already exists",
        });
      }

      // Create pending staff document with uid: null (will be set on first Google login)
      const staffRef = await admin.firestore().collection("staff").add({
        email: email.toLowerCase(),
        display_role,
        system_role,
        is_on_duty: false,
        photo_url: "",
        uid: null, // Will be populated when they sign in with Google
        created_at: admin.firestore.FieldValue.serverTimestamp(),
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      res.status(201).json({
        success: true,
        id: staffRef.id,
        message:
          "Staff member added to whitelist. They must sign in with Google to activate their account.",
      });
    } catch (error: any) {
      console.error("Error adding staff to whitelist:", error);

      res.status(500).json({
        error: "Failed to add staff member to whitelist",
        details: error.message,
      });
    }
  });

  /**
   * Endpoint to promote a user to admin/kitchen role
   */
  app.post("/api/admin/promote", verifyAdminToken, async (req, res) => {
    try {
      const { email, system_role, display_role } = req.body;

      if (!email || !system_role) {
        return res
          .status(400)
          .json({ error: "Email and system_role are required" });
      }

      // Find user by email in users collection
      const usersSnapshot = await admin
        .firestore()
        .collection("users")
        .where("email", "==", email)
        .get();

      if (usersSnapshot.empty) {
        return res.status(404).json({ error: "User not found" });
      }

      const userDoc = usersSnapshot.docs[0];
      const userId = userDoc.id;

      // Update Firestore document
      await admin
        .firestore()
        .collection("users")
        .doc(userId)
        .update({
          system_role,
          display_role: display_role || system_role,
          updated_at: admin.firestore.FieldValue.serverTimestamp(),
        });

      // Update Firebase Auth custom claims
      await admin.auth().setCustomUserClaims(userId, {
        [system_role]: true,
      });

      res.json({
        success: true,
        message: `User ${email} promoted to ${system_role}`,
      });
    } catch (error: any) {
      console.error("Error promoting user:", error);
      res
        .status(500)
        .json({ error: "Failed to promote user", details: error.message });
    }
  });

  /**
   * Endpoint to update staff role
   */
  app.patch("/api/admin/staff/role", verifyAdminToken, async (req, res) => {
    try {
      const { uid, system_role } = req.body;

      if (!uid || !system_role) {
        return res
          .status(400)
          .json({ error: "uid and system_role are required" });
      }

      // Update Firestore document
      await admin.firestore().collection("users").doc(uid).update({
        system_role,
        updated_at: admin.firestore.FieldValue.serverTimestamp(),
      });

      // Update Firebase Auth custom claims
      await admin.auth().setCustomUserClaims(uid, {
        [system_role]: true,
      });

      res.json({ success: true });
    } catch (error: any) {
      console.error("Error updating staff role:", error);
      res
        .status(500)
        .json({ error: "Failed to update role", details: error.message });
    }
  });

  /**
   * Endpoint to remove staff member
   */
  app.delete("/api/admin/staff/:docId", verifyAdminToken, async (req, res) => {
    try {
      const { docId } = req.params;

      // Enforce Owner Immunity: Prevents privilege escalation where administrative users could disable the root account
      const staffRef = admin.firestore().collection("staff").doc(docId);
      const doc = await staffRef.get();

      if (!doc.exists) {
        return res.status(404).json({ error: "Staff member not found" });
      }

      const staffData = doc.data();
      const uid = staffData?.uid;

      // If we have a UID, fetch the Firebase Auth user and check for Owner immunity
      if (uid) {
        try {
          const userRecord = await admin.auth().getUser(uid);
          const OWNER_EMAIL = process.env.OWNER_EMAIL;

          if (!OWNER_EMAIL) {
            console.warn(
              `[SECURITY WARNING] OWNER_EMAIL environment variable is not set on the server!`,
            );
          } else if (userRecord.email === OWNER_EMAIL) {
            console.error(
              `[SECURITY] Mutiny attempt! Someone tried to delete the Owner: ${uid}`,
            );
            return res
              .status(403)
              .json({ error: "Access Denied: The Owner cannot be removed." });
          }
        } catch (authError: any) {
          // User might not exist in Auth yet (whitelist-only), continue with deletion
          console.warn(
            `[DELETE-STAFF] Could not verify Auth user for Owner immunity check: ${authError.message}`,
          );
        }
      }

      // Try to disable the Firebase Auth user if uid exists
      if (uid) {
        try {
          await admin.auth().updateUser(uid, { disabled: true });
        } catch (authError: any) {
          // User might not exist in Auth yet (whitelist-only), that's okay
          console.warn(
            `[DELETE-STAFF] Could not disable Auth user (may not exist): ${authError.message}`,
          );
        }
      }

      // Unconditionally delete the Firestore document
      await staffRef.delete();

      res.json({
        success: true,
        message: "Staff member removed successfully",
      });
    } catch (error: any) {
      console.error("[DELETE-STAFF] Error removing staff:", error);
      res
        .status(500)
        .json({ error: "Failed to remove staff", details: error.message });
    }
  });

  /**
   * GET /api/customer/ritual - Context-Aware Ritual Engine
   * Returns personalized item recommendations based on time-of-day and user's order history
   * Uses fast algorithm (no LLM) for millisecond response times
   */
  app.get("/api/customer/ritual", async (req, res) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res
          .status(401)
          .json({ error: "Missing or invalid authorization header" });
      }

      const token = authHeader.split(" ")[1];

      // Verify the customer's Firebase ID token
      let decodedToken;
      try {
        decodedToken = await admin.auth().verifyIdToken(token);
      } catch (tokenError: any) {
        console.error(
          "[RITUAL] Token verification failed:",
          tokenError.message,
        );
        return res.status(401).json({ error: "Invalid or expired token" });
      }

      const userId = decodedToken.uid;

      // Get current local hour (0-23)
      const now = new Date();
      const currentHour = now.getHours();

      // Define time slots
      let currentTimeSlot: "morning" | "lunch" | "evening";
      if (currentHour >= 5 && currentHour < 11) {
        currentTimeSlot = "morning";
      } else if (currentHour >= 11 && currentHour < 16) {
        currentTimeSlot = "lunch";
      } else {
        currentTimeSlot = "evening";
      }

      // Query user's past completed orders
      const ordersSnapshot = await admin
        .firestore()
        .collection("orders")
        .where("userId", "==", userId)
        .where("status", "==", "completed")
        .get();

      // If no orders at all, return fallback recommendation
      if (ordersSnapshot.empty) {
        // Fetch a hardcoded popular item from menu_items
        const popularItemSnapshot = await admin
          .firestore()
          .collection("menu_items")
          .where("name", "==", "Velvet Latte")
          .limit(1)
          .get();

        let fallbackItem;
        if (!popularItemSnapshot.empty) {
          const itemData = popularItemSnapshot.docs[0].data();
          fallbackItem = {
            id: popularItemSnapshot.docs[0].id,
            name: itemData.name,
            price: itemData.price,
            image_url: itemData.image_url,
            description: itemData.description,
            category: itemData.category,
          };
        } else {
          // Absolute fallback if Velvet Latte doesn't exist
          fallbackItem = {
            id: "fallback",
            name: "Velvet Latte",
            price: 4.5,
            image_url: null,
            description: "Our signature smooth latte",
            category: "Drinks",
          };
        }

        return res.json({
          item: fallbackItem,
          message: "Welcome! Try our most popular choice.",
          context: "new_user",
          time_slot: currentTimeSlot,
        });
      }

      // Iterate through orders and score items by time slot
      const itemScores: Record<
        string,
        {
          itemId: string;
          name: string;
          score: number;
          orderCount: number;
          lastOrdered?: any;
        }
      > = {};

      let totalOrdersInTimeSlot = 0;
      let totalOrdersAllTime = 0;

      ordersSnapshot.forEach((doc) => {
        const order = doc.data();
        totalOrdersAllTime++;

        // Parse order timestamp to determine its time slot (handle both createdAt and created_at)
        const timestamp = order.createdAt || order.created_at;
        let orderHour: number;
        if (timestamp?.toDate) {
          // Firestore Timestamp
          orderHour = timestamp.toDate().getHours();
        } else if (
          typeof timestamp === "string" ||
          typeof timestamp === "number"
        ) {
          // ISO string or Unix timestamp
          orderHour = new Date(timestamp).getHours();
        } else {
          // Skip if no valid time
          return;
        }

        // Determine which time slot this order belongs to
        let orderTimeSlot: "morning" | "lunch" | "evening";
        if (orderHour >= 5 && orderHour < 11) {
          orderTimeSlot = "morning";
        } else if (orderHour >= 11 && orderHour < 16) {
          orderTimeSlot = "lunch";
        } else {
          orderTimeSlot = "evening";
        }

        // Only count items from orders in the CURRENT time slot
        const isMatchingTimeSlot = orderTimeSlot === currentTimeSlot;

        if (isMatchingTimeSlot) {
          totalOrdersInTimeSlot++;
        }

        // Process items in this order (handle both array and stringified JSON)
        let items: any[] = [];
        if (typeof order.items === "string") {
          try {
            items = JSON.parse(order.items);
          } catch (e) {
            items = [];
          }
        } else if (Array.isArray(order.items)) {
          items = order.items;
        }

        items.forEach((item: any) => {
          const itemName = item.name || "Unknown Item";
          const itemId = item.item_id || item.id;

          if (!itemId) return; // Skip items without ID

          if (!itemScores[itemId]) {
            itemScores[itemId] = {
              itemId,
              name: itemName,
              score: 0,
              orderCount: 0,
              lastOrdered: order.created_at,
            };
          }

          // Increment score only if order matches current time slot
          if (isMatchingTimeSlot) {
            itemScores[itemId].score += item.quantity || 1;
            itemScores[itemId].orderCount++;

            // Update last ordered timestamp if this is more recent
            if (order.created_at) {
              const existingDate = itemScores[itemId].lastOrdered?.toDate
                ? itemScores[itemId].lastOrdered.toDate()
                : new Date(itemScores[itemId].lastOrdered);
              const newDate = order.created_at.toDate
                ? order.created_at.toDate()
                : new Date(order.created_at);

              if (newDate > existingDate) {
                itemScores[itemId].lastOrdered = order.created_at;
              }
            }
          }
        });
      });

      // Find the winning item
      let winningItemId: string | null = null;
      let highestScore = 0;

      // First, try to find best item in current time slot
      Object.entries(itemScores).forEach(([itemId, data]) => {
        if (data.score > highestScore) {
          highestScore = data.score;
          winningItemId = itemId;
        }
      });

      // Fallback: If no orders in current time slot, use all-time favorite
      if (!winningItemId || highestScore === 0) {
        // Re-scan all orders without time filter
        const allTimeScores: Record<string, number> = {};

        ordersSnapshot.forEach((doc) => {
          const order = doc.data();
          const items = Array.isArray(order.items) ? order.items : [];

          items.forEach((item: any) => {
            const itemId = item.item_id || item.id;
            if (!itemId) return;

            allTimeScores[itemId] =
              (allTimeScores[itemId] || 0) + (item.quantity || 1);
          });
        });

        // Find highest scoring all-time item
        Object.entries(allTimeScores).forEach(([itemId, score]) => {
          if (score > highestScore) {
            highestScore = score;
            winningItemId = itemId;
          }
        });
      }

      // Final fallback if still no winner
      if (!winningItemId) {
        winningItemId = "fallback_velvet_latte";
      }

      // Fetch full menu_item details for the winning item
      let menuItemData: any;
      let menuItemDocId: string;

      if (winningItemId === "fallback_velvet_latte") {
        // Use hardcoded fallback
        menuItemData = {
          name: "Velvet Latte",
          price: 4.5,
          image_url: null,
          description: "Our signature smooth latte with velvety microfoam",
          category: "Drinks",
        };
        menuItemDocId = "fallback";
      } else {
        // Query Firestore for the actual menu item
        const itemSnapshot = await admin
          .firestore()
          .collection("menu_items")
          .doc(winningItemId)
          .get();

        if (!itemSnapshot.exists) {
          menuItemData = {
            name: "Classic Espresso",
            price: 3.5,
            image_url: null,
            description: "Rich and bold espresso shot",
            category: "Drinks",
          };
          menuItemDocId = "fallback_espresso";
        } else {
          menuItemData = itemSnapshot.data();
          menuItemDocId = itemSnapshot.id;
        }
      }

      // Generate contextual message based on context
      let contextualMessage: string;
      const timeSlotMessages = {
        morning: [
          "Your usual morning pick-me-up ☕",
          "Start your day right with this classic",
          "Morning fuel, just how you like it",
        ],
        lunch: [
          "Perfect for your afternoon break",
          "Your midday favorite awaits",
          "Lunchtime ritual, customized for you",
        ],
        evening: [
          "Wind down with your evening choice",
          "Your perfect end-of-day treat",
          "Evening relaxation, your way",
        ],
      };

      if (totalOrdersInTimeSlot === 0 && totalOrdersAllTime > 0) {
        // Used all-time fallback
        contextualMessage = `Your all-time favorite, perfect for any time of day`;
      } else if (totalOrdersAllTime === 0) {
        // New user
        contextualMessage = "Welcome! Try our most popular choice.";
      } else {
        // Has orders in current time slot
        const messages = timeSlotMessages[currentTimeSlot];
        contextualMessage =
          messages[Math.floor(Math.random() * messages.length)];

        // Add personalization if they've ordered this item multiple times
        const winningItemScore = itemScores[winningItemId]?.orderCount || 0;
        if (winningItemScore > 2) {
          contextualMessage += ` (ordered ${winningItemScore} times)`;
        }
      }

      // Return the ritual recommendation
      res.json({
        item: {
          id: menuItemDocId,
          name: menuItemData.name,
          price: menuItemData.price,
          image_url: menuItemData.image_url,
          description: menuItemData.description,
          category: menuItemData.category,
          customizations: menuItemData.customizations || [],
        },
        message: contextualMessage,
        context:
          totalOrdersAllTime === 0
            ? "new_user"
            : totalOrdersInTimeSlot === 0
              ? "all_time_favorite"
              : "time_based",
        time_slot: currentTimeSlot,
        stats: {
          total_orders: totalOrdersAllTime,
          orders_in_time_slot: totalOrdersInTimeSlot,
          confidence_score: highestScore,
        },
      });
    } catch (error: any) {
      console.error("[RITUAL] Error generating ritual:", error);
      res.status(500).json({
        error: "Failed to generate ritual recommendation",
        details: error.message,
      });
    }
  });

  /**
   * GET /api/admin/seed-ritual-orders - Test Order Seeder
   * Injects historical orders for testing the time-weighted ritual algorithm
   * Target user: baqV3tQlhnWczwTSUFsFsOs1w392
   */
  app.get("/api/admin/seed-ritual-orders", async (req, res) => {
    try {
      const targetUserId = "baqV3tQlhnWczwTSUFsFsOs1w392";
      const batch = admin.firestore().batch();
      const ordersRef = admin.firestore().collection("orders");

      // Helper to create an ISO string for a specific hour today
      const getPastDate = (hour: number) => {
        const d = new Date();
        d.setHours(hour, 0, 0, 0);
        return d.toISOString();
      };

      // 1. Morning Ritual Orders (Americano - 8:00 AM)
      const morningItem = JSON.stringify([
        {
          id: "americano_test",
          name: "Americano",
          price: 4.5,
          category: "Coffee",
          quantity: 1,
        },
      ]);

      for (let i = 0; i < 3; i++) {
        const docRef = ordersRef.doc();
        batch.set(docRef, {
          userId: targetUserId,
          status: "completed",
          createdAt: getPastDate(8), // 8 AM
          items: morningItem,
          total: 4.5,
          paymentMethod: "card",
          createdAtTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // 2. Evening Ritual Orders (Trileçe - 9:00 PM / 21:00)
      const eveningItem = JSON.stringify([
        {
          id: "trilece_test",
          name: "Trileçe (Turkish milk cake)",
          price: 12.21,
          category: "Dessert",
          quantity: 1,
        },
      ]);

      for (let i = 0; i < 4; i++) {
        const docRef = ordersRef.doc();
        batch.set(docRef, {
          userId: targetUserId,
          status: "completed",
          createdAt: getPastDate(21), // 9 PM
          items: eveningItem,
          total: 12.21,
          paymentMethod: "card",
          createdAtTimestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }

      // Commit all writes
      await batch.commit();

      res.json({
        success: true,
        message: "Successfully seeded 3 Morning and 4 Evening test orders!",
        details: {
          userId: targetUserId,
          morningOrders: 3,
          eveningOrders: 4,
          totalOrders: 7,
          expectedBehavior: {
            morning: "Americano recommendation",
            evening: "Trileçe recommendation",
            other: "Trileçe (all-time favorite)",
          },
        },
      });
    } catch (error: any) {
      console.error("[SEED-RITUAL] Error seeding orders:", error);
      res.status(500).json({
        error: "Failed to seed ritual orders",
        details: error.message,
      });
    }
  });

  /**
   * Endpoint to generate AI-powered business insights (Admin Only)
   * Aggregates order data and uses Groq LLM for analysis
   */
  app.get("/api/admin/insights", verifyAdminToken, async (req, res) => {
    try {
      // Step 1: Data Fetching & Aggregation from Firestore
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      const ordersSnapshot = await admin
        .firestore()
        .collection("orders")
        .where("createdAt", ">=", thirtyDaysAgo.toISOString())
        .get();

      if (ordersSnapshot.empty) {
        return res.status(200).json({
          peak_hours_analysis:
            "Insufficient data for analysis. Need more orders.",
          revenue_prediction: "Not enough historical data to make predictions.",
          recommendations: [
            {
              priority: "high",
              title: "Start Collecting Data",
              description:
                "Your cafe needs more order history to generate meaningful insights.",
            },
          ],
          inventory_alerts: [],
        });
      }

      // Aggregate raw data into summary statistics
      let totalRevenue = 0;
      const itemCounts: Record<string, { name: string; quantity: number }> = {};
      const hourlyOrders: Record<string, number> = {};

      ordersSnapshot.forEach((doc) => {
        const order = doc.data();

        // Revenue aggregation
        totalRevenue += order.total || 0;

        // Item frequency analysis
        const items = Array.isArray(order.items) ? order.items : [];
        items.forEach((item: any) => {
          const itemName = item.name || "Unknown Item";
          const quantity = item.quantity || 1;

          if (!itemCounts[itemName]) {
            itemCounts[itemName] = { name: itemName, quantity: 0 };
          }
          itemCounts[itemName].quantity += quantity;
        });

        // Hourly distribution analysis
        if (order.createdAt) {
          const orderDate = new Date(order.createdAt);
          const hour = orderDate.getHours().toString().padStart(2, "0") + ":00";
          hourlyOrders[hour] = (hourlyOrders[hour] || 0) + 1;
        }
      });

      // Sort items by quantity to get top 5
      const topItems = Object.values(itemCounts)
        .sort((a, b) => b.quantity - a.quantity)
        .slice(0, 5);

      // Find peak hours (top 3 busiest hours)
      const sortedHours = Object.entries(hourlyOrders)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3);

      const aggregatedData = {
        period: "Last 30 days",
        total_orders: ordersSnapshot.size,
        total_revenue: Math.round(totalRevenue * 100) / 100,
        average_order_value:
          Math.round((totalRevenue / ordersSnapshot.size) * 100) / 100,
        top_selling_items: topItems,
        peak_hours: sortedHours.map(([hour, count]) => ({
          hour,
          orders: count,
        })),
        hourly_distribution: hourlyOrders,
      };

      // Step 2: Send aggregated data to Groq LLM for analysis
      const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

      const systemPrompt = `You are an expert Cafe Business Consultant with deep knowledge of hospitality analytics. 
Analyze the provided 30-day performance data and provide actionable, specific insights.

CRITICAL RULES:
1. You MUST respond in strictly valid JSON format matching the schema below.
2. Do NOT invent or hallucinate data. ONLY use the numbers provided in the input data.
3. If data is insufficient for certain insights, state that clearly.
4. Provide SPECIFIC, ACTIONABLE recommendations based on the actual data patterns.
5. Do NOT include markdown code blocks, backticks, or any formatting - just raw JSON.
6. Keep responses concise but insightful.

Response Schema:
{
  "peak_hours_analysis": "string explaining busiest times with specific data points",
  "revenue_prediction": "string predicting next week's trends based on current patterns",
  "recommendations": [
    { "priority": "high|medium|low", "title": "string", "description": "string" }
  ],
  "inventory_alerts": ["string"]
}

Focus areas:
- Peak hours: Identify clear patterns and suggest staffing optimizations
- Revenue: Analyze trends and predict realistic outcomes
- Recommendations: Must be specific to THIS cafe's data (e.g., "Promote ${topItems[0]?.name}" not generic advice)
- Inventory: Flag items that might need restocking based on sales velocity`;

      const userMessage = `Here is the cafe's performance data for the last 30 days:\n\n${JSON.stringify(aggregatedData, null, 2)}`;

      const completion = await groq.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        model: "llama-3.1-8b-instant",
        temperature: 0.3, // Low temperature for consistent, factual responses
        max_tokens: 1000,
        response_format: { type: "json_object" }, // Force JSON output
      });

      const aiResponse = completion.choices[0]?.message?.content;

      if (!aiResponse) {
        throw new Error("Groq API returned empty response");
      }

      // Parse and validate JSON response
      let aiInsights;
      try {
        aiInsights = JSON.parse(aiResponse);

        // Validate required fields exist
        if (
          !aiInsights.peak_hours_analysis ||
          !aiInsights.revenue_prediction ||
          !Array.isArray(aiInsights.recommendations)
        ) {
          throw new Error("LLM response missing required fields");
        }
      } catch (parseError: any) {
        console.error(
          "[INSIGHTS] Failed to parse LLM response:",
          parseError.message,
        );

        // Fallback response if LLM returns malformed JSON
        aiInsights = {
          peak_hours_analysis:
            "Analysis temporarily unavailable due to technical issues.",
          revenue_prediction: "Prediction service experiencing difficulties.",
          recommendations: [
            {
              priority: "medium",
              title: "System Maintenance",
              description:
                "Our AI insights engine is being updated. Please check back soon.",
            },
          ],
          inventory_alerts: [],
        };
      }

      res.status(200).json(aiInsights);
    } catch (error: any) {
      console.error("[INSIGHTS] Error generating insights:", error);

      // Graceful error handling - don't crash the endpoint
      res.status(500).json({
        error: "Failed to generate AI insights",
        details: error.message,
        fallback: {
          peak_hours_analysis: "Unable to analyze peak hours at this time.",
          revenue_prediction: "Revenue prediction service unavailable.",
          recommendations: [
            {
              priority: "high",
              title: "Technical Issue",
              description:
                "Our AI insights engine encountered an error. Our team has been notified.",
            },
          ],
          inventory_alerts: [],
        },
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
