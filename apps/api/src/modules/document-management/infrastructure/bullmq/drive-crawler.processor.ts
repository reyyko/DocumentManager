import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job } from 'bullmq';

import { DriveCrawlerService } from '../../application/services/drive-crawler.service';
import { DriveDailyReportService } from '../../application/services/drive-daily-report.service';

@Injectable()
@Processor('drive-crawler')
export class DriveCrawlerProcessor extends WorkerHost {
  constructor(
    private readonly driveCrawlerService: DriveCrawlerService,
    private readonly driveDailyReportService: DriveDailyReportService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name === 'scan-drive-sort-batch') {
      await this.driveCrawlerService.scanAndQueueDocuments();
      return;
    }

    if (job.name === 'publish-drive-daily-report') {
      await this.driveDailyReportService.publishDailyReport();
      return;
    }

    throw new Error(`Unsupported drive crawler job: ${job.name}`);
  }
}
