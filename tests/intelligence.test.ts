import { describe, expect, it } from "vitest";
import {
  findingCVE,
  intelligenceLabel,
  matchesIntelligence,
  type IntelligenceSnapshot,
} from "../src/shared/intelligence";
const snapshot = (
  state = "fresh",
  value: any = { probability: 0 },
): IntelligenceSnapshot => ({
  cve: "CVE-2024-1234",
  sources: [{ source: "epss", state: state as any, value }],
});
describe("CVE intelligence boundaries", () => {
  it("accepts explicit CVEs and never infers one from a CWE, URL or embedded text", () => {
    expect(findingCVE(" cve-2021-44228 ")).toBe("CVE-2021-44228");
    for (const value of [
      "CWE-79",
      "CVE-2024-123",
      "Finding CVE-2024-1234",
      "https://example.invalid/CVE-2024-1234",
      "CVE-2024-1234\nsecret",
      "CVE-1980-1234",
    ])
      expect(findingCVE(value)).toBeNull();
  });
  it("distinguishes a published zero from unavailable intelligence", () => {
    expect(intelligenceLabel(snapshot())).toBe("EPSS 0.00%");
    expect(intelligenceLabel(snapshot("unavailable", null))).toBe(
      "Intelligence not current",
    );
    expect(matchesIntelligence(snapshot("unavailable", null), "unknown")).toBe(
      true,
    );
    expect(matchesIntelligence(snapshot(), "unknown")).toBe(false);
  });
  it("does not treat stale high EPSS as a fresh score", () => {
    expect(
      matchesIntelligence(snapshot("stale", { probability: 0.8 }), "epss"),
    ).toBe(false);
    expect(
      matchesIntelligence(snapshot("fresh", { probability: 0.1 }), "epss"),
    ).toBe(true);
  });
  it("keeps cached positive KEV evidence visible with an explicit qualifier", () => {
    const value: IntelligenceSnapshot = {
      cve: "CVE-2024-1234",
      sources: [{ source: "kev", state: "stale", value: { listed: true } }],
    };
    expect(intelligenceLabel(value)).toBe("KEV evidence · cached");
    expect(matchesIntelligence(value, "kev")).toBe(true);
  });
});
