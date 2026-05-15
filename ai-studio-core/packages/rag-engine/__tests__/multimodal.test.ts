import { describe, it, expect, vi } from "vitest";
import { extractVisualChunks, getVLMPrompt } from "../src/multimodal";
import type { VLMCaller } from "../src/multimodal";

// ── Helpers ──

function mockVLMCaller(descriptions: Map<string, string>): VLMCaller {
  return {
    describeImage: async (imagePath: string) => {
      const desc = descriptions.get(imagePath);
      if (desc === undefined) {
        throw new Error(`No description for ${imagePath}`);
      }
      return desc;
    },
  };
}

function staticVLMCaller(description: string): VLMCaller {
  return {
    describeImage: async () => description,
  };
}

// ── Tests ──

describe("extractVisualChunks()", () => {
  describe("happy path", () => {
    it("should return visual chunks with descriptions for multiple page images", async () => {
      const descriptions = new Map([
        ["/pages/page-1.png", "This page contains a table showing model pricing and a chart of latency."],
        ["/pages/page-2.png", "This page shows a diagram of the agent architecture."],
      ]);
      const vlm = mockVLMCaller(descriptions);

      const pages = [
        { pageNumber: 1, imagePath: "/pages/page-1.png" },
        { pageNumber: 2, imagePath: "/pages/page-2.png" },
      ];

      const result = await extractVisualChunks(pages, vlm);

      expect(result).toHaveLength(2);
      expect(result[0].pageNumber).toBe(1);
      expect(result[0].description).toContain("table");
      expect(result[0].pageImagePath).toBe("/pages/page-1.png");
      expect(result[1].pageNumber).toBe(2);
      expect(result[1].description).toContain("diagram");
    });

    it("should detect visual element keywords from VLM descriptions", async () => {
      const vlm = staticVLMCaller(
        "This page contains a table with metrics, a chart showing trends, and a diagram of the system architecture.",
      );

      const pages = [{ pageNumber: 1, imagePath: "/img/page.png" }];
      const result = await extractVisualChunks(pages, vlm);

      expect(result).toHaveLength(1);
      expect(result[0].visualElements).toContain("table");
      expect(result[0].visualElements).toContain("chart");
      expect(result[0].visualElements).toContain("diagram");
      expect(result[0].visualElements).toContain("architecture");
    });
  });

  describe("edge cases", () => {
    it("should return empty array when pages array is empty", async () => {
      const vlm = staticVLMCaller("irrelevant");

      const result = await extractVisualChunks([], vlm);

      expect(result).toEqual([]);
    });

    it("should work correctly with a single page", async () => {
      const vlm = staticVLMCaller("A page with a flowchart explaining the pipeline.");

      const pages = [{ pageNumber: 1, imagePath: "/img/single.png" }];
      const result = await extractVisualChunks(pages, vlm);

      expect(result).toHaveLength(1);
      expect(result[0].pageNumber).toBe(1);
      expect(result[0].visualElements).toContain("flowchart");
    });
  });

  describe("error cases", () => {
    it("should skip pages where VLM throws and still return successful pages", async () => {
      const descriptions = new Map([
        ["/img/page-1.png", "A page showing a schema diagram."],
        // page-2 is not in the map, so mockVLMCaller will throw
        ["/img/page-3.png", "A page with a code snippet example."],
      ]);
      const vlm = mockVLMCaller(descriptions);

      const pages = [
        { pageNumber: 1, imagePath: "/img/page-1.png" },
        { pageNumber: 2, imagePath: "/img/page-2.png" },
        { pageNumber: 3, imagePath: "/img/page-3.png" },
      ];

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await extractVisualChunks(pages, vlm);

      expect(result).toHaveLength(2);
      expect(result.map((r) => r.pageNumber)).toEqual([1, 3]);

      vi.restoreAllMocks();
    });

    it("should skip pages where VLM returns empty string", async () => {
      const vlm = staticVLMCaller("");

      const pages = [{ pageNumber: 1, imagePath: "/img/empty.png" }];

      vi.spyOn(console, "warn").mockImplementation(() => {});

      const result = await extractVisualChunks(pages, vlm);

      expect(result).toEqual([]);

      vi.restoreAllMocks();
    });
  });

  describe("getVLMPrompt", () => {
    it("should return a non-empty string with expected keywords", () => {
      const prompt = getVLMPrompt();

      expect(typeof prompt).toBe("string");
      expect(prompt.length).toBeGreaterThan(0);
      expect(prompt).toContain("Describe");
      expect(prompt).toContain("diagram");
      expect(prompt).toContain("table");
      expect(prompt).toContain("code");
    });
  });

  describe("concurrency control", () => {
    it("should process all 3 pages when concurrency is 1", async () => {
      let callCount = 0;
      const vlm: VLMCaller = {
        describeImage: async (imagePath: string) => {
          callCount++;
          return `Description of page at ${imagePath} with a table.`;
        },
      };

      const pages = [
        { pageNumber: 1, imagePath: "/img/p1.png" },
        { pageNumber: 2, imagePath: "/img/p2.png" },
        { pageNumber: 3, imagePath: "/img/p3.png" },
      ];

      const result = await extractVisualChunks(pages, vlm, 1);

      expect(callCount).toBe(3);
      expect(result).toHaveLength(3);
      expect(result.map((r) => r.pageNumber)).toEqual([1, 2, 3]);
    });
  });

  describe("security", () => {
    it("should not crash on page paths with special characters", async () => {
      const vlm = staticVLMCaller("A page with a table of results.");

      const pages = [
        { pageNumber: 1, imagePath: "/img/page with spaces & (parens).png" },
        { pageNumber: 2, imagePath: '/img/path"quotes\'mixed.png' },
      ];

      const result = await extractVisualChunks(pages, vlm);

      expect(result).toHaveLength(2);
      expect(result[0].pageImagePath).toBe("/img/page with spaces & (parens).png");
      expect(result[1].pageImagePath).toBe('/img/path"quotes\'mixed.png');
    });
  });
});
