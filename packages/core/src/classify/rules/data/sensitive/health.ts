import type { SensitiveRuleSet } from '../../types.js';

/**
 * Health: conditions, drugs, symptoms, treatment. Normalized phrases (see aliases.ts). "dental"
 * is weak: dental hygiene products are shopping, a dental problem needs a second term.
 */
export const HEALTH: SensitiveRuleSet = {
  category: 'health',
  strong: [
    'ibuprofen', 'acetaminophen', 'aspirin', 'antibiotic', 'antibiotics', 'antidepressant',
    'antidepressants', 'ssri', 'ssris', 'prozac', 'zoloft', 'lexapro', 'xanax', 'adderall',
    'insulin', 'metformin', 'statin', 'statins', 'vaccine', 'vaccines', 'vaccination',
    'chest pain', 'back pain', 'chronic pain', 'joint pain', 'stomach pain', 'headache',
    'headaches', 'migraine', 'migraines', 'anxiety', 'depression', 'adhd', 'autism', 'bipolar',
    'ptsd', 'ocd', 'diabetes', 'cancer', 'tumor', 'tumour', 'chemo', 'chemotherapy', 'asthma',
    'arthritis', 'uti', 'strep throat', 'pneumonia', 'bronchitis', 'flu', 'flu shot', 'covid',
    'covid 19', 'blood pressure', 'hypertension', 'cholesterol', 'heart attack', 'had a stroke',
    'stroke symptoms', 'seizure', 'seizures', 'allergy', 'allergies', 'allergic reaction',
    'fever', 'nausea', 'vomiting', 'diarrhea', 'pregnant', 'pregnancy', 'miscarriage',
    'fertility', 'ivf', 'birth control', 'contraception', 'sexually transmitted', 'herpes',
    'hiv', 'eating disorder', 'anorexia', 'bulimia', 'therapist', 'psychiatrist',
    'psychologist', 'prescription', 'prescriptions', 'prescribed', 'medication', 'medications',
    'meds', 'diagnosed', 'health insurance', 'medical', 'dosage', 'overdose', 'concussion',
    'surgery', 'weight loss', 'diet pills', 'dentist', 'hospital', 'urgent care',
    'painkiller', 'painkillers', 'opioid', 'opioids', 'insomnia', 'sleep apnea', 'menopause',
    'testosterone', 'hormone', 'hormones', 'thyroid', 'eczema', 'psoriasis', 'acne', 'celiac',
    'ibs', 'crohns', 'ulcer', 'hernia', 'fracture', 'sprain', 'physical therapy',
    'physiotherapy', 'chiropractor', 'mental health', 'panic attack', 'panic attacks',
    'wellbutrin', 'ozempic', 'wegovy', 'semaglutide', 'melatonin', 'probiotic', 'probiotics',
    'abortion', 'kidney infection', 'ear infection', 'sinus infection',
  ],
  weak: [
    'dose', 'doses', 'pain', 'sick', 'supplement', 'supplements', 'vitamin', 'vitamins',
    'doctor', 'nurse', 'clinic', 'intermittent fasting', 'keto', 'calories', 'diet', 'sore',
    'swollen', 'swelling', 'cough', 'sneezing', 'fatigue', 'dizzy', 'dizziness', 'nauseous',
    'bleeding', 'injury', 'injured', 'bruise', 'itchy', 'cramps', 'symptom', 'symptoms',
    'infection', 'infections', 'side effects', 'diagnosis', 'treatment', 'cure', 'remedy',
    'remedies', 'rash', 'dental',
  ],
  patterns: [
    String.raw`\b(chronic|back|neck|knee|joint|chest|stomach|abdominal|pelvic|shoulder|hip) pain\b`,
    String.raw`\b\d+ ?mg\b`,
    String.raw`\b(type [12]|gestational) diabetes\b`,
    String.raw`\b(kidney|ear|sinus|yeast|bladder|lung|skin|eye|throat) infections?\b`,
    String.raw`\b(blood|urine|allergy|pregnancy|covid) test\b`,
    String.raw`\bsafe (to take|for (my|a|an) \d+ (year|month) old|during pregnancy|while pregnant|while breastfeeding)\b`,
  ],
};
