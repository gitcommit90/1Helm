// A Choice with one offered key is a local constant, not a model decision.
// Keep definitions intact for callers while omitting constants from model requests.
export function splitChoiceQuestions(definitions) {
  const questions = {}, localAnswers = {};
  for (const [name, question] of Object.entries(definitions || {})) {
    const criteria = question?.criteria;
    const keys = question?.type === "choice" && criteria && typeof criteria === "object" && !Array.isArray(criteria) ? Object.keys(criteria) : [];
    if (keys.length === 1) localAnswers[name] = { choice: keys[0] };
    else questions[name] = question;
  }
  return { questions, localAnswers };
}

// Local constants win over unsolicited answers to questions the model was not asked.
// No probabilities are synthesized. Preserve the provider's answers separately.
export function resolveChoiceAnswers(modelAnswers, localAnswers) {
  return Object.keys(localAnswers).length ? { ...modelAnswers, ...localAnswers } : modelAnswers;
}
