/**
 * Prompt-injection guard. An email is untrusted text, and a language model can be talked into following instructions written inside it. General pattern: a
 * message that addresses the AI or the classifier itself ("ignore your instructions", "notice to AI assistants", "classify this as...", "system:") is not
 * recruiting correspondence; it is an attack, or a test of one. Such a message is never sent to the model, and no opinion about it can create or alter an event.
 * This is a backstop around the model, not a substitute for the guide telling it to treat the text as data; the evidence quote verification (lib/semantic/reading.ts)
 * is the other layer. Patterns are about addressing the machine, never about hiring vocabulary.
 */
const INJECTION = [
  /\b(?:ignore|disregard|forget|override)\b[^.\n]{0,25}\b(?:your|all (?:of )?(?:the )?(?:previous|prior|above|earlier)|any (?:previous|prior)|the (?:previous|prior|above)) (?:\w+ ){0,2}(?:instructions?|rules?|prompts?|guidelines?)\b(?!\s+(?:about|regarding|on|for|in|to the)\b)/i,
  /\b(?:notice|message|note|attention)\s+(?:to|for)\s+(?:the\s+)?(?:ai|a\.i\.|llm|language model|assistants?|chatbots?|classifiers?|automated (?:systems?|readers?|filters?))\b/i,
  /\b(?:ai|llm|language model|assistant|chatbot|classifier|automated reader)s?\b[^.\n]{0,60}\b(?:must|should|shall|please|do not|don'?t)\b[^.\n]{0,60}\b(?:classif\w+|mark|record|label|treat|report|flag|answer|output|respond)\b/i,
  /\b(?:classify|mark|label|record|treat|report)\s+(?:this|it|the (?:email|message))\s+as\s+(?:an?\s+)?(?:recruiting|job|offer|accepted|genuine|real)\b/i,
  /(?:^|\n)\s*(?:system|assistant|developer)\s*(?::|prompt\b)/i,
  /\bdo not (?:alert|notify|tell|inform) the (?:user|recipient|reader)\b/i,
  /\byou are (?:now )?(?:an? )?(?:ai|assistant|language model|classifier)\b/i,
  /\b(?:respond|answer|reply|output) (?:only )?(?:with|in) (?:json|yes|the following)\b/i,
];

export function looksLikeInjection(text: string): boolean {
  return INJECTION.some((p) => p.test(text));
}
