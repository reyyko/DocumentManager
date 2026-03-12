export const SENSITIVITY_LEVELS = ['normal', 'sensitive', 'high-risk'] as const;

export type SensitivityLevel = (typeof SENSITIVITY_LEVELS)[number];
