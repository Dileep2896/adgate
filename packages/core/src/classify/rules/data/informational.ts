/**
 * Phrases that mark an informational request (explain, translate, fix this...). Each distinct
 * hit subtracts scoring.intent.informational_penalty from commercial intent. Normalized form.
 */
export const INFORMATIONAL_PHRASES: readonly string[] = [
  'explain', 'explain how', 'explain what', 'what is a', 'what is an', 'what is the difference',
  'difference between', 'what does', 'how does', 'how do i', 'how do you', 'how can i', 'how to',
  'why is', 'why does', 'why do', 'why did', 'summarize', 'summary of', 'translate',
  'translation', 'write a', 'write me', 'write an', 'draft a', 'draft an', 'help me write',
  'rewrite', 'proofread', 'fix this', 'fix my', 'debug', 'debugging', 'not working',
  'does not work', 'error message', 'tell me a joke', 'joke about', 'in simple terms', 'eli5',
  'define', 'definition of', 'meaning of', 'what year', 'when was', 'when did', 'who was',
  'who is', 'who invented', 'history of', 'how many', 'how long', 'how far', 'how old',
  'what time', 'capital of', 'prove that', 'solve', 'calculate', 'compute', 'regex', 'syntax',
  'example of', 'examples of', 'step by step', 'code review', 'refactor', 'unit test',
  'write tests', 'pseudocode', 'algorithm', 'big o', 'time complexity', 'haiku', 'poem', 'story',
  'essay', 'birthday message', 'cover letter',
];
