import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { execFile } from 'child_process';
import { readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { extname, resolve } from 'path';
import { promisify } from 'util';

import { AiAnalysisPort, SearchPlan } from '../../application/ports/ai-analysis.port';
import { DocumentAnalysisResultDto } from '../../application/dto/document-analysis-result.dto';
import { SearchDocumentsInput } from '../../application/dto/search-documents.input';
import { DocumentEntity } from '../../domain/entities/document.entity';

const execFileAsync = promisify(execFile);

interface InspectionPayload {
  path: string;
  inspection?: {
    type?: string;
    likely_scan_only?: boolean;
    text_excerpt?: string;
    recommended_next_step?: string;
    metadata?: Record<string, string>;
    producer?: string;
    title?: string;
    pages?: number;
    textChars?: number;
  };
}

interface RenderedPdfManifest {
  outputDir: string;
  textExcerpt?: string;
  pages: Array<{
    page: number;
    imagePath: string | null;
    textExcerpt?: string;
  }>;
}

interface OcrExtractionPayload {
  full_text?: string;
  mean_score?: number | null;
}

@Injectable()
export class OpenAiDocumentAnalysisService implements AiAnalysisPort {
  constructor(private readonly configService: ConfigService) {}

  async analyze(document: DocumentEntity): Promise<DocumentAnalysisResultDto> {
    const filePath = await this.materializeDocument(document);

    try {
      const inspection = await this.inspectDocument(filePath);
      const extractedText = await this.extractBestText(filePath, inspection);
      return this.heuristicAnalysis(document, extractedText, inspection);
    } finally {
      await rm(filePath, { force: true }).catch(() => undefined);
    }
  }

  async buildSearchPlan(input: SearchDocumentsInput): Promise<SearchPlan> {
    const tokens = input.query
      .toLowerCase()
      .replace(/[^\w\s/-]/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 2);

    const folderHint = tokens.find((token) =>
      ['finance', 'facture', 'contrat', 'logistique', 'administratif', 'etudes', 'juridique'].includes(token),
    );
    return {
      keywords: tokens.slice(0, 8),
      folderHint,
      mimeTypes: input.query.toLowerCase().includes('pdf') ? ['application/pdf'] : undefined,
    };
  }

  private async materializeDocument(document: DocumentEntity): Promise<string> {
    const suffix = extname(document.originalFileName) || this.defaultExtension(document.metadata.mimeType);
    const tempPath = resolve(tmpdir(), `${document.id}${suffix}`);
    await writeFile(tempPath, Buffer.from(document.contentBase64, 'base64'));
    return tempPath;
  }

  private async inspectDocument(filePath: string): Promise<InspectionPayload | null> {
    const scriptPath = resolve(process.cwd(), 'scripts/inspect_document.py');
    const pythonBinary = process.platform === 'win32' ? 'python' : 'python3';

    try {
      const { stdout } = await execFileAsync(pythonBinary, [scriptPath, filePath], {
        cwd: process.cwd(),
        timeout: 120000,
      });
      return JSON.parse(stdout) as InspectionPayload;
    } catch {
      return null;
    }
  }

  private async extractBestText(filePath: string, inspection: InspectionPayload | null): Promise<string> {
    const suffix = extname(filePath).toLowerCase();
    const isVisualDocument = suffix === '.pdf' || ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'].includes(suffix);
    const inspectionText = inspection?.inspection?.text_excerpt?.trim();
    const isBinaryArchiveOrMedia = ['.mp3', '.mp4', '.zip', '.rar'].includes(suffix);

    if (isBinaryArchiveOrMedia) {
      return inspectionText ?? '';
    }

    if (isVisualDocument && inspection?.inspection?.likely_scan_only) {
      const ocrText = await this.extractTextWithPaddleOcr(filePath, inspection);
      if (ocrText) {
        return ocrText;
      }
    }

    if (inspectionText) {
      return inspectionText;
    }

    if (isVisualDocument) {
      const ocrText = await this.extractTextWithPaddleOcr(filePath, inspection);
      if (ocrText) {
        return ocrText;
      }
    }

    const rawSample = (await readFile(filePath)).toString('utf8').slice(0, 6000).trim();
    if (rawSample.length > 120) {
      return rawSample;
    }

    const ocrText = await this.extractTextWithPaddleOcr(filePath, inspection);
    return ocrText || rawSample;
  }

  private async extractTextWithPaddleOcr(filePath: string, inspection: InspectionPayload | null): Promise<string> {
    if (!this.configService.get<boolean>('documentManagement.analysis.enablePaddleOcr')) {
      return '';
    }

    const suffix = extname(filePath).toLowerCase();
    if (['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.tif', '.tiff'].includes(suffix)) {
      return this.runPaddleOcr([filePath]);
    }

    if (suffix !== '.pdf') {
      return '';
    }

    const manifest = await this.renderPdfForOcr(filePath);
    if (!manifest) {
      return '';
    }

    try {
      const imagePaths = manifest.pages
        .map((page) => page.imagePath)
        .filter((imagePath): imagePath is string => Boolean(imagePath));

      if (!imagePaths.length && inspection?.inspection?.likely_scan_only) {
        return manifest.textExcerpt?.trim() ?? '';
      }

      const ocrText = await this.runPaddleOcr(imagePaths);
      return ocrText || manifest.textExcerpt?.trim() || '';
    } finally {
      await rm(manifest.outputDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async renderPdfForOcr(filePath: string): Promise<RenderedPdfManifest | null> {
    const scriptPath = resolve(process.cwd(), 'scripts/render_pdf_pages.mjs');
    const maxPages = String(this.configService.get<number>('documentManagement.analysis.maxRenderedPages') ?? 4);

    try {
      const { stdout } = await execFileAsync(
        'node',
        [scriptPath, filePath, '--max-pages', maxPages, '--force-images'],
        {
          cwd: process.cwd(),
          timeout: 120000,
        },
      );
      return JSON.parse(stdout) as RenderedPdfManifest;
    } catch {
      return null;
    }
  }

  private async runPaddleOcr(imagePaths: string[]): Promise<string> {
    if (!imagePaths.length) {
      return '';
    }

    const scriptPath = resolve(process.cwd(), 'scripts/paddle_ocr_extract.py');
    const pythonBinary = process.platform === 'win32' ? 'python' : 'python3';
    const language = this.configService.get<string>('documentManagement.analysis.paddleOcrLang') ?? 'fr';

    try {
      const { stdout } = await execFileAsync(
        pythonBinary,
        [scriptPath, ...imagePaths, '--lang', language],
        {
          cwd: process.cwd(),
          timeout: 300000,
          maxBuffer: 16 * 1024 * 1024,
        },
      );
      const payload = JSON.parse(stdout) as OcrExtractionPayload;
      return payload.full_text?.trim() ?? '';
    } catch {
      return '';
    }
  }

  private heuristicAnalysis(
    document: DocumentEntity,
    extractedText: string,
    inspection: InspectionPayload | null,
  ): DocumentAnalysisResultDto {
    const lowered = `${document.originalFileName} ${extractedText}`.toLowerCase();
    const normalized = this.normalizeForMatching(lowered);
    const documentDate = this.extractDate(normalized) ?? document.metadata.receivedAt.slice(0, 10);
    const person = this.extractPersonLabel(extractedText) ?? this.extractPersonLabel(document.originalFileName) ?? 'document';
    const suffix = extname(document.originalFileName) || this.defaultExtension(document.metadata.mimeType) || '.pdf';
    const dateParts = this.toDateParts(documentDate);
    const mimeType = document.metadata.mimeType.toLowerCase();
    const baseSlug = this.slug(document.originalFileName.replace(/\.[^.]+$/, ''));

    if (mimeType.startsWith('audio/')) {
      return {
        summary: 'Fichier audio archive automatiquement.',
        category: 'archives.media.audio',
        suggestedName: this.buildStandardizedFileName(documentDate, ['audio', baseSlug], suffix),
        destinationPath: `Archives/Medias/Audio/${dateParts.year}/${dateParts.month}`,
        confidence: 0.96,
        sensitivity: 'normal',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'audio',
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (mimeType.startsWith('video/')) {
      return {
        summary: 'Fichier video archive automatiquement.',
        category: 'archives.media.video',
        suggestedName: this.buildStandardizedFileName(documentDate, ['video', baseSlug], suffix),
        destinationPath: `Archives/Medias/Video/${dateParts.year}/${dateParts.month}`,
        confidence: 0.96,
        sensitivity: 'normal',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'video',
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (
      mimeType === 'application/zip' ||
      mimeType === 'application/x-zip-compressed' ||
      mimeType === 'application/x-rar-compressed' ||
      mimeType === 'application/rar'
    ) {
      return {
        summary: 'Archive compressee classee automatiquement.',
        category: 'archives.compressed',
        suggestedName: this.buildStandardizedFileName(documentDate, ['archive', baseSlug], suffix),
        destinationPath: `Archives/Fichiers-Compresses/${dateParts.year}/${dateParts.month}`,
        confidence: 0.95,
        sensitivity: 'normal',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'compressed-archive',
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (
      normalized.includes('complementaire sante') ||
      normalized.includes('mutuelle') ||
      normalized.includes('carte sante')
    ) {
      return {
        summary: 'Document sante detecte.',
        category: 'administratif.sante',
        suggestedName: this.buildStandardizedFileName(documentDate, ['sante'], suffix),
        destinationPath: `Administratif/Sante/${dateParts.year}`,
        confidence: 0.88,
        sensitivity: 'sensitive',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'sante',
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (normalized.includes('releve de notes') || normalized.includes('but 2a') || normalized.includes('iut de toulouse 3')) {
      return {
        summary: `Releve de notes detecte pour ${person}.`,
        category: 'administratif.releves-notes',
        suggestedName: this.buildStandardizedFileName(documentDate, ['releve-notes', person], suffix),
        destinationPath: `Administratif/Etudes/Releves-notes/${dateParts.year}`,
        confidence: 0.88,
        sensitivity: 'normal',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          person,
          type: 'releve-notes',
          source: document.source,
          scanOnly: inspection?.inspection?.likely_scan_only ?? false,
        },
        notificationTarget: 'general',
      };
    }

    if (
      normalized.includes('quittance') ||
      normalized.includes('avis echeance') ||
      normalized.includes('avis d echeance') ||
      normalized.includes('echeance loyer')
    ) {
      const leaseDocType = normalized.includes('quittance') ? 'quittance-loyer' : 'avis-echeance';
      return {
        summary: `Document immobilier detecte (${leaseDocType}).`,
        category: 'administratif.immobilier.loyer',
        suggestedName: this.buildStandardizedFileName(documentDate, [leaseDocType], suffix),
        destinationPath: `Administratif/Immobilier/Loyers/${dateParts.year}/${dateParts.month}`,
        confidence: 0.9,
        sensitivity: 'sensitive',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: leaseDocType,
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (
      normalized.includes('business plan') ||
      normalized.includes('businessplan') ||
      normalized.includes('expo') ||
      normalized.includes('oral') ||
      normalized.includes('sae') ||
      normalized.includes('etude ia') ||
      normalized.includes('anglais')
    ) {
      const studyType = normalized.includes('business plan') || normalized.includes('businessplan')
        ? 'business-plan'
        : normalized.includes('expo')
          ? 'presentation'
          : normalized.includes('oral')
            ? 'oral'
            : normalized.includes('sae')
              ? 'sae'
              : normalized.includes('anglais')
                ? 'anglais'
                : 'etude';
      return {
        summary: `Document d etudes detecte (${studyType}).`,
        category: 'administratif.etudes.document',
        suggestedName: this.buildStandardizedFileName(
          documentDate,
          [studyType, person !== 'document' ? person : null],
          suffix,
        ),
        destinationPath: `Administratif/Etudes/Documents/${dateParts.year}/${dateParts.month}`,
        confidence: 0.82,
        sensitivity: 'normal',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: studyType,
          person,
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (normalized.includes('facture') || normalized.includes('invoice')) {
      const issuer =
        this.extractOrganizationLabel(extractedText) ??
        this.extractOrganizationLabel(document.originalFileName);
      const monetaryAmount = this.extractAmount(extractedText);
      const amountLabel = monetaryAmount ? monetaryAmount.replace(/[^\dA-Za-z-]+/g, '-') : null;
      const requiresAttention = !issuer;
      const destinationRoot = requiresAttention ? 'Finance/Factures/A-verifier' : 'Finance/Factures';
      const summary = requiresAttention
        ? 'Facture detectee, fournisseur non identifie automatiquement.'
        : `Facture detectee, fournisseur probable: ${issuer}.`;
      return {
        summary,
        category: 'finance.facture',
        suggestedName: this.buildStandardizedFileName(
          documentDate,
          ['facture', issuer ?? 'fournisseur-inconnu', amountLabel ?? null],
          suffix,
        ),
        destinationPath: `${destinationRoot}/${dateParts.year}/${dateParts.month}`,
        confidence: 0.82,
        sensitivity: 'high-risk',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          issuer,
          supplier: issuer,
          amount: monetaryAmount,
          source: document.source,
        },
        notificationTarget: 'finance',
      };
    }

    if (
      normalized.includes('fiche renseignement') &&
      (normalized.includes('garant') || normalized.includes('caution'))
    ) {
      return {
        summary: 'Fiche de renseignement garant detectee.',
        category: 'administratif.immobilier.candidature.garant',
        suggestedName: this.buildStandardizedFileName(documentDate, ['fiche-renseignement-garant'], suffix),
        destinationPath: `Administratif/Immobilier/Candidatures/Garants/${dateParts.year}/${dateParts.month}`,
        confidence: 0.9,
        sensitivity: 'sensitive',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'fiche-renseignement-garant',
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (normalized.includes('fiche renseignement') && normalized.includes('locataire')) {
      return {
        summary: 'Fiche de renseignement locataire detectee.',
        category: 'administratif.immobilier.candidature.locataire',
        suggestedName: this.buildStandardizedFileName(documentDate, ['fiche-renseignement-locataire'], suffix),
        destinationPath: `Administratif/Immobilier/Candidatures/Locataires/${dateParts.year}/${dateParts.month}`,
        confidence: 0.9,
        sensitivity: 'sensitive',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'fiche-renseignement-locataire',
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (
      normalized.includes('bail') ||
      normalized.includes('contrat de location') ||
      normalized.includes('location meubl') ||
      normalized.includes('location nue')
    ) {
      return {
        summary: 'Bail immobilier detecte.',
        category: 'administratif.immobilier.bail',
        suggestedName: this.buildStandardizedFileName(documentDate, ['bail'], suffix),
        destinationPath: `Administratif/Immobilier/Baux/${dateParts.year}`,
        confidence: 0.86,
        sensitivity: 'sensitive',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'bail',
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (
      normalized.includes('fiche candidat') ||
      normalized.includes('dossier candidature') ||
      normalized.includes('cautionnaire') ||
      normalized.includes('locataire') ||
      normalized.includes('renseignements locataires')
    ) {
      const profileType = normalized.includes('caution') || normalized.includes('garant')
        ? 'candidature-garant'
        : normalized.includes('dossier candidature')
          ? 'dossier-candidature'
          : 'candidature-locataire';
      return {
        summary: `Dossier de candidature locative detecte (${profileType}).`,
        category: 'administratif.immobilier.candidature',
        suggestedName: this.buildStandardizedFileName(documentDate, [profileType], suffix),
        destinationPath:
          profileType === 'dossier-candidature'
            ? `Administratif/Immobilier/Candidatures/Dossiers/${dateParts.year}/${dateParts.month}`
            : profileType === 'candidature-garant'
              ? `Administratif/Immobilier/Candidatures/Garants/${dateParts.year}/${dateParts.month}`
              : `Administratif/Immobilier/Candidatures/Locataires/${dateParts.year}/${dateParts.month}`,
        confidence: 0.83,
        sensitivity: 'sensitive',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: profileType,
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (normalized.includes('bulletin') || normalized.includes('bulletins')) {
      return {
        summary: 'Bulletin detecte.',
        category: 'administratif.immobilier.justificatif-revenus',
        suggestedName: this.buildStandardizedFileName(documentDate, ['bulletin'], suffix),
        destinationPath: `Administratif/Immobilier/Candidatures/Justificatifs-Revenus/${dateParts.year}/${dateParts.month}`,
        confidence: 0.84,
        sensitivity: 'sensitive',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'bulletin',
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (normalized.includes('iban') || normalized.includes('rib') || normalized.includes('releve d identite bancaire')) {
      return {
        summary: 'Coordonnees bancaires detectees.',
        category: 'administratif.immobilier.coordonnees-bancaires',
        suggestedName: this.buildStandardizedFileName(documentDate, ['coordonnees-bancaires'], suffix),
        destinationPath: `Administratif/Immobilier/Candidatures/Coordonnees-Bancaires/${dateParts.year}/${dateParts.month}`,
        confidence: 0.86,
        sensitivity: 'sensitive',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'coordonnees-bancaires',
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (normalized.includes('cv') || normalized.includes('curriculum vitae')) {
      return {
        summary: 'CV detecte.',
        category: 'administratif.rh.cv',
        suggestedName: this.buildStandardizedFileName(documentDate, ['cv', person !== 'document' ? person : null], suffix),
        destinationPath: `Administratif/RH/CV/${dateParts.year}`,
        confidence: 0.8,
        sensitivity: 'sensitive',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'cv',
          person,
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (
      normalized.includes('modele lettre') ||
      normalized.includes('modèle lettre') ||
      normalized.includes('preavis') ||
      normalized.includes('préavis')
    ) {
      return {
        summary: 'Modele de courrier detecte.',
        category: 'administratif.modeles-courriers',
        suggestedName: this.buildStandardizedFileName(documentDate, ['modele-courrier'], suffix),
        destinationPath: `Administratif/Modeles-Courriers/${dateParts.year}`,
        confidence: 0.82,
        sensitivity: 'normal',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'modele-courrier',
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (
      normalized.includes('charges recuperables') ||
      normalized.includes('reparations locatives') ||
      normalized.includes('grille de vetuste')
    ) {
      const referenceType = normalized.includes('charges') ? 'charges-recuperables' : 'reparations-locatives';
      return {
        summary: `Document de reference immobiliere detecte (${referenceType}).`,
        category: 'administratif.immobilier.reference',
        suggestedName: this.buildStandardizedFileName(documentDate, [referenceType], suffix),
        destinationPath: `Administratif/Immobilier/References/${dateParts.year}`,
        confidence: 0.82,
        sensitivity: 'normal',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: referenceType,
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (
      normalized.includes('complementaire sante') ||
      normalized.includes('mutuelle') ||
      normalized.includes('carte sante')
    ) {
      return {
        summary: 'Document sante detecte.',
        category: 'administratif.sante',
        suggestedName: this.buildStandardizedFileName(documentDate, ['sante'], suffix),
        destinationPath: `Administratif/Sante/${dateParts.year}`,
        confidence: 0.8,
        sensitivity: 'sensitive',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: 'sante',
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (normalized.includes('contrat') || normalized.includes('contract')) {
      const counterparty = this.extractOrganizationLabel(extractedText) ?? person;
      return {
        summary: `Contrat detecte avec ${counterparty}.`,
        category: 'administratif.contrat',
        suggestedName: this.buildStandardizedFileName(documentDate, ['contrat', counterparty], suffix),
        destinationPath: `Administratif/Contrats/${dateParts.year}`,
        confidence: 0.8,
        sensitivity: 'sensitive',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          counterparty,
          source: document.source,
        },
        notificationTarget: 'contracts',
      };
    }

    if (
      normalized.includes('eula') ||
      normalized.includes('terms of use') ||
      normalized.includes('terms_of_use') ||
      normalized.includes('privacy policy') ||
      normalized.includes('privacy_policy') ||
      normalized.includes('cookie policy') ||
      normalized.includes('cookie_policy')
    ) {
      const label = this.extractLegalDocumentLabel(normalized);
      return {
        summary: `Document juridique standard detecte: ${label}.`,
        category: 'administratif.conditions-generales',
        suggestedName: this.buildStandardizedFileName(documentDate, [label], suffix),
        destinationPath: `Administratif/Juridique/Conditions-generales/${dateParts.year}`,
        confidence: 0.84,
        sensitivity: 'normal',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: label,
          source: document.source,
        },
        notificationTarget: 'general',
      };
    }

    if (
      normalized.includes('transport') ||
      normalized.includes('shipping') ||
      normalized.includes('livraison') ||
      normalized.includes('douane') ||
      normalized.includes('customs')
    ) {
      const logisticsType =
        normalized.includes('douane') || normalized.includes('customs') ? 'douane' : 'transport';
      return {
        summary: `Document logistique detecte (${logisticsType}).`,
        category: logisticsType === 'douane' ? 'logistique.douane' : 'logistique.document',
        suggestedName: this.buildStandardizedFileName(documentDate, [logisticsType], suffix),
        destinationPath:
          logisticsType === 'douane'
            ? `Logistique/Douanes/${dateParts.year}/${dateParts.month}`
            : `Logistique/Documents/${dateParts.year}/${dateParts.month}`,
        confidence: 0.75,
        sensitivity: 'normal',
        requiresApproval: false,
        approvalReason: undefined,
        requiresAttention: false,
        attentionReason: undefined,
        extractedFields: {
          type: logisticsType,
          source: document.source,
        },
        notificationTarget: 'logistics',
      };
    }

    return {
      summary: `Document archive automatiquement depuis ${document.source}.`,
      category: 'archives.non-qualifies',
      suggestedName: this.buildStandardizedFileName(
        documentDate,
        ['archive', baseSlug],
        suffix,
      ),
      destinationPath: `Archives/Classement-Auto/Non-qualifies/${dateParts.year}/${dateParts.month}`,
      confidence: 0.7,
      sensitivity: 'normal',
      requiresApproval: false,
      approvalReason: undefined,
      requiresAttention: false,
      attentionReason: undefined,
      extractedFields: {
        source: document.source,
        scanOnly: inspection?.inspection?.likely_scan_only ?? false,
      },
      notificationTarget: 'general',
    };
  }

  private buildStandardizedFileName(documentDate: string, segments: Array<string | null>, suffix: string): string {
    const normalizedSegments = segments
      .map((segment) => this.normalizeSegment(segment))
      .filter((segment): segment is string => Boolean(segment));
    return this.normalizeFilename([documentDate, ...normalizedSegments].join('_'), suffix);
  }

  private normalizeFilename(fileName: string, suffix: string): string {
    const lower = fileName.toLowerCase();
    const normalized = lower
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/_+/g, '_')
      .replace(/^[-_]+|[-_]+$/g, '');
    return normalized.includes('.') ? normalized : `${normalized}${suffix}`;
  }

  private normalizeSegment(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    const normalized = value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    return normalized || null;
  }

  private slug(value: string): string {
    return value
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'document';
  }

  private toDateParts(documentDate: string): { year: string; month: string; day: string } {
    const [year = '1970', month = '01', day = '01'] = documentDate.split('-');
    return {
      year,
      month,
      day,
    };
  }

  private normalizeForMatching(value: string): string {
    return value
      .normalize('NFKD')
      .replace(/[^\x00-\x7F]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private extractDate(text: string): string | null {
    const iso = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
    if (iso) {
      return iso[0];
    }
    const french = text.match(/\b(\d{1,2})\s+(janvier|fevrier|mars|avril|mai|juin|juillet|aout|septembre|octobre|novembre|decembre)\s+(20\d{2})\b/);
    if (french) {
      const monthIndex: Record<string, string> = {
        janvier: '01',
        fevrier: '02',
        mars: '03',
        avril: '04',
        mai: '05',
        juin: '06',
        juillet: '07',
        aout: '08',
        septembre: '09',
        octobre: '10',
        novembre: '11',
        decembre: '12',
      };
      return `${french[3]}-${monthIndex[french[2]]}-${french[1].padStart(2, '0')}`;
    }
    return null;
  }

  private extractPersonLabel(text: string): string | null {
    const stopwords = new Set(['releve', 'notes', 'resultats', 'page', 'session', 'unique', 'administration']);
    const matches = Array.from(text.matchAll(/\b([A-Z][A-Z-]{1,})\s+([A-Z][a-z-]{1,})\b/gu));

    for (const match of matches) {
      const surname = match[1] ?? '';
      const givenName = match[2] ?? '';
      const lowered = `${surname} ${givenName}`.toLowerCase();
      if ([surname.toLowerCase(), givenName.toLowerCase()].some((part) => stopwords.has(part))) {
        continue;
      }
      if (lowered.includes('resultat') || lowered.includes('releve')) {
        continue;
      }
      return this.slug(`${surname}-${givenName}`);
    }

    return null;
  }

  private extractOrganizationLabel(text: string): string | null {
    const normalized = text.toLowerCase();
    if (normalized.includes('iut de toulouse 3')) {
      return 'iut-toulouse3';
    }
    const matches = [
      normalized.match(/\b(?:facture|invoice)\s+(?:de|from)\s+([a-z0-9& .'-]{3,})/i),
      normalized.match(/\bfournisseur\s*:\s*([a-z0-9& .'-]{3,})/i),
      normalized.match(/\bvendor\s*:\s*([a-z0-9& .'-]{3,})/i),
      normalized.match(/\b(?:sarl|sas|eurl|inc|llc)\s+([a-z0-9& .'-]{2,})/i),
    ];

    for (const match of matches) {
      const label = this.normalizeSegment(match?.[1] ?? null);
      if (label) {
        return label;
      }
    }

    return null;
  }

  private extractAmount(text: string): string | null {
    const normalized = text
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .replace(/eur/gi, 'EUR');
    const matches = Array.from(
      normalized.matchAll(/\b(\d{1,3}(?:[ .]\d{3})*(?:[,.]\d{2})|\d+(?:[,.]\d{2}))\s?(EUR|€|\$|USD)?\b/g),
    );

    for (const match of matches.reverse()) {
      const rawAmount = match[1]?.replace(/[ .]/g, '').replace(',', '.');
      if (!rawAmount) {
        continue;
      }

      const currency = match[2]?.replace('€', 'EUR') ?? 'EUR';
      return `${rawAmount}-${currency.toLowerCase()}`;
    }

    return null;
  }

  private extractLegalDocumentLabel(text: string): string {
    if (text.includes('privacy policy') || text.includes('privacy_policy')) {
      return 'politique-confidentialite';
    }
    if (text.includes('cookie policy') || text.includes('cookie_policy')) {
      return 'politique-cookies';
    }
    if (text.includes('terms of use') || text.includes('terms_of_use')) {
      return 'conditions-utilisation';
    }
    return 'licence-utilisateur';
  }

  private defaultExtension(mimeType: string): string {
    if (mimeType === 'application/pdf') {
      return '.pdf';
    }
    if (mimeType.includes('word')) {
      return '.docx';
    }
    if (mimeType === 'image/png') {
      return '.png';
    }
    if (mimeType === 'image/jpeg') {
      return '.jpg';
    }
    if (mimeType === 'audio/mpeg' || mimeType === 'audio/mp3') {
      return '.mp3';
    }
    if (mimeType === 'video/mp4') {
      return '.mp4';
    }
    if (mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') {
      return '.zip';
    }
    if (mimeType === 'application/x-rar-compressed' || mimeType === 'application/rar') {
      return '.rar';
    }
    return '.bin';
  }
}
