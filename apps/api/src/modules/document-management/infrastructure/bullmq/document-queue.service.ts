import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

import { WorkflowQueuePort } from '../../application/ports/workflow-queue.port';

@Injectable()
export class DocumentQueueService implements WorkflowQueuePort {
  constructor(@InjectQueue('document-analysis') private readonly queue: Queue) {}

  async enqueueDocumentAnalysis(documentId: string): Promise<void> {
    await this.queue.add(
      'analyze-document',
      { documentId },
      {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 100,
      },
    );
  }
}
