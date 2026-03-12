import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

@Injectable()
export class DriveCrawlerSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(DriveCrawlerSchedulerService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectQueue('drive-crawler') private readonly queue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const enabled = this.configService.get<boolean>('documentManagement.driveCrawler.enabled');
    const folderIds = this.configService.get<string[]>('documentManagement.driveCrawler.folderIds') ?? [];
    if (!enabled || !folderIds.length) {
      this.logger.log('Drive crawler disabled or no scan folders configured.');
      return;
    }

    await this.queue.add(
      'scan-drive-sort-batch',
      {},
      {
        jobId: 'drive-crawler-bootstrap',
        removeOnComplete: 1,
        removeOnFail: 10,
      },
    );
    this.logger.log(`Drive crawler bootstrap job queued for ${folderIds.length} folder(s).`);

    await this.queue.upsertJobScheduler(
      'drive-crawler-scan',
      {
        pattern: this.configService.get<string>('documentManagement.driveCrawler.scanCron') ?? '*/15 * * * *',
      },
      {
        name: 'scan-drive-sort-batch',
        data: {},
        opts: {
          removeOnComplete: 20,
          removeOnFail: 20,
        },
      },
    );

    await this.queue.upsertJobScheduler(
      'drive-crawler-report',
      {
        pattern: this.configService.get<string>('documentManagement.driveCrawler.reportCron') ?? '0 18 * * *',
        tz: this.configService.get<string>('documentManagement.driveCrawler.reportTimezone') ?? 'Europe/Paris',
      },
      {
        name: 'publish-drive-daily-report',
        data: {},
        opts: {
          removeOnComplete: 10,
          removeOnFail: 10,
        },
      },
    );
    this.logger.log('Drive crawler schedulers registered.');
  }
}
