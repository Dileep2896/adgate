import type { CommercialRuleSet } from '../../types.js';

/** Security: VPNs, password managers, auth providers, scanners, privacy tools. */
export const SOFTWARE_SECURITY: CommercialRuleSet = {
  category: 'software.security',
  products: [
    'vpn', 'vpn service', 'vpn provider', 'vpn app', 'password manager', 'password managers',
    '1password', 'bitwarden', 'lastpass', 'dashlane', 'nordvpn', 'expressvpn', 'express vpn',
    'surfshark', 'protonvpn', 'proton vpn', 'mullvad', 'proton mail', 'protonmail', 'antivirus',
    'anti virus', 'malwarebytes', 'norton', 'mcafee', 'bitdefender', 'kaspersky', 'avast',
    'identity theft protection', 'identity protection', 'security key', 'yubikey',
    'hardware key', 'authenticator app', '2fa app', 'mfa provider', 'sso provider',
    'identity provider', 'auth provider', 'auth service', 'authentication service', 'auth0',
    'okta', 'clerk auth', 'clerk dev', 'supertokens', 'stytch', 'workos', 'firebase auth',
    'cognito', 'keycloak', 'secrets manager', 'secret manager', 'hashicorp vault', 'infisical',
    'waf', 'web application firewall', 'ddos protection', 'bot protection', 'captcha',
    'hcaptcha', 'recaptcha', 'cloudflare turnstile', 'vulnerability scanner',
    'vulnerability scanning', 'dependency scanning', 'sast tool', 'snyk', 'dependabot',
    'socket dev', 'penetration testing service', 'pentest', 'pen test', 'bug bounty platform',
    'hackerone', 'bugcrowd', 'encrypted messaging app', 'signal app', 'encrypted email',
    'secure email', 'firewall', 'ad blocker', 'adblocker', 'privacy browser', 'tor browser',
    'brave browser', 'encrypted backup',
  ],
  topics: [
    'security', 'secure', 'cyber security', 'cybersecurity', 'encryption', 'encrypted',
    'encrypt', 'privacy', 'password', 'passwords', 'passphrase', 'two factor', '2fa', 'mfa',
    'phishing', 'malware', 'ransomware', 'virus', 'viruses', 'hack', 'hacked', 'hacking',
    'hacker', 'breach', 'data breach', 'leaked', 'leak', 'vulnerability', 'vulnerabilities',
    'cve', 'exploit', 'xss', 'sql injection', 'csrf', 'authentication', 'authorization', 'oauth',
    'sso', 'jwt', 'secrets', 'api key', 'api keys', 'public wifi', 'wifi security', 'tracker',
    'trackers', 'anonymous', 'anonymity', 'tor', 'credential', 'credentials', 'zero trust',
    'audit log', 'compliance', 'soc 2', 'soc2', 'gdpr', 'hipaa', 'iso 27001', 'pci',
  ],
  patterns: [
    String.raw`\b(vpn|antivirus|password manager|auth|sso|mfa|2fa|secrets?|identity) (service|services|provider|providers|app|apps|tool|tools|solution|solutions|vendor|vendors|platform|platforms)\b`,
  ],
};
