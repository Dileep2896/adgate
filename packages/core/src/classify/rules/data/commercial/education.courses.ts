import type { CommercialRuleSet } from '../../types.js';

/** Courses and bootcamps. Bare "course" is omitted ("of course"); "a course" and plurals are products. */
export const EDUCATION_COURSES: CommercialRuleSet = {
  category: 'education.courses',
  products: [
    'online course', 'online courses', 'video course', 'courses', 'a course', 'bootcamp',
    'bootcamps', 'coding bootcamp', 'data science bootcamp', 'udemy', 'coursera', 'edx',
    'pluralsight', 'skillshare', 'masterclass', 'linkedin learning', 'codecademy', 'datacamp',
    'frontend masters', 'egghead', 'educative', 'treehouse', 'udacity', 'nanodegree',
    'zero to mastery', 'certificate program', 'aws certification', 'online degree',
    'masters program', 'tutor', 'tutoring', 'private tutor', 'exam prep', 'test prep',
    'sat prep', 'gre prep', 'gmat prep', 'study guide', 'textbook', 'textbooks',
    'cohort based course', 'reforge', 'training course', 'learning platform',
    'e learning platform', 'lms', 'mooc', 'moocs', 'course platform', 'certification course',
    'crash course',
  ],
  topics: [
    'learn', 'learning', 'study', 'studying', 'tutorial', 'tutorials', 'lesson', 'lessons',
    'curriculum', 'syllabus', 'degree', 'university', 'college', 'exam', 'exams',
    'certification', 'certified', 'self taught', 'career change', 'upskill', 'upskilling',
    'reskill', 'data engineering', 'data science', 'web development', 'beginner', 'beginners',
    'for beginners', 'learn react', 'learn python', 'learn to code', 'coding', 'programming',
    'computer science', 'cs degree', 'skills', 'education', 'educational', 'student',
    'students', 'teacher', 'teach', 'teaching', 'homework',
  ],
  patterns: [
    String.raw`\b(online|video|udemy|coursera|free|paid|best|good|beginner|advanced|crash|intro|introductory) courses?\b`,
    String.raw`\bcourses? (on|for|about|to learn|in) \b`,
    String.raw`\b(coding|data science|data engineering|web development|ux|design|devops|cyber security|cybersecurity|ml|ai|software engineering|analytics) (bootcamp|bootcamps|course|courses|program|programs|certification|certificate|nanodegree|degree)\b`,
  ],
};
