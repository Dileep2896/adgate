import type { CommercialRuleSet } from '../../types.js';

/** Observability: error tracking, monitoring, logging, incident tools. */
export const SOFTWARE_DEVTOOLS_OBSERVABILITY: CommercialRuleSet = {
  category: 'software.devtools.observability',
  products: [
    'error monitoring', 'error monitoring tool', 'error tracking', 'error tracking tool',
    'sentry', 'datadog', 'new relic', 'newrelic', 'grafana cloud', 'grafana', 'honeycomb',
    'bugsnag', 'rollbar', 'logrocket', 'log rocket', 'betterstack', 'better stack',
    'better uptime', 'uptime robot', 'uptimerobot', 'pingdom', 'splunk', 'dynatrace',
    'appsignal', 'scout apm', 'highlight io', 'logtail', 'papertrail', 'loggly', 'elastic apm',
    'monitoring tool', 'monitoring tools', 'monitoring service', 'monitoring platform',
    'apm tool', 'apm', 'log management', 'logging service', 'logging platform',
    'uptime monitoring', 'observability platform', 'observability tool', 'observability tools',
    'session replay', 'crash reporting', 'crash reporting tool', 'status page',
    'incident management', 'pagerduty', 'opsgenie', 'incident io', 'alerting tool',
    'error reporting service', 'openobserve', 'signoz', 'victoriametrics', 'chronosphere',
  ],
  topics: [
    'monitoring', 'observability', 'logs', 'logging', 'log', 'metrics', 'tracing', 'traces',
    'trace', 'alerting', 'alerts', 'alert', 'uptime', 'telemetry', 'opentelemetry', 'otel',
    'prometheus', 'dashboards', 'dashboard', 'latency', 'p95', 'p99', 'error rate', 'on call',
    'incident', 'incidents', 'exceptions', 'stack trace', 'stack traces', 'crash', 'crashes',
    'downtime', 'sla', 'slo',
  ],
  patterns: [
    String.raw`\b(error|exception|crash|uptime|log|logging|performance|application) (monitoring|tracking|reporting|management) (tool|tools|service|services|platform|platforms|saas|vendor|vendors|provider|providers)\b`,
  ],
};
