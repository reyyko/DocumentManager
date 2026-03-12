import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DriveFileClassificationStateRepository } from '../../domain/repositories/drive-file-classification-state.repository';
import { DiscordNotificationPort } from '../ports/discord-notification.port';
import {
  DISCORD_NOTIFICATION_PORT,
  DRIVE_CLASSIFICATION_STATE_REPOSITORY,
} from '../../document-management.tokens';

@Injectable()
export class DriveDailyReportService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(DRIVE_CLASSIFICATION_STATE_REPOSITORY)
    private readonly driveStateRepository: DriveFileClassificationStateRepository,
    @Inject(DISCORD_NOTIFICATION_PORT) private readonly discordNotifier: DiscordNotificationPort,
  ) {}

  async publishDailyReport(): Promise<void> {
    const timezone =
      this.configService.get<string>('documentManagement.driveCrawler.reportTimezone') ?? 'Europe/Paris';
    const referenceTime = new Date();
    const rows = await this.driveStateRepository.listProcessedForLocalDate(timezone, referenceTime.toISOString());
    const localDate = new Intl.DateTimeFormat('fr-FR', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(referenceTime);

    if (!rows.length) {
      await this.discordNotifier.notifyDriveDailyReport(
        `Rapport Drive ${localDate}: aucun document analyse aujourd'hui.`,
      );
      return;
    }

    const analyzed = rows.length;
    const classified = rows.filter((row) => row.status === 'classified').length;
    const attentionRows = rows.filter((row) =>
      ['attention-required', 'pending-approval', 'failed'].includes(row.status),
    );
    const areas = new Map<string, number>();
    const reasons = new Map<string, number>();

    for (const row of rows) {
      if (row.status !== 'classified') {
        continue;
      }

      const area = this.toBusinessArea(row.destinationPath);
      areas.set(area, (areas.get(area) ?? 0) + 1);
    }

    for (const row of attentionRows) {
      const reason = row.attentionReason ?? 'Qualification manuelle requise';
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }

    const areaSummary = Array.from(areas.entries())
      .sort((left, right) => right[1] - left[1])
      .map(([label, count]) => `${count} dans ${label}`)
      .join(', ');
    const attentionSummary = attentionRows.length
      ? Array.from(reasons.entries())
          .sort((left, right) => right[1] - left[1])
          .map(([label, count]) => `${count} pour ${label.toLowerCase()}`)
          .join(', ')
      : 'aucune attention requise';

    await this.discordNotifier.notifyDriveDailyReport(
      `Rapport Drive ${localDate}: ${analyzed} documents analyses. ${classified} classes automatiquement${areaSummary ? ` (${areaSummary})` : ''}. ${attentionRows.length} requierent votre attention${attentionRows.length ? ` (${attentionSummary})` : ''}.`,
    );
  }

  private toBusinessArea(destinationPath: string | null): string {
    if (!destinationPath) {
      return 'le tri manuel';
    }

    if (destinationPath.startsWith('Finance/')) {
      return 'la comptabilite';
    }
    if (destinationPath.startsWith('Logistique/')) {
      return 'la logistique';
    }
    if (destinationPath.startsWith('Administratif/Contrats')) {
      return 'les contrats';
    }
    return "l'administratif";
  }
}
