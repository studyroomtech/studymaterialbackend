// Download controller — Download Gate and tracked download (Req 6, 9).
//
// Shapes the HTTP surface of the two download endpoints:
//
//   - `POST /api/downloads/gate` — submits the Download Gate name/email,
//     delegating validation, User Record upsert, and Access Token issuance to
//     the download service, and returns the issued token and its lifetime
//     (Req 6.2–6.5). The resolved User Record id the service also returns is
//     internal and is not exposed in the HTTP response.
//   - `POST /api/materials/:id/download` — resolves the Learner from the Bearer
//     Access Token, records the download, and returns a short-lived presigned
//     R2 URL, delegating to the download service (Req 6.6–6.8, 9.1–9.3). A
//     missing/invalid/expired token surfaces as a 401 so the frontend re-shows
//     the Download Gate (Req 6.1, 6.7).
//
// The controller holds no business logic; it only reads the request, extracts
// the Bearer credential, delegates to the service, and shapes the response.

import type { NextFunction, Request, Response } from 'express';

import { createDefaultDownloadService } from '../services/download.service';
import type {
  DownloadGateResponse,
  DownloadResponse,
  PreviewResponse,
} from '../types/api.types';

const BEARER_PREFIX = 'Bearer ';

/**
 * Extract the raw JWT from an `Authorization: Bearer <token>` header, returning
 * an empty string when the header is absent or is not a non-empty Bearer
 * credential. The download service treats an empty/invalid token as an auth
 * failure and returns a 401 (Req 6.7).
 */
function extractBearerToken(header: string | undefined): string {
  if (typeof header !== 'string' || !header.startsWith(BEARER_PREFIX)) {
    return '';
  }
  return header.slice(BEARER_PREFIX.length).trim();
}

/**
 * `POST /api/downloads/gate` — validate the Download Gate submission, upsert
 * the User Record by email, and issue a learner Access Token (Req 6.2–6.5).
 */
export async function submitGateHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { name, email, password } = req.body as {
      name: string;
      email: string;
      password?: string;
    };
    const result = await createDefaultDownloadService().submitGate(
      name,
      email,
      password,
    );
    const body: DownloadGateResponse = {
      accessToken: result.accessToken,
      expiresInSeconds: result.expiresInSeconds,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/materials/:id/download` — resolve the Learner from the Bearer
 * Access Token, record the download, and return a presigned R2 GET URL
 * (Req 6.6–6.8, 9.1–9.3).
 */
export async function downloadMaterialHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const prepared = await createDefaultDownloadService().prepareDownload(
      token,
      req.params.id,
    );
    const body: DownloadResponse = {
      downloadUrl: prepared.downloadUrl,
      fileName: prepared.fileName,
      expiresInSeconds: prepared.expiresInSeconds,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `POST /api/materials/:id/preview` — resolve the Learner from the Bearer
 * Access Token and return a short-lived inline URL for previewing the Study
 * Material (Req 5.1). Mirrors the download auth/entitlement flow but records no
 * Download Record; a missing/invalid/expired token surfaces as a 401.
 */
export async function previewMaterialHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const token = extractBearerToken(req.headers.authorization);
    const prepared = await createDefaultDownloadService().preparePreview(
      token,
      req.params.id,
    );
    const body: PreviewResponse = {
      previewUrl: prepared.previewUrl,
      fileName: prepared.fileName,
      contentType: prepared.contentType,
      expiresInSeconds: prepared.expiresInSeconds,
    };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}
