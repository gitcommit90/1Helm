// Explicit model stub for storage/recall tests, not semantic-quality evidence.
export const retainReview = async input => ({ items: input.candidates.map(c => ({ id: c.id, verdict: "retain", reason: "direct_personal_intent", context: [c.line] })) });
