import { describe, expect, it } from "vitest";
import { WorkflowError } from "./errors";
import type { ChainState } from "./types";
import * as wf from "./workflow";

const ADMIN = "GADMIN";
const REPORTER = "GREPORTER";
const TECH = "GTECH";
const VERIFIER = "GVERIFIER";
const POINT = "aa".repeat(32);
const h = (n: number) => n.toString(16).padStart(2, "0").repeat(32);

function base(): ChainState {
  let s: ChainState = { admin: ADMIN, reporters: [], waterPoints: {}, jobs: {}, history: {} };
  s = wf.setReporter(s, ADMIN, REPORTER, true);
  return wf.registerWaterPoint(s, ADMIN, POINT, h(2));
}

function expectError(fn: () => unknown, name: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(WorkflowError);
    expect((e as WorkflowError).errorName).toBe(name);
    return;
  }
  throw new Error(`expected ${name}`);
}

function submitted() {
  let { state: s, jobId } = wf.reportFault(base(), REPORTER, POINT, h(10), 1);
  s = wf.assignJob(s, ADMIN, jobId, TECH, VERIFIER, 2);
  s = wf.submitRepair(s, TECH, jobId, h(20), 3);
  return { s, jobId };
}

describe("lifecycle", () => {
  it("runs report → close and frees the water point", () => {
    let { s, jobId } = submitted();
    s = wf.verifyRepair(s, VERIFIER, jobId, h(30), true, 4);
    s = wf.closeJob(s, ADMIN, jobId, 5);
    expect(s.jobs[jobId]!.status).toBe("Closed");
    expect(s.waterPoints[POINT]!.openJob).toBeNull();
    expect(s.history[jobId]!.map((e) => e.action)).toEqual([
      "Reported",
      "Assigned",
      "RepairSubmitted",
      "RepairApproved",
      "Closed",
    ]);
  });

  it("keeps rejected evidence in history through rework", () => {
    let { s, jobId } = submitted();
    s = wf.verifyRepair(s, VERIFIER, jobId, h(31), false, 4);
    expect(s.jobs[jobId]!.status).toBe("NeedsRework");
    expectError(() => wf.closeJob(s, ADMIN, jobId, 5), "InvalidTransition");
    s = wf.submitRepair(s, TECH, jobId, h(21), 5);
    expect(s.history[jobId]![2]!.reference).toBe(h(20));
    expect(s.jobs[jobId]!.repairReference).toBe(h(21));
  });

  it("cancels, frees the water point, and becomes terminal", () => {
    let { state: s, jobId } = wf.reportFault(base(), REPORTER, POINT, h(10), 1);
    s = wf.cancelJob(s, ADMIN, jobId, h(40), 2);
    expect(s.jobs[jobId]!.status).toBe("Cancelled");
    expect(s.waterPoints[POINT]!.openJob).toBeNull();
    expectError(() => wf.assignJob(s, ADMIN, jobId, TECH, VERIFIER, 3), "InvalidTransition");
    expectError(() => wf.cancelJob(s, ADMIN, jobId, h(41), 3), "InvalidTransition");
    expect(wf.reportFault(s, REPORTER, POINT, h(11), 3).jobId).toBe(2);
  });
});

describe("rules", () => {
  it("rejects unauthorised reporters, inactive points and duplicate open jobs", () => {
    expectError(() => wf.reportFault(base(), "GSTRANGER", POINT, h(10), 1), "ReporterNotAuthorized");
    expectError(() => wf.reportFault(base(), REPORTER, h(99), h(10), 1), "WaterPointNotFound");
    const inactive = wf.setWaterPointActive(base(), ADMIN, POINT, false);
    expectError(() => wf.reportFault(inactive, REPORTER, POINT, h(10), 1), "WaterPointInactive");
    const { state } = wf.reportFault(base(), REPORTER, POINT, h(10), 1);
    expectError(() => wf.reportFault(state, REPORTER, POINT, h(11), 2), "OpenJobExists");
  });

  it("requires the admin for coordinator actions", () => {
    expectError(() => wf.registerWaterPoint(base(), TECH, h(5), h(6)), "Unauthorized");
    const { state, jobId } = wf.reportFault(base(), REPORTER, POINT, h(10), 1);
    expectError(() => wf.assignJob(state, TECH, jobId, TECH, VERIFIER, 2), "Unauthorized");
  });

  it("enforces technician ≠ verifier and leaves state unchanged", () => {
    const { state, jobId } = wf.reportFault(base(), REPORTER, POINT, h(10), 1);
    expectError(() => wf.assignJob(state, ADMIN, jobId, TECH, TECH, 2), "SameTechnicianAndVerifier");
    expect(state.jobs[jobId]!.status).toBe("Reported");
  });

  it("only lets the assigned technician and verifier act", () => {
    const { s, jobId } = submitted();
    expectError(() => wf.verifyRepair(s, TECH, jobId, h(30), true, 4), "NotAssignedVerifier");
    expectError(() => wf.submitRepair(s, VERIFIER, jobId, h(21), 4), "NotAssignedTechnician");
  });

  it("rejects out-of-order and duplicate transitions", () => {
    const { s, jobId } = submitted();
    expectError(() => wf.submitRepair(s, TECH, jobId, h(21), 4), "InvalidTransition");
    expectError(() => wf.cancelJob(s, ADMIN, jobId, h(40), 4), "InvalidTransition");
    expectError(() => wf.assignJob(s, ADMIN, jobId, TECH, VERIFIER, 4), "InvalidTransition");
    expectError(() => wf.closeJob(s, ADMIN, jobId, 4), "InvalidTransition");
  });

  it("caps audit history", () => {
    let { state: s, jobId } = wf.reportFault(base(), REPORTER, POINT, h(10), 1);
    s = wf.assignJob(s, ADMIN, jobId, TECH, VERIFIER, 2);
    for (let i = 0; i < (wf.MAX_HISTORY_LEN - 2) / 2; i++) {
      s = wf.submitRepair(s, TECH, jobId, h(20), 3);
      s = wf.verifyRepair(s, VERIFIER, jobId, h(30), false, 4);
    }
    expect(s.history[jobId]).toHaveLength(wf.MAX_HISTORY_LEN);
    expectError(() => wf.submitRepair(s, TECH, jobId, h(20), 5), "HistoryLimitReached");
  });
});
