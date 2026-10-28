require("dotenv").config();
const { GoogleGenAI } = require("@google/genai");

const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateQuestions({ unit, topics, notes, count }) {
  const wanted = Number(count);
  const total = wanted > 0
    ? Math.min(25, wanted)
    : notes ? Math.min(25, Math.max(5, Math.round(notes.length / 700))) : 5;
  const source = notes
    ? `Base the questions ONLY on these lecture notes:\n\n${notes}`
    : `Unit: ${unit}\nTopics: ${topics.join(", ")}`;

    const prompt = `Write exactly ${total} multiple choice questions for a university student. If notes are provided, spread the questions evenly across the whole text so every major section is covered.

${source}

Return ONLY a JSON array, with no markdown and no extra text. Each item must look like:
{"text": "question", "options": ["A", "B", "C", "D"], "correctIndex": 0, "explanation": "one or two sentences on why the answer is correct"}

Rules: exactly 4 options per question, correctIndex is a number from 0 to 3, vary the position of the correct answer, and make the wrong options plausible.`;

  const response = await client.models.generateContent({
    model: process.env.GEMINI_MODEL,
    contents: prompt,
    config: { responseMimeType: "application/json", maxOutputTokens: 8192 },
  });

  const clean = response.text.replace(/```json|```/g, "").trim();
  const parsed = JSON.parse(clean);

  return parsed.map((q, i) => ({
    id: i + 1,
    text: q.text,
    options: q.options,
    correctIndex: q.correctIndex,
    explanation: q.explanation,
  }));
}

module.exports = { generateQuestions };