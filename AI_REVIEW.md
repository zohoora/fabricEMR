# FabricEMR Review Findings

## Scope
- Reviewed core bot implementations under `bots/src`, deployment scripts, configs, SQL, and docs/tests alignment.
- Focused on correctness, safety/compliance, and operational risks.

## Critical
- Hardcoded bearer token committed in repo. This is a live credential leak; rotate immediately and remove from code. Evidence: `deploy-bots.js:4`.
- Safety filters with `require_approval` are not enforced; they only add warnings. High-risk commands that should require approval can execute if approval rules allow. Evidence: `bots/src/command-processor-bot.ts:143-164`.

## High
- Approval queue subscription criteria does not match actual Task coding, so approvals may never fire. Subscription filters on `Task?code=ai-approval` while tasks are created with code system `http://medplum.com/fhir/CodeSystem/ai-command` and command-specific codes. Evidence: `create-subscriptions.js:66-69`, `bots/src/command-processor-bot.ts:263-270`.
- Safety filters appear ineffective due to placeholder regex and operator mismatch (e.g., `contains` with `DNR|ICU|Chemotherapy` and `matches` with `controlled_substance_regex`). These conditions will not match real inputs. Evidence: `bots/src/types/ai-command-types.ts:221-237`.
- Bots bypass the configured LLM gateway (LiteLLM) and call Ollama directly, so routing, logging, and PHI controls described in config are not applied. Evidence: `bots/src/semantic-search-bot.ts:15`, `bots/src/rag-pipeline-bot.ts:14-16`, `bots/src/clinical-decision-support-bot.ts:24-26`, `bots/src/documentation-assistant-bot.ts:29-31`, `bots/src/billing-code-suggester-bot.ts:24-25`, `docker-compose.yml:102-104`.
- Embeddings are stored as Binary resources instead of the `clinical_embeddings` pgvector table described in SQL/architecture, so semantic search is in-memory and non-scalable. Evidence: `bots/src/embedding-bot.ts:373-397`, `sql/embeddings.sql:1-64`, `ARCHITECTURE.md:248-260`.
- Tests and API docs are materially out of sync with the implementation, so the test suite cannot be trusted to validate behavior. Examples: `bots/tests/unit/semantic-search.test.ts:61-150` (expects `resourceTypes`, `minSimilarity`, `queryEmbeddingGenerated`), `bots/tests/unit/documentation-assistant.test.ts:35-90` (expects `documentationType` and output fields that do not exist), `bots/tests/unit/embedding-bot.test.ts:25-92` (expects `embeddingsCreated` and `skipped`), `bots/docs/API.md:83-178`.

## Medium
- `Binary` search uses `content-type` parameter; FHIR search parameter for Binary is `contenttype`, so filtering is likely ignored and results may be incorrect or large. Evidence: `bots/src/semantic-search-bot.ts:148-153`, `bots/src/rag-pipeline-bot.ts:277-282`.
- Approval notification uses `task.for`, but tasks created in the command processor do not populate `for`, so communications may be invalid or missing a subject. Evidence: `bots/src/command-processor-bot.ts:258-301`, `bots/src/approval-queue-bot.ts:528-545`.
- Approved command modifications are executed without re-validating safety filters or approval rules, allowing a clinician edit to bypass safeguards. Evidence: `bots/src/approval-queue-bot.ts:110-118`.
- Provenance targets for auto-executed commands are likely invalid because `executeCommand` returns bare IDs, not `ResourceType/id`. Evidence: `bots/src/command-processor-bot.ts:369-406`, `bots/src/command-processor-bot.ts:424-428`.
- FHIR search parameters appear inconsistent with resource specs (`patient` is used for Condition, MedicationStatement, Procedure, DiagnosticReport, MedicationRequest, DocumentReference). If the server does not alias `patient` to `subject`, these queries will return empty results. Evidence: `bots/src/rag-pipeline-bot.ts:116-131`, `bots/src/clinical-decision-support-bot.ts:164-178`, `bots/src/documentation-assistant-bot.ts:186-233`, `bots/src/billing-code-suggester-bot.ts:167-214`.
- DocumentReference query uses `context.encounter`, but the standard search parameter is `encounter`; documents may be missed. Evidence: `bots/src/billing-code-suggester-bot.ts:210-214`.
- `getAuditEventsForCommand` searches `entity-name`, but command IDs are stored in `entity.what.display`, so this lookup will usually return nothing. Evidence: `bots/src/audit-logging-bot.ts:120-137`, `bots/src/audit-logging-bot.ts:528-534`.
- Prompt/response logging stores PHI without any gating or redaction despite config indicating redaction/disable options. Evidence: `bots/src/audit-logging-bot.ts:160-186`, `config/safety-filters.yaml:120-206`.

## Low
- `EMBEDDABLE_TYPES` includes `ClinicalImpression`, `Procedure`, and `AllergyIntolerance` but `extractTextContent` has no handling for them, resulting in consistent failures for those types. Evidence: `bots/src/embedding-bot.ts:29-39`, `bots/src/embedding-bot.ts:122-188`.
- Attachment decoding assumes UTF-8 for all `data` blobs; binary PDFs or images will become garbage text and pollute embeddings. Evidence: `bots/src/embedding-bot.ts:137-176`.
- Default configs allow permissive CORS and introspection; fine for local dev but unsafe for production without overrides. Evidence: `medplum.config.json:23-24`, `docker-compose.yml:97-100`.
- `verify-deployment.js` hardcodes the default admin credentials. This should be environment-driven if used outside local dev. Evidence: `verify-deployment.js:16-25`.

## Suggested Fix Order (Practical)
1. Remove the hardcoded token in `deploy-bots.js:4`, rotate the credential, and switch to env-based secrets.
2. Enforce `require_approval` in safety filters and fix filter conditions/regexes in `bots/src/types/ai-command-types.ts`.
3. Fix approval workflow wiring: subscription criteria (`create-subscriptions.js:66-69`), task `for` population, and re-validate modified commands.
4. Decide whether embeddings/search use pgvector or Binary resources, then make code + docs consistent.
5. Align tests and API docs with actual behavior or update implementation to match documented API.

