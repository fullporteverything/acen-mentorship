import { createHash } from "node:crypto";

/**
 * Bump when the NDA_TEXT below changes in any legally meaningful way. A member's
 * signature is only honored (getOnboardingStatus) when it was captured against
 * the CURRENT version, so raising this transparently re-gates everyone until
 * they re-sign the new text.
 */
export const NDA_VERSION = 1;

/** Operating entity / counterparty named as the Provider in the agreement. */
export const NDA_OPERATOR = "ACEN LLC";

/**
 * PLACEHOLDER confidentiality / non-disclosure agreement. Kept as a plain
 * string constant so NDA_HASH below is deterministic and reproducible across
 * deploys — do NOT interpolate dates, names, or anything else into it.
 *
 * PLACEHOLDER — replace before going live. The orchestrator may swap the exact
 * wording later; the hash will change with it, which correctly forces re-signing.
 */
export const NDA_TEXT = `MUTUAL CONFIDENTIALITY & NON-DISCLOSURE AGREEMENT

PLACEHOLDER — replace before going live.

This Confidentiality and Non-Disclosure Agreement (the "Agreement") is entered
into between ${NDA_OPERATOR} ("Provider"), the operator of this private
mentorship program, and the individual accepting this Agreement electronically
(the "Receiving Party"). By signing below, the Receiving Party agrees to the
following terms.

1. CONFIDENTIAL INFORMATION. "Confidential Information" means all non-public
information disclosed by Provider to the Receiving Party through the mentorship
program, including but not limited to course materials, video lessons, written
curriculum, strategies, methodologies, trade secrets, member communications,
and any other proprietary information, whether disclosed orally, in writing, or
through the program platform.

2. OBLIGATIONS. The Receiving Party shall (a) hold all Confidential Information
in strict confidence; (b) not disclose, publish, distribute, resell, record,
screenshot, screen-capture, or otherwise share any Confidential Information with
any third party; and (c) use the Confidential Information solely for the
Receiving Party's own personal educational purposes within the program.

3. NO LICENSE. Nothing in this Agreement grants the Receiving Party any right,
title, or interest in the Confidential Information other than the limited right
to access it for personal use during active membership. All intellectual
property remains the exclusive property of Provider.

4. EXCLUSIONS. Confidential Information does not include information that is or
becomes publicly available through no fault of the Receiving Party, or that the
Receiving Party can demonstrate was lawfully known prior to disclosure.

5. TERM & SURVIVAL. This Agreement takes effect upon electronic signature and
the confidentiality obligations survive termination of the Receiving Party's
membership indefinitely.

6. REMEDIES. The Receiving Party acknowledges that any breach may cause
irreparable harm to Provider for which monetary damages are inadequate, and that
Provider is entitled to seek injunctive relief in addition to any other remedy
available at law or in equity.

7. ELECTRONIC SIGNATURE. The Receiving Party consents to sign this Agreement
electronically and agrees that such electronic signature has the same legal
force and effect as a handwritten signature.

8. GOVERNING LAW. This Agreement is governed by the laws of the jurisdiction in
which Provider is organized, without regard to conflict-of-law principles.

By entering their full legal name and confirming the consents below, the
Receiving Party acknowledges having read, understood, and agreed to be bound by
this Agreement.

PLACEHOLDER — replace before going live.`;

/**
 * SHA-256 hex of NDA_TEXT, computed once at module load. Stored alongside each
 * signature as immutable evidence of exactly which text the member agreed to.
 */
export const NDA_HASH = createHash("sha256").update(NDA_TEXT, "utf8").digest("hex");
