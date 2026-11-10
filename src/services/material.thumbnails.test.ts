// Thumbnail rules of the Study Material service, exercised through in-memory
// fakes (no DB/R2): format detection by magic bytes, size/count limits,
// add/remove, the public DTO shape, and storage cleanup on material delete.
import { describe, expect, it } from 'vitest';

import {
  MAX_THUMBNAIL_SIZE_BYTES,
  MAX_THUMBNAILS_PER_MATERIAL,
} from '../constants/limits.constant';
import { AppError } from '../utils/errors';
import {
  createMaterialService,
  detectThumbnailContentType,
  validateThumbnailsOrThrow,
} from './material.service';
import type {
  MaterialRecord,
  MaterialServiceDeps,
  UploadedFile,
} from './material.service.types';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0]);
const WEBP = Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'latin1');
const HTML = Buffer.from('<html><script>alert(1)</script>', 'utf8');

function image(body: Buffer, sizeBytes = body.byteLength): UploadedFile {
  // The declared MIME type is intentionally wrong: detection must ignore it.
  return { body, fileName: 'x', contentType: 'text/html', sizeBytes };
}

function pdf(): UploadedFile {
  return {
    body: Buffer.from('%PDF-1.4'),
    fileName: 'notes.pdf',
    contentType: 'application/pdf',
    sizeBytes: 8,
  };
}

function expectThumbnailError(run: () => unknown): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect(JSON.stringify(error)).toContain('thumbnails');
    return;
  }
  throw new Error('expected a thumbnails validation error');
}

/** In-memory service wiring; returns the service plus the fake stores. */
function setup() {
  const records = new Map<string, MaterialRecord>();
  const objects = new Map<string, string>();
  let seq = 0;
  const deps: MaterialServiceDeps = {
    materials: {
      async create(input) {
        const record: MaterialRecord = {
          id: 'm1',
          title: input.title,
          description: input.description,
          objectKey: input.objectKey,
          fileName: input.fileName,
          contentType: input.contentType,
          fileSizeBytes: input.fileSizeBytes,
          tags: [],
          files: [],
          thumbnails: [],
        };
        records.set(record.id, record);
        return record;
      },
      async findById(id) {
        const record = records.get(id);
        return record === undefined ? null : structuredClone(record);
      },
      async update(id) {
        return records.get(id) as MaterialRecord;
      },
      async delete(id) {
        records.delete(id);
      },
      async addFiles(id, files) {
        const record = records.get(id) as MaterialRecord;
        record.files.push(
          ...files.map((file) => ({ ...file, id: `f${(seq += 1)}` })),
        );
      },
      async findFile() {
        return null;
      },
      async deleteFile() {
        return null;
      },
      async countFiles(id) {
        return records.get(id)?.files.length ?? 0;
      },
      async addThumbnails(id, thumbnails) {
        const record = records.get(id) as MaterialRecord;
        record.thumbnails = [
          ...(record.thumbnails ?? []),
          ...thumbnails.map((t) => ({ ...t, id: `t${(seq += 1)}` })),
        ];
      },
      async deleteThumbnail(id, thumbnailId) {
        const record = records.get(id);
        const found = record?.thumbnails?.find((t) => t.id === thumbnailId);
        if (record === undefined || found === undefined) {
          return null;
        }
        record.thumbnails = record.thumbnails?.filter((t) => t !== found);
        return { objectKey: found.objectKey };
      },
    },
    storage: {
      async putObject(key, _body, contentType) {
        objects.set(key, contentType);
      },
      async deleteObject(key) {
        objects.delete(key);
      },
    },
    entitlements: {
      async findEntitlement() {
        return null;
      },
      async listEntitledMaterialIds() {
        return [];
      },
    },
    linkGroups: {
      async listGroupMemberIds() {
        return [];
      },
      async listGroupMembersWithPrice() {
        return [];
      },
    },
    generateObjectKey: () => `materials/${(seq += 1)}`,
    generateThumbnailKey: () => `thumbnails/${(seq += 1)}`,
  };
  return { service: createMaterialService(deps), objects };
}

describe('detectThumbnailContentType', () => {
  it('identifies JPEG, PNG and WebP by their bytes', () => {
    expect(detectThumbnailContentType(JPEG)).toBe('image/jpeg');
    expect(detectThumbnailContentType(PNG)).toBe('image/png');
    expect(detectThumbnailContentType(WEBP)).toBe('image/webp');
  });

  it('rejects non-images regardless of declared type', () => {
    expect(detectThumbnailContentType(HTML)).toBeNull();
    expect(detectThumbnailContentType(Buffer.from('RIFF\0\0\0\0WAVE'))).toBeNull();
    expect(detectThumbnailContentType('not bytes')).toBeNull();
  });
});

describe('validateThumbnailsOrThrow', () => {
  it('accepts up to the per-material limit', () => {
    const files = Array.from({ length: MAX_THUMBNAILS_PER_MATERIAL }, () => image(PNG));
    expect(validateThumbnailsOrThrow(files, 0)).toHaveLength(MAX_THUMBNAILS_PER_MATERIAL);
  });

  it('rejects exceeding the limit counting existing thumbnails', () => {
    expectThumbnailError(() =>
      validateThumbnailsOrThrow([image(PNG)], MAX_THUMBNAILS_PER_MATERIAL),
    );
  });

  it('rejects oversize and non-image files', () => {
    expectThumbnailError(() =>
      validateThumbnailsOrThrow([image(PNG, MAX_THUMBNAIL_SIZE_BYTES + 1)], 0),
    );
    expectThumbnailError(() => validateThumbnailsOrThrow([image(HTML)], 0));
  });
});

describe('material service thumbnails', () => {
  it('stores thumbnails on upload with detected types and exposes public urls', async () => {
    const { service, objects } = setup();
    const dto = await service.uploadMaterial({
      title: 'Notes',
      files: [pdf()],
      thumbnails: [image(JPEG), image(PNG)],
    });
    expect(dto.thumbnails?.map((t) => t.url)).toEqual(
      dto.thumbnails?.map((t) => `/api/thumbnails/${t.id}`),
    );
    expect(dto.thumbnails).toHaveLength(2);
    expect([...objects.values()].sort()).toEqual(
      ['application/pdf', 'image/jpeg', 'image/png'].sort(),
    );
    expect(JSON.stringify(dto)).not.toMatch(/thumbnails\/\d/); // no object keys
  });

  it('stores nothing when a thumbnail is invalid', async () => {
    const { service, objects } = setup();
    await expect(
      service.uploadMaterial({ title: 'Notes', files: [pdf()], thumbnails: [image(HTML)] }),
    ).rejects.toBeInstanceOf(AppError);
    expect(objects.size).toBe(0);
  });

  it('adds, lists and removes thumbnails, and enforces the limit on add', async () => {
    const { service, objects } = setup();
    await service.uploadMaterial({ title: 'Notes', files: [pdf()] });
    const added = await service.addThumbnails('m1', [image(WEBP), image(PNG)]);
    expect(added.thumbnails).toHaveLength(2);
    expect(await service.listThumbnails('m1')).toEqual(added.thumbnails);

    const [first] = added.thumbnails ?? [];
    const removed = await service.removeThumbnail('m1', first.id);
    expect(removed.thumbnails?.map((t) => t.id)).not.toContain(first.id);
    expect(objects.size).toBe(2); // pdf + remaining thumbnail

    await expect(service.removeThumbnail('m1', first.id)).rejects.toBeInstanceOf(AppError);
    await expect(
      service.addThumbnails(
        'm1',
        Array.from({ length: MAX_THUMBNAILS_PER_MATERIAL }, () => image(PNG)),
      ),
    ).rejects.toBeInstanceOf(AppError);
    await expect(service.listThumbnails('missing')).rejects.toBeInstanceOf(AppError);
  });

  it('deletes thumbnail objects when the material is deleted', async () => {
    const { service, objects } = setup();
    await service.uploadMaterial({
      title: 'Notes',
      files: [pdf()],
      thumbnails: [image(PNG), image(JPEG)],
    });
    await service.deleteMaterial('m1');
    expect(objects.size).toBe(0);
  });
});
