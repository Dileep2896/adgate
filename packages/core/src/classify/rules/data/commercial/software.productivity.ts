import type { CommercialRuleSet } from '../../types.js';

/** Productivity: project and task management, notes, collaboration, automation. */
export const SOFTWARE_PRODUCTIVITY: CommercialRuleSet = {
  category: 'software.productivity',
  products: [
    'project management tool', 'project management software', 'project management app',
    'task management app', 'task manager', 'todo app', 'to do app', 'note taking app',
    'notes app', 'notion', 'notion alternative', 'obsidian', 'evernote', 'roam research',
    'logseq', 'trello', 'asana', 'jira', 'linear app', 'clickup', 'monday com', 'basecamp',
    'airtable', 'slack', 'slack alternative', 'microsoft teams', 'zoom alternative', 'loom',
    'calendly', 'cal com', 'scheduling tool', 'scheduling app', 'calendar app', 'email client',
    'superhuman', 'hey email', 'todoist', 'things 3', 'omnifocus', 'ticktick', 'tick tick',
    'time tracking app', 'time tracker', 'toggl', 'clockify', 'wiki tool', 'team wiki',
    'knowledge base tool', 'docs tool', 'whiteboard app', 'miro', 'figjam', 'excalidraw',
    'kanban tool', 'kanban board', 'crm', 'hubspot', 'pipedrive', 'productivity app',
    'productivity tool', 'focus app', 'pomodoro app', 'habit tracker', 'office suite',
    'google workspace', 'microsoft 365', 'office 365', 'libreoffice', 'pdf editor',
    'screen recorder', 'transcription app', 'otter ai', 'meeting notes app', 'ai note taker',
    'clipboard manager', 'raycast', 'text expander', 'form builder', 'typeform', 'survey tool',
    'docusign', 'e signature', 'esignature', 'zapier', 'make com', 'n8n', 'automation tool',
    'workflow automation',
  ],
  topics: [
    'productivity', 'project management', 'task management', 'todo', 'to do list', 'todo list',
    'note taking', 'kanban', 'sprint', 'sprints', 'backlog', 'roadmap', 'okr', 'okrs', 'standup',
    'standups', 'calendar', 'scheduling', 'collaboration', 'collaborate', 'remote team',
    'team chat', 'wiki', 'second brain', 'pkm', 'markdown notes', 'offline notes', 'sync notes',
    'gantt', 'time tracking', 'pomodoro', 'habit', 'habits', 'getting things done', 'gtd',
    'inbox zero', 'team of', 'works offline', 'offline',
  ],
  patterns: [
    String.raw`\b(project|task|time|team|knowledge|note|notes|work) (management|tracking|taking|collaboration) (tool|tools|app|apps|software|platform|platforms|system|systems|saas)\b`,
    String.raw`\b(notion|trello|asana|jira|slack|evernote|todoist|airtable|obsidian|zoom|calendly) (alternative|alternatives|replacement|competitor|competitors)\b`,
  ],
};
