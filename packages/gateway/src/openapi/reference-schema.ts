import { code } from './markdown.js';
import { COMPONENT_SCHEMA_PREFIX } from './paths.js';

/**
 * Reading a JSON Schema object the way a reader of docs/api-reference.md needs it: a short type
 * name, the constraints a type name cannot carry, and one table row per property. Pure: it
 * takes `unknown` everywhere and never throws on a shape it does not recognise, because the
 * input is whatever the Zod exporter produced.
 */

/** A regex longer than this is noise in a table cell; the schema file carries the full one. */
export const MAX_PATTERN_LENGTH = 48;

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const asString = (value: unknown): string | null =>
  typeof value === 'string' ? value : null;

export const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

/** The component name a `$ref` points at, or null when it is not a component reference. */
export const componentName = (schema: unknown): string | null => {
  const ref = isObject(schema) ? asString(schema['$ref']) : null;
  return ref !== null && ref.startsWith(COMPONENT_SCHEMA_PREFIX)
    ? ref.slice(COMPONENT_SCHEMA_PREFIX.length)
    : null;
};

/** A short type for one schema: its component name, its title, its members, or its JSON type. */
export const typeName = (schema: unknown): string => {
  if (!isObject(schema)) {
    return 'any';
  }
  const referenced = componentName(schema);
  if (referenced !== null) {
    return referenced;
  }
  const title = asString(schema['title']);
  if (title !== null) {
    return title;
  }
  if (schema['const'] !== undefined) {
    return JSON.stringify(schema['const']);
  }
  if (Array.isArray(schema['enum'])) {
    return schema['enum'].map((value) => JSON.stringify(value)).join(' | ');
  }
  const type = schema['type'];
  if (type === 'array') {
    return `${typeName(schema['items'])}[]`;
  }
  if (typeof type === 'string') {
    return type;
  }
  if (Array.isArray(type)) {
    return stringsOf(type).join(' | ');
  }
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const members = schema[key];
    if (Array.isArray(members)) {
      return members.map((member) => typeName(member)).join(' | ');
    }
  }
  return isObject(schema['properties']) ? 'object' : 'any';
};

/** The parts of a schema worth spelling out next to its description. */
export const constraintsOf = (schema: unknown): string[] => {
  if (!isObject(schema)) {
    return [];
  }
  const out: string[] = [];
  if (Array.isArray(schema['enum'])) {
    out.push(`One of: ${schema['enum'].map((value) => code(String(value))).join(', ')}.`);
  }
  if (schema['const'] !== undefined) {
    out.push(`Always ${code(String(schema['const']))}.`);
  }
  const format = asString(schema['format']);
  if (format !== null) {
    out.push(`Format: ${format}.`);
  }
  const pattern = asString(schema['pattern']);
  if (pattern !== null && pattern.length <= MAX_PATTERN_LENGTH) {
    out.push(`Pattern: ${code(pattern)}.`);
  }
  return out;
};

/** A schema's own description followed by `extra` sentences, joined into one cell. */
export const describe = (schema: unknown, extra: readonly string[] = []): string =>
  [asString(isObject(schema) ? schema['description'] : null) ?? '', ...extra]
    .filter((part) => part !== '')
    .join(' ');

/** One row per top-level property of an object schema: name, type, required, notes. */
export const propertyRows = (schema: unknown): string[][] => {
  if (!isObject(schema) || !isObject(schema['properties'])) {
    return [];
  }
  const required = stringsOf(schema['required']);
  return Object.entries(schema['properties']).map(([name, property]) => [
    code(name),
    code(typeName(property)),
    required.includes(name) ? 'yes' : 'no',
    describe(property, constraintsOf(property)),
  ]);
};

/** The refinement keywords zod adds that a property table cannot express, in a fixed order. */
export const REFINEMENT_KEYS = ['anyOf', 'oneOf', 'allOf'] as const;
