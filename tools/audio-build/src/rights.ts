/**
 * The licence gate: only translations whose metadata allows audio derivatives are rendered,
 * unless the operator says they hold the rights. And the credit that goes in the index.
 */

import type { AudioCredit } from './core';

export interface TextRights {
  abbreviation: string;
  fullName: string;
  licenseSpdx?: string;
  licenseUrl?: string;
  copyright?: string;
  publisher?: string;
  /** From core's `isPublicDomain()`. */
  publicDomain: boolean;
}

export interface RightsDecision { allowed: boolean; reason: string; credit: AudioCredit }

const PUBLIC_DOMAIN = /^(PD|PUBLIC[- ]?DOMAIN|CC0(-1\.0)?|CC-PDDC|UNLICENSE|NLOD-1\.0)$/i;
/** Licences that let anyone make and share a spoken derivative (some ask for attribution, which the index carries). */
const OPEN = /^(CC-BY(-SA)?-\d(\.\d)?|(A|L)?GPL-\d(\.\d)?(-only|-or-later)?|MIT|ISC|BSD-\d-Clause|0BSD|Apache-2\.0|MPL-2\.0|WTFPL)$/i;
const BLOCKED = /(^|-)(ND|NC)(-|$)|PROPRIETARY|ALL[- ]RIGHTS/i;

export function decideRights(t: TextRights, iHaveRights: boolean): RightsDecision {
  const spdx = t.licenseSpdx?.trim() ?? '';
  const credit: AudioCredit = {
    name: `${t.fullName} (${t.abbreviation})`,
    ...(spdx ? { license: spdx } : {}),
    ...(t.licenseUrl ? { url: t.licenseUrl } : {}),
    ...(t.copyright && !/^none$/i.test(t.copyright.trim()) ? { attribution: t.copyright.trim().slice(0, 500) } : {}),
  };
  if (iHaveRights) return { allowed: true, reason: 'allowed by --i-have-rights', credit };
  if (t.publicDomain || PUBLIC_DOMAIN.test(spdx)) return { allowed: true, reason: 'public domain', credit };
  if (spdx && !BLOCKED.test(spdx) && OPEN.test(spdx)) return { allowed: true, reason: `licence ${spdx} allows derivatives`, credit };
  const why = spdx ? `its licence is ${spdx}` : 'it declares no licence';
  return {
    allowed: false,
    reason: `${t.abbreviation}: ${why}, which does not clearly allow audio derivatives. Pass --i-have-rights if you hold the rights.`,
    credit,
  };
}
