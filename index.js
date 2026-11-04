const express = require("express");
const cors = require("cors");
const { randomInt } = require("crypto");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const mammoth = require("mammoth");
const { PDFParse } = require("pdf-parse");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { generateQuestions } = require("./questions");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require("./serviceAccountKey.json");

initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();
const app = express();

app.set("trust proxy", 1);

const createLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "You have created too many quizzes. Please try again in an hour." },
});

const uploadLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many uploads. Please try again in an hour." },
});

app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

async function makeUniqueCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  for (let attempt = 0; attempt < 5; attempt++) {
    let code = "QUIZ-";
    for (let i = 0; i < 5; i++) {
      code += chars[randomInt(chars.length)];
    }
    const doc = await db.collection("quizzes").doc(code).get();
    if (!doc.exists) return code;
  }

  throw new Error("Could not create a unique code");
}

// 1. Create a quiz
app.post("/quizzes", createLimiter, async (req, res) => {
  const { unit, topics, notes, count, difficulty } = req.body;

  const topicList = Array.isArray(topics)
    ? topics.filter((t) => typeof t === "string" && t.trim()).slice(0, 20)
    : [];
  const notesText = typeof notes === "string" ? notes.trim() : "";

  if (!notesText && topicList.length === 0) {
    return res.status(400).json({ error: "Add some topics or paste your notes first" });
  }

  try {
    const code = await makeUniqueCode();
    const questions = await generateQuestions({
      unit,
      topics: topicList,
      notes: notesText,
      count,
      difficulty,
    });

    await db.collection("quizzes").doc(code).set({
      code,
      unit: String(unit || "").slice(0, 100),
      topics: topicList,
      difficulty: difficulty || "mixed",
      createdAt: new Date(),
      questions,
    });

    res.json({ code });
  } catch (err) {
    console.error("Generation failed:", err.message);
    res.status(500).json({ error: "Could not generate questions, try again" });
  }
});

// 2. Load a quiz (without the answers)
app.get("/quizzes/:code", async (req, res) => {
  const doc = await db.collection("quizzes").doc(req.params.code).get();

  if (!doc.exists) {
    return res.status(404).json({ error: "Quiz not found" });
  }

  const quiz = doc.data();

  const questions = quiz.questions.map((q) => ({
    id: q.id,
    text: q.text,
    options: q.options,
  }));

  res.json({ code: quiz.code, unit: quiz.unit, topics: quiz.topics, questions });
});

// 3. Mark someone's answers and save their score
app.post("/quizzes/:code/attempts", async (req, res) => {
  const { playerName, answers } = req.body;

  const name = String(playerName || "").trim();
  if (!name || name.length > 50) {
    return res.status(400).json({ error: "Enter your name (up to 50 characters)" });
  }
  if (!Array.isArray(answers) || !answers.every((a) => Number.isInteger(a))) {
    return res.status(400).json({ error: "Answers are not valid" });
  }

  const doc = await db.collection("quizzes").doc(req.params.code).get();
  if (!doc.exists) {
    return res.status(404).json({ error: "Quiz not found" });
  }

  const quiz = doc.data();

  if (answers.length !== quiz.questions.length) {
    return res.status(400).json({ error: "Number of answers does not match the quiz" });
  }

  let score = 0;

  const review = quiz.questions.map((q, i) => {
    const correct = answers[i] === q.correctIndex;
    if (correct) score++;
    return {
      id: q.id,
      text: q.text,
      yourAnswer: answers[i],
      correctIndex: q.correctIndex,
      correct,
      explanation: q.explanation,
    };
  });

  await db.collection("attempts").add({
    quizCode: quiz.code,
    playerName: name,
    answers,
    score,
    total: quiz.questions.length,
    submittedAt: new Date(),
  });

  res.json({ score, total: quiz.questions.length, review });
});

// 4. Scoreboard for a quiz
app.get("/quizzes/:code/results", async (req, res) => {
  const snapshot = await db
    .collection("attempts")
    .where("quizCode", "==", req.params.code)
    .get();

  const results = snapshot.docs
    .map((d) => {
      const a = d.data();
      return {
        playerName: a.playerName,
        score: a.score,
        total: a.total,
        submittedAt: a.submittedAt.toDate(),
      };
    })
    .sort((a, b) => b.score - a.score);

  res.json({ code: req.params.code, results });
});

// 5. Read text out of an uploaded PDF or Word file
app.post(
  "/extract-text",
  uploadLimiter,
  (req, res, next) => {
    upload.single("file")(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: "File too large (max 10 MB) or invalid" });
      }
      next();
    });
  },
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileName = req.file.originalname.toLowerCase();

    try {
      let text = "";

      if (fileName.endsWith(".pdf")) {
        const parser = new PDFParse({ data: new Uint8Array(req.file.buffer) });
        try {
          const result = await parser.getText();
          text = result.text;
        } finally {
          await parser.destroy();
        }
      } else if (fileName.endsWith(".docx")) {
        const result = await mammoth.extractRawText({ buffer: req.file.buffer });
        text = result.value;
      } else {
        return res.status(400).json({ error: "Only PDF and DOCX files are supported" });
      }

      text = text.replace(/\s+\n/g, "\n").trim();

      if (text.length < 50) {
        return res.status(422).json({
          error: "Could not find readable text in this file. It may be a scanned document.",
        });
      }

      const MAX = 120000;
      res.json({ text: text.slice(0, MAX), truncated: text.length > MAX });
    } catch (err) {
      console.error("Extract failed:", err.message);
      res.status(500).json({ error: "Could not read that file" });
    }
  }
);

// 6. Report a question that looks wrong
app.post("/quizzes/:code/report", async (req, res) => {
  const { questionId, reason, playerName } = req.body;

  const doc = await db.collection("quizzes").doc(req.params.code).get();
  if (!doc.exists) {
    return res.status(404).json({ error: "Quiz not found" });
  }

  const quiz = doc.data();
  const q = quiz.questions.find((x) => x.id === Number(questionId));
  if (!q) {
    return res.status(400).json({ error: "Question not found" });
  }

  await db.collection("reports").add({
    quizCode: quiz.code,
    questionId: q.id,
    questionText: q.text,
    options: q.options,
    markedCorrectIndex: q.correctIndex,
    reason: String(reason || "").slice(0, 500),
    playerName: String(playerName || "").slice(0, 50),
    createdAt: new Date(),
  });

  res.json({ ok: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));