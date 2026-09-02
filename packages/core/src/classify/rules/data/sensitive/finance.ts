import type { SensitiveRuleSet } from '../../types.js';

/**
 * Finance: credit, debt, investing, insurance, money trouble. "budget" and "dollars" are NOT
 * here: they are buying signals (intent.ts) and appear in serve cases like "under 200 dollars".
 */
export const FINANCE: SensitiveRuleSet = {
  category: 'finance',
  strong: [
    'credit card', 'credit cards', 'credit score', 'credit report', 'debt', 'debts', 'loan',
    'loans', 'student loan', 'student loans', 'mortgage', 'mortgages', 'refinance',
    'refinancing', 'index fund', 'index funds', 'etf', 'etfs', 'stocks', 'stock market',
    'stock options', 'investing', 'investment', 'investments', 'investor', '401k', 'ira',
    'roth ira', 'retirement', 'pension', 'savings account', 'my savings', 'bitcoin', 'ethereum',
    'dogecoin', 'brokerage', 'bank account', 'checking account', 'interest rate',
    'interest rates', 'apr', 'annual fee', 'health insurance', 'life insurance',
    'car insurance', 'auto insurance', 'home insurance', 'homeowners insurance',
    'renters insurance', 'disability insurance', 'taxes', 'tax return', 'tax refund', 'irs',
    'paycheck', 'payday loan', 'payday loans', 'bankruptcy', 'foreclosure', 'rent is due',
    'dollars short', 'short on cash', 'short on money', 'short on rent', 'behind on rent',
    'behind on bills', 'financial advisor', 'financial planner', 'net worth', 'dividend',
    'dividends', 'forex', 'day trading', 'options trading', 'hedge fund', 'mutual fund',
    'mutual funds', 'emergency fund', 'borrow money', 'personal loan', 'car loan', 'auto loan',
    'down payment', 'credit union', 'overdraft', 'remittance', 'send money', 'money transfer',
    'cash advance', 'buy now pay later', 'klarna', 'afterpay', 'robinhood', 'coinbase',
    'vanguard', 'nft', 'nfts', 'stablecoin', 'defi', 'rsu', 'rsus', 'equity compensation',
    'debt consolidation', 'paycheck to paycheck',
  ],
  weak: [
    'money', 'rent', 'bills', 'afford', 'cash', 'bank', 'salary', 'savings', 'budgeting',
    'inflation', 'economy', 'wallet', 'fee', 'fees', 'income', 'expenses', 'credit',
    'consolidate', 'pay off', 'stock', 'invest', 'trading', 'bonds', 'treasury', 'portfolio',
    'insurance', 'tax', 'financial', 'finances', 'finance',
  ],
  patterns: [
    String.raw`\b\d+ (dollars|bucks|usd|pounds|euros) short\b`,
    String.raw`\bpay(ing)? off (my|the|our) (debt|debts|loan|loans|mortgage|credit card|credit cards|card|balance|student loans)\b`,
    String.raw`\b(can not|could not|unable to) (pay|afford|make|cover) (my |the |our )?(rent|bills|mortgage|loan|payments|car payment)\b`,
    String.raw`\b(invest|investing|put) (my |our |some )?(savings|money) (in|into)\b`,
  ],
};
