import { updateEmployeeStatusAction } from "@/app/(app)/employees/actions";

type EmployeeStatusActionProps = {
  employeeId: string;
  status: "ACTIVE" | "TERMINATED" | "DISABLED";
};

export function EmployeeStatusAction({ employeeId, status }: EmployeeStatusActionProps) {
  if (status === "TERMINATED") {
    return <span className="stacked-text">离职状态只能通过待确认主档版本更正</span>;
  }

  const nextStatus = status === "DISABLED" ? "ACTIVE" : "DISABLED";

  return (
    <form action={updateEmployeeStatusAction}>
      <input type="hidden" name="employeeId" value={employeeId} />
      <input type="hidden" name="status" value={nextStatus} />
      <button type="submit">{status === "DISABLED" ? "重新启用" : "停用员工"}</button>
    </form>
  );
}
