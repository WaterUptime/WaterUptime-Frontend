// Contract error codes (contracts/water_uptime/src/types.rs) mapped to plain
// language. Never show a raw `Error(Contract, #9)` to users.

export const ContractErrorCode = {
  AlreadyInitialized: 1,
  NotInitialized: 2,
  WaterPointExists: 3,
  WaterPointNotFound: 4,
  WaterPointInactive: 5,
  ReporterNotAuthorized: 6,
  OpenJobExists: 7,
  JobNotFound: 8,
  InvalidTransition: 9,
  SameTechnicianAndVerifier: 10,
  NotAssignedTechnician: 11,
  NotAssignedVerifier: 12,
  HistoryLimitReached: 13,
} as const;

export type ContractErrorName = keyof typeof ContractErrorCode;

const messages: Record<ContractErrorName, string> = {
  AlreadyInitialized: "The workflow has already been set up.",
  NotInitialized: "The workflow has not been set up yet.",
  WaterPointExists: "A water point with this ID is already registered.",
  WaterPointNotFound: "This water point is not registered.",
  WaterPointInactive: "This water point is inactive and cannot receive new fault reports.",
  ReporterNotAuthorized: "You are not authorised to report faults. Ask the coordinator for access.",
  OpenJobExists: "This water point already has an open job. Follow that job instead of reporting again.",
  JobNotFound: "This job could not be found.",
  InvalidTransition: "That action is not allowed at this stage of the job.",
  SameTechnicianAndVerifier: "The technician and the verifier must be different people.",
  NotAssignedTechnician: "Only the technician assigned to this job can submit repair evidence.",
  NotAssignedVerifier: "Only the verifier assigned to this job can make this decision.",
  HistoryLimitReached:
    "This job has had too many rework rounds to record more. The coordinator can still close or cancel it; then report the fault again as a new job.",
};

export class WorkflowError extends Error {
  readonly code: number;
  readonly errorName: ContractErrorName | "Unauthorized";

  constructor(name: ContractErrorName | "Unauthorized") {
    super(
      name === "Unauthorized"
        ? "Your role is not allowed to perform this action."
        : messages[name],
    );
    this.errorName = name;
    this.code = name === "Unauthorized" ? 0 : ContractErrorCode[name];
  }
}

export function messageForCode(code: number): string {
  const entry = (Object.entries(ContractErrorCode) as [ContractErrorName, number][]).find(
    ([, c]) => c === code,
  );
  return entry ? messages[entry[0]] : "The contract rejected this request.";
}
