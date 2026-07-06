// Types for the Category Type repository (Req 1.15: type declarations live only
// in `*.types.ts`).

import type { CategoryType, Tag } from '@prisma/client';

/**
 * A Category Type together with its Tags, as needed to build the catalog
 * structure (Req 2.5, 3.2).
 */
export type CategoryTypeWithCategories = CategoryType & {
  tags: Tag[];
};
