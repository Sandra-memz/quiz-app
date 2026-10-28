const express = require("express");
const cors = require("cors");
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { generateQuestions } = require("./questions");

const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT
  ? JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
  : require("./serviceAccountKey.json");

initializeApp({ credential: cert(serviceAccount) });

const db = getFirestore();
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

function makeCode() {
  return "QUIZ-" + Math.floor(1000 + Math.random() * 9000);
}

app.post("/quizzes", async (req, res) => {
  const { unit, topics, notes, count } = req.body;
  const code = makeCode();
      try {

  const questions = await generateQuestions({ unit, topics, notes, count });

  await db.collection("quizzes").doc(code).set({
    code,
    unit: unit || "",
    topics: topics || [],
    createdAt: new Date(),
    questions,
  });

      res.json({ code });
  } catch (err) {
    console.error("Generation failed:", err.message);
    res.status(500).json({ error: "Could not generate questions, try again" });
  }
});

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

app.post("/quizzes/:code/attempts", async (req, res) => {
  const { playerName, answers } = req.body;

  const doc = await db.collection("quizzes").doc(req.params.code).get();
  if (!doc.exists) {
    return res.status(404).json({ error: "Quiz not found" });
  }

  const quiz = doc.data();
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
    playerName,
    answers,
    score,
    total: quiz.questions.length,
    submittedAt: new Date(),
  });

  res.json({ score, total: quiz.questions.length, review });
});

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("Server running on port " + PORT));