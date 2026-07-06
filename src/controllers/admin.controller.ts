// Admin controller — Content Management Actions (Req 2.2–2.4, 11).
//
// Shapes the HTTP surface of the admin (role_admin) endpoints. Every handler
// here runs behind `auth.middleware` + `requireAdmin.middleware` (wired in the
// admin routes, task 9.3), so authorization is enforced before any handler
// executes and no non-admin caller can reach these actions (Req 10.5–10.8).
//
// The controller holds no business logic: Study Material upload/edit/delete
// delegate to `material.service.ts`, and Category Type / Category management and
// Tag assign/remove delegate to `category.service.ts`. Handlers only read the
// request, delegate, and shape the JSON response; typed domain errors thrown by
// the services (validation → 422, not-found → 404) are forwarded to the central
// error handler.
//
// Admin login is a placeholder in Phase 1: credential verification (the admin
// service, bcrypt-backed) is not yet built, so the endpoint reports "not
// implemented" rather than issuing an unauthenticated admin token. Wiring the
// real login is a follow-up once the admin service lands.

import type { NextFunction, Request, Response } from 'express';

import { createDefaultCategoryService } from '../services/category.service';
import { createDefaultMaterialService } from '../services/material.service';
import {
  JOB_CATEGORY_TYPE_NAME,
  SUBJECT_CATEGORY_TYPE_NAME,
} from '../constants/categoryTypes.constant';
import type {
  MaterialEditRequest,
  MaterialResponse,
} from '../types/api.types';
import type { RequestWithFile } from './admin.controller.types';

/**
 * `POST /api/admin/login` — placeholder (Req 10.5). Admin credential
 * verification is not yet implemented in Phase 1; rather than issue an
 * unauthenticated admin token, the endpoint reports that login is unavailable.
 */
export function adminLoginHandler(_req: Request, res: Response): void {
  res.status(501).json({
    error: {
      code: 'NOT_IMPLEMENTED',
      message: 'Admin login is not yet available.',
    },
  });
}

// --- Study Material CRUD --------------------------------------------------

/**
 * `POST /api/admin/materials` — upload a Study Material (Req 11.1, 11.2). The
 * title/description/Price come from the multipart fields and the file is
 * attached to the request by the upload middleware; a missing/empty file is
 * rejected by the service with a validation error naming the file (Req 11.2).
 * The optional Price (`priceAmount` + `currency`) is forwarded to the service,
 * which validates its bounds/Currency and rejects an invalid Price with a 422
 * before anything is stored (Req 11.13–11.15).
 */
export async function uploadMaterialHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { title, description, priceAmount, currency, categories, subjects, jobs } =
      req.body as {
        title: string;
        description?: string;
        priceAmount?: number | null;
        currency?: string | null;
        categories?: string[];
        subjects?: string[];
        jobs?: string[];
      };
    const uploaded = (req as Request & RequestWithFile).file;
    const material = await createDefaultMaterialService().uploadMaterial({
      title,
      description,
      priceAmount,
      currency,
      file: {
        body: uploaded?.buffer ?? '',
        fileName: uploaded?.originalname ?? '',
        contentType: uploaded?.mimetype ?? 'application/octet-stream',
        sizeBytes: uploaded?.size ?? 0,
      },
    });
    // Attach the selected/typed classifications (by name) to the new material.
    // An existing value is reused; a new name is auto-created under the relevant
    // Category Type — flat Categories under the default type, Subjects under the
    // Subject type, and Jobs under the Job type (Req 0.1, 2.2).
    const categoryService = createDefaultCategoryService();
    if (Array.isArray(categories) && categories.length > 0) {
      await categoryService.applyCategoriesByName(material.id, categories);
    }
    if (Array.isArray(subjects) && subjects.length > 0) {
      await categoryService.applyCategoriesForType(
        material.id,
        SUBJECT_CATEGORY_TYPE_NAME,
        subjects,
      );
    }
    if (Array.isArray(jobs) && jobs.length > 0) {
      await categoryService.applyCategoriesForType(
        material.id,
        JOB_CATEGORY_TYPE_NAME,
        jobs,
      );
    }
    const body: MaterialResponse = { material };
    res.status(201).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `PATCH /api/admin/materials/:id` — edit a Study Material's title, description,
 * and/or Price (Req 11.5, 11.6, 11.13). Omitted fields are left unchanged; an
 * out-of-bounds title/description or an invalid Price is rejected with the
 * metadata unchanged; a missing material yields a not-found error (Req 11.4,
 * 11.6, 11.15).
 */
export async function editMaterialHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const input = req.body as MaterialEditRequest;
    const material = await createDefaultMaterialService().editMaterial(
      req.params.id,
      input,
    );
    const body: MaterialResponse = { material };
    res.status(200).json(body);
  } catch (error) {
    next(error);
  }
}

/**
 * `DELETE /api/admin/materials/:id` — delete a Study Material and its stored
 * file (Req 11.3). A missing material yields a not-found error with no data
 * changed (Req 11.4).
 */
export async function deleteMaterialHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await createDefaultMaterialService().deleteMaterial(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// --- Tag assignment -------------------------------------------------------

/**
 * `POST /api/admin/materials/:id/tags` — assign a Tag (a Category) to a Study
 * Material, confirming success (Req 2.3). Rejects a Tag outside a supported
 * Category Type or that would exceed the 50-Tag limit, leaving existing Tags
 * unchanged (Req 2.4).
 */
export async function assignTagHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { categoryId } = req.body as { categoryId: string };
    const result = await createDefaultCategoryService().assignTag(
      req.params.id,
      categoryId,
    );
    res
      .status(result.alreadyAssigned ? 200 : 201)
      .json({ tag: result.tag, alreadyAssigned: result.alreadyAssigned });
  } catch (error) {
    next(error);
  }
}

/**
 * `DELETE /api/admin/materials/:id/tags/:categoryId` — remove a Tag from a
 * Study Material (Req 2.4). A missing material or unassigned Tag yields a
 * not-found error.
 */
export async function removeTagHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await createDefaultCategoryService().removeTag(
      req.params.id,
      req.params.categoryId,
    );
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// --- Category Type management ---------------------------------------------

/**
 * `POST /api/admin/category-types` — create a Category Type with a unique name
 * of 1–100 characters (Req 11.7, 11.11).
 */
export async function createCategoryTypeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { name } = req.body as { name: string };
    const categoryType =
      await createDefaultCategoryService().createCategoryType(name);
    res.status(201).json(categoryType);
  } catch (error) {
    next(error);
  }
}

/**
 * `PATCH /api/admin/category-types/:id` — rename a Category Type (Req 11.9,
 * 11.11). A missing target yields a not-found error (Req 11.12).
 */
export async function renameCategoryTypeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { name } = req.body as { name: string };
    const categoryType =
      await createDefaultCategoryService().renameCategoryType(
        req.params.id,
        name,
      );
    res.status(200).json(categoryType);
  } catch (error) {
    next(error);
  }
}

/**
 * `DELETE /api/admin/category-types/:id` — delete a Category Type (Req 11.10).
 * A missing target yields a not-found error (Req 11.12).
 */
export async function deleteCategoryTypeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await createDefaultCategoryService().deleteCategoryType(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}

// --- Category management --------------------------------------------------

/**
 * `POST /api/admin/categories` — create a Category with a name of 1–100
 * characters under an existing Category Type (Req 11.9, 11.11). A missing
 * Category Type yields a not-found error (Req 11.12).
 */
export async function createCategoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { name, categoryTypeId } = req.body as {
      name: string;
      categoryTypeId: string;
    };
    const category = await createDefaultCategoryService().createCategory(
      categoryTypeId,
      name,
    );
    res.status(201).json(category);
  } catch (error) {
    next(error);
  }
}

/**
 * `PATCH /api/admin/categories/:id` — rename a Category to a name unique within
 * its owning Category Type (Req 11.10, 11.11). A missing target yields a
 * not-found error (Req 11.12).
 */
export async function renameCategoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { name } = req.body as { name: string };
    const category = await createDefaultCategoryService().renameCategory(
      req.params.id,
      name,
    );
    res.status(200).json(category);
  } catch (error) {
    next(error);
  }
}

/**
 * `DELETE /api/admin/categories/:id` — delete a Category (Req 11.10). A missing
 * target yields a not-found error (Req 11.12).
 */
export async function deleteCategoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await createDefaultCategoryService().deleteCategory(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
}
