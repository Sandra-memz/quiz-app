const { generateQuestions } = require("./questions");

generateQuestions({
  unit: "Data Structures",
  topics: ["Stacks", "Queues"],
  count: 3,
})
  .then((q) => console.log(JSON.stringify(q, null, 2)))
  .catch((err) => console.error("ERROR:", err.message));