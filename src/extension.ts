import * as vscode from "vscode";

import { ConfigManager } from "./services/configManager";
import { HardwareDetector, modelsForTier } from "./services/hardwareDetector";
import { OllamaService } from "./services/ollamaService";
import type { Logger } from "./types";

// Phase 1 — Ollama Integration + Hardware Detection (PHASES.md).
//
// On activation the extension runs a developer smoke test (not user-facing yet):
// detect hardware -> pick tier/models -> install/start Ollama -> pull the chat
// model -> send "say hello" -> log the response to the Output Channel. There is
// no observability proxy in v1 (Helicone deferred — DECISIONS 011); the Ollama
// Service talks to Ollama directly.

let ollamaService: OllamaService | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const channel = vscode.window.createOutputChannel("LocalPilot");
  context.subscriptions.push(channel);
  const logger = createLogger(channel);

  context.subscriptions.push(
    vscode.commands.registerCommand("localpilot.helloWorld", () => {
      vscode.window.showInformationMessage("Hello World from LocalPilot!");
    }),
    vscode.commands.registerCommand("localpilot.runSmokeTest", () => {
      void runSmokeTest(context, logger, channel);
    }),
  );

  // Fire-and-forget so a long model pull never blocks VS Code activation.
  void runSmokeTest(context, logger, channel);
}

export function deactivate(): void {
  // Stop the `ollama serve` process if this extension started it.
  ollamaService?.stop();
  ollamaService = undefined;
}

/** Wrap a VS Code OutputChannel in the service-facing Logger interface. */
function createLogger(channel: vscode.OutputChannel): Logger {
  const stamp = (): string => new Date().toISOString();
  return {
    info: (message) => channel.appendLine(`[INFO  ${stamp()}] ${message}`),
    warn: (message) => channel.appendLine(`[WARN  ${stamp()}] ${message}`),
    error: (message, err) => {
      const detail =
        err instanceof Error
          ? ` :: ${err.stack ?? err.message}`
          : err !== undefined
            ? ` :: ${String(err)}`
            : "";
      channel.appendLine(`[ERROR ${stamp()}] ${message}${detail}`);
    },
  };
}

/**
 * Developer smoke test for Phase 1. Surfaces all progress in the Output
 * Channel and never throws — failures are logged and a single notification
 * points the developer to the channel.
 */
async function runSmokeTest(
  context: vscode.ExtensionContext,
  logger: Logger,
  channel: vscode.OutputChannel,
): Promise<void> {
  channel.show(true);
  logger.info("LocalPilot Phase 1 smoke test starting...");

  try {
    const config = new ConfigManager(context.globalStorageUri.fsPath, logger);
    await config.load();

    // 1. Hardware detection + tier mapping.
    const detector = new HardwareDetector(logger);
    const hw = await detector.detect();

    if (!hw.supported) {
      const reason =
        hw.unsupportedReason ?? "LocalPilot v1 supports Apple Silicon only.";
      logger.warn(reason);
      void vscode.window.showWarningMessage(`LocalPilot: ${reason}`);
      return;
    }

    logger.info(
      `Detected: ${hw.chipBrand} — ${hw.totalMemoryGB}GB unified memory, ` +
        `${hw.availableDiskGB}GB free disk, macOS ${hw.macosVersion || "unknown"}. ` +
        `Tier ${hw.tier}.`,
    );
    if (hw.detectionFailed) {
      logger.warn("Hardware detection partially failed; defaulted to Tier 2.");
    }
    if (!hw.metalSupported) {
      logger.warn(
        "macOS is below Ventura (13). Metal acceleration is unavailable; " +
          "models will run on CPU and be slower.",
      );
    }

    // 2. Record tier + model selection in config.json.
    const models = modelsForTier(hw.tier);
    logger.info(
      `Selected models — chat: ${models.chat}, ` +
        `autocomplete: ${models.autocomplete}, embedding: ${models.embedding}`,
    );
    await config.update({
      tier: hw.tier,
      chatModel: models.chat,
      autocompleteModel: models.autocomplete,
      embeddingModel: models.embedding,
    });

    // 3. Ensure Ollama is installed and running.
    ollamaService = new OllamaService({ logger });
    if (!ollamaService.isInstalled()) {
      logger.info("Ollama not found. Installing...");
      await ollamaService.install();
      logger.info("Ollama installed.");
    } else {
      logger.info("Ollama found.");
    }

    if (await ollamaService.isRunning()) {
      logger.info("Ollama is already running.");
    } else {
      logger.info("Starting Ollama daemon...");
      await ollamaService.start();
      logger.info("Ollama is running.");
    }

    // 4. Pull the chat model (idempotent; fast if already present).
    logger.info(
      `Pulling chat model ${models.chat} (first run may take a while)...`,
    );
    let lastPercent = -1;
    await ollamaService.pullModel(models.chat, (progress) => {
      if (progress.percent !== undefined && progress.percent !== lastPercent) {
        lastPercent = progress.percent;
        logger.info(
          `  ${models.chat}: ${progress.status} ${progress.percent}%`,
        );
      }
    });
    logger.info(`Chat model ready: ${models.chat}`);

    // 5. Send a test prompt and log the response.
    logger.info('Sending test prompt: "say hello"...');
    let response = "";
    for await (const token of ollamaService.chat(
      [{ role: "user", content: "say hello" }],
      models.chat,
    )) {
      response += token;
    }
    logger.info(`Model response: ${response.trim()}`);
    logger.info("Phase 1 smoke test complete. ✓");
  } catch (err) {
    logger.error("Phase 1 smoke test failed", err);
    void vscode.window.showErrorMessage(
      "LocalPilot smoke test failed — see the LocalPilot output channel for details.",
    );
  }
}
