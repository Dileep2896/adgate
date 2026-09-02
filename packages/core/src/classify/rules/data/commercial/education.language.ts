import type { CommercialRuleSet } from '../../types.js';

/** Language learning: apps, tutors, courses; language names are topics. */
export const EDUCATION_LANGUAGE: CommercialRuleSet = {
  category: 'education.language',
  products: [
    'duolingo', 'babbel', 'rosetta stone', 'busuu', 'memrise', 'pimsleur', 'lingoda', 'italki',
    'preply', 'lingq', 'language app', 'language apps', 'language learning app',
    'language course', 'language courses', 'language class', 'language classes',
    'language tutor', 'spanish tutor', 'language exchange', 'spanish course', 'spanish classes',
    'spanish lessons', 'french lessons', 'japanese lessons', 'language school',
    'immersion program', 'language program',
  ],
  topics: [
    'spanish', 'french', 'german', 'italian', 'japanese', 'chinese', 'mandarin', 'korean',
    'portuguese', 'arabic', 'russian', 'hindi', 'english', 'esl', 'language', 'languages',
    'foreign language', 'second language', 'fluent', 'fluency', 'vocabulary', 'vocab',
    'grammar', 'conjugation', 'pronunciation', 'kanji', 'hiragana', 'katakana', 'hsk', 'jlpt',
    'dele', 'toefl', 'ielts', 'bilingual', 'learn a language', 'learning a language',
    'language learning', 'flashcards', 'anki', 'immersion',
  ],
  patterns: [
    String.raw`\b(learn|learning|study|studying|speak|speaking|practice|practicing|practise|practising|improve|improving) (my )?(spanish|french|german|italian|japanese|chinese|mandarin|korean|portuguese|arabic|russian|hindi|english|a language|a new language|a foreign language|languages)\b`,
    String.raw`\b(spanish|french|german|italian|japanese|chinese|mandarin|korean|portuguese|arabic|russian|hindi|english|language) (app|apps|course|courses|class|classes|lessons|tutor|tutors|tutoring|program|programs|school|schools)\b`,
  ],
};
