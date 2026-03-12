import { Inject, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DriveStoragePort } from '../ports/drive-storage.port';
import { DRIVE_STORAGE_PORT } from '../../document-management.tokens';

@Injectable()
export class DownloadDriveDocumentService {
  constructor(
    private readonly configService: ConfigService,
    @Inject(DRIVE_STORAGE_PORT) private readonly driveStorage: DriveStoragePort,
  ) {}

  async execute(fileId: string) {
    if (!this.configService.get<boolean>('documentManagement.nativeGoogle.enabled')) {
      throw new ServiceUnavailableException('Native Google Drive download is disabled. Configure Google OAuth credentials first.');
    }

    const file = await this.driveStorage.downloadFile(fileId);
    if (!file) {
      throw new NotFoundException(`Google Drive file ${fileId} not found`);
    }

    return file;
  }
}
