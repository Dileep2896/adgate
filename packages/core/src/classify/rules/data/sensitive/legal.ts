import type { SensitiveRuleSet } from '../../types.js';

/** Legal: disputes, rights, courts, employment and tenancy law, crime. */
export const LEGAL: SensitiveRuleSet = {
  category: 'legal',
  strong: [
    'lawyer', 'lawyers', 'attorney', 'attorneys', 'lawsuit', 'lawsuits', 'sue', 'suing', 'sued',
    'litigation', 'courtroom', 'court date', 'court order', 'go to court', 'taken to court',
    'evict', 'evicted', 'eviction', 'divorce', 'divorced', 'custody', 'alimony', 'prenup',
    'prenuptial', 'my rights', 'legal rights', 'tenant rights', 'tenants rights',
    'workers rights', 'fire me', 'fired me', 'wrongful termination', 'wrongfully terminated',
    'harassment', 'discrimination', 'arrested', 'arrest', 'dui', 'dwi', 'misdemeanor', 'felony',
    'charged with', 'criminal', 'subpoena', 'breach of contract', 'small claims',
    'restraining order', 'immigration lawyer', 'green card', 'power of attorney', 'notary',
    'liable', 'liability', 'legal advice', 'legal', 'illegal', 'plaintiff', 'defendant',
    'verdict', 'jury', 'probation', 'parole', 'bail', 'indictment', 'indicted', 'deportation',
    'deported', 'non compete', 'severance', 'unemployment benefits', 'workers comp',
    'workers compensation', 'security deposit', 'lease agreement', 'child support',
    'guardianship', 'inheritance', 'will and testament', 'estate planning', 'probate',
    'copyright infringement', 'cease and desist', 'defamation', 'libel', 'slander',
    'police report', 'press charges', 'statute of limitations', 'supreme court',
  ],
  weak: [
    'landlord', 'tenant', 'lease', 'employer', 'hr', 'contract', 'law', 'laws', 'rights',
    'police', 'crime', 'judge', 'settlement', 'copyright', 'trademark', 'patent', 'nda', 'fired',
    'court', 'warrant', 'legally',
  ],
  patterns: [
    String.raw`\b(can|could) (my|the|an?) (employer|landlord|boss|company|manager|hoa|school|neighbor|neighbour) (legally )?\w+ me\b`,
    String.raw`\bfire(d)? me\b`,
    String.raw`\b(what are|know|have|violating|violated) my (legal )?rights\b`,
    String.raw`\bfile for (divorce|bankruptcy|custody|unemployment)\b`,
    String.raw`\b(is|are|was) (it|this|that|he|she|they) (legal|illegal|against the law)\b`,
    String.raw`\btake (them|him|her|it|my \w+) to court\b`,
  ],
};
