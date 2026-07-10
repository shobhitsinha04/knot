// Phase 7 performance harness (dev tool — NOT shipped in the .vsix).
//
// Measures the two things Phase 7 calls for:
//   1. Workspace indexing throughput  — index a large workspace, time it, and
//      time a few @codebase-style queries (real embeddings via Ollama).
//   2. Inline-completion latency      — repeated complete() calls (p50/p95).
//
// The extension services are `vscode`-free (dependency-injected), so we drive
// them directly here. Requires Ollama running with the relevant models pulled.
//
// Run:  npm run perf                          (generates a synthetic 500-file repo)
//       npm run perf -- --workspace <path>    (measure a real project)
//       npm run perf -- --files 1000 --completions 20 --complete qwen2.5-coder:7b

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { EMBEDDING_MODEL } from "../src/constants";
import { IndexManager } from "../src/services/indexManager";
import { OllamaService } from "../src/services/ollamaService";
import { PromptEngine } from "../src/services/promptEngine";
import type { Logger } from "../src/types";

const logger: Logger = {
  info: (m) => console.log(`  [info] ${m}`),
  warn: (m) => console.warn(`  [warn] ${m}`),
  error: (m, e) => console.error(`  [error] ${m}`, e ?? ""),
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const opts = {
  workspace: arg("--workspace"),
  files: Number(arg("--files") ?? "500"),
  embed: arg("--embed") ?? EMBEDDING_MODEL,
  complete: arg("--complete") ?? "qwen2.5-coder:1.5b",
  completions: Number(arg("--completions") ?? "10"),
};

/** avg / p50 / p95 / min / max summary of a set of millisecond timings. */
function summarize(ms: number[]): string {
  if (ms.length === 0) return "(no samples)";
  const s = [...ms].sort((a, b) => a - b);
  const pct = (p: number) =>
    s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
  const avg = s.reduce((a, b) => a + b, 0) / s.length;
  return (
    `avg ${avg.toFixed(0)}ms · p50 ${pct(50)}ms · p95 ${pct(95)}ms · ` +
    `min ${s[0]}ms · max ${s[s.length - 1]}ms`
  );
}

/** Generate a synthetic workspace of `n` plausible-looking TypeScript files. */
async function generateWorkspace(n: number): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "lp-perf-ws-"));
  for (let i = 0; i < n; i++) {
    const dir = path.join(root, `pkg${Math.floor(i / 25)}`);
    await mkdir(dir, { recursive: true });
    const lines: string[] = [
      `// Module ${i} — generated for the Knot perf harness.`,
      `import { helper${i % 10} } from "./shared";`,
      "",
    ];
    for (let f = 0; f < 6; f++) {
      lines.push(
        `/** Does operation ${f} for module ${i}. */`,
        `export function op${i}_${f}(input: number[], factor = ${f + 1}): number {`,
        `  let total = 0;`,
        `  for (const x of input) {`,
        `    total += x * factor + ${i};`,
        `  }`,
        `  return total / (input.length || 1);`,
        `}`,
        "",
      );
    }
    await writeFile(path.join(dir, `module${i}.ts`), lines.join("\n"), "utf8");
  }
  return root;
}

async function main(): Promise<void> {
  const ollama = new OllamaService({ logger });
  if (!(await ollama.isRunning())) {
    console.error("Ollama isn't running. Start it (`ollama serve`) and retry.");
    process.exit(1);
  }

  console.log("== Knot performance harness ==");
  console.log(
    `embed=${opts.embed}  complete=${opts.complete}  ` +
      `files=${opts.workspace ? "(real workspace)" : opts.files}\n`,
  );

  let workspace = opts.workspace ? path.resolve(opts.workspace) : "";
  let generated = false;
  if (!workspace) {
    process.stdout.write(`Generating ${opts.files} files… `);
    workspace = await generateWorkspace(opts.files);
    generated = true;
    console.log("done.");
  }

  const storageDir = await mkdtemp(path.join(tmpdir(), "lp-perf-store-"));
  const index = new IndexManager({
    ollama,
    storageDir,
    workspacePath: workspace,
    embeddingModel: opts.embed,
    logger,
  });

  try {
    if (!(await ollama.hasModel(opts.embed))) {
      logger.warn(
        `Embedding model ${opts.embed} not found — embeds will fail.`,
      );
    }

    // 1a. Indexing throughput.
    console.log(`\n-- Indexing ${workspace} --`);
    const t0 = Date.now();
    const stats = await index.indexWorkspace((p) => {
      if (p.current % 50 === 0 || p.current === p.total) {
        process.stdout.write(`\r  ${p.current}/${p.total} files`);
      }
    });
    const indexMs = Date.now() - t0;
    const secs = indexMs / 1000;
    console.log(
      `\n  files: ${stats.fileCount} · chunks: ${stats.chunkCount} · ` +
        `time: ${secs.toFixed(1)}s · ${(stats.fileCount / secs).toFixed(1)} files/s · ` +
        `${(stats.chunkCount / secs).toFixed(1)} chunks/s`,
    );

    // 1b. Query latency.
    const queries = [
      "how does the operation compute a total",
      "where is the helper imported",
      "function that divides by input length",
      "module that multiplies by a factor",
      "code that iterates over an input array",
    ];
    const qMs: number[] = [];
    for (const q of queries) {
      const s = Date.now();
      await index.search(q);
      qMs.push(Date.now() - s);
    }
    console.log(`  @codebase query latency: ${summarize(qMs)}`);

    // 2. Completion latency.
    console.log(`\n-- Inline completion (${opts.complete}) --`);
    if (!(await ollama.hasModel(opts.complete))) {
      logger.warn(
        `Model ${opts.complete} not found — skipping completion test.`,
      );
    } else {
      const prompt = new PromptEngine();
      const fim = prompt.buildFIMPrompt(
        "function fibonacci(n: number): number {\n  if (n < 2) return n;\n  return ",
        "\n}\n",
      );
      const options = prompt.completionOptions();
      process.stdout.write("  warming up… ");
      await ollama.complete(fim, opts.complete, options, undefined, 60_000);
      console.log("done.");
      const cMs: number[] = [];
      for (let i = 0; i < opts.completions; i++) {
        const s = Date.now();
        await ollama.complete(fim, opts.complete, options, undefined, 60_000);
        cMs.push(Date.now() - s);
        process.stdout.write(`\r  ${i + 1}/${opts.completions} completions`);
      }
      console.log(`\n  completion latency: ${summarize(cMs)}`);
    }

    console.log("\n== Done ==");
  } finally {
    await rm(storageDir, { recursive: true, force: true });
    if (generated) await rm(workspace, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
