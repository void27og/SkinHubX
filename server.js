const express = require("express");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// Ensure uploads folder exists
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

// Multer setup for PNG skin uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadDir);
  },
  filename: function (req, file, cb) {
    // Basic filename: timestamp_originalname
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_.-]/g, "_");
    cb(null, Date.now() + "_" + safeName);
  }
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.includes("png")) {
      return cb(new Error("Only PNG files allowed"));
    }
    cb(null, true);
  },
  limits: { fileSize: 1024 * 1024 * 2 } // 2 MB
});

// In-memory metadata store (for real use, swap to DB)
let uploadedSkins = [];

/**
 * API: Get Mojang skin URL for a username
 * GET /api/skin/:username
 */
app.get("/api/skin/:username", async (req, res) => {
  const username = req.params.username;

  try {
    // Step 1: Username -> UUID
    const profileResp = await axios.get(
      `https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`
    );

    const uuid = profileResp.data.id;

    // Step 2: UUID -> Profile (with textures)
    const sessionResp = await axios.get(
      `https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`
    );

    const props = sessionResp.data.properties || [];
    const texturesProp = props.find(p => p.name === "textures");

    if (!texturesProp) {
      return res.status(404).json({ error: "No textures found for this user" });
    }

    const decoded = JSON.parse(
      Buffer.from(texturesProp.value, "base64").toString("utf8")
    );

    const skinUrl = decoded.textures?.SKIN?.url;

    if (!skinUrl) {
      return res.status(404).json({ error: "No skin found for this user" });
    }

    res.json({
      username,
      uuid,
      skinUrl
    });
  } catch (err) {
    console.error(err.message);
    res.status(404).json({ error: "Username not found or Mojang API error" });
  }
});

/**
 * API: Upload a skin PNG
 * POST /api/upload-skin
 * form-data: file (png), author(optional), name(optional)
 */
app.post("/api/upload-skin", upload.single("file"), (req, res) => {
  const file = req.file;
  const { author, name } = req.body;

  if (!file) {
    return res.status(400).json({ error: "No file uploaded" });
  }

  const id = uploadedSkins.length + 1;
  const record = {
    id,
    name: name || file.originalname,
    author: author || "Anonymous",
    filename: file.filename,
    url: `/uploads/${file.filename}`,
    uploadedAt: new Date().toISOString()
  };

  uploadedSkins.push(record);

  res.json({ success: true, skin: record });
});

/**
 * Serve uploads statically
 */
app.use("/uploads", express.static(uploadDir));

/**
 * API: List uploaded skins
 * GET /api/uploaded-skins
 */
app.get("/api/uploaded-skins", (req, res) => {
  res.json(uploadedSkins);
});

// Fallback: serve index.html
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
