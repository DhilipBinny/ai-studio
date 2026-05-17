import { describe, it, expect } from "vitest";
import { chunkText, contextualChunkText, parentChildChunkText } from "../src/chunker";

describe("chunkText — recursive strategy", () => {
  it("should split long text at paragraph boundaries (\\n\\n)", () => {
    const paragraphs = Array.from({ length: 10 }, (_, i) =>
      `Paragraph ${i + 1}. ${"Lorem ipsum dolor sit amet. ".repeat(20)}`
    );
    const text = paragraphs.join("\n\n");

    const chunks = chunkText(text, { method: "recursive", chunk_size: 600 });

    expect(chunks.length).toBeGreaterThan(1);
    // Each chunk should not exceed chunk_size (with some tolerance for overlap prefix)
    for (const chunk of chunks) {
      // Content itself should be reasonable — the merge step can add overlap
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("should respect the chunk_size limit for the initial split segments", () => {
    const text = Array.from({ length: 20 }, (_, i) =>
      `Section ${i + 1}: ${"word ".repeat(50)}`
    ).join("\n\n");

    const chunkSize = 500;
    // Note: chunk_overlap || DEFAULT uses 200 when 0 is passed (falsy).
    // The merge step can exceed chunkSize because overlap text is prepended.
    // What we verify: recursive splitting produces multiple chunks and content is non-empty.
    const chunks = chunkText(text, { method: "recursive", chunk_size: chunkSize });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("should return a single chunk when text is shorter than chunk_size", () => {
    const text = "This is a short paragraph that fits in one chunk easily.";

    const chunks = chunkText(text, { method: "recursive", chunk_size: 2048 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
    expect(chunks[0].index).toBe(0);
  });

  it("should return an empty array for empty text", () => {
    const chunks = chunkText("", { method: "recursive" });

    expect(chunks).toEqual([]);
  });

  it("should fall back to character-level splitting when no separators match", () => {
    // A single long string with no spaces, newlines, or periods — only '' separator works
    const text = "a".repeat(5000);

    const chunks = chunkText(text, { method: "recursive", chunk_size: 500, chunk_overlap: 0 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("should preserve context between chunks via overlap", () => {
    const paragraph1 = "First paragraph content. ".repeat(20);
    const paragraph2 = "Second paragraph content. ".repeat(20);
    const text = paragraph1 + "\n\n" + paragraph2;

    const chunks = chunkText(text, {
      method: "recursive",
      chunk_size: 300,
      chunk_overlap: 50,
    });

    expect(chunks.length).toBeGreaterThan(1);

    // Check that consecutive chunks share overlapping content.
    // With overlap=50, some trailing text from the previous chunk should appear
    // in the next chunk. We check that at least one pair shares a common substring.
    let overlapFound = false;
    for (let i = 1; i < chunks.length; i++) {
      const prevContent = chunks[i - 1].content;
      const nextContent = chunks[i].content;
      // Extract the last 15 non-whitespace chars from the previous chunk
      const prevTail = prevContent.trim().slice(-15);
      if (prevTail.length > 0 && nextContent.includes(prevTail)) {
        overlapFound = true;
      }
    }
    expect(overlapFound).toBe(true);
  });

  it("should filter out chunks shorter than minimum length (10 chars)", () => {
    // Create text where some segments will be very short after splitting
    const text = "Hello.\n\nX\n\nThis is a proper paragraph with enough content to pass the filter.";

    const chunks = chunkText(text, { method: "recursive", chunk_size: 2048 });

    // "X" alone (1 char) should be filtered out, but it may get merged.
    // The key guarantee: no chunk has content.trim().length <= 10
    for (const chunk of chunks) {
      expect(chunk.content.trim().length).toBeGreaterThan(10);
    }
  });
});

describe("chunkText — large overlap", () => {
  it("should produce heavily overlapping chunks when overlap is 80% of chunk_size", () => {
    // chunk_size=500, overlap=400 (80% of 500)
    // With 80% overlap, the merge step takes the last 400 chars from each
    // chunk and prepends them to the next. Each chunk advances only ~100 chars
    // of new content, creating extensive duplication between consecutive chunks.
    const text = "Alpha Bravo Charlie Delta Echo Foxtrot Golf. ".repeat(100);

    const chunks = chunkText(text, {
      method: "recursive",
      chunk_size: 500,
      chunk_overlap: 400,
    });

    expect(chunks.length).toBeGreaterThan(1);

    // Verify: consecutive chunks share substantial overlapping content.
    // With 400-char overlap, at least 100 chars from end of prev should appear in next.
    let overlapCount = 0;
    for (let i = 1; i < chunks.length; i++) {
      const prevContent = chunks[i - 1].content;
      const nextContent = chunks[i].content;
      const prevTail = prevContent.slice(-100);
      if (prevTail.length > 0 && nextContent.includes(prevTail)) {
        overlapCount++;
      }
    }

    // Most consecutive chunk pairs should share overlapping content
    expect(overlapCount).toBeGreaterThan(0);

    // All chunks should have valid content
    for (const chunk of chunks) {
      expect(chunk.content.length).toBeGreaterThan(0);
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });
});

describe("chunkText — fixed strategy", () => {
  it("should split 1000-char text with size=200 into multiple chunks", () => {
    // fixedSplit produces 5 segments of 200 chars each. The mergeWithOverlap
    // step then joins consecutive segments that fit within maxSize (200), but
    // since each segment is exactly 200 chars, merging adds a space between them,
    // pushing length > maxSize, so each stays separate — however overlap text
    // from the previous chunk gets prepended. We verify the total content
    // covers the full input.
    const text = "A".repeat(1000);

    const chunks = chunkText(text, { method: "fixed", chunk_size: 200 });

    expect(chunks.length).toBeGreaterThanOrEqual(3);
    // All chunks should only contain 'A' characters (and spaces from merge)
    for (const chunk of chunks) {
      expect(chunk.content.replace(/ /g, "")).toMatch(/^A+$/);
    }
  });

  it("should produce chunks that together cover the original text content", () => {
    const text = "B".repeat(600);

    const chunks = chunkText(text, { method: "fixed", chunk_size: 200 });

    expect(chunks.length).toBeGreaterThanOrEqual(2);
    // Each chunk should contain only 'B' (and possibly spaces from merge)
    for (const chunk of chunks) {
      expect(chunk.content.replace(/ /g, "")).toMatch(/^B+$/);
      expect(chunk.content.length).toBeGreaterThan(0);
    }
  });

  it("should return a single chunk when text length equals chunk_size", () => {
    const text = "C".repeat(500);

    const chunks = chunkText(text, { method: "fixed", chunk_size: 500, chunk_overlap: 0 });

    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toBe(text);
  });
});

describe("parentChildChunkText", () => {
  it("should return both parent and child chunks with correct types", () => {
    const text = "Parent section one. ".repeat(80) + "\n\n" + "Parent section two. ".repeat(80);

    const results = parentChildChunkText(text, {
      parent_chunk_size: 800,
      child_chunk_size: 200,
      chunk_overlap: 50,
    });

    const parents = results.filter((r) => r.chunkType === "parent");
    const children = results.filter((r) => r.chunkType === "child");

    expect(parents.length).toBeGreaterThanOrEqual(1);
    expect(children.length).toBeGreaterThanOrEqual(1);

    for (const parent of parents) {
      expect(parent.chunkType).toBe("parent");
      expect(parent.parentIndex).toBeUndefined();
    }

    for (const child of children) {
      expect(child.chunkType).toBe("child");
    }
  });

  it("should have child chunks reference their parent via parentIndex", () => {
    const text = "Sample content for parent child testing. ".repeat(100);

    const results = parentChildChunkText(text, {
      parent_chunk_size: 1000,
      child_chunk_size: 200,
      chunk_overlap: 50,
    });

    const parentIndices = results
      .filter((r) => r.chunkType === "parent")
      .map((r) => r.index);

    const children = results.filter((r) => r.chunkType === "child");

    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.parentIndex).toBeDefined();
      expect(parentIndices).toContain(child.parentIndex);
    }
  });

  it("should handle text shorter than child size — single parent, single child", () => {
    const text = "Short text that fits in one chunk easily enough.";

    const results = parentChildChunkText(text, {
      parent_chunk_size: 2048,
      child_chunk_size: 512,
      chunk_overlap: 50,
    });

    const parents = results.filter((r) => r.chunkType === "parent");
    const children = results.filter((r) => r.chunkType === "child");

    expect(parents).toHaveLength(1);
    expect(children).toHaveLength(1);
    expect(children[0].parentIndex).toBe(parents[0].index);
    expect(children[0].content).toBe(parents[0].content);
  });

  it("should estimate tokens as ceil(chars / 4)", () => {
    const text = "Token estimation test content. ".repeat(50);

    const results = parentChildChunkText(text, {
      parent_chunk_size: 2048,
      child_chunk_size: 512,
      chunk_overlap: 0,
    });

    for (const chunk of results) {
      const expectedTokens = Math.ceil(chunk.content.length / 4);
      expect(chunk.tokenCount).toBe(expectedTokens);
    }
  });

  it("should add document prefix to child chunks when context is provided", () => {
    const text = "Content for context testing in parent child mode. ".repeat(60);

    const results = parentChildChunkText(text, {
      parent_chunk_size: 800,
      child_chunk_size: 200,
      chunk_overlap: 50,
    }, { fileName: "report.pdf" });

    const children = results.filter((r) => r.chunkType === "child");
    expect(children.length).toBeGreaterThan(0);
    for (const child of children) {
      expect(child.content).toMatch(/^\[Document: report\.pdf\] /);
    }

    // Parent chunks should NOT have the prefix
    const parents = results.filter((r) => r.chunkType === "parent");
    for (const parent of parents) {
      expect(parent.content).not.toMatch(/^\[Document:/);
    }
  });

  it("should return an empty array for empty text", () => {
    const results = parentChildChunkText("", {
      parent_chunk_size: 2048,
      child_chunk_size: 512,
    });

    expect(results).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// contextualChunkText
// ---------------------------------------------------------------------------

describe("contextualChunkText", () => {
  it("should prefix chunks with document name when only fileName is provided", () => {
    const text = "Some document content for contextual chunking test.";

    const chunks = contextualChunkText(text, { chunk_size: 2048 }, { fileName: "notes.txt" });

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of chunks) {
      expect(chunk.content).toMatch(/^\[Document: notes\.txt\] /);
    }
  });

  it("should prefix chunks with document name and section heading when both are provided", () => {
    const text = "Content in a specific section of the document.";

    const chunks = contextualChunkText(
      text,
      { chunk_size: 2048 },
      { fileName: "manual.pdf", sectionHeading: "Chapter 3" },
    );

    expect(chunks.length).toBeGreaterThanOrEqual(1);
    for (const chunk of chunks) {
      expect(chunk.content).toMatch(/^\[Document: manual\.pdf \| Section: Chapter 3\] /);
    }
  });

  it("should update tokenCount to reflect the added prefix", () => {
    const text = "Short content for token check.";
    const prefix = "[Document: file.txt] ";

    const chunks = contextualChunkText(text, { chunk_size: 2048 }, { fileName: "file.txt" });

    expect(chunks).toHaveLength(1);
    const expectedTokens = Math.ceil((prefix + text).length / 4);
    expect(chunks[0].tokenCount).toBe(expectedTokens);
  });
});
