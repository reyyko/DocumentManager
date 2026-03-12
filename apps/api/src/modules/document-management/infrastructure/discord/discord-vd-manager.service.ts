import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client, GatewayIntentBits, TextBasedChannel } from 'discord.js';

import { DiscordNotificationPort } from '../../application/ports/discord-notification.port';

@Injectable()
export class DiscordVdManagerService implements DiscordNotificationPort, OnModuleInit {
  private readonly logger = new Logger(DiscordVdManagerService.name);
  private readonly client: Client;

  constructor(private readonly configService: ConfigService) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages],
    });
  }

  async onModuleInit(): Promise<void> {
    const token = this.configService.get<string>('documentManagement.discord.token');
    if (!token) {
      this.logger.warn('Discord bot token missing, notifications will be logged only.');
      return;
    }

    await this.client.login(token);
  }

  async notifyQueue(documentName: string, source: string): Promise<void> {
    await this.sendMessage(
      this.configService.get<string>('documentManagement.discord.vdManagerChannelId'),
      `Piece jointe ${documentName} deposee depuis ${source}, mise en file d'attente pour analyse.`,
    );
  }

  async notifyClassification(params: {
    documentId: string;
    destinationPath: string;
    target: 'finance' | 'logistics' | 'contracts' | 'general';
    summary: string;
  }): Promise<void> {
    const channelId =
      this.configService.get<string>(`documentManagement.routing.${params.target}`) ||
      this.configService.get<string>('documentManagement.discord.vdManagerChannelId');
    await this.sendMessage(
      channelId,
      `Document ${params.documentId} classe dans ${params.destinationPath}. ${params.summary}`,
    );
  }

  async notifyApprovalRequired(params: {
    documentId: string;
    approverDiscordId: string;
    reason: string;
    documentName: string;
  }): Promise<void> {
    const message = `Validation requise pour ${params.documentName} (${params.documentId}). Motif: ${params.reason}`;
    if (!this.client.isReady()) {
      this.logger.warn(`${message} Approver=${params.approverDiscordId}`);
      return;
    }

    try {
      const user = await this.client.users.fetch(params.approverDiscordId);
      await user.send(message);
    } catch (error) {
      this.logger.error(
        `Unable to DM approver ${params.approverDiscordId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  async notifyAttentionRequired(params: {
    documentId: string;
    documentName: string;
    reason: string;
    destinationPath: string;
  }): Promise<void> {
    await this.sendMessage(
      this.configService.get<string>('documentManagement.discord.vdManagerChannelId'),
      `Attention requise pour ${params.documentName} (${params.documentId}). Classe dans ${params.destinationPath}. Motif: ${params.reason}`,
    );
  }

  async notifyDriveDailyReport(message: string): Promise<void> {
    await this.sendMessage(
      this.configService.get<string>('documentManagement.discord.vdManagerChannelId'),
      message,
    );
  }

  private async sendMessage(channelId: string | undefined, message: string): Promise<void> {
    if (!channelId || !this.client.isReady()) {
      this.logger.log(message);
      return;
    }

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (channel?.isTextBased() && 'send' in channel) {
        await (channel as TextBasedChannel & { send: (content: string) => Promise<unknown> }).send(message);
        return;
      }
    } catch (error) {
      this.logger.error(
        `Unable to send Discord message to ${channelId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }

    this.logger.log(message);
  }
}
