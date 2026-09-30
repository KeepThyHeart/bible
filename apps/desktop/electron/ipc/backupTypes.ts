/**
 * Types of the `backup:*` IPC replies, shared by the main process, the preload
 * and the renderer. Type-only: importing this file pulls in no runtime code.
 */
export type {
  BackupSummary,
  InspectionDto as BackupInspection,
  ApplyResult as BackupApplyResult,
} from '../services/BackupService';
