/**
 * AI Command Types for Medplum
 *
 * These types define the structured commands that AI can propose.
 * Commands are validated by the command processor before execution.
 */

import { Reference, CodeableConcept } from '@medplum/fhirtypes';

// Base command interface
export interface AICommandBase {
  command: string;
  confidence: number;
  reasoning?: string;
  requiresApproval: boolean;
  createdAt?: string; // Set by processor if not provided
  aiModel: string;
  promptTemplate?: string;
  retrievalSources?: string[];
}

// Create encounter note draft
export interface CreateEncounterNoteDraft extends AICommandBase {
  command: 'CreateEncounterNoteDraft';
  encounterId: string;
  patientId: string;
  noteType: 'progress' | 'discharge' | 'consultation' | 'procedure' | 'history';
  content: string;
  sections?: {
    chiefComplaint?: string;
    historyOfPresentIllness?: string;
    reviewOfSystems?: string;
    physicalExam?: string;
    assessment?: string;
    plan?: string;
  };
  requiresApproval: true; // Always requires approval
}

// Propose problem list update
export interface ProposeProblemListUpdate extends AICommandBase {
  command: 'ProposeProblemListUpdate';
  patientId: string;
  action: 'add' | 'resolve' | 'update';
  condition: {
    code: string;
    system: string;
    display: string;
  };
  clinicalStatus?: 'active' | 'recurrence' | 'relapse' | 'inactive' | 'remission' | 'resolved';
  verificationStatus?: 'unconfirmed' | 'provisional' | 'differential' | 'confirmed';
  severity?: 'mild' | 'moderate' | 'severe';
  onsetDate?: string;
}

// Suggest billing codes
export interface SuggestBillingCodes extends AICommandBase {
  command: 'SuggestBillingCodes';
  encounterId: string;
  patientId: string;
  suggestedCodes: Array<{
    code: string;
    system: 'CPT' | 'ICD-10-CM' | 'ICD-10-PCS' | 'HCPCS';
    display: string;
    confidence: number;
    rationale?: string;
  }>;
  requiresApproval: true; // Always requires approval
}

// Queue referral letter
export interface QueueReferralLetter extends AICommandBase {
  command: 'QueueReferralLetter';
  patientId: string;
  referringPractitionerId: string;
  recipientPractitionerId?: string;
  specialty: string;
  urgency: 'routine' | 'urgent' | 'emergent';
  reasonForReferral: string;
  clinicalSummary: string;
  specificQuestions?: string[];
}

// Flag abnormal result
export interface FlagAbnormalResult extends AICommandBase {
  command: 'FlagAbnormalResult';
  patientId: string;
  observationId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  interpretation: string;
  suggestedActions?: string[];
  requiresApproval: false; // Auto-flag but logged
}

// Suggest medication change
export interface SuggestMedicationChange extends AICommandBase {
  command: 'SuggestMedicationChange';
  patientId: string;
  currentMedicationId?: string;
  action: 'start' | 'stop' | 'modify' | 'substitute';
  medication: {
    code: string;
    system: string;
    display: string;
  };
  dosage?: string;
  frequency?: string;
  duration?: string;
  rationale: string;
  interactions?: Array<{
    medication: string;
    severity: 'minor' | 'moderate' | 'major';
    description: string;
  }>;
  requiresApproval: true; // Always requires approval
}

// Summarize patient history
export interface SummarizePatientHistory extends AICommandBase {
  command: 'SummarizePatientHistory';
  patientId: string;
  summaryType: 'comprehensive' | 'problem-focused' | 'medication' | 'surgical' | 'social';
  timeRange?: {
    start: string;
    end: string;
  };
  summary: string;
  keyFindings: string[];
  requiresApproval: false; // Read-only summary
}

// Union type for all commands
export type AICommand =
  | CreateEncounterNoteDraft
  | ProposeProblemListUpdate
  | SuggestBillingCodes
  | QueueReferralLetter
  | FlagAbnormalResult
  | SuggestMedicationChange
  | SummarizePatientHistory;

// Approval rule configuration
export interface ApprovalRule {
  requiresApproval: boolean | ((cmd: AICommand) => boolean);
  approverRoles: string[];
  timeout: string; // e.g., '24h', '7d'
  notifyRoles?: string[];
  auditRequired: boolean;
  dualApproval?: boolean;
}

// Safety filter configuration
export interface SafetyFilter {
  name: string;
  description: string;
  enabled: boolean;
  action: 'block' | 'warn' | 'require_approval';
  conditions: SafetyCondition[];
}

export interface SafetyCondition {
  field: string;
  operator: 'equals' | 'contains' | 'matches' | 'greater_than' | 'less_than';
  value: string | number | boolean;
}

// Default approval rules
export const DEFAULT_APPROVAL_RULES: Record<string, ApprovalRule> = {
  CreateEncounterNoteDraft: {
    requiresApproval: true,
    approverRoles: ['Practitioner', 'Nurse'],
    timeout: '24h',
    auditRequired: true,
  },
  ProposeProblemListUpdate: {
    requiresApproval: (cmd) => {
      const c = cmd as ProposeProblemListUpdate;
      return c.action !== 'add' || c.confidence < 0.9;
    },
    approverRoles: ['Practitioner'],
    timeout: '48h',
    auditRequired: true,
  },
  SuggestBillingCodes: {
    requiresApproval: true,
    approverRoles: ['Practitioner', 'BillingSpecialist'],
    timeout: '7d',
    auditRequired: true,
  },
  QueueReferralLetter: {
    requiresApproval: true,
    approverRoles: ['Practitioner'],
    timeout: '48h',
    auditRequired: true,
  },
  FlagAbnormalResult: {
    requiresApproval: false,
    approverRoles: [],
    timeout: '0',
    notifyRoles: ['Practitioner'],
    auditRequired: true,
  },
  SuggestMedicationChange: {
    requiresApproval: true,
    approverRoles: ['Practitioner', 'Pharmacist'],
    timeout: '24h',
    auditRequired: true,
    dualApproval: false, // Set to true for controlled substances
  },
  SummarizePatientHistory: {
    requiresApproval: false,
    approverRoles: [],
    timeout: '0',
    auditRequired: true,
  },
};

// Default safety filters
export const DEFAULT_SAFETY_FILTERS: SafetyFilter[] = [
  {
    name: 'BlockControlledSubstances',
    description: 'Block AI from directly ordering controlled substances',
    enabled: true,
    action: 'block',
    conditions: [
      { field: 'command', operator: 'equals', value: 'SuggestMedicationChange' },
      { field: 'medication.code', operator: 'matches', value: 'controlled_substance_regex' },
    ],
  },
  {
    name: 'RequireDualApprovalCritical',
    description: 'Require dual approval for critical actions',
    enabled: true,
    action: 'require_approval',
    conditions: [
      { field: 'command', operator: 'contains', value: 'DNR|ICU|Chemotherapy' },
    ],
  },
  {
    name: 'QuietHoursWarning',
    description: 'Warn about actions during quiet hours',
    enabled: true,
    action: 'warn',
    conditions: [
      { field: 'createdAt', operator: 'matches', value: 'T(2[2-3]|0[0-5]):' }, // 10pm-6am
    ],
  },
  {
    name: 'LowConfidenceBlock',
    description: 'Block commands with very low confidence',
    enabled: true,
    action: 'block',
    conditions: [
      { field: 'confidence', operator: 'less_than', value: 0.5 },
    ],
  },
];

// Provenance metadata for AI actions
export interface AIProvenance {
  aiModel: string;
  modelVersion?: string;
  promptTemplate: string;
  promptTemplateVersion?: string;
  confidence: number;
  retrievalSources: string[];
  clinicianAction: 'pending' | 'accepted' | 'edited' | 'rejected';
  clinicianId?: string;
  editedFields?: string[];
  rejectionReason?: string;
}

// Alias for backward compatibility
export type SuggestBillingCodesCommand = SuggestBillingCodes;
