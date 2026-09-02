import type { SensitiveCategory } from '@adgate/schemas';

import type { CommercialCategory, CommercialRuleSet, RulesData, SensitiveRuleSet } from '../types.js';
import { ALIASES } from './aliases.js';
import { EDUCATION_COURSES } from './commercial/education.courses.js';
import { EDUCATION_LANGUAGE } from './commercial/education.language.js';
import { ENTERTAINMENT_STREAMING } from './commercial/entertainment.streaming.js';
import { FOOD_DELIVERY } from './commercial/food.delivery.js';
import { SHOPPING_ELECTRONICS } from './commercial/shopping.electronics.js';
import { SHOPPING_HOME } from './commercial/shopping.home.js';
import { SHOPPING_PETS } from './commercial/shopping.pets.js';
import { SHOPPING_SPORTSWEAR } from './commercial/shopping.sportswear.js';
import { SOFTWARE_DEVTOOLS_AI } from './commercial/software.devtools.ai.js';
import { SOFTWARE_DEVTOOLS_CI } from './commercial/software.devtools.ci.js';
import { SOFTWARE_DEVTOOLS_DATABASE } from './commercial/software.devtools.database.js';
import { SOFTWARE_DEVTOOLS_HOSTING } from './commercial/software.devtools.hosting.js';
import { SOFTWARE_DEVTOOLS_OBSERVABILITY } from './commercial/software.devtools.observability.js';
import { SOFTWARE_PRODUCTIVITY } from './commercial/software.productivity.js';
import { SOFTWARE_SECURITY } from './commercial/software.security.js';
import { TRAVEL_CONNECTIVITY } from './commercial/travel.connectivity.js';
import { TRAVEL_FLIGHTS } from './commercial/travel.flights.js';
import { TRAVEL_HOTELS } from './commercial/travel.hotels.js';
import { INFORMATIONAL_PHRASES } from './informational.js';
import { INTENT_RULES } from './intent.js';
import { SCORING } from './scoring.js';
import { ADULT } from './sensitive/adult.js';
import { FINANCE } from './sensitive/finance.js';
import { GAMBLING } from './sensitive/gambling.js';
import { HEALTH } from './sensitive/health.js';
import { LEGAL } from './sensitive/legal.js';
import { POLITICS } from './sensitive/politics.js';
import { RELIGION } from './sensitive/religion.js';
import { SELF_HARM } from './sensitive/self-harm.js';
import { WEAPONS } from './sensitive/weapons.js';

/**
 * The keyword registry. Adding a taxonomy category means adding one data file and one line
 * here; the Record types make a missing category a compile error. RULES_VERSION is the hash
 * of this whole object (canonical JSON), so every edit below changes it.
 */
export const SENSITIVE_RULES: Record<SensitiveCategory, SensitiveRuleSet> = {
  health: HEALTH,
  finance: FINANCE,
  politics: POLITICS,
  legal: LEGAL,
  adult: ADULT,
  gambling: GAMBLING,
  weapons: WEAPONS,
  religion: RELIGION,
  self_harm: SELF_HARM,
};

export const COMMERCIAL_RULES: Record<CommercialCategory, CommercialRuleSet> = {
  'software.devtools.database': SOFTWARE_DEVTOOLS_DATABASE,
  'software.devtools.hosting': SOFTWARE_DEVTOOLS_HOSTING,
  'software.devtools.ci': SOFTWARE_DEVTOOLS_CI,
  'software.devtools.observability': SOFTWARE_DEVTOOLS_OBSERVABILITY,
  'software.devtools.ai': SOFTWARE_DEVTOOLS_AI,
  'software.security': SOFTWARE_SECURITY,
  'software.productivity': SOFTWARE_PRODUCTIVITY,
  'shopping.electronics': SHOPPING_ELECTRONICS,
  'shopping.home': SHOPPING_HOME,
  'shopping.sportswear': SHOPPING_SPORTSWEAR,
  'shopping.pets': SHOPPING_PETS,
  'travel.flights': TRAVEL_FLIGHTS,
  'travel.hotels': TRAVEL_HOTELS,
  'travel.connectivity': TRAVEL_CONNECTIVITY,
  'education.language': EDUCATION_LANGUAGE,
  'education.courses': EDUCATION_COURSES,
  'entertainment.streaming': ENTERTAINMENT_STREAMING,
  'food.delivery': FOOD_DELIVERY,
};

export const RULES_DATA: RulesData = {
  sensitive: SENSITIVE_RULES,
  commercial: COMMERCIAL_RULES,
  intent: INTENT_RULES,
  informational: INFORMATIONAL_PHRASES,
  aliases: ALIASES,
  scoring: SCORING,
};
