import { describe, expect, it } from "vitest";
import {
  assertConfirmedStandardizationDependencies,
  assertPendingProposalStatus,
  assertReviewableMappingCandidate,
  assertReviewableStandardizedInput,
  assertRunWritable,
} from "@/app/(app)/payroll-runs/[runId]/phase8-action-guards";

describe("phase 8 server action guards", () => {
  it("blocks reviewed proposals and locked payroll runs", () => {
    expect(() => assertPendingProposalStatus("REJECTED")).toThrow("CHANGE_PROPOSAL_ALREADY_REVIEWED");
    expect(() => assertPendingProposalStatus("PENDING_REVIEW", true)).toThrow(
      "CHANGE_PROPOSAL_ALREADY_REVIEWED",
    );
    expect(() => assertRunWritable({ status: "LOCKED" })).toThrow("LOCKED_RUN_REQUIRES_CORRECTION_RUN");
    expect(() => assertRunWritable({ status: "DRAFT", lockedAt: new Date() })).toThrow(
      "LOCKED_RUN_REQUIRES_CORRECTION_RUN",
    );
  });

  it("blocks repeated mapping confirmation and non-preview standardized inputs", () => {
    expect(() => assertReviewableMappingCandidate("CONFIRMED")).toThrow(
      "FIELD_MAPPING_CANDIDATE_NOT_REVIEWABLE",
    );
    expect(() => assertReviewableStandardizedInput("CONFIRMED")).toThrow(
      "STANDARDIZED_INPUT_NOT_REVIEWABLE",
    );
  });

  it("requires confirmed mapping and confirmed employee match before standardization", () => {
    expect(() =>
      assertConfirmedStandardizationDependencies({ clientId: "client-a", runId: "run-a" }),
    ).toThrow("FIELD_MAPPING_REQUIRED");
    expect(() =>
      assertConfirmedStandardizationDependencies({
        clientId: "client-a",
        runId: "run-a",
        fieldMappingVersionId: "mapping-a",
        fieldMappingVersion: {
          clientId: "client-a",
          runId: "run-a",
          status: "CONFIRMED",
          confidence: "HIGH",
        },
      }),
    ).toThrow("EMPLOYEE_MATCH_REQUIRED");
    expect(() =>
      assertConfirmedStandardizationDependencies({
        clientId: "client-a",
        runId: "run-a",
        fieldMappingVersionId: "mapping-a",
        fieldMappingVersion: {
          clientId: "client-a",
          runId: "run-a",
          status: "CONFIRMED",
          confidence: "HIGH",
        },
        employeeMatchCandidateId: "match-a",
        employeeMatchCandidate: {
          clientId: "client-a",
          runId: "run-a",
          status: "CONFIRMED",
          employeeId: "emp-a",
        },
      }),
    ).not.toThrow();
  });
});
