import mongoose from 'mongoose';

const cache = new Map();

/**
 * HRM migrated from MySQL keeps the old numeric `id` / foreign-key columns.
 * Mongoose normally creates an `id` virtual that aliases `_id`, which collides
 * with the legacy numeric `id`. It can also strip filters for fields that are
 * not declared in an empty schema. Both behaviours break joins such as
 * employee.branch_id -> branches.id and can turn filtered queries into
 * unfiltered queries.
 *
 * This raw model deliberately:
 *  - disables Mongoose's virtual `id`
 *  - declares the legacy `id` field
 *  - keeps strict:false for migrated columns
 *  - forces strictQuery:false so employee_id/branch_id/etc are never stripped
 */
export function rawModel(collectionName) {
  if (cache.has(collectionName)) return cache.get(collectionName);

  const modelName = `Raw_${collectionName.replace(/[^a-zA-Z0-9]/g, '_')}`;
  const schema = new mongoose.Schema(
    { id: { type: mongoose.Schema.Types.Mixed, required: false } },
    {
      strict: false,
      strictQuery: false,
      id: false,
      versionKey: false,
      collection: collectionName,
      minimize: false
    }
  );

  // Be explicit even if the Mongoose global default changes between versions.
  schema.set('strictQuery', false);

  const model = mongoose.models[modelName] || mongoose.model(modelName, schema);
  cache.set(collectionName, model);
  return model;
}

export const Employees = rawModel('employees');
export const Users = rawModel('users');
export const Roles = rawModel('roles');
export const Permissions = rawModel('permissions');
export const UserRoles = rawModel('user_roles');
export const RolePermissions = rawModel('role_permissions');
export const UserPermissions = rawModel('user_permissions');
export const AuditLogs = rawModel('audit_logs');
export const Branches = rawModel('branches');
export const Departments = rawModel('departments');
export const Positions = rawModel('positions');
export const Companies = rawModel('companies');
export const EmployeeDocuments = rawModel('employee_documents');
export const EmployeeDocumentFiles = rawModel('employee_document_files');
export const EmployeeDocumentReviews = rawModel('employee_document_reviews');
export const DocumentTypes = rawModel('document_types');
export const EmployeeContracts = rawModel('employee_contracts');
export const EmployeeContractFiles = rawModel('employee_contract_files');
export const ContractTypes = rawModel('contract_types');
export const ContractStatuses = rawModel('contract_statuses');
export const OnboardingCases = rawModel('onboarding_cases');
export const OnboardingTasks = rawModel('onboarding_tasks');
export const PayrollPeriods = rawModel('payroll_periods');
export const PayrollItems = rawModel('payroll_items');
export const SalaryProfiles = rawModel('salary_profiles');
export const RecruitmentJobs = rawModel('recruitment_jobs');
export const Candidates = rawModel('candidates');
export const CandidateApplications = rawModel('candidate_applications');
export const TrainingCourses = rawModel('training_courses');
export const EmployeeTraining = rawModel('employee_training');
export const EmployeeChangeRequests = rawModel('employee_change_requests');
export const EmployeeStatusHistory = rawModel('employee_status_history');
export const EmployeeDecisions = rawModel('employee_decisions');
export const AttendanceRecords = rawModel('attendance_records');
export const LeaveRequests = rawModel('leave_requests');
export const LeaveTypes = rawModel('leave_types');
