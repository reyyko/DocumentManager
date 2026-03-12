import { z } from 'zod';

export const searchDocumentsSchema = z.object({
  query: z.string().min(3),
  requesterDiscordId: z.string().min(1),
});

export type SearchDocumentsInput = z.infer<typeof searchDocumentsSchema>;
