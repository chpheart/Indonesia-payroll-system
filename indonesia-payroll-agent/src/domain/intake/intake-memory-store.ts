import {
  IntakeServiceError,
  type CaseItemDraft,
  type IntakeStore,
  type RawInputDraft,
  type RawInputRecord,
  type RawInputStatus,
} from "@/domain/intake/intake-service";

export class InMemoryIntakeStore implements IntakeStore {
  readonly rawInputs = new Map<string, RawInputRecord>();
  readonly cases: CaseItemDraft[] = [];
  readonly runs = new Map<string, { id: string; clientId: string; payrollMonth: string }>();
  private sequence = 0;

  async findRunById(id: string) {
    return this.runs.get(id) ?? null;
  }

  async findDuplicateRawInput(input: {
    contentHash: string;
    clientId?: string | null;
    payrollMonth?: string | null;
  }) {
    return (
      Array.from(this.rawInputs.values()).find(
        (item) =>
          item.contentHash === input.contentHash &&
          item.clientId === (input.clientId ?? null) &&
          item.payrollMonth === (input.payrollMonth ?? null),
      ) ?? null
    );
  }

  async createRawInput(input: RawInputDraft) {
    this.sequence += 1;
    const record: RawInputRecord = {
      ...input,
      id: `raw-${this.sequence}`,
      evidenceCandidateRefs: [],
    };
    this.rawInputs.set(record.id, structuredClone(record));

    return structuredClone(record);
  }

  async updateRawInput(input: {
    id: string;
    clientId?: string | null;
    payrollMonth?: string | null;
    runId?: string | null;
    status?: RawInputStatus;
    evidenceCandidateRefs?: string[];
  }) {
    const current = this.rawInputs.get(input.id);
    if (!current) {
      throw new IntakeServiceError("RAW_INPUT_NOT_FOUND");
    }

    const updated = { ...current, ...input };
    this.rawInputs.set(updated.id, structuredClone(updated));

    return structuredClone(updated);
  }

  async createCaseItem(input: CaseItemDraft) {
    this.cases.push(structuredClone(input));
  }
}
