// Shared types for LocalPilot. Kept free of any `vscode` import so every
// service that uses these types stays unit-testable under Vitest.

/** Hardware tier (HARDWARE_PROFILES.md). Drives model selection. */
export type Tier = 1 | 2 | 3 | 4;

export type ChipGeneration = "M1" | "M2" | "M3" | "M4" | "unknown";
export type ChipVariant = "base" | "Pro" | "Max" | "Ultra" | "unknown";

/** Result of HardwareDetector.detect(). */
export interface HardwareProfile {
  /** False for Intel Macs (v1 is Apple Silicon only — DECISIONS 001). */
  supported: boolean;
  /** User-facing reason when `supported` is false. */
  unsupportedReason?: string;
  isAppleSilicon: boolean;
  /** Raw `machdep.cpu.brand_string`, e.g. "Apple M3 Pro". */
  chipBrand: string;
  chipGeneration: ChipGeneration;
  chipVariant: ChipVariant;
  /** Total unified memory in GiB, rounded. */
  totalMemoryGB: number;
  /** Free disk in GiB on the home volume. */
  availableDiskGB: number;
  /** macOS product version, e.g. "14.5". */
  macosVersion: string;
  /** Major version number, e.g. 14. */
  macosMajor: number;
  /** Metal GPU acceleration available (macOS 13 Ventura or later). */
  metalSupported: boolean;
  /** Chosen tier after RAM mapping + disk fallback. */
  tier: Tier;
  /** True when detection failed and we defaulted to Tier 2. */
  detectionFailed: boolean;
}

/** The three models a tier uses (HARDWARE_PROFILES.md). */
export interface ModelSet {
  chat: string;
  autocomplete: string;
  embedding: string;
}

/** Per-workspace index state. Populated in Phase 2; open-ended for now. */
export interface WorkspaceIndexState {
  indexed?: boolean;
  fileCount?: number;
  workspaceHash?: string;
}

/** Persisted config.json schema (PHASES.md Phase 1). */
export interface LocalPilotConfig {
  onboardingComplete: boolean;
  tier: Tier | null;
  chatModel: string | null;
  autocompleteModel: string | null;
  embeddingModel: string | null;
  workspaceIndexes: Record<string, WorkspaceIndexState>;
}

/** Minimal logging surface so services don't depend on vscode.OutputChannel. */
export interface Logger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, err?: unknown): void;
}

/** A single chat message in the Ollama /api/chat format. */
export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Ollama sampling options (passed through to /api/chat and /api/generate). */
export interface OllamaRequestOptions {
  temperature?: number;
  top_p?: number;
  stop?: string[];
}

/** Progress event emitted while pulling a model. */
export interface PullProgress {
  /** Ollama's status text, e.g. "pulling manifest", "downloading". */
  status: string;
  /** 0–100 when a percentage is present on the line. */
  percent?: number;
}
