import { SensitivityLevel } from '../../domain/value-objects/sensitivity-level.vo';

export interface DocumentAnalysisResultDto {
  summary: string;
  category: string;
  suggestedName: string;
  destinationPath: string;
  confidence: number;
  sensitivity: SensitivityLevel;
  requiresApproval: boolean;
  approvalReason?: string;
  requiresAttention: boolean;
  attentionReason?: string;
  extractedFields: Record<string, string | number | boolean | null>;
  notificationTarget: 'finance' | 'logistics' | 'contracts' | 'general';
}
