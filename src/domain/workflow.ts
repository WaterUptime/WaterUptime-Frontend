// Pure port of the contract state machine (contracts/water_uptime/src/lib.rs).
// Demo mode runs every action through these functions so the UI enforces the
// same rules, in the same order, with the same errors as the contract.

import { WorkflowError } from "./errors";
import type {
  Address,
  AuditEntry,
  ChainState,
  Hex32,
  JobAction,
  JobStatus,
  MaintenanceJob,
} from "./types";

export const MAX_HISTORY_LEN = 50;

const REASSIGNABLE: JobStatus[] = ["Reported", "Assigned", "NeedsRework"];
const SUBMITTABLE: JobStatus[] = ["Assigned", "NeedsRework"];
const CANCELLABLE: JobStatus[] = ["Reported", "Assigned", "NeedsRework"];

export const OPEN_STATUSES: JobStatus[] = [
  "Reported",
  "Assigned",
  "RepairSubmitted",
  "NeedsRework",
  "Verified",
];

export function isTerminal(status: JobStatus): boolean {
  return status === "Closed" || status === "Cancelled";
}

function requireAdmin(state: ChainState, caller: Address): void {
  if (caller !== state.admin) throw new WorkflowError("Unauthorized");
}

function loadJob(state: ChainState, jobId: number): MaintenanceJob {
  const job = state.jobs[jobId];
  if (!job) throw new WorkflowError("JobNotFound");
  return job;
}

/**
 * Fewest audit entries a job in `status` still needs to reach Closed or
 * Cancelled. Mirrors `entries_to_finish` in the contract (lib.rs).
 */
export function entriesToFinish(status: JobStatus): number {
  if (isTerminal(status)) return 0;
  return status === "RepairSubmitted" ? 2 : 1;
}

function record(
  state: ChainState,
  job: MaintenanceJob,
  action: JobAction,
  actor: Address,
  reference: Hex32 | null,
  now: number,
): ChainState {
  const history = state.history[job.id] ?? [];
  // Keep room for the entries the job still needs to finish, as the contract does.
  if (history.length + 1 + entriesToFinish(job.status) > MAX_HISTORY_LEN) {
    throw new WorkflowError("HistoryLimitReached");
  }
  const entry: AuditEntry = { action, actor, reference, timestamp: now };
  return {
    ...state,
    jobs: { ...state.jobs, [job.id]: { ...job, updatedAt: now } },
    history: { ...state.history, [job.id]: [...history, entry] },
  };
}

function releaseWaterPoint(state: ChainState, job: MaintenanceJob): ChainState {
  const point = state.waterPoints[job.waterPointId];
  if (!point || point.openJob !== job.id) return state;
  return {
    ...state,
    waterPoints: { ...state.waterPoints, [point.id]: { ...point, openJob: null } },
  };
}

export function setReporter(
  state: ChainState,
  caller: Address,
  reporter: Address,
  allowed: boolean,
): ChainState {
  requireAdmin(state, caller);
  const others = state.reporters.filter((r) => r !== reporter);
  return { ...state, reporters: allowed ? [...others, reporter] : others };
}

export function registerWaterPoint(
  state: ChainState,
  caller: Address,
  waterPointId: Hex32,
  metadataHash: Hex32,
): ChainState {
  requireAdmin(state, caller);
  if (state.waterPoints[waterPointId]) throw new WorkflowError("WaterPointExists");
  return {
    ...state,
    waterPoints: {
      ...state.waterPoints,
      [waterPointId]: {
        id: waterPointId,
        metadataHash,
        active: true,
        registeredBy: caller,
        openJob: null,
      },
    },
  };
}

export function setWaterPointActive(
  state: ChainState,
  caller: Address,
  waterPointId: Hex32,
  active: boolean,
): ChainState {
  requireAdmin(state, caller);
  const point = state.waterPoints[waterPointId];
  if (!point) throw new WorkflowError("WaterPointNotFound");
  return {
    ...state,
    waterPoints: { ...state.waterPoints, [waterPointId]: { ...point, active } },
  };
}

export function reportFault(
  state: ChainState,
  reporter: Address,
  waterPointId: Hex32,
  faultReference: Hex32,
  now: number,
): { state: ChainState; jobId: number } {
  if (!state.reporters.includes(reporter)) throw new WorkflowError("ReporterNotAuthorized");
  const point = state.waterPoints[waterPointId];
  if (!point) throw new WorkflowError("WaterPointNotFound");
  if (!point.active) throw new WorkflowError("WaterPointInactive");
  if (point.openJob !== null) throw new WorkflowError("OpenJobExists");

  const jobId = Object.keys(state.jobs).length + 1;
  const job: MaintenanceJob = {
    id: jobId,
    waterPointId,
    reporter,
    faultReference,
    status: "Reported",
    technician: null,
    verifier: null,
    repairReference: null,
    verificationReference: null,
    createdAt: now,
    updatedAt: now,
  };
  const withPoint: ChainState = {
    ...state,
    waterPoints: { ...state.waterPoints, [waterPointId]: { ...point, openJob: jobId } },
  };
  return { state: record(withPoint, job, "Reported", reporter, faultReference, now), jobId };
}

export function assignJob(
  state: ChainState,
  caller: Address,
  jobId: number,
  technician: Address,
  verifier: Address,
  now: number,
): ChainState {
  requireAdmin(state, caller);
  if (technician === verifier) throw new WorkflowError("SameTechnicianAndVerifier");
  const job = loadJob(state, jobId);
  if (!REASSIGNABLE.includes(job.status)) throw new WorkflowError("InvalidTransition");
  return record(
    state,
    { ...job, status: "Assigned", technician, verifier },
    "Assigned",
    caller,
    null,
    now,
  );
}

export function submitRepair(
  state: ChainState,
  technician: Address,
  jobId: number,
  repairReference: Hex32,
  now: number,
): ChainState {
  const job = loadJob(state, jobId);
  if (job.technician !== technician) throw new WorkflowError("NotAssignedTechnician");
  if (!SUBMITTABLE.includes(job.status)) throw new WorkflowError("InvalidTransition");
  return record(
    state,
    { ...job, status: "RepairSubmitted", repairReference },
    "RepairSubmitted",
    technician,
    repairReference,
    now,
  );
}

export function verifyRepair(
  state: ChainState,
  verifier: Address,
  jobId: number,
  verificationReference: Hex32,
  approved: boolean,
  now: number,
): ChainState {
  const job = loadJob(state, jobId);
  if (job.verifier !== verifier) throw new WorkflowError("NotAssignedVerifier");
  if (job.status !== "RepairSubmitted") throw new WorkflowError("InvalidTransition");
  return record(
    state,
    { ...job, status: approved ? "Verified" : "NeedsRework", verificationReference },
    approved ? "RepairApproved" : "RepairReturned",
    verifier,
    verificationReference,
    now,
  );
}

export function closeJob(state: ChainState, caller: Address, jobId: number, now: number): ChainState {
  requireAdmin(state, caller);
  const job = loadJob(state, jobId);
  if (job.status !== "Verified") throw new WorkflowError("InvalidTransition");
  const closed: MaintenanceJob = { ...job, status: "Closed" };
  return releaseWaterPoint(record(state, closed, "Closed", caller, null, now), closed);
}

export function cancelJob(
  state: ChainState,
  caller: Address,
  jobId: number,
  reasonReference: Hex32,
  now: number,
): ChainState {
  requireAdmin(state, caller);
  const job = loadJob(state, jobId);
  if (!CANCELLABLE.includes(job.status)) throw new WorkflowError("InvalidTransition");
  const cancelled: MaintenanceJob = { ...job, status: "Cancelled" };
  return releaseWaterPoint(
    record(state, cancelled, "Cancelled", caller, reasonReference, now),
    cancelled,
  );
}

// ---- Read helpers for the UI ----

export type NextStep = "assign" | "submit" | "verify" | "close" | null;

/** The single next workflow step a job is waiting on, and who must take it. */
export function nextStep(job: MaintenanceJob): { step: NextStep; actor: Address | "coordinator" | null } {
  switch (job.status) {
    case "Reported":
      return { step: "assign", actor: "coordinator" };
    case "Assigned":
    case "NeedsRework":
      return { step: "submit", actor: job.technician };
    case "RepairSubmitted":
      return { step: "verify", actor: job.verifier };
    case "Verified":
      return { step: "close", actor: "coordinator" };
    default:
      return { step: null, actor: null };
  }
}

export const canReassign = (s: JobStatus) => REASSIGNABLE.includes(s);
export const canSubmit = (s: JobStatus) => SUBMITTABLE.includes(s);
export const canCancel = (s: JobStatus) => CANCELLABLE.includes(s);
