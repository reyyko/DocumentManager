import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drive_v3, google } from 'googleapis';
import { Readable } from 'stream';

import {
  ClassifiedDocumentPayload,
  DownloadedDriveFile,
  DriveScanCandidate,
  DriveSearchResult,
  DriveStoragePort,
  ExistingDriveClassificationPayload,
} from '../../application/ports/drive-storage.port';
import { SearchPlan } from '../../application/ports/ai-analysis.port';

@Injectable()
export class GoogleDriveService implements DriveStoragePort {
  private readonly driveClient: drive_v3.Drive | null;

  constructor(private readonly configService: ConfigService) {
    const nativeGoogleEnabled = this.configService.get<boolean>('documentManagement.nativeGoogle.enabled');
    const clientId = this.configService.get<string>('documentManagement.googleDrive.clientId');
    const clientSecret = this.configService.get<string>('documentManagement.googleDrive.clientSecret');
    const refreshToken = this.configService.get<string>('documentManagement.googleDrive.refreshToken');
    const redirectUri = this.configService.get<string>('documentManagement.googleDrive.redirectUri');

    if (!nativeGoogleEnabled || !clientId || !clientSecret || !refreshToken || !redirectUri) {
      this.driveClient = null;
      return;
    }

    const auth = new google.auth.OAuth2(clientId, clientSecret, redirectUri);
    auth.setCredentials({ refresh_token: refreshToken });
    this.driveClient = google.drive({ version: 'v3', auth });
  }

  async storeDocument(payload: ClassifiedDocumentPayload): Promise<string> {
    if (!this.driveClient) {
      return `local-drive-disabled:${payload.folderPath}/${payload.fileName}`;
    }

    const parentId = await this.ensureFolderPath(payload.folderPath);
    const existing = await this.driveClient.files.list({
      q: [
        `name = '${payload.fileName.replace(/'/g, "\\'")}'`,
        `'${parentId}' in parents`,
        'trashed = false',
      ].join(' and '),
      fields: 'files(id,name)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const existingFile = existing.data.files?.[0];
    if (existingFile?.id) {
      return existingFile.id;
    }

    const file = await this.driveClient.files.create({
      requestBody: {
        name: payload.fileName,
        parents: [parentId],
      },
      media: {
        mimeType: payload.mimeType,
        body: Readable.from(Buffer.from(payload.contentBase64, 'base64')),
      },
      fields: 'id',
      supportsAllDrives: true,
    });

    return file.data.id ?? '';
  }

  async classifyExistingDocument(payload: ExistingDriveClassificationPayload): Promise<string> {
    if (!this.driveClient) {
      return `local-drive-disabled:${payload.folderPath}/${payload.fileName}`;
    }

    const parentId = await this.ensureFolderPath(payload.folderPath);
    const metadata = await this.driveClient.files.get({
      fileId: payload.fileId,
      fields: 'id,parents',
      supportsAllDrives: true,
    });

    const currentParents = metadata.data.parents ?? [];
    const removeParents = currentParents.filter((candidate) => candidate !== parentId).join(',');
    const addParents = currentParents.includes(parentId) ? undefined : parentId;

    const updated = await this.driveClient.files.update({
      fileId: payload.fileId,
      requestBody: {
        name: payload.fileName,
      },
      addParents,
      removeParents: removeParents || undefined,
      fields: 'id',
      supportsAllDrives: true,
    });

    return updated.data.id ?? payload.fileId;
  }

  async ensureFolderLoop(folderPath: string): Promise<void> {
    if (!this.driveClient) {
      return;
    }

    await this.ensureFolderPath(folderPath);
  }

  async searchDocuments(plan: SearchPlan): Promise<DriveSearchResult[]> {
    if (!this.driveClient) {
      return [
        {
          fileId: 'local-placeholder',
          name: `Local placeholder for query: ${plan.keywords.join(' ')}`,
          path: plan.folderHint ?? 'Shared/Inbox',
        },
      ];
    }

    const filters = [
      "trashed = false",
      ...plan.keywords.map((keyword) => `fullText contains '${keyword.replace(/'/g, "\\'")}'`),
    ];

    if (plan.mimeTypes?.length) {
      filters.push(`(${plan.mimeTypes.map((mimeType) => `mimeType = '${mimeType}'`).join(' or ')})`);
    }

    const files = await this.driveClient.files.list({
      q: filters.join(' and '),
      fields: 'files(id,name,mimeType,webViewLink,modifiedTime,parents)',
      pageSize: 10,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    return (files.data.files ?? []).map((file) => ({
      fileId: file.id ?? '',
      name: file.name ?? '',
      mimeType: file.mimeType ?? undefined,
      webViewLink: file.webViewLink ?? undefined,
      modifiedTime: file.modifiedTime ?? undefined,
      path: plan.folderHint,
    }));
  }

  async scanFolders(folderIds: string[], limit: number): Promise<DriveScanCandidate[]> {
    if (!this.driveClient || !folderIds.length || limit <= 0) {
      return [];
    }

    const files: DriveScanCandidate[] = [];
    const queue = folderIds.map((folderId) => ({ folderId, path: '' }));

    while (queue.length && files.length < limit) {
      const current = queue.shift();
      if (!current) {
        continue;
      }

      const response = await this.driveClient.files.list({
        q: `'${current.folderId}' in parents and trashed = false`,
        fields: 'files(id,name,mimeType,modifiedTime,webViewLink,parents)',
        pageSize: Math.min(limit - files.length + 20, 100),
        orderBy: 'modifiedTime desc',
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });

      for (const file of response.data.files ?? []) {
        if (!file.id || !file.name) {
          continue;
        }

        if (file.mimeType === 'application/vnd.google-apps.folder') {
          queue.push({
            folderId: file.id,
            path: current.path ? `${current.path}/${file.name}` : file.name,
          });
          continue;
        }

        if (file.mimeType === 'application/vnd.google-apps.shortcut') {
          continue;
        }

        files.push({
          fileId: file.id,
          name: file.name,
          mimeType: file.mimeType ?? undefined,
          modifiedTime: file.modifiedTime ?? undefined,
          webViewLink: file.webViewLink ?? undefined,
          parentIds: file.parents ?? [],
          path: current.path ? `${current.path}/${file.name}` : file.name,
        });

        if (files.length >= limit) {
          break;
        }
      }
    }

    return files;
  }

  async downloadFile(fileId: string): Promise<DownloadedDriveFile | null> {
    if (!this.driveClient) {
      return null;
    }

    const metadata = await this.driveClient.files.get({
      fileId,
      fields: 'id,name,mimeType,modifiedTime,webViewLink,parents,size',
      supportsAllDrives: true,
    });

    if (!metadata.data.id || !metadata.data.name || !metadata.data.mimeType) {
      return null;
    }

    const download = await this.downloadDriveFile(metadata.data.id, metadata.data.mimeType);
    return {
      fileId: metadata.data.id,
      name: metadata.data.name,
      mimeType: download.mimeType,
      modifiedTime: metadata.data.modifiedTime ?? undefined,
      webViewLink: metadata.data.webViewLink ?? undefined,
      parentIds: metadata.data.parents ?? [],
      path: undefined,
      contentBase64: download.buffer.toString('base64'),
      sizeBytes: download.buffer.byteLength,
    };
  }

  private async ensureFolderPath(folderPath: string): Promise<string> {
    if (!this.driveClient) {
      throw new Error('Google Drive is not configured');
    }

    const rootFolderId = this.configService.get<string>('documentManagement.googleDrive.rootFolderId');
    let currentParent = rootFolderId || 'root';

    for (const part of folderPath.split('/').filter(Boolean)) {
      const query = [
        `name = '${part.replace(/'/g, "\\'")}'`,
        "mimeType = 'application/vnd.google-apps.folder'",
        `'${currentParent}' in parents`,
        'trashed = false',
      ].join(' and ');
      const existing = await this.driveClient.files.list({
        q: query,
        fields: 'files(id,name)',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      });
      const folder = existing.data.files?.[0];

      if (folder?.id) {
        currentParent = folder.id;
        continue;
      }

      const created = await this.driveClient.files.create({
        requestBody: {
          name: part,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [currentParent],
        },
        fields: 'id',
        supportsAllDrives: true,
      });
      currentParent = created.data.id ?? currentParent;
    }

    return currentParent;
  }

  private async downloadDriveFile(fileId: string, mimeType: string): Promise<{ buffer: Buffer; mimeType: string }> {
    if (!this.driveClient) {
      throw new Error('Google Drive is not configured');
    }

    if (mimeType === 'application/vnd.google-apps.document') {
      const exportResponse = await this.driveClient.files.export(
        {
          fileId,
          mimeType: 'application/pdf',
        },
        {
          responseType: 'arraybuffer',
        },
      );
      return {
        buffer: Buffer.from(exportResponse.data as ArrayBuffer),
        mimeType: 'application/pdf',
      };
    }

    if (mimeType === 'application/vnd.google-apps.presentation') {
      const exportResponse = await this.driveClient.files.export(
        {
          fileId,
          mimeType: 'application/pdf',
        },
        {
          responseType: 'arraybuffer',
        },
      );
      return {
        buffer: Buffer.from(exportResponse.data as ArrayBuffer),
        mimeType: 'application/pdf',
      };
    }

    const response = await this.driveClient.files.get(
      {
        fileId,
        alt: 'media',
      },
      {
        responseType: 'arraybuffer',
      },
    );

    return {
      buffer: Buffer.from(response.data as ArrayBuffer),
      mimeType,
    };
  }
}
