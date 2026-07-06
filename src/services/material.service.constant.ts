// Constant values for the Study Material service (Req 1.16: constant values
// live only in `*.constant.ts`).

/**
 * Prefix applied to every generated Object Storage Key so a Study Material's
 * file bytes are grouped under a predictable namespace within the R2 bucket
 * (Req 1.13, 11.1).
 */
export const MATERIAL_OBJECT_KEY_PREFIX = 'materials/';
