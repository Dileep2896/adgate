import type { CommercialRuleSet } from '../../types.js';

/** Hosting: app and web hosting platforms, cloud providers, domains, CDNs. */
export const SOFTWARE_DEVTOOLS_HOSTING: CommercialRuleSet = {
  category: 'software.devtools.hosting',
  products: [
    'vercel', 'netlify', 'heroku', 'render com', 'render hosting', 'fly io', 'railway app',
    'digitalocean', 'digital ocean', 'linode', 'vultr', 'hetzner', 'cloudflare pages',
    'cloudflare workers', 'aws amplify', 'github pages', 'hosting provider', 'hosting providers',
    'hosting service', 'hosting services', 'web hosting', 'app hosting', 'static hosting',
    'cloud hosting', 'vps', 'vps hosting', 'vps provider', 'cloud provider', 'cloud providers',
    'paas', 'serverless platform', 'edge hosting', 'managed hosting', 'shared hosting',
    'dedicated server', 'cdn', 'domain registrar', 'domain name registrar', 'namecheap',
    'godaddy', 'porkbun', 'cloudflare', 'aws lightsail', 'lightsail', 'app platform',
    'deno deploy', 'kinsta', 'wp engine', 'wordpress hosting', 'bluehost', 'siteground',
    'coolify', 'dokku',
  ],
  topics: [
    'hosting', 'host', 'hosted', 'deploy', 'deploying', 'deployment', 'deployments', 'server',
    'servers', 'next js', 'docker', 'kubernetes', 'container', 'containers', 'cloud', 'aws',
    'gcp', 'azure', 'ec2', 'lambda', 's3', 'static site', 'domain', 'domain name', 'dns', 'ssl',
    'ssl certificate', 'nginx', 'load balancer', 'vm', 'virtual machine', 'serverless',
    'edge functions', 'ssr', 'jamstack', 'railway',
  ],
  patterns: [
    String.raw`\bdeploy(ing)? (my|our|a|an|the) \w+( \w+)? (app|site|application|api|project|website)\b`,
    String.raw`\b(host|hosting) (my|our|a|an|the) \w+( \w+)? (app|site|application|api|project|website)\b`,
  ],
};
