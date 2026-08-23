import { describe, expect, it } from "vitest";

import {
  arabicKeysToLatin,
  latinKeysToArabic,
  passwordLayoutCandidates,
  verifyPasswordWithLayoutFallback,
} from "./keyboardLayout";
import { createPasswordHash } from "./passwordCrypto";

describe("keyboard-layout transliteration", () => {
  it("reads the owner's own example: the keys for «mhmd» typed on an Arabic keyboard", () => {
    // m→ة  h→ا  m→ة  d→ي  — the same four physical keys.
    expect(latinKeysToArabic("mhmd")).toBe("ةاةي");
    expect(arabicKeysToLatin("ةاةي")).toBe("mhmd");
  });

  it("round-trips every mapped key in both directions", () => {
    // `gh` is excluded on purpose — see the ambiguity test below. Every OTHER
    // key on the unshifted block survives a round trip exactly.
    const latin = "qwertyuiop[]asdfjkl;'zxcvbnm,./";
    expect(arabicKeysToLatin(latinKeysToArabic(latin))).toBe(latin);
  });

  it("offers BOTH readings of «لا», because the layout genuinely has two", () => {
    // `لا` is the single `b` key AND the ordinary sequence `g`+`h` (`ل`+`ا`).
    // The Arabic layout is not injective here, so neither reading is "the"
    // right one and picking one would fail half the logins it should allow.
    expect(latinKeysToArabic("b")).toBe("لا");
    expect(latinKeysToArabic("gh")).toBe("لا");

    expect(arabicKeysToLatin("لا")).toBe("b");
    expect(arabicKeysToLatin("لا", true)).toBe("gh");
    expect(passwordLayoutCandidates("لا")).toEqual(expect.arrayContaining(["b", "gh"]));
  });

  it("keeps the longest-match scan, so a ligature never leaves a stray alef behind", () => {
    expect(arabicKeysToLatin("لاش")).toBe("ba");
  });

  it("folds Arabic-Indic digits, which fail for exactly the same reason", () => {
    expect(arabicKeysToLatin("١٩٩٧")).toBe("1997");
    expect(arabicKeysToLatin("۱۹۹۷")).toBe("1997");
  });

  it("leaves unmapped characters alone, so a mixed-script password converts only the half that needs it", () => {
    expect(arabicKeysToLatin("ةاةي-2026")).toBe("mhmd-2026");
  });

  it("offers exactly one candidate when both readings are the same string", () => {
    // An all-digit password is unchanged by either map, so the fallback costs
    // nothing at all for it.
    expect(passwordLayoutCandidates("1234")).toEqual(["1234"]);
  });

  it("puts the literal typed string first, so a correctly-typed password verifies on the first try", () => {
    expect(passwordLayoutCandidates("mhmd")[0]).toBe("mhmd");
  });

  it("never exceeds four candidates, whatever the password contains", () => {
    // The bound is what keeps one submitted attempt from becoming an unbounded
    // number of Argon2id verifications.
    for (const typed of ["mhmd", "ةاةي", "لالالا", "1234", "لاb-ش٩"]) {
      expect(passwordLayoutCandidates(typed).length).toBeLessThanOrEqual(4);
    }
  });
});

describe("verifyPasswordWithLayoutFallback", () => {
  it("signs in when the password was typed with the keyboard left on Arabic", async () => {
    const record = await createPasswordHash("mhmd");
    await expect(verifyPasswordWithLayoutFallback("ةاةي", record)).resolves.toBe("mhmd");
  });

  it("signs in the other way round too — an Arabic-typed password entered on an English keyboard", async () => {
    const record = await createPasswordHash("ةاةي");
    await expect(verifyPasswordWithLayoutFallback("mhmd", record)).resolves.toBe("ةاةي");
  });

  it("returns the MATCHED plaintext, not what was typed — the rehash-safety contract", async () => {
    // If this ever returned a bare `true`, AuthGate's transparent Argon2id
    // upgrade would re-hash the typed string and silently change the user's
    // password to one they never chose.
    const record = await createPasswordHash("mhmd");
    const matched = await verifyPasswordWithLayoutFallback("ةاةي", record);
    expect(matched).toBe("mhmd");
    expect(matched).not.toBe("ةاةي");
  });

  it("still verifies a correctly-typed password", async () => {
    const record = await createPasswordHash("mhmd");
    await expect(verifyPasswordWithLayoutFallback("mhmd", record)).resolves.toBe("mhmd");
  });

  it("rejects a wrong password under EVERY reading — the fallback widens layouts, never secrets", async () => {
    const record = await createPasswordHash("mhmd");
    await expect(verifyPasswordWithLayoutFallback("wrong", record)).resolves.toBeNull();
    await expect(verifyPasswordWithLayoutFallback("خقخىل", record)).resolves.toBeNull();
    await expect(verifyPasswordWithLayoutFallback("", record)).resolves.toBeNull();
  });
});
