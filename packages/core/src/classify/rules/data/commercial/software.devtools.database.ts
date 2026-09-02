import type { CommercialRuleSet } from '../../types.js';

/** Databases: managed and hosted database products, engines, vector stores. */
export const SOFTWARE_DEVTOOLS_DATABASE: CommercialRuleSet = {
  category: 'software.devtools.database',
  products: [
    'postgres hosting', 'database hosting', 'db hosting', 'managed postgres', 'managed database',
    'managed redis', 'managed mysql', 'managed mongodb', 'hosted postgres', 'hosted database',
    'hosted redis', 'hosted mysql', 'hosted mongodb', 'serverless postgres',
    'serverless database', 'vector database', 'vector db', 'database provider',
    'database service', 'database as a service', 'dbaas', 'postgres provider', 'redis provider',
    'redis hosting', 'mysql hosting', 'mongodb hosting', 'supabase', 'neon postgres', 'neon db',
    'planetscale', 'cockroachdb', 'mongodb atlas', 'upstash', 'redis cloud', 'elephantsql',
    'rds', 'cloud sql', 'turso', 'xata', 'pinecone', 'weaviate', 'qdrant', 'milvus', 'timescale',
    'clickhouse cloud', 'database backup service',
  ],
  topics: [
    'postgres', 'mysql', 'mariadb', 'mongodb', 'redis', 'sqlite', 'database', 'databases', 'db',
    'sql', 'nosql', 'orm', 'prisma', 'drizzle', 'schema', 'migration', 'migrations', 'query',
    'queries', 'replication', 'sharding', 'connection pool', 'pgbouncer', 'data warehouse',
    'bigquery', 'redshift', 'dynamodb', 'cassandra', 'elasticsearch', 'kv store',
    'key value store', 'embeddings', 'vector search', 'clickhouse', 'duckdb', 'cockroach',
  ],
  patterns: [
    String.raw`\b(postgres|mysql|mongodb|redis|mariadb|sqlite|database|db) (hosting|provider|providers|service|services|host|cloud|vendor|vendors)\b`,
    String.raw`\bmanaged (postgres|mysql|mongodb|redis|database|db|sql)\b`,
  ],
};
