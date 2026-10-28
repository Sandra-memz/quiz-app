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
If the unit or topics are mathematical or quantitative (for example calculus, algebra, statistics, physics, accounting or engineering), at least 80% of the questions must be calculation or problem-solving questions with specific numbers, where the student has to work out the answer. Avoid pure definition or theory questions in those subjects. For other subjects, mix theory and applied questions.

Write all mathematics in plain text, never LaTeX: use x^2, sqrt(x), a/b, pi, and no backslashes or dollar signs.

Return ONLY a JSON array, with no markdown and no extra text. Each item must look like:
{"text": "question", "options": ["A", "B", "C", "D"], "explanation": "the step-by-step working that leads to the correct answer", "correctIndex": 0}

Rules: exactly 4 options per question, correctIndex is a number from 0 to 3, vary the position of the correct answer, and make the wrong options plausible. Work out the answer in the explanation first, then set correctIndex to match it, and double check any arithmetic. Make the wrong options the results of common mistakes.`;

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