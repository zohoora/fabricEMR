/**
 * Medplum AI Bots - Index
 *
 * Exports all AI bots for the Medplum AI-native stack.
 */

// Phase 2: Embedding Pipeline
export { handler as embeddingBot } from './embedding-bot';
export { handler as semanticSearchBot, formatSearchResults } from './semantic-search-bot';
export { handler as ragPipelineBot } from './rag-pipeline-bot';

// Phase 3: AI Command Framework
export * from './types/ai-command-types';
export { handler as commandProcessorBot } from './command-processor-bot';
export { handler as approvalQueueBot } from './approval-queue-bot';

// Phase 4: LLM Integration Bots
export { handler as clinicalDecisionSupportBot } from './clinical-decision-support-bot';
export { handler as documentationAssistantBot } from './documentation-assistant-bot';
export { handler as billingCodeSuggesterBot } from './billing-code-suggester-bot';

// Phase 5: Audit & Compliance
export { handler as auditLoggingBot, logAIAuditEvent, logAIAuditEventBatch } from './audit-logging-bot';
