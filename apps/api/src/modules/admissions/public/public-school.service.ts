import { Inject, Injectable } from '@nestjs/common';
import { DbService } from '../../../common/db/db.service';
import { DomainError } from '../../../common/errors/domain-error';
import { STORAGE_DRIVER, type StorageDriver } from '../../files/storage';
import { publicTenant } from './otp.service';

/** Raster images only: an SVG could carry script onto the public site. */
const IMAGE = /^image\/(png|jpeg|webp|gif)$/;

/**
 * What every public page of a school shows (admissions, careers, appointments, visitors, consent forms,
 * passes): the school's name and logo, its second line, board and affiliation, address, phone, email
 * and website, as set in System → School profile. Only what a school publishes anyway; the office's
 * own addresses (accounts, principal…) stay inside.
 */
@Injectable()
export class PublicSchoolService {
  constructor(
    private readonly db: DbService,
    @Inject(STORAGE_DRIVER) private readonly storage: StorageDriver,
  ) {}

  private async schoolId(code: string): Promise<string> {
    const id = await this.db.global(async (c) => {
      const r = await c.query<{ id: string | null }>(
        `SELECT app.public_school_id($1)::text AS id`,
        [code],
      );
      return r.rows[0]?.id ?? null;
    });
    if (!id) throw new DomainError('not-found', 'School not found', { status: 404 });
    return id;
  }

  async profile(code: string) {
    const schoolId = await this.schoolId(code);
    return this.db.tenant(publicTenant(schoolId), async (c) => {
      const r = await c.query<{
        code: string;
        name: string;
        second: string | null;
        board: string | null;
        affiliation: string | null;
        address: string | null;
        phone: string | null;
        email: string | null;
        website: string | null;
        logo: string | null;
      }>(
        `SELECT lower(s.code) AS code, s.name, NULLIF(btrim(s.branding->>'name2'), '') AS second,
                NULLIF(btrim(s.board), '') AS board, NULLIF(btrim(s.affiliation_no), '') AS affiliation,
                NULLIF(concat_ws(', ', NULLIF(btrim(s.address->>'line1'), ''), NULLIF(btrim(s.address->>'line2'), ''),
                       NULLIF(btrim(s.address->>'line3'), ''), NULLIF(btrim(s.address->>'city'), ''),
                       NULLIF(btrim(s.address->>'state'), ''),
                       NULLIF(btrim(COALESCE(s.address->>'pincode', s.address->>'pin')), '')), '') AS address,
                NULLIF(btrim(s.contact->>'phone'), '') AS phone, NULLIF(btrim(s.contact->>'email'), '') AS email,
                NULLIF(btrim(s.contact->>'website'), '') AS website,
                (SELECT f.id::text FROM files f WHERE f.id::text = s.branding->>'logoFileId' AND f.deleted_at IS NULL
                    AND f.content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')) AS logo
           FROM schools s WHERE s.id = app.current_school_id()`,
      );
      const s = r.rows[0]!;
      const site =
        s.website && !/^https?:\/\//i.test(s.website) ? `https://${s.website}` : s.website;
      return {
        code: s.code,
        name: s.name,
        // the second line (a branch, a trust) only when it says more than the name
        subtitle: s.second && s.second.toLowerCase() !== s.name.toLowerCase() ? s.second : null,
        board: s.board,
        affiliationNo: s.affiliation,
        address: s.address,
        phone: s.phone,
        email: s.email,
        website: site,
        logo: s.logo,
      };
    });
  }

  /** The school's logo (an image file of its own), for the public pages. */
  async logo(code: string) {
    const schoolId = await this.schoolId(code);
    const f = await this.db.tenant(publicTenant(schoolId), async (c) => {
      const r = await c.query<{ object_key: string; content_type: string }>(
        `SELECT f.object_key, f.content_type FROM schools s
           JOIN files f ON f.id::text = s.branding->>'logoFileId' AND f.deleted_at IS NULL
          WHERE s.id = app.current_school_id()`,
      );
      return r.rows[0];
    });
    if (!f || !IMAGE.test(f.content_type))
      throw new DomainError('not-found', 'The school has no logo', { status: 404 });
    return {
      contentType: f.content_type,
      base64: (await this.storage.read(f.object_key)).toString('base64'),
    };
  }
}
