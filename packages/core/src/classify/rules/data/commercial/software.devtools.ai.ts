import type { CommercialRuleSet } from '../../types.js';

/** AI infrastructure: LLM and inference APIs, GPU clouds, vector stores, AI dev tools. */
export const SOFTWARE_DEVTOOLS_AI: CommercialRuleSet = {
  category: 'software.devtools.ai',
  products: [
    'vector database', 'vector db', 'llm api', 'llm provider', 'llm hosting', 'gpu hosting',
    'gpu cloud', 'gpu provider', 'gpu rental', 'rent a gpu', 'inference api',
    'inference provider', 'inference endpoint', 'model hosting', 'embedding api',
    'embeddings api', 'openai api', 'anthropic api', 'claude api', 'gemini api', 'openrouter',
    'together ai', 'fireworks ai', 'groq', 'hugging face inference', 'huggingface inference',
    'modal labs', 'baseten', 'runpod', 'lambda labs', 'vast ai', 'coreweave', 'langsmith',
    'langfuse', 'helicone', 'braintrust', 'prompt management tool', 'llm observability',
    'llm gateway', 'ai gateway', 'rag platform', 'vector store', 'vector search service',
    'pinecone', 'weaviate', 'qdrant', 'chromadb', 'chroma db', 'milvus', 'ai api',
    'speech to text api', 'text to speech api', 'whisper api', 'deepgram', 'assemblyai',
    'elevenlabs', 'image generation api', 'stable diffusion hosting', 'fine tuning service',
    'fine tuning platform', 'ai coding assistant', 'copilot alternative', 'cursor ide',
    'cursor editor', 'github copilot', 'codeium', 'tabnine', 'windsurf',
  ],
  topics: [
    'llm', 'llms', 'ai', 'gpt', 'gpt 4', 'gpt 4o', 'chatgpt', 'claude', 'gemini', 'llama',
    'mistral', 'openai', 'anthropic', 'rag', 'retrieval augmented generation', 'embedding',
    'embeddings', 'fine tune', 'fine tuning', 'finetune', 'finetuning', 'prompt engineering',
    'system prompt', 'ai agent', 'ai agents', 'langchain', 'llamaindex', 'llama index',
    'vector search', 'context window', 'inference', 'gpu', 'gpus', 'machine learning', 'ml',
    'transformer', 'transformers', 'pytorch', 'tensorflow', 'hugging face', 'huggingface',
    'ai app', 'chatbot', 'chat bot', 'copilot', 'whisper', 'stable diffusion', 'midjourney',
    'dall e', 'text to speech', 'speech to text', 'tts', 'ocr',
  ],
  patterns: [
    String.raw`\b(cheapest|best|fastest|cheap|good) (llm|gpu|inference|embedding|vector|ai) (api|apis|provider|providers|hosting|cloud|database|db|service|services|platform)\b`,
  ],
};
