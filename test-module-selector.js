import {
  selectKnowledgeModules,
} from "./src/modules/orchestration/moduleSelector.service.js";

const questions = [
  "What does research say about tennis training load?",

  "Which coaching drills improve footwork?",

  "What was the player's score and serve percentage in the match?",

  "How has the player's ranking changed?",

  "How can a player improve movement?",
];

for (const question of questions) {
  const selectedModules =
    selectKnowledgeModules({
      question,
    });

  console.log("\nQuestion:");
  console.log(question);

  console.log("Selected modules:");
  console.log(selectedModules);
}